import { randomUUID } from "node:crypto";

import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import {
  clone,
  create,
  ScalarType,
  toBinary,
  type DescField,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import {
  AnySchema,
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  EmptySchema,
  FloatValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  UInt32ValueSchema,
  UInt64ValueSchema,
} from "@bufbuild/protobuf/wkt";
import type { MessageSchema } from "@spine-event-engine/core";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-event-engine/core";
import {
  CommandIdSchema,
  type Command,
  type Event,
  EventSchema,
  type TenantId,
  ValidationErrorSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { ErrorSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import type {
  CompositeFilter,
  Filter,
  Target,
  TargetFilters,
} from "@spine-event-engine/proto/client";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
} from "@spine-event-engine/proto/client";
import {
  EntityStateWithVersionSchema,
  OrderBy_Direction,
  QueryResponseSchema,
  type Query,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  EventUpdatesSchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
  type Subscription,
  type SubscriptionUpdate,
  type Topic,
} from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { AckSchema, type Ack } from "@spine-event-engine/proto";
import {
  ResponseSchema,
  StatusSchema,
  type Response,
  type Status,
} from "@spine-event-engine/proto";
import {
  RecordMask,
  type NormalizedComparisonOperator,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";

import { boundedContextAccess, type BoundedContext } from "../context/bounded-context.js";
import { CommandValidationError } from "../bus/command-errors.js";
import type { EntityFamily } from "../entity/entity.js";
import { TransitionValidationError } from "../repository/command-errors.js";
import type { StandReadResult, StandUpdate } from "../stand/stand.js";
import {
  DurableSubscriptionRecords,
  durableSubscriptionRecordSpec,
  type DurableSubscriptionRecord,
} from "./subscription-records.js";

/**
 * Small route registrar for the first public Spine gRPC service slice.
 *
 * `QueryService.Read` supports ID filters for any registered state route,
 * projection-state `include_all = true` reads, top-level equality filters over
 * declared projection `(column)` proto field names, field masks, ordering by
 * declared proto columns, and bounded result sets. An absent response format or
 * zero wire limit receives an implicit 1,000-row cap without requiring
 * ordering; a positive limit requires at least one ordering directive. Use
 * proto column names such as `open_task_count`, not generated TS local names
 * such as `openTaskCount`; undeclared columns return stable `INVALID_QUERY`
 * responses before Stand storage is read. Unsupported query operators and
 * shapes also return stable `INVALID_QUERY` responses before Stand storage is
 * read.
 *
 * `SubscriptionService.Subscribe` accepts known state targets with
 * `include_all` or validated ID/field filters and known event targets exposed
 * by built-context event dispatchers with `include_all = true`. It stores a
 * durable inactive record that can be recovered before expiry, and attaches
 * delivery only when the opaque subscription ID is activated: state
 * subscriptions attach to `Stand`, while
 * event subscriptions attach to a framework-internal `EventBus` listener.
 * Filtered state topics deliver matching states, emit `no_longer_matching`
 * when previous state matched and new state does not, and apply topic masks
 * only to delivered states. Event topics stream wire-level `event_updates`
 * containing cloned framework `Event` envelopes; rejection updates omit
 * rejected-command payload forms and stack trace from their client-facing
 * context.
 * Application code remains on generated domain event messages through handler
 * dispatch. Unknown or duplicate activation IDs complete without updates.
 * Cancellation of unknown or already-cleaned IDs returns OK after admission to
 * the bounded unknown-removal pool.
 */
export class SpineServices {
  readonly #contexts: readonly BoundedContext[];
  readonly #commandRoutes = new Map<string, CommandRoute>();
  readonly #stateRoutes = new Map<string, StateRoute>();
  readonly #eventRoutes = new Map<string, EventRoute>();
  readonly #subscriptions = new Map<string, SubscriptionRecord>();
  readonly #subscriptionReservations = new Set<string>();
  readonly #claims = new Map<string, SubscriptionClaim>();
  readonly #removals = new Map<string, SubscriptionRemoval>();
  readonly #unknownRemovals = new Set<string>();
  readonly #subscriptionStores: readonly SubscriptionStore[];
  readonly #inactiveTtlMs: number;
  readonly #queueLimit: number;
  readonly #subscriptionLimit: number;

  /** Create service adapters over the passed built bounded contexts. */
  constructor(options: SpineServicesOptions) {
    this.#contexts = Object.freeze([...options.contexts]);
    this.#inactiveTtlMs = inactiveTtl(options.inactiveTtlMs ?? DEFAULT_INACTIVE_TTL_MS);
    this.#queueLimit = positiveInteger(options.queueLimit ?? DEFAULT_QUEUE_LIMIT);
    this.#subscriptionLimit = subscriptionLimit(
      options.subscriptionLimit ?? DEFAULT_SUBSCRIPTION_LIMIT,
    );

    for (const context of this.#contexts) {
      for (const typeUrl of context.commandBus().acceptedCommandTypes()) {
        if (!this.#commandRoutes.has(typeUrl)) {
          this.#commandRoutes.set(typeUrl, { context, typeUrl });
        }
      }

      for (const repository of context.registeredRepositories()) {
        const schema = repository.stateSchema;
        const typeUrl = deriveTypeUrl(schema);
        const declaredColumns = repository.metadata.columns.map((column) => column.name);
        const systemColumns = ["version", "archived", "deleted"];
        this.#stateRoutes.set(typeUrl, {
          allowedColumnNames: new Set([...declaredColumns, ...systemColumns]),
          columnFields: new Map(
            repository.metadata.columns.flatMap((column) => {
              const field = schema.fields.find((candidate) => candidate.name === column.name);
              return field === undefined ? [] : [[column.name, field] as const];
            }),
          ),
          context,
          entityFamily: repository.entityFamily,
          idField: stateRouteIdField(schema, repository.idField),
          kind: "state",
          schema,
          typeUrl,
        });
      }

      for (const typeUrl of context.eventBus().acceptedEventTypes()) {
        if (!this.#eventRoutes.has(typeUrl)) {
          this.#eventRoutes.set(typeUrl, { context, kind: "event", typeUrl });
        }
      }
    }
    this.#subscriptionStores = Object.freeze(
      uniqueContexts(this.#contexts).flatMap((context) => {
        const store = subscriptionStore(context);

        return store === undefined ? [] : [store];
      }),
    );
  }

  /** Register CommandService, QueryService, and SubscriptionService routes. */
  register(router: ConnectRouter): ConnectRouter {
    router.service(CommandService, {
      post: (command) => this.#post(command),
    });
    router.service(QueryService, {
      read: (query) => this.#read(query),
    });
    router.service(SubscriptionService, {
      subscribe: (topic) => this.#subscribe(topic),
      activate: (subscription) => this.#activate(subscription),
      cancel: (subscription) => this.#cancel(subscription),
    });
    return router;
  }

  async #post(command: Command): Promise<Ack> {
    const messageId = command.id && packAny(CommandIdSchema, command.id, { validate: false });
    const typeUrl = command.message?.typeUrl;

    if (typeUrl === undefined || typeUrl.length === 0) {
      return create(AckSchema, {
        messageId,
        status: errorStatus("INVALID_COMMAND", "Command message type is required."),
      });
    }

    const route = this.#commandRoutes.get(typeUrl);
    if (route === undefined) {
      return create(AckSchema, {
        messageId,
        status: errorStatus("UNSUPPORTED_COMMAND", "No bounded context accepted the command."),
      });
    }

    const tenantError = tenantMismatch(
      route.context.isMultitenant,
      commandTenant(command),
      "command",
    );
    if (tenantError !== undefined) {
      return create(AckSchema, {
        messageId,
        status: errorStatus(tenantError.type, tenantError.message),
      });
    }

    try {
      await route.context.commandBus().post(command);
      return create(AckSchema, {
        messageId,
        status: okStatus(),
      });
    } catch (error) {
      const postError = commandPostError(error);

      return create(AckSchema, {
        messageId,
        status: errorStatus(postError.type, postError.message, postError.details),
      });
    }
  }

  async #read(query: Query): Promise<QueryResponse> {
    const target = query.target;
    const route = this.#readRoute(target);

    if (target === undefined || route === undefined) {
      return queryErrorResponse(
        "UNSUPPORTED_QUERY_TARGET",
        "No bounded context owns query target.",
      );
    }

    const queryError = validateReadQuery(query, target, route);
    if (queryError !== undefined) {
      return queryErrorResponse(queryError.type, queryError.message);
    }

    const tenantId = tenantValue(query.context?.tenantId);
    const tenantError = tenantMismatch(route.context.isMultitenant, tenantId, "query");
    if (tenantError !== undefined) {
      return queryErrorResponse(tenantError.type, tenantError.message);
    }

    try {
      return await this.#query(route, createReadPlan(target, query, route), tenantId);
    } catch {
      return queryErrorResponse("QUERY_READ_ERROR", "Query read failed.");
    }
  }

  #readRoute(target: Target | undefined): StateRoute | undefined {
    return target === undefined ? undefined : this.#stateRoutes.get(target.type);
  }

  async #query(
    route: StateRoute,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: string | undefined,
  ): Promise<QueryResponse> {
    const boundedPlan: NormalizedQueryPlan<unknown> = {
      ...plan,
      candidateLimit: MAX_QUERY_LIMIT,
    };
    const results = await route.context
      .stand()
      .queryPlanVersioned(route.schema, boundedPlan, tenantOptions(tenantId));

    return create(QueryResponseSchema, {
      response: okResponse(),
      message: results.map((result) => packVersionedState(route.schema, result)),
    });
  }

  #subscribe(topic: Topic): Subscription | Promise<Subscription> {
    const route = this.#subscriptionRoute(topic);
    validateTopic(topic);
    const shape = createSubscriptionShape(topic, route);
    const tenantId = topicTenant(topic);
    const tenantError = tenantMismatch(route.context.isMultitenant, tenantId, "subscription");

    if (tenantError !== undefined) {
      throw new ConnectError(tenantError.message, Code.InvalidArgument);
    }

    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${randomUUID()}` }),
      topic: clone(TopicSchema, topic),
    });
    const id = subscription.id?.value;

    if (id === undefined) {
      throw new ConnectError("Subscription ID is required.", Code.InvalidArgument);
    }

    const record = createSubscriptionRecord({
      id,
      subscription,
      shape,
      tenantId,
      expiresAtMs: Date.now() + this.#inactiveTtlMs,
      queueLimit: this.#queueLimit,
    });
    const reservation = this.#reserveSubscription(id);
    if (reservation === undefined) {
      throw new ConnectError("Subscription ID is already reserved.", Code.AlreadyExists);
    }
    record.reservation = reservation;
    return this.#completeSubscription(record, subscription);
  }

  async #completeSubscription(
    record: SubscriptionRecord,
    subscription: Subscription,
  ): Promise<Subscription> {
    try {
      await this.#persistSubscription(record);
      this.#rememberSubscription(record);
      return clone(SubscriptionSchema, subscription);
    } catch (error) {
      try {
        await this.#cancelPersistence(record.id, record.route.context, undefined);
      } catch {
        this.#retainFailedSetup(record);
        throw error;
      }
      this.#releaseRecord(record);
      throw error;
    }
  }

  #retainFailedSetup(record: SubscriptionRecord): void {
    record.delivery.close();
    try {
      this.#rememberSubscription(record);
    } catch {
      this.#subscriptions.set(record.id, record);
      queueMicrotask(() => {
        void this.#runTimerlessCleanup(record);
      });
    }
  }

  async #runTimerlessCleanup(record: SubscriptionRecord): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.#removeSubscription(record.id);
        return;
      } catch {
        // A retained failed Subscribe is bounded and inert after both attempts.
      }
    }
  }

  #rememberSubscription(record: SubscriptionRecord): void {
    record.inactiveTimer = setTimeout(
      () => {
        void this.#removeSubscription(record.id).catch(() => undefined);
      },
      Math.max(1, record.expiresAtMs - Date.now()),
    );
    record.inactiveTimer.unref();
    this.#subscriptions.set(record.id, record);
  }

  async *#activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate> {
    const id = subscription.id?.value;
    if (id === undefined) {
      return;
    }

    const local = this.#subscriptions.get(id);
    if (local?.delivery.closed === true) {
      return;
    }
    const record = local ?? (await this.#recoverSubscription(id));

    if (record === undefined) {
      return;
    }

    if (record.delivery.active) {
      return;
    }

    if (local !== undefined) {
      const outcome = await this.#claimSubscription(record, false);
      if (outcome !== "claimed") {
        if (outcome === "lost") {
          this.#forgetSubscription(record);
        }
        return;
      }
    }

    const claim = this.#claims.get(id);
    if (record.delivery.closed || claim?.canceled === true) {
      return;
    }

    try {
      this.#activateRecord(record);
    } catch (error) {
      try {
        await this.#removeSubscription(id);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Subscription activation and cleanup failed.",
        );
      }
      throw error;
    }

    try {
      for (;;) {
        const update = await record.delivery.next();
        if (update === undefined) {
          return;
        }
        yield update;
      }
    } finally {
      await this.#removeSubscription(id);
    }
  }

  #cancel(subscription: Subscription): Response | Promise<Response> {
    const id = subscription.id?.value;

    if (id === undefined) {
      return okResponse();
    }

    return this.#removeSubscription(id).then(() => okResponse());
  }

  #subscriptionRoute(topic: Topic): SubscriptionRoute {
    const target = topic.target;
    const route =
      target === undefined
        ? undefined
        : (this.#stateRoutes.get(target.type) ?? this.#eventRoutes.get(target.type));

    if (target === undefined || route === undefined) {
      throw new ConnectError("Unsupported subscription target.", Code.InvalidArgument);
    }

    return route;
  }

  #activateRecord(record: SubscriptionRecord): void {
    clearInactiveTimer(record);
    if (record.kind === "event") {
      const eventSubscription = boundedContextAccess.subscribeToEvent(
        record.route.context,
        record.route.typeUrl,
        {
          onEvent: (event) => {
            if (!eventTenantMatches(record, event)) {
              return;
            }
            record.delivery.push(createEventUpdate(record, event));
            if (record.delivery.closed) {
              void this.#removeSubscription(record.id).catch(() => undefined);
            }
          },
        },
      );
      record.delivery.attach(eventSubscription);
      return;
    }

    const stateRecord = record;
    const standSubscription = stateRecord.route.context.stand().subscribe(
      stateRecord.route.schema,
      (update) => {
        const subscriptionUpdate = createEntityUpdate(stateRecord, update);
        if (subscriptionUpdate !== undefined) {
          stateRecord.delivery.push(subscriptionUpdate);
        }
        if (stateRecord.delivery.closed) {
          void this.#removeSubscription(stateRecord.id).catch(() => undefined);
        }
      },
      tenantOptions(stateRecord.tenantId),
    );
    stateRecord.delivery.attach(standSubscription);
  }

  #removeSubscription(id: string): Promise<void> {
    const existing = this.#removals.get(id);
    if (existing !== undefined) {
      return existing.settled;
    }

    const record = this.#subscriptions.get(id);
    const claim = this.#claims.get(id);
    const local = record ?? claim?.record;
    const unknown = local === undefined;
    if (unknown && this.#unknownRemovals.size >= this.#subscriptionLimit) {
      return Promise.reject(
        new ConnectError(
          "Subscription cancellation capacity is exhausted.",
          Code.ResourceExhausted,
        ),
      );
    }
    if (unknown) {
      this.#unknownRemovals.add(id);
    } else {
      if (claim !== undefined) {
        claim.canceled = true;
      }
      clearInactiveTimer(local);
      local.delivery.close();
      this.#subscriptions.delete(id);
    }

    const removal = createSubscriptionRemoval();
    this.#removals.set(id, removal);
    void this.#runRemoval(id, removal, local, claim, unknown);
    return removal.settled;
  }

  async #runRemoval(
    id: string,
    removal: SubscriptionRemoval,
    record: SubscriptionRecord | undefined,
    claim: SubscriptionClaim | undefined,
    unknown: boolean,
  ): Promise<void> {
    try {
      await this.#cancelPersistence(id, record?.route.context, claim?.owner);
      this.#releaseLocal(id, record, claim);
      removal.resolve();
    } catch (error) {
      this.#retainRecord(record);
      removal.reject(error);
    } finally {
      if (unknown) {
        this.#unknownRemovals.delete(id);
      }
      if (this.#removals.get(id) === removal) {
        this.#removals.delete(id);
      }
    }
  }

  async #persistSubscription(record: SubscriptionRecord): Promise<void> {
    const durable = DurableSubscriptionRecords.write({
      id: record.id,
      kind: record.kind,
      targetType: record.route.typeUrl,
      ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
      subscription: record.subscription,
      expiresAtMs: record.expiresAtMs,
    });
    record.durableState = durable;
    const storage = this.#subscriptionStorage(record.route.context);
    if (storage === undefined) {
      return;
    }

    try {
      await storage.write(durable);
    } finally {
      storage.close();
    }
  }

  async #recoverSubscription(id: string): Promise<SubscriptionRecord | undefined> {
    for (const store of this.#subscriptionStores) {
      const removal = this.#removals.get(id);
      if (removal !== undefined) {
        await observeRemoval(removal);
        return undefined;
      }
      const outcome = await this.#recoverFromStore(id, store);
      if (outcome.status === "complete") {
        return outcome.record;
      }
    }

    return undefined;
  }

  async #recoverFromStore(
    id: string,
    store: SubscriptionStore,
  ): Promise<SubscriptionRecoveryOutcome> {
    const storage = createSubscriptionStorage(store);
    try {
      const durable = await storage.read(id);
      const removal = this.#removals.get(id);
      if (removal !== undefined) {
        await observeRemoval(removal);
        return { status: "complete", record: undefined };
      }
      if (durable === undefined) {
        return { status: "continue" };
      }

      let state;
      try {
        state = DurableSubscriptionRecords.readState(durable, id);
      } catch {
        return { status: "complete", record: undefined };
      }
      if (state.type === "claim") {
        return { status: "complete", record: undefined };
      }
      if (state.type === "cancel") {
        await this.#clearMarker(storage, id, durable);
        return { status: "complete", record: undefined };
      }

      const record = this.#restoreSubscription(state.record);
      if (record === undefined) {
        await this.#clearInactive(storage, id, durable);
        return { status: "complete", record: undefined };
      }
      record.durableState = durable;
      const outcome = await this.#claimSubscription(record, true);
      return {
        status: "complete",
        record: outcome === "claimed" ? record : undefined,
      };
    } finally {
      storage.close();
    }
  }

  async #claimSubscription(
    record: SubscriptionRecord,
    remember: boolean,
  ): Promise<SubscriptionClaimOutcome> {
    const claim = this.#beginClaim(record);
    if (claim === undefined) {
      return "duplicate";
    }

    const storage = this.#subscriptionStorage(record.route.context);
    try {
      const durableOutcome = await this.#claimDurable(storage, record, claim);
      claim.claimed = durableOutcome === "claimed";
      if (!claim.claimed) {
        return claim.canceled || durableOutcome === "canceled" ? "canceled" : "lost";
      }
      record.durableState = claim.state;
      if (claim.canceled) {
        return "canceled";
      }
      if (remember) {
        await this.#rememberClaim(record, claim, storage);
      }
      return "claimed";
    } finally {
      storage?.close();
      this.#finishClaim(record, claim);
    }
  }

  #beginClaim(record: SubscriptionRecord): SubscriptionClaim | undefined {
    if (this.#claims.has(record.id)) {
      return undefined;
    }
    const reservation = record.reservation ?? this.#reserveSubscription(record.id);
    if (reservation === undefined) {
      return undefined;
    }
    record.reservation = reservation;
    const claim = createSubscriptionClaim(record);
    this.#claims.set(record.id, claim);
    return claim;
  }

  async #rememberClaim(
    record: SubscriptionRecord,
    claim: SubscriptionClaim,
    storage: RecordStorage<string, Any> | undefined,
  ): Promise<void> {
    try {
      this.#rememberSubscription(record);
    } catch (error) {
      claim.canceled = true;
      await this.#rollbackClaim(record, claim, storage);
      throw error;
    }
  }

  async #rollbackClaim(
    record: SubscriptionRecord,
    claim: SubscriptionClaim,
    storage: RecordStorage<string, Any> | undefined,
  ): Promise<void> {
    let settled = storage === undefined;
    if (storage !== undefined) {
      try {
        await this.#cancelStored(storage, record.id, claim.owner);
        settled = true;
      } catch {
        // Preserve the process-local registration failure.
      }
    }
    if (settled) {
      this.#releaseLocal(record.id, record, claim);
    }
  }

  #finishClaim(record: SubscriptionRecord, claim: SubscriptionClaim): void {
    if (claim.claimed || claim.canceled || claim.unknown) {
      return;
    }
    if (this.#claims.get(record.id) === claim) {
      this.#claims.delete(record.id);
    }
    if (!this.#subscriptions.has(record.id)) {
      this.#releaseRecord(record);
    }
  }

  async #claimDurable(
    storage: RecordStorage<string, Any> | undefined,
    record: SubscriptionRecord,
    claim: SubscriptionClaim,
  ): Promise<DurableClaimOutcome> {
    if (storage === undefined) {
      return "claimed";
    }
    if (record.durableState === undefined) {
      return "lost";
    }
    try {
      return (await storage.compareAndSet(record.id, record.durableState, claim.state))
        ? "claimed"
        : "lost";
    } catch (error) {
      return await this.#reconcileClaimError(storage, record, claim, error);
    }
  }

  async #reconcileClaimError(
    storage: RecordStorage<string, Any>,
    record: SubscriptionRecord,
    claim: SubscriptionClaim,
    error: unknown,
  ): Promise<DurableClaimOutcome> {
    let current: Any | undefined;
    try {
      current = await storage.read(record.id);
    } catch {
      claim.unknown = true;
      throw error;
    }
    if (sameAny(current, claim.state)) {
      return "claimed";
    }
    if (sameAny(current, record.durableState)) {
      throw error;
    }
    if (current === undefined) {
      return "lost";
    }
    try {
      return DurableSubscriptionRecords.readState(current, record.id).type === "cancel"
        ? "canceled"
        : "lost";
    } catch {
      claim.unknown = true;
      throw error;
    }
  }

  #restoreSubscription(stored: DurableSubscriptionRecord): SubscriptionRecord | undefined {
    if (stored.expiresAtMs <= Date.now()) {
      return undefined;
    }

    const route =
      stored.kind === "event"
        ? this.#eventRoutes.get(stored.targetType)
        : this.#stateRoutes.get(stored.targetType);
    const topic = stored.subscription.topic;
    const target = topic?.target;

    if (
      route === undefined ||
      topic === undefined ||
      target?.type !== stored.targetType ||
      topicTenant(topic) !== stored.tenantId
    ) {
      return undefined;
    }

    const tenantError = tenantMismatch(
      route.context.isMultitenant,
      stored.tenantId,
      "subscription",
    );
    if (tenantError !== undefined) {
      return undefined;
    }

    return createSubscriptionRecord({
      id: stored.id,
      subscription: stored.subscription,
      shape: createSubscriptionShape(topic, route),
      tenantId: stored.tenantId,
      expiresAtMs: stored.expiresAtMs,
      queueLimit: this.#queueLimit,
    });
  }

  async #cancelPersistence(
    id: string,
    context: BoundedContext | undefined,
    owner: string | undefined,
  ): Promise<void> {
    const stores =
      context === undefined
        ? this.#subscriptionStores
        : this.#subscriptionStores.filter((store) => store.context === context);

    for (const store of stores) {
      const storage = createSubscriptionStorage(store);
      try {
        await this.#cancelStored(storage, id, owner);
      } finally {
        storage.close();
      }
    }
  }

  async #cancelStored(
    storage: RecordStorage<string, Any>,
    id: string,
    owner: string | undefined,
  ): Promise<void> {
    try {
      await this.#settleCancellation(storage, id, owner);
    } catch (error) {
      if (isCancellationConflict(error)) {
        throw error;
      }
      throw cancellationFailedError();
    }
  }

  async #settleCancellation(
    storage: RecordStorage<string, Any>,
    id: string,
    owner: string | undefined,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_CANCEL_RETRIES; attempt += 1) {
      const current = await storage.read(id);
      if (current === undefined) {
        return;
      }
      const state = DurableSubscriptionRecords.readState(current, id);
      if (state.type === "claim" && state.owner !== owner) {
        throw foreignSubscriptionError();
      }
      const marker = state.type === "cancel" ? current : DurableSubscriptionRecords.cancel(id);
      if (state.type !== "cancel" && !(await storage.compareAndSet(id, current, marker))) {
        continue;
      }
      if (await storage.compareAndSet(id, marker, undefined)) {
        return;
      }
      if ((await storage.read(id)) === undefined) {
        return;
      }
    }
    throw concurrentCancellationError();
  }

  async #clearMarker(storage: RecordStorage<string, Any>, id: string, marker: Any): Promise<void> {
    try {
      await storage.compareAndSet(id, marker, undefined);
    } catch {
      // Preserve the marker as a recovery fence.
    }
  }

  async #clearInactive(
    storage: RecordStorage<string, Any>,
    id: string,
    inactive: Any,
  ): Promise<void> {
    const marker = DurableSubscriptionRecords.cancel(id);
    try {
      if (await storage.compareAndSet(id, inactive, marker)) {
        await storage.compareAndSet(id, marker, undefined);
      }
    } catch {
      // Invalid or expired durable state remains inert on cleanup failure.
    }
  }

  #forgetSubscription(record: SubscriptionRecord): void {
    clearInactiveTimer(record);
    record.delivery.close();
    this.#subscriptions.delete(record.id);
    this.#releaseRecord(record);
  }

  #releaseLocal(
    id: string,
    record: SubscriptionRecord | undefined,
    claim: SubscriptionClaim | undefined,
  ): void {
    if (record !== undefined) {
      if (this.#subscriptions.get(id) === record) {
        this.#subscriptions.delete(id);
      }
      this.#releaseRecord(record);
    }
    if (claim !== undefined && this.#claims.get(id) === claim) {
      this.#claims.delete(id);
    }
  }

  #retainRecord(record: SubscriptionRecord | undefined): void {
    if (record !== undefined && !this.#subscriptions.has(record.id)) {
      this.#subscriptions.set(record.id, record);
    }
  }

  #subscriptionStorage(context: BoundedContext): RecordStorage<string, Any> | undefined {
    const store = this.#subscriptionStores.find((candidate) => candidate.context === context);

    if (store === undefined) {
      return undefined;
    }

    return createSubscriptionStorage(store);
  }

  #reserveSubscription(id: string): SubscriptionReservation | undefined {
    if (this.#subscriptionReservations.has(id)) {
      return undefined;
    }
    if (this.#subscriptionReservations.size >= this.#subscriptionLimit) {
      throw new ConnectError("Subscription capacity is exhausted.", Code.ResourceExhausted);
    }
    this.#subscriptionReservations.add(id);
    return { id, released: false };
  }

  #releaseSubscription(reservation: SubscriptionReservation): void {
    if (reservation.released) {
      return;
    }
    reservation.released = true;
    this.#subscriptionReservations.delete(reservation.id);
  }

  #releaseRecord(record: SubscriptionRecord): void {
    const reservation = record.reservation;
    if (reservation === undefined) {
      return;
    }
    record.reservation = undefined;
    this.#releaseSubscription(reservation);
  }
}

/** Options for registering Spine service adapters over built bounded contexts. */
export interface SpineServicesOptions {
  /** Contexts exposed by these service adapters. */
  readonly contexts: readonly BoundedContext[];
  /**
   * Milliseconds until a never-activated durable subscription record becomes ineligible for activation.
   *
   * Defaults to 30 seconds. Non-positive or non-finite values are coerced to 1;
   * positive finite values are floored and must not exceed 2,147,483,647.
   */
  readonly inactiveTtlMs?: number;
  /**
   * Maximum queued updates per active subscription before delivery is closed.
   *
   * Defaults to 100. Non-positive or non-finite values are coerced to 1.
   */
  readonly queueLimit?: number;
  /**
   * Maximum subscriptions owned by this `SpineServices` instance.
   *
   * The limit includes pending, inactive, active, and recovered work. It defaults
   * to 100 and must be a positive safe integer. Each instance has an independent
   * limit; this is neither a process-wide nor a distributed quota.
   */
  readonly subscriptionLimit?: number;
}

interface CommandRoute {
  readonly context: BoundedContext;
  readonly typeUrl: string;
}

interface StateRoute {
  readonly allowedColumnNames: ReadonlySet<string>;
  readonly columnFields: ReadonlyMap<string, DescField>;
  readonly context: BoundedContext;
  readonly entityFamily: EntityFamily;
  readonly idField: MessageFieldInfo;
  readonly kind: "state";
  readonly schema: MessageSchema;
  readonly typeUrl: string;
}

interface EventRoute {
  readonly context: BoundedContext;
  readonly kind: "event";
  readonly typeUrl: string;
}

type SubscriptionRoute = StateRoute | EventRoute;

interface SubscriptionRecordBase {
  readonly id: string;
  readonly subscription: Subscription;
  readonly tenantId: string | undefined;
  readonly expiresAtMs: number;
  readonly delivery: SubscriptionDelivery;
  durableState: Any | undefined;
  inactiveTimer: ReturnType<typeof setTimeout> | undefined;
  reservation: SubscriptionReservation | undefined;
}

interface SubscriptionReservation {
  readonly id: string;
  released: boolean;
}

interface SubscriptionClaim {
  canceled: boolean;
  claimed: boolean;
  unknown: boolean;
  readonly owner: string;
  readonly record: SubscriptionRecord;
  readonly state: Any;
}

interface SubscriptionRemoval {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: () => void;
  readonly settled: Promise<void>;
}

type SubscriptionRecoveryOutcome =
  | { readonly status: "continue" }
  | { readonly status: "complete"; readonly record: SubscriptionRecord | undefined };

type DurableClaimOutcome = "claimed" | "lost" | "canceled";

type SubscriptionClaimOutcome = "claimed" | "duplicate" | "lost" | "canceled";

type SubscriptionRecord = EventSubscriptionRecord | StateSubscriptionRecord;

interface EventSubscriptionRecord extends SubscriptionRecordBase {
  readonly kind: "event";
  readonly route: EventRoute;
}

interface StateSubscriptionRecord extends SubscriptionRecordBase {
  readonly kind: "state";
  readonly route: StateRoute;
  readonly matcher: SubscriptionMatcher;
}

type SubscriptionShape =
  | {
      readonly kind: "event";
      readonly route: EventRoute;
    }
  | {
      readonly kind: "state";
      readonly route: StateRoute;
      readonly matcher: SubscriptionMatcher;
    };

interface SubscriptionMatcher {
  readonly fieldMask: readonly string[] | undefined;
  match(update: StandUpdate): SubscriptionMatch | undefined;
}

type SubscriptionMatch = "state" | "noLongerMatching";

class SubscriptionDelivery {
  readonly #queue: SubscriptionUpdate[] = [];
  readonly #waiters: ((update: SubscriptionUpdate | undefined) => void)[] = [];
  readonly #queueLimit: number;
  #subscription: SubscriptionAttachment | undefined;
  #closed = false;

  constructor(queueLimit: number) {
    this.#queueLimit = queueLimit;
  }

  get active(): boolean {
    return this.#subscription !== undefined;
  }

  get closed(): boolean {
    return this.#closed;
  }

  attach(subscription: SubscriptionAttachment): void {
    if (this.#closed) {
      subscription.unsubscribe();
      return;
    }

    this.#subscription = subscription;
  }

  push(update: SubscriptionUpdate): void {
    if (this.#closed) {
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      if (this.#queue.length >= this.#queueLimit) {
        this.close();
        return;
      }
      this.#queue.push(update);
    } else {
      waiter(update);
    }
  }

  next(): Promise<SubscriptionUpdate | undefined> {
    const update = this.#queue.shift();
    if (update !== undefined || this.#closed) {
      return Promise.resolve(update);
    }

    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#queue.length = 0;
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;

    for (const waiter of this.#waiters.splice(0)) {
      waiter(undefined);
    }
  }
}

interface SubscriptionAttachment {
  readonly closed: boolean;
  unsubscribe(): void;
}

interface SubscriptionStore {
  readonly context: BoundedContext;
  readonly storageContext: StorageContext;
  readonly storageFactory: StorageFactory;
}

function okStatus(): Status {
  return create(StatusSchema, {
    status: {
      case: "ok",
      value: create(EmptySchema),
    },
  });
}

function errorStatus(type: string, message: string, details?: Any): Status {
  return create(StatusSchema, {
    status: {
      case: "error",
      value: create(ErrorSchema, {
        type,
        message,
        ...(details === undefined ? {} : { details }),
      }),
    },
  });
}

function okResponse(): Response {
  return create(ResponseSchema, { status: okStatus() });
}

function errorResponse(type: string, message: string): Response {
  return create(ResponseSchema, { status: errorStatus(type, message) });
}

function queryErrorResponse(type: string, message: string): QueryResponse {
  return create(QueryResponseSchema, {
    response: errorResponse(type, message),
  });
}

function validateReadQuery(
  query: Query,
  target: Target,
  route: StateRoute,
): ContractError | undefined {
  const formatError = formatReadError(query.format, route);
  if (formatError !== undefined) {
    return formatError;
  }

  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        return invalidCriterionError();
      }
      return undefined;
    case "filters":
      return validateFilters(target.criterion.value, route);
    default:
      return invalidCriterionError();
  }
}

function validateFilters(filters: TargetFilters, route: StateRoute): ContractError | undefined {
  const idCount = filters.idFilter?.id.length ?? 0;
  if (idCount > MAX_QUERY_ID_FILTER_IDS) {
    return invalidQueryError("QueryService.Read id_filter may contain at most 100 IDs.");
  }
  const idEntries = filters.idFilter?.id as readonly (Any | undefined)[] | undefined;
  if (idEntries?.some((id) => id === undefined) === true) {
    return invalidQueryError("QueryService.Read id_filter entries are required.");
  }
  if (filters.filter.length > MAX_QUERY_COMPOSITE_FILTERS) {
    return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
  }

  const filterError = validateCompositeFilters(filters.filter, route);
  if (filterError !== undefined) {
    return filterError;
  }

  return idCount === 0 && countSimpleFilters(filters.filter) === 0
    ? {
        type: "INVALID_QUERY",
        message: "QueryService.Read requires an ID filter or column filter.",
      }
    : undefined;
}

function validateCompositeFilters(
  filters: readonly CompositeFilter[],
  route: StateRoute,
): ContractError | undefined {
  const pending = filters.map((filter) => ({ filter, depth: 0 }));
  const seen = new WeakSet<object>();
  let compositeCount = 0;
  let simpleCount = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const filter = current.filter;
    if (seen.has(filter))
      return unsupportedFilterError("QueryService.Read filters must not contain cycles.");
    seen.add(filter);
    compositeCount += 1;
    simpleCount += filter.filter.length;
    if (filter.filter.length === 0 && filter.compositeFilter.length === 0) {
      return invalidQueryError("QueryService.Read composite filter must not be empty.");
    }
    if (compositeCount > MAX_QUERY_COMPOSITE_FILTERS || current.depth > 8) {
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    }
    if (simpleCount > MAX_QUERY_SIMPLE_FILTERS) {
      return invalidQueryError("QueryService.Read may contain at most 16 simple column filters.");
    }
    if (
      compositeCount + pending.length + filter.compositeFilter.length >
      MAX_QUERY_COMPOSITE_FILTERS
    ) {
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    }
    if (current.depth >= 8 && filter.compositeFilter.length > 0) {
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    }
    const operator = filter.operator;
    if (
      operator !== CompositeFilter_CompositeOperator.ALL &&
      operator !== CompositeFilter_CompositeOperator.EITHER
    ) {
      return unsupportedFilterError("QueryService.Read composite operator must be ALL or EITHER.");
    }
    const simpleError = validateSimpleFilters(filter.filter, route);
    if (simpleError !== undefined) {
      return simpleError;
    }
    for (const child of filter.compositeFilter) {
      pending.push({ filter: child, depth: current.depth + 1 });
    }
  }

  return undefined;
}

function countSimpleFilters(filters: readonly CompositeFilter[]): number {
  const pending = [...filters];
  let count = 0;
  while (pending.length > 0) {
    const filter = pending.pop();
    if (filter === undefined) break;
    count += filter.filter.length;
    pending.push(...filter.compositeFilter);
  }
  return count;
}

function validateSimpleFilters(
  filters: readonly Filter[],
  route: StateRoute,
): ContractError | undefined {
  for (const filter of filters) {
    if (wireComparison(filter.operator) === undefined) {
      return unsupportedFilterError("QueryService.Read comparison operator is not supported.");
    }
    const column = filter.fieldPath?.fieldName[0];
    if (column === undefined || column.trim().length === 0) {
      return unsupportedFilterError("QueryService.Read column filter field is required.");
    }
    if (filter.fieldPath?.fieldName.length !== 1) {
      return unsupportedFilterError("QueryService.Read supports only top-level column filters.");
    }
    if (!route.allowedColumnNames.has(column)) {
      return unsupportedFilterError(
        `QueryService.Read column filter "${column}" is not a declared column.`,
      );
    }
    if (filter.value === undefined) {
      return unsupportedFilterError("QueryService.Read column filter value is required.");
    }
    const field = route.columnFields.get(column);
    if (
      field === undefined
        ? !systemValueMatches(column, filter.value)
        : !filterValueMatches(field, filter.value)
    ) {
      return unsupportedFilterError(
        `QueryService.Read column filter "${column}" has the wrong value type.`,
      );
    }
    if (
      filter.operator !== Filter_Operator.EQUAL &&
      (field === undefined ? column !== "version" : !supportsRange(field))
    ) {
      return unsupportedFilterError(
        `QueryService.Read column filter "${column}" does not support range comparison.`,
      );
    }
  }

  return undefined;
}

function formatReadError(format: Query["format"], route: StateRoute): ContractError | undefined {
  if (format === undefined) {
    return undefined;
  }
  if (format.orderBy.length > MAX_QUERY_ORDER_BY) {
    return unsupportedFormatError("QueryService.Read order_by may contain at most 8 entries.");
  }
  if ((format.fieldMask?.paths.length ?? 0) > MAX_QUERY_FIELD_MASK_PATHS) {
    return unsupportedFormatError("QueryService.Read field_mask may contain at most 32 paths.");
  }
  if (
    format.fieldMask?.paths.some((path) => path.length > MAX_QUERY_FIELD_MASK_PATH_LENGTH) ??
    false
  ) {
    return unsupportedFormatError(
      "QueryService.Read field_mask paths may contain at most 128 characters.",
    );
  }
  for (const path of format.fieldMask?.paths ?? []) {
    if (resolveQueryMask(route.schema, path) === undefined) {
      return unsupportedFormatError(
        `QueryService.Read field_mask path "${path}" is not a state field.`,
      );
    }
  }
  if (format.limit > MAX_QUERY_LIMIT) {
    return {
      type: "INVALID_QUERY",
      message: "QueryService.Read limit may be at most 1000.",
    };
  }
  if (format.limit > 0 && format.orderBy.length === 0) {
    return {
      type: "INVALID_QUERY",
      message: "QueryService.Read limit requires ordering.",
    };
  }
  for (const order of format.orderBy) {
    if (order.column.trim().length === 0) {
      return unsupportedFormatError("QueryService.Read order_by column is required.");
    }
    if (!route.allowedColumnNames.has(order.column)) {
      return unsupportedFormatError(
        `QueryService.Read order_by column "${order.column}" is not a declared column.`,
      );
    }
    const field = route.columnFields.get(order.column);
    if (field === undefined ? order.column !== "version" : !supportsRange(field)) {
      return unsupportedFormatError(
        `QueryService.Read order_by column "${order.column}" is not orderable.`,
      );
    }
    if (
      order.direction !== OrderBy_Direction.ASCENDING &&
      order.direction !== OrderBy_Direction.DESCENDING
    ) {
      return unsupportedFormatError(
        "QueryService.Read order_by direction must be ASCENDING or DESCENDING.",
      );
    }
  }

  return undefined;
}

function createReadPlan(
  target: Target,
  query: Query,
  route: StateRoute,
): NormalizedQueryPlan<unknown> {
  const predicate =
    target.criterion.case === "filters"
      ? normalizedFilters(target.criterion.value, route)
      : undefined;
  const format = query.format;
  return Object.freeze({
    ...(predicate === undefined ? {} : { predicate }),
    ...(format?.fieldMask === undefined
      ? {}
      : {
          mask: {
            paths: format.fieldMask.paths.map((path) => requiredQueryMask(route.schema, path)),
          },
        }),
    ...(format === undefined || format.orderBy.length === 0
      ? {}
      : {
          order: format.orderBy.map((order) => ({
            column: order.column,
            direction:
              order.direction === OrderBy_Direction.DESCENDING
                ? ("desc" as const)
                : ("asc" as const),
          })),
        }),
    ...(format === undefined || format.limit === 0 ? {} : { limit: format.limit }),
  });
}

function normalizedFilters(
  filters: TargetFilters,
  route: StateRoute,
): NormalizedQueryPredicate<unknown> {
  const predicates: NormalizedQueryPredicate<unknown>[] = [];
  if (filters.idFilter !== undefined) {
    predicates.push({ kind: "ids", ids: filters.idFilter.id.map((id) => decodeAnyValue(id)) });
  }
  predicates.push(...filters.filter.map((filter) => normalizedComposite(filter, route)));
  const onlyPredicate = predicates[0];
  return predicates.length === 1 && onlyPredicate !== undefined
    ? onlyPredicate
    : { kind: "all", predicates };
}

function normalizedComposite(
  filter: CompositeFilter,
  route: StateRoute,
): NormalizedQueryPredicate<unknown> {
  const predicates: NormalizedQueryPredicate<unknown>[] = [
    ...filter.filter.map((child) => ({
      kind: "comparison" as const,
      column: requiredFilterColumn(child),
      operator: requiredComparison(child),
      value: decodeColumnValue(child, route),
    })),
    ...filter.compositeFilter.map((child) => normalizedComposite(child, route)),
  ];
  return {
    kind: filter.operator === CompositeFilter_CompositeOperator.EITHER ? "either" : "all",
    predicates,
  };
}

function requiredFilterColumn(filter: Filter): string {
  const column = filter.fieldPath?.fieldName[0];
  if (column !== undefined) return column;
  throw new TypeError("Validated query filter has no column.");
}

function requiredComparison(filter: Filter): NormalizedComparisonOperator {
  const operator = wireComparison(filter.operator);
  if (operator !== undefined) return operator;
  throw new TypeError("Validated query filter has no supported comparison operator.");
}

function decodeColumnValue(filter: Filter, route: StateRoute): unknown {
  const column = filter.fieldPath?.fieldName[0] ?? "";
  if (column === "version" && filter.value !== undefined) {
    const value = unpackAny(filter.value, VersionSchema);
    if (value !== undefined) return value;
    throw new TypeError('Validated query column "version" has an invalid value.');
  }
  if ((column === "archived" || column === "deleted") && filter.value !== undefined) {
    const value = unpackAny(filter.value, BoolValueSchema);
    if (value !== undefined) return value.value;
    throw new TypeError(`Validated query column "${column}" has an invalid value.`);
  }
  const field = route.columnFields.get(column);
  return decodeAnyValue(
    filter.value,
    field?.fieldKind === "message" ? (field.message as MessageSchema) : undefined,
  );
}

function filterValueMatches(field: DescField, value: Any): boolean {
  const schema = filterValueSchema(field);
  if (schema === undefined || value.typeUrl !== deriveTypeUrl(schema)) return false;
  const decoded =
    field.fieldKind === "message" ? decodeAnyValue(value, schema) : decodeAnyValue(value);
  if (field.fieldKind === "message") {
    return isMessage(decoded) && decoded.$typeName === field.message.typeName;
  }
  if (field.fieldKind === "enum") return typeof decoded === "number" && Number.isInteger(decoded);
  if (field.fieldKind !== "scalar") return false;
  if (field.scalar === ScalarType.BOOL) return typeof decoded === "boolean";
  if (field.scalar === ScalarType.BYTES) return decoded instanceof Uint8Array;
  if (field.scalar === ScalarType.STRING) return typeof decoded === "string";
  if (
    field.scalar === ScalarType.INT64 ||
    field.scalar === ScalarType.UINT64 ||
    field.scalar === ScalarType.SFIXED64 ||
    field.scalar === ScalarType.FIXED64 ||
    field.scalar === ScalarType.SINT64
  ) {
    return typeof decoded === "bigint";
  }
  return typeof decoded === "number" && Number.isFinite(decoded);
}

function filterValueSchema(field: DescField): MessageSchema | undefined {
  if (field.fieldKind === "message") return field.message as MessageSchema;
  if (field.fieldKind === "enum") return Int32ValueSchema;
  if (field.fieldKind !== "scalar") return undefined;
  if (field.scalar === ScalarType.BOOL) return BoolValueSchema;
  if (field.scalar === ScalarType.BYTES) return BytesValueSchema;
  if (field.scalar === ScalarType.DOUBLE) return DoubleValueSchema;
  if (field.scalar === ScalarType.FLOAT) return FloatValueSchema;
  if (
    field.scalar === ScalarType.INT64 ||
    field.scalar === ScalarType.SFIXED64 ||
    field.scalar === ScalarType.SINT64
  ) {
    return Int64ValueSchema;
  }
  if (field.scalar === ScalarType.UINT64 || field.scalar === ScalarType.FIXED64) {
    return UInt64ValueSchema;
  }
  if (field.scalar === ScalarType.UINT32 || field.scalar === ScalarType.FIXED32) {
    return UInt32ValueSchema;
  }
  if (field.scalar === ScalarType.STRING) return StringValueSchema;
  return Int32ValueSchema;
}

function systemValueMatches(column: string, value: Any): boolean {
  if (column === "version") {
    return (
      value.typeUrl === deriveTypeUrl(VersionSchema) &&
      unpackAny(value, VersionSchema) !== undefined
    );
  }
  if (column === "archived" || column === "deleted") {
    return (
      value.typeUrl === deriveTypeUrl(BoolValueSchema) &&
      unpackAny(value, BoolValueSchema) !== undefined
    );
  }
  return false;
}

function supportsRange(field: DescField): boolean {
  if (field.fieldKind === "message") {
    return (
      field.message.typeName === "google.protobuf.Timestamp" ||
      field.message.typeName === "spine.core.Version"
    );
  }
  return (
    field.fieldKind === "scalar" &&
    field.scalar !== ScalarType.BOOL &&
    field.scalar !== ScalarType.BYTES
  );
}

function wireComparison(operator: Filter_Operator): NormalizedComparisonOperator | undefined {
  if (operator === Filter_Operator.EQUAL) return "equal";
  if (operator === Filter_Operator.GREATER_THAN) return "greaterThan";
  if (operator === Filter_Operator.LESS_THAN) return "lessThan";
  if (operator === Filter_Operator.GREATER_OR_EQUAL) return "greaterOrEqual";
  if (operator === Filter_Operator.LESS_OR_EQUAL) return "lessOrEqual";
  return undefined;
}

function resolveQueryMask(schema: MessageSchema, path: string): string | undefined {
  let current: MessageSchema | undefined = schema;
  const local: string[] = [];
  for (const segment of path.split(".")) {
    const field = findMessageField(current, segment);
    if (field === undefined) return undefined;
    local.push(field.localName);
    current = field.message;
  }
  return local.join(".");
}

function requiredQueryMask(schema: MessageSchema, path: string): string {
  const resolved = resolveQueryMask(schema, path);
  if (resolved !== undefined) return resolved;
  throw new TypeError(`Validated query mask path "${path}" is invalid.`);
}

function unsupportedFilterError(message: string): ContractError {
  return invalidQueryError(message);
}

function unsupportedFormatError(message: string): ContractError {
  return invalidQueryError(message);
}

function invalidQueryError(message: string): ContractError {
  return {
    type: "INVALID_QUERY",
    message,
  };
}

function invalidCriterionError(): ContractError {
  return {
    type: "INVALID_QUERY",
    message: "QueryService.Read requires filters or include_all = true.",
  };
}

const DEFAULT_INACTIVE_TTL_MS = 30_000;
const MAX_INACTIVE_TTL_MS = 2_147_483_647;
const DEFAULT_QUEUE_LIMIT = 100;
const DEFAULT_SUBSCRIPTION_LIMIT = 100;
const MAX_CANCEL_RETRIES = 3;
const FOREIGN_SUBSCRIPTION_MESSAGE = "Subscription is active in another service instance.";
const CONCURRENT_CANCELLATION_MESSAGE =
  "Subscription cancellation could not settle concurrent storage changes.";
const MAX_QUERY_ID_FILTER_IDS = 100;
const MAX_QUERY_SIMPLE_FILTERS = 16;
const MAX_QUERY_COMPOSITE_FILTERS = 8;
const MAX_QUERY_ORDER_BY = 8;
const MAX_QUERY_FIELD_MASK_PATHS = 32;
const MAX_QUERY_FIELD_MASK_PATH_LENGTH = 128;
const MAX_QUERY_LIMIT = 1_000;
const MAX_SUBSCRIPTION_ID_FILTER_IDS = MAX_QUERY_ID_FILTER_IDS;
const MAX_SUBSCRIPTION_TOTAL_COMPOSITE_FILTERS = 8;
const MAX_SUBSCRIPTION_SIMPLE_FILTERS = 16;
const MAX_SUBSCRIPTION_COMPOSITE_DEPTH = 8;
const MAX_SUBSCRIPTION_FIELD_MASK_PATHS = 32;
const MAX_SUBSCRIPTION_FIELD_MASK_PATH_LENGTH = 128;
const MAX_SUBSCRIPTION_FIELD_PATH_COMPONENTS = 16;
const MAX_SUBSCRIPTION_FIELD_PATH_SEGMENT_LENGTH = 128;

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function inactiveTtl(value: number): number {
  const normalized = positiveInteger(value);
  if (normalized > MAX_INACTIVE_TTL_MS) {
    throw new TypeError("SpineServices inactiveTtlMs must not exceed 2147483647 milliseconds.");
  }
  return normalized;
}

function subscriptionLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("SpineServices subscriptionLimit must be a positive safe integer.");
  }

  return value;
}

function clearInactiveTimer(record: SubscriptionRecord): void {
  if (record.inactiveTimer !== undefined) {
    clearTimeout(record.inactiveTimer);
    record.inactiveTimer = undefined;
  }
}

function createSubscriptionRecord(input: {
  readonly id: string;
  readonly subscription: Subscription;
  readonly shape: SubscriptionShape;
  readonly tenantId: string | undefined;
  readonly expiresAtMs: number;
  readonly queueLimit: number;
}): SubscriptionRecord {
  return {
    id: input.id,
    subscription: clone(SubscriptionSchema, input.subscription),
    tenantId: input.tenantId,
    expiresAtMs: input.expiresAtMs,
    delivery: new SubscriptionDelivery(input.queueLimit),
    durableState: undefined,
    inactiveTimer: undefined,
    reservation: undefined,
    ...input.shape,
  };
}

function createSubscriptionClaim(record: SubscriptionRecord): SubscriptionClaim {
  const owner = randomUUID();
  return {
    canceled: false,
    claimed: false,
    unknown: false,
    owner,
    record,
    state: DurableSubscriptionRecords.claim(record.id, owner),
  };
}

function sameAny(left: Any | undefined, right: Any | undefined): boolean {
  return (
    left?.typeUrl === right?.typeUrl &&
    Buffer.from(left?.value ?? []).equals(Buffer.from(right?.value ?? []))
  );
}

function foreignSubscriptionError(): ConnectError {
  return new ConnectError(FOREIGN_SUBSCRIPTION_MESSAGE, Code.Aborted);
}

function cancellationFailedError(): ConnectError {
  return new ConnectError("Subscription cancellation failed.", Code.Internal);
}

function concurrentCancellationError(): ConnectError {
  return new ConnectError(CONCURRENT_CANCELLATION_MESSAGE, Code.Aborted);
}

function isCancellationConflict(error: unknown): error is ConnectError {
  return (
    error instanceof ConnectError &&
    error.code === Code.Aborted &&
    (error.rawMessage === FOREIGN_SUBSCRIPTION_MESSAGE ||
      error.rawMessage === CONCURRENT_CANCELLATION_MESSAGE)
  );
}

function createSubscriptionRemoval(): SubscriptionRemoval {
  let reject!: (reason?: unknown) => void;
  let resolve!: () => void;
  const settled = new Promise<void>((settle, fail) => {
    reject = fail;
    resolve = () => {
      settle();
    };
  });
  return { reject, resolve, settled };
}

async function observeRemoval(removal: SubscriptionRemoval): Promise<void> {
  try {
    await removal.settled;
  } catch {
    // The cancellation caller observes deletion failure; recovery remains inert.
  }
}

function uniqueContexts(contexts: readonly BoundedContext[]): readonly BoundedContext[] {
  return [...new Set(contexts)];
}

function subscriptionStorageContext(context: BoundedContext): StorageContext {
  return Object.freeze({
    name: `${context.snapshot.name.value}:subscriptions`,
    multitenant: false,
  });
}

function subscriptionStore(context: BoundedContext): SubscriptionStore | undefined {
  try {
    return Object.freeze({
      context,
      storageContext: subscriptionStorageContext(context),
      storageFactory: boundedContextAccess.storageFactory(context),
    });
  } catch {
    return undefined;
  }
}

function createSubscriptionStorage(store: SubscriptionStore): RecordStorage<string, Any> {
  return store.storageFactory.createRecordStorage(
    store.storageContext,
    durableSubscriptionRecordSpec,
  );
}

function validateTopic(topic: Topic): void {
  if (topic.id?.value === undefined || topic.id.value.trim().length === 0) {
    throw new ConnectError("Subscription topic ID is required.", Code.InvalidArgument);
  }
  if (topic.context === undefined) {
    throw new ConnectError("Subscription topic context is required.", Code.InvalidArgument);
  }
  if (topic.target?.criterion.case === undefined) {
    throw new ConnectError("Subscription topic criterion is required.", Code.InvalidArgument);
  }
}

function createSubscriptionShape(topic: Topic, route: SubscriptionRoute): SubscriptionShape {
  const target = topic.target;
  if (target === undefined) {
    throw new ConnectError("Subscription topic target is required.", Code.InvalidArgument);
  }
  if (route.kind === "event") {
    validateEventSubscriptionTopic(topic, target);
    return { kind: "event", route };
  }

  const fieldMask = subscriptionFieldMask(topic, route);

  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        throw new ConnectError(
          "SubscriptionService.Subscribe requires filters or include_all = true.",
          Code.InvalidArgument,
        );
      }
      return {
        kind: "state",
        route,
        matcher: {
          fieldMask,
          match: () => "state",
        },
      };
    case "filters":
      return {
        kind: "state",
        route,
        matcher: createFilteredSubscriptionMatcher(target.criterion.value, route, fieldMask),
      };
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

function validateEventSubscriptionTopic(topic: Topic, target: Target): void {
  if ((topic.fieldMask?.paths.length ?? 0) > 0) {
    throw new ConnectError(
      "SubscriptionService.Subscribe event topics do not support field_mask.",
      Code.InvalidArgument,
    );
  }

  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        throw new ConnectError(
          "SubscriptionService.Subscribe requires filters or include_all = true.",
          Code.InvalidArgument,
        );
      }
      return;
    case "filters":
      throw new ConnectError(
        "SubscriptionService.Subscribe event topics support only include_all in this runtime slice.",
        Code.InvalidArgument,
      );
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

function createFilteredSubscriptionMatcher(
  filters: TargetFilters,
  route: StateRoute,
  fieldMask: readonly string[] | undefined,
): SubscriptionMatcher {
  if (filters.idFilter?.id.length === 0) {
    throw new ConnectError(
      "SubscriptionService.Subscribe id_filter requires at least one ID.",
      Code.InvalidArgument,
    );
  }
  if (
    filters.idFilter !== undefined &&
    filters.idFilter.id.length > MAX_SUBSCRIPTION_ID_FILTER_IDS
  ) {
    throw new ConnectError(
      "SubscriptionService.Subscribe id_filter may contain at most 100 IDs.",
      Code.InvalidArgument,
    );
  }
  if (filters.idFilter === undefined && filters.filter.length === 0) {
    throw new ConnectError(
      "SubscriptionService.Subscribe requires an ID filter or field filter.",
      Code.InvalidArgument,
    );
  }

  validateSubscriptionFilterTree(filters.filter);
  const idValues = filters.idFilter?.id.map((id) => decodeSubscriptionIdValue(id, route));
  const statePredicate = createSubscriptionPredicate(filters.filter, route);

  return {
    fieldMask,
    match(update) {
      if (
        idValues !== undefined &&
        !idValues.some((id) => valuesEqual(update.id, id, route.idField.message))
      ) {
        return undefined;
      }
      if (statePredicate(update.state)) {
        return "state";
      }
      if (update.previousState !== undefined && statePredicate(update.previousState)) {
        return "noLongerMatching";
      }

      return undefined;
    },
  };
}

function createSubscriptionPredicate(
  filters: readonly CompositeFilter[],
  route: StateRoute,
): (state: Message) => boolean {
  const predicates = filters.map((filter) => createCompositePredicate(filter, route));
  return (state) => predicates.every((predicate) => predicate(state));
}

function validateSubscriptionFilterTree(filters: readonly CompositeFilter[]): void {
  if (filters.length > MAX_SUBSCRIPTION_TOTAL_COMPOSITE_FILTERS) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
      Code.InvalidArgument,
    );
  }

  const stack: SubscriptionFilterFrame[] = [];
  for (const filter of filters) {
    stack.push({ filter, depth: 0 });
  }
  const counts = {
    compositeCount: 0,
    simpleCount: 0,
  };

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    validateSubscriptionFilterNode(current.filter, current.depth, counts);
    enqueueSubscriptionFilterChildren(current.filter, current.depth, stack);
  }
}

function validateSubscriptionFilterNode(
  filter: CompositeFilter,
  depth: number,
  counts: SubscriptionFilterCounts,
): void {
  if (depth > MAX_SUBSCRIPTION_COMPOSITE_DEPTH) {
    throw new ConnectError(
      "SubscriptionService.Subscribe composite filters may nest at most 8 levels.",
      Code.InvalidArgument,
    );
  }
  switch (filter.operator) {
    case CompositeFilter_CompositeOperator.ALL:
    case CompositeFilter_CompositeOperator.EITHER:
      break;
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe supports only ALL or EITHER composite filters.",
        Code.InvalidArgument,
      );
  }
  if (depth === MAX_SUBSCRIPTION_COMPOSITE_DEPTH && filter.compositeFilter.length > 0) {
    throw new ConnectError(
      "SubscriptionService.Subscribe composite filters may nest at most 8 levels.",
      Code.InvalidArgument,
    );
  }

  counts.compositeCount += 1;
  if (counts.compositeCount > MAX_SUBSCRIPTION_TOTAL_COMPOSITE_FILTERS) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
      Code.InvalidArgument,
    );
  }

  counts.simpleCount += filter.filter.length;
  if (counts.simpleCount > MAX_SUBSCRIPTION_SIMPLE_FILTERS) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 16 simple field filters.",
      Code.InvalidArgument,
    );
  }
  if (
    (filter.compositeFilter.length > 1 || depth + 1 < MAX_SUBSCRIPTION_COMPOSITE_DEPTH) &&
    counts.compositeCount + filter.compositeFilter.length > MAX_SUBSCRIPTION_TOTAL_COMPOSITE_FILTERS
  ) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
      Code.InvalidArgument,
    );
  }
}

function enqueueSubscriptionFilterChildren(
  filter: CompositeFilter,
  depth: number,
  stack: SubscriptionFilterFrame[],
): void {
  for (const nested of filter.compositeFilter) {
    if (depth + 1 > MAX_SUBSCRIPTION_COMPOSITE_DEPTH) {
      throw new ConnectError(
        "SubscriptionService.Subscribe composite filters may nest at most 8 levels.",
        Code.InvalidArgument,
      );
    }
    stack.push({ filter: nested, depth: depth + 1 });
  }
}

interface SubscriptionFilterFrame {
  readonly filter: CompositeFilter;
  readonly depth: number;
}

interface SubscriptionFilterCounts {
  compositeCount: number;
  simpleCount: number;
}

function createCompositePredicate(
  filter: CompositeFilter,
  route: StateRoute,
): (state: Message) => boolean {
  const children = [
    ...filter.filter.map((simple) => createSimplePredicate(simple, route)),
    ...filter.compositeFilter.map((nested) => createCompositePredicate(nested, route)),
  ];
  if (children.length === 0) {
    return () => true;
  }

  return filter.operator === CompositeFilter_CompositeOperator.ALL
    ? (state) => children.every((predicate) => predicate(state))
    : (state) => children.some((predicate) => predicate(state));
}

function createSimplePredicate(filter: Filter, route: StateRoute): (state: Message) => boolean {
  if (filter.operator !== Filter_Operator.EQUAL) {
    throw new ConnectError(
      "SubscriptionService.Subscribe supports only EQUAL field filters.",
      Code.InvalidArgument,
    );
  }
  if (filter.value === undefined) {
    throw new ConnectError(
      "SubscriptionService.Subscribe field filter value is required.",
      Code.InvalidArgument,
    );
  }

  validateSubscriptionPath(filter.fieldPath?.fieldName ?? [], "field filter");
  const resolved = resolveMessagePath(
    route.schema,
    filter.fieldPath?.fieldName ?? [],
    "field filter",
  );
  const expected = decodeFieldFilterValue(filter.value, resolved.leafSchema);

  return (state) =>
    valuesEqual(readPathValue(state, resolved.localPath), expected, resolved.leafSchema);
}

function subscriptionFieldMask(topic: Topic, route: StateRoute): readonly string[] | undefined {
  const paths = topic.fieldMask?.paths ?? [];
  if (paths.length === 0) {
    return undefined;
  }
  if (paths.length > MAX_SUBSCRIPTION_FIELD_MASK_PATHS) {
    throw new ConnectError(
      "SubscriptionService.Subscribe field_mask may contain at most 32 paths.",
      Code.InvalidArgument,
    );
  }
  if (paths.some((path) => path.length > MAX_SUBSCRIPTION_FIELD_MASK_PATH_LENGTH)) {
    throw new ConnectError(
      "SubscriptionService.Subscribe field_mask paths may contain at most 128 characters.",
      Code.InvalidArgument,
    );
  }

  return paths.map((path) => {
    const segments = path.split(".");
    validateSubscriptionPath(segments, "field_mask");

    return resolveMessagePath(route.schema, segments, "field_mask").localPath.join(".");
  });
}

function validateSubscriptionPath(
  fieldPath: readonly string[],
  label: "field filter" | "field_mask",
): void {
  if (fieldPath.length === 0 || fieldPath.some((field) => field.trim().length === 0)) {
    throw new ConnectError(
      `SubscriptionService.Subscribe ${label} path is required.`,
      Code.InvalidArgument,
    );
  }
  if (fieldPath.length > MAX_SUBSCRIPTION_FIELD_PATH_COMPONENTS) {
    throw new ConnectError(
      `SubscriptionService.Subscribe ${label} path may contain at most 16 components.`,
      Code.InvalidArgument,
    );
  }
  if (fieldPath.some((field) => field.length > MAX_SUBSCRIPTION_FIELD_PATH_SEGMENT_LENGTH)) {
    throw new ConnectError(
      `SubscriptionService.Subscribe ${label} path components may contain at most 128 characters.`,
      Code.InvalidArgument,
    );
  }
}

function decodeSubscriptionIdValue(value: Any, route: StateRoute): unknown {
  if (!isAny(value)) {
    throw new ConnectError(
      "SubscriptionService.Subscribe id_filter values must be packed Any messages.",
      Code.InvalidArgument,
    );
  }
  if (route.idField.message === undefined) {
    return decodeAnyValue(value);
  }

  const decoded = unpackAny(value, route.idField.message);
  if (decoded === undefined) {
    throw new ConnectError(
      `SubscriptionService.Subscribe id_filter values must pack ${route.idField.message.typeName}.`,
      Code.InvalidArgument,
    );
  }

  return decoded;
}

function decodeFieldFilterValue(value: Any | undefined, schema: MessageSchema | undefined) {
  if (value === undefined || schema === undefined) {
    return decodeAnyValue(value);
  }

  const decoded = unpackAny(value, schema);
  if (decoded === undefined) {
    throw new ConnectError(
      `SubscriptionService.Subscribe field filter value must pack ${schema.typeName}.`,
      Code.InvalidArgument,
    );
  }

  return decoded;
}

function decodeAnyValue(value: Any | undefined, schema?: MessageSchema): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (schema !== undefined) {
    const decoded = unpackAny(value, schema);
    if (decoded !== undefined) {
      return decoded;
    }
  }

  for (const decoder of VALUE_DECODERS) {
    const decoded = decoder(value);
    if (decoded !== undefined) {
      return decoded;
    }
  }

  return value;
}

interface ResolvedMessagePath {
  readonly localPath: readonly string[];
  readonly leafSchema?: MessageSchema;
}

interface MessageFieldInfo {
  readonly name: string;
  readonly localName: string;
  readonly message?: MessageSchema;
}

function resolveMessagePath(
  schema: MessageSchema,
  fieldPath: readonly string[],
  label: "field filter" | "field_mask",
): ResolvedMessagePath {
  const localPath: string[] = [];
  let currentSchema: MessageSchema | undefined = schema;
  let leafSchema: MessageSchema | undefined;

  for (const [index, name] of fieldPath.entries()) {
    const field = findMessageField(currentSchema, name);
    if (field === undefined) {
      throw new ConnectError(
        `SubscriptionService.Subscribe ${label} "${fieldPath.join(".")}" is not a state field.`,
        Code.InvalidArgument,
      );
    }

    localPath.push(field.localName);
    leafSchema = field.message;
    currentSchema = index === fieldPath.length - 1 ? undefined : field.message;
    if (currentSchema === undefined && index < fieldPath.length - 1) {
      throw new ConnectError(
        `SubscriptionService.Subscribe ${label} "${fieldPath.join(".")}" is not a message path.`,
        Code.InvalidArgument,
      );
    }
  }

  return Object.freeze({
    localPath,
    ...(leafSchema === undefined ? {} : { leafSchema }),
  });
}

function findMessageField(
  schema: MessageSchema | undefined,
  name: string,
): MessageFieldInfo | undefined {
  const fields = (schema?.fields ?? []) as unknown as readonly MessageFieldInfo[];

  return fields.find((field) => field.name === name || field.localName === name);
}

function readPathValue(value: unknown, path: readonly string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = Reflect.get(current, segment);
  }

  return current;
}

function valuesEqual(actual: unknown, expected: unknown, schema?: MessageSchema): boolean {
  if (schema !== undefined && isMessage(actual) && isMessage(expected)) {
    return bytesEqual(toBinary(schema, actual), toBinary(schema, expected));
  }
  if (isAny(actual) && isAny(expected)) {
    return bytesEqual(toBinary(AnySchema, actual), toBinary(AnySchema, expected));
  }
  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    return bytesEqual(actual, expected);
  }

  return Object.is(actual, expected);
}

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && "$typeName" in value;
}

function isAny(value: unknown): value is Any {
  return isMessage(value) && value.$typeName === "google.protobuf.Any";
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function packVersionedState<Schema extends MessageSchema>(
  schema: Schema,
  result: StandReadResult<Schema>,
) {
  return create(EntityStateWithVersionSchema, {
    state: packAny(schema, result.state, { validate: false }),
    version: result.version ?? create(VersionSchema),
  });
}

function commandTenant(command: Command): string | undefined {
  return tenantValue(command.context?.actorContext?.tenantId);
}

function topicTenant(topic: Topic | undefined): string | undefined {
  return tenantValue(topic?.context?.tenantId);
}

function eventTenant(event: Event): string | undefined {
  switch (event.context?.origin.case) {
    case "importContext":
      return tenantValue(event.context.origin.value.tenantId);
    case "pastMessage":
      return tenantValue(event.context.origin.value.actorContext?.tenantId);
    default:
      return undefined;
  }
}

function eventTenantMatches(record: SubscriptionRecord, event: Event): boolean {
  return record.tenantId === undefined || eventTenant(event) === record.tenantId;
}

function tenantValue(tenantId: TenantId | undefined): string | undefined {
  switch (tenantId?.kind.case) {
    case "value":
      return tenantId.kind.value;
    case "domain":
      return `domain:${tenantId.kind.value.value}`;
    case "email":
      return `email:${tenantId.kind.value.value}`;
    default:
      return undefined;
  }
}

function stateRouteIdField(
  schema: MessageSchema,
  idField: { readonly name?: string; readonly localName?: string } | undefined,
): MessageFieldInfo {
  const field =
    findMessageField(schema, idField?.name ?? "") ??
    findMessageField(schema, idField?.localName ?? "") ??
    (schema.fields[0] as unknown as MessageFieldInfo | undefined) ??
    undefined;

  if (field === undefined) {
    throw new ConnectError("Subscription target ID field is not available.", Code.InvalidArgument);
  }

  return field;
}

function tenantMismatch(
  multitenant: boolean,
  tenantId: string | undefined,
  subject: "command" | "query" | "subscription",
): ContractError | undefined {
  if (multitenant) {
    return tenantId === undefined || tenantId.trim().length === 0
      ? {
          type: "TENANT_REQUIRED",
          message: `Tenant is required for this ${subject}.`,
        }
      : undefined;
  }

  return tenantId === undefined
    ? undefined
    : {
        type: "TENANT_INAPPLICABLE",
        message: `Tenant is not applicable for this ${subject}.`,
      };
}

interface ContractError {
  readonly type: string;
  readonly message: string;
  readonly details?: Any;
}

function commandPostError(error: unknown): ContractError {
  if (error instanceof TransitionValidationError) {
    return {
      type: error.type,
      message: error.clientMessage,
      details: packAny(ValidationErrorSchema, error.validationError, { validate: false }),
    };
  }

  if (error instanceof CommandValidationError) {
    return {
      type: "COMMAND_VALIDATION_ERROR",
      message: "Command payload validation failed.",
      details: packAny(ValidationErrorSchema, error.validationError, { validate: false }),
    };
  }

  return {
    type: "COMMAND_POST_ERROR",
    message: "Command post failed.",
  };
}

function tenantOptions(tenantId: string | undefined): { readonly tenantId?: string } {
  return tenantId === undefined ? {} : { tenantId };
}

const VALUE_DECODERS = Object.freeze([
  (value: Any) => unpackAny(value, StringValueSchema)?.value,
  (value: Any) => unpackAny(value, BoolValueSchema)?.value,
  (value: Any) => unpackAny(value, Int32ValueSchema)?.value,
  (value: Any) => unpackAny(value, UInt32ValueSchema)?.value,
  (value: Any) => unpackAny(value, Int64ValueSchema)?.value,
  (value: Any) => unpackAny(value, UInt64ValueSchema)?.value,
  (value: Any) => unpackAny(value, FloatValueSchema)?.value,
  (value: Any) => unpackAny(value, DoubleValueSchema)?.value,
  (value: Any) => unpackAny(value, BytesValueSchema)?.value,
]);

function createEntityUpdate(
  record: StateSubscriptionRecord,
  update: StandUpdate,
): SubscriptionUpdate | undefined {
  const match = record.matcher.match(update);
  if (match === undefined) {
    return undefined;
  }

  return create(SubscriptionUpdateSchema, {
    subscription: clone(SubscriptionSchema, record.subscription),
    response: okResponse(),
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: packEntityId(record.route, update.id),
            kind:
              match === "state"
                ? {
                    case: "state",
                    value: packAny(record.route.schema, maskedState(record, update.state), {
                      validate: false,
                    }),
                  }
                : {
                    case: "noLongerMatching",
                    value: true,
                  },
          }),
        ],
      }),
    },
  });
}

function createEventUpdate(record: SubscriptionRecord, event: Event): SubscriptionUpdate {
  return create(SubscriptionUpdateSchema, {
    subscription: clone(SubscriptionSchema, record.subscription),
    response: okResponse(),
    update: {
      case: "eventUpdates",
      value: create(EventUpdatesSchema, {
        event: [cloneClientEvent(event)],
      }),
    },
  });
}

function cloneClientEvent(event: Event): Event {
  const clientEvent = clone(EventSchema, event);
  const rejection = clientEvent.context?.rejection;

  if (rejection !== undefined) {
    rejection.command = undefined;
    // Clear the legacy wire payload as part of client-side security redaction.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    rejection.commandMessage = undefined;
    rejection.stacktrace = "";
  }
  return clientEvent;
}

function maskedState(record: StateSubscriptionRecord, state: MessageShape<MessageSchema>): Message {
  return RecordMask.apply(clone(record.route.schema, state), record.matcher.fieldMask);
}

function packString(value: string): Any {
  return packAny(StringValueSchema, create(StringValueSchema, { value }));
}

function packEntityId(route: StateRoute, id: unknown): Any | undefined {
  if (isAny(id)) {
    return clone(AnySchema, id);
  }
  if (route.idField.message !== undefined && isMessage(id)) {
    return packAny(route.idField.message, id, { validate: false });
  }
  if (id instanceof Uint8Array) {
    return packAny(BytesValueSchema, create(BytesValueSchema, { value: id }));
  }

  switch (typeof id) {
    case "string":
      return packString(id);
    case "boolean":
      return packAny(BoolValueSchema, create(BoolValueSchema, { value: id }));
    case "number":
      return packAny(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
    case "bigint":
      return packAny(Int64ValueSchema, create(Int64ValueSchema, { value: id }));
    default:
      return undefined;
  }
}
