import { randomUUID } from "node:crypto";

import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { clone, create, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
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
import type { MessageSchema } from "@spine-ts/core";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import {
  CommandIdSchema,
  type Command,
  type Event,
  EventSchema,
  type TenantId,
  ValidationErrorSchema,
  VersionSchema,
} from "@spine-ts/proto";
import { ErrorSchema } from "@spine-ts/proto/generated/spine/base/error_pb.js";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import type {
  CompositeFilter,
  Filter,
  Target,
  TargetFilters,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  EntityStateWithVersionSchema,
  OrderBy_Direction,
  QueryResponseSchema,
  type OrderBy,
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
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
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import { AckSchema, type Ack } from "@spine-ts/proto/generated/spine/core/ack_pb.js";
import {
  ResponseSchema,
  StatusSchema,
  type Response,
  type Status,
} from "@spine-ts/proto/generated/spine/core/response_pb.js";
import {
  RecordMask,
  type RecordStorage,
  type RecordFilter,
  type RecordOrder,
  type RecordQuery,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import { boundedContextAccess, type BoundedContext } from "../context/bounded-context.js";
import { CommandValidationError } from "../bus/command-errors.js";
import type { EntityFamily } from "../entity/entity.js";
import { TransitionValidationError } from "../repository/command-errors.js";
import type { StandReadResult, StandUpdate } from "../stand/stand.js";
import { CommandRefusalError } from "./command-errors.js";
import {
  DurableSubscriptionRecords,
  durableSubscriptionRecordSpec,
} from "./subscription-records.js";

/**
 * Small route registrar for the first public Spine gRPC service slice.
 *
 * `QueryService.Read` supports ID filters for any registered state route,
 * projection-state `include_all = true` reads, top-level equality filters over
 * declared projection `(column)` proto field names, field masks, ordering by
 * declared proto columns, and positive limits when at least one ordering
 * directive is present. Use proto column names such as `open_task_count`, not
 * generated TS local names such as `openTaskCount`; undeclared columns return
 * stable `INVALID_QUERY` responses before Stand storage is read. Unsupported
 * query operators and shapes also return stable `INVALID_QUERY` responses
 * before Stand storage is read.
 *
 * `SubscriptionService.Subscribe` accepts known state targets with
 * `include_all` or validated ID/field filters and known event targets exposed
 * by built-context event dispatchers with `include_all = true`. It creates an
 * inactive process-local record and attaches delivery only when the opaque
 * subscription ID is activated: state subscriptions attach to `Stand`, while
 * event subscriptions attach to a framework-internal `EventBus` listener.
 * Filtered state topics deliver matching states, emit `no_longer_matching`
 * when previous state matched and new state does not, and apply topic masks
 * only to delivered states. Event topics stream wire-level `event_updates`
 * containing cloned framework `Event` envelopes; application code remains on
 * generated domain event messages through handler dispatch. Unknown or
 * duplicate activation IDs complete without updates, and cancellation of
 * unknown or already-cleaned IDs returns OK.
 */
export class SpineServices {
  readonly #contexts: readonly BoundedContext[];
  readonly #commandRoutes = new Map<string, CommandRoute>();
  readonly #stateRoutes = new Map<string, StateRoute>();
  readonly #eventRoutes = new Map<string, EventRoute>();
  readonly #subscriptions = new Map<string, SubscriptionRecord>();
  readonly #subscriptionStores: readonly SubscriptionStore[];
  readonly #inactiveTtlMs: number;
  readonly #queueLimit: number;

  /** Create service adapters over the passed built bounded contexts. */
  constructor(options: SpineServicesOptions) {
    this.#contexts = Object.freeze([...options.contexts]);
    this.#inactiveTtlMs = positiveInteger(options.inactiveTtlMs ?? DEFAULT_INACTIVE_TTL_MS);
    this.#queueLimit = positiveInteger(options.queueLimit ?? DEFAULT_QUEUE_LIMIT);

    for (const context of this.#contexts) {
      for (const typeUrl of context.commandBus().acceptedCommandTypes()) {
        if (!this.#commandRoutes.has(typeUrl)) {
          this.#commandRoutes.set(typeUrl, { context, typeUrl });
        }
      }

      for (const repository of context.registeredRepositories()) {
        const schema = repository.stateSchema;
        const typeUrl = deriveTypeUrl(schema);
        this.#stateRoutes.set(typeUrl, {
          allowedColumnNames: new Set(repository.metadata.columns.map((column) => column.name)),
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
      return await this.#query(route, createReadQuery(target, query), tenantId);
    } catch {
      return queryErrorResponse("QUERY_READ_ERROR", "Query read failed.");
    }
  }

  #readRoute(target: Target | undefined): StateRoute | undefined {
    return target === undefined ? undefined : this.#stateRoutes.get(target.type);
  }

  async #query(
    route: StateRoute,
    recordQuery: RecordQuery<unknown>,
    tenantId: string | undefined,
  ): Promise<QueryResponse> {
    const results = await route.context
      .stand()
      .queryVersioned(route.schema, recordQuery, tenantOptions(tenantId));

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
    return this.#persistSubscription(record).then(() => {
      this.#rememberSubscription(record);

      return clone(SubscriptionSchema, subscription);
    });
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
    const record =
      id === undefined
        ? undefined
        : (this.#subscriptions.get(id) ?? (await this.#recoverSubscription(id)));

    if (id === undefined || record === undefined) {
      return;
    }

    if (record.delivery.active) {
      return;
    }

    if (!record.durableConsumed && !(await this.#consumeDurableSubscription(record))) {
      await this.#removeSubscription(id);
      return;
    }

    try {
      this.#activateRecord(record);
    } catch (error) {
      await this.#removeSubscription(id);
      throw error;
    }

    try {
      while (!record.delivery.closed) {
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

  async #removeSubscription(id: string): Promise<void> {
    const record = this.#subscriptions.get(id);

    if (record !== undefined) {
      clearInactiveTimer(record);
      record.delivery.close();
      this.#subscriptions.delete(id);
    }
    await this.#deleteDurableSubscription(id, record?.route.context);
  }

  async #persistSubscription(record: SubscriptionRecord): Promise<void> {
    const storage = this.#subscriptionStorage(record.route.context);
    if (storage === undefined) {
      return;
    }

    try {
      await storage.write(
        DurableSubscriptionRecords.write({
          id: record.id,
          kind: record.kind,
          targetType: record.route.typeUrl,
          ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
          subscription: record.subscription,
          expiresAtMs: record.expiresAtMs,
        }),
      );
    } finally {
      storage.close();
    }
  }

  async #recoverSubscription(id: string): Promise<SubscriptionRecord | undefined> {
    for (const store of this.#subscriptionStores) {
      const storage = createSubscriptionStorage(store);

      try {
        const durable = await storage.read(id);
        if (durable === undefined) {
          continue;
        }

        const record = this.#restoreSubscription(durable, id);
        if (record === undefined) {
          await storage.delete(id);
          return undefined;
        }

        if (!(await storage.compareAndSet(id, durable, undefined))) {
          continue;
        }

        record.durableConsumed = true;
        this.#rememberSubscription(record);
        return record;
      } finally {
        storage.close();
      }
    }

    return undefined;
  }

  #restoreSubscription(durable: Any, id: string): SubscriptionRecord | undefined {
    try {
      const stored = DurableSubscriptionRecords.read(durable, id);

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
    } catch {
      return undefined;
    }
  }

  async #deleteDurableSubscription(id: string, context?: BoundedContext): Promise<void> {
    const stores =
      context === undefined
        ? this.#subscriptionStores
        : this.#subscriptionStores.filter((store) => store.context === context);

    await Promise.all(
      stores.map(async (store) => {
        const storage = createSubscriptionStorage(store);

        try {
          await storage.delete(id);
        } finally {
          storage.close();
        }
      }),
    );
  }

  async #consumeDurableSubscription(record: SubscriptionRecord): Promise<boolean> {
    const storage = this.#subscriptionStorage(record.route.context);
    if (storage === undefined) {
      record.durableConsumed = true;
      return true;
    }

    try {
      const durable = await storage.read(record.id);
      if (durable === undefined) {
        return false;
      }

      const stored = this.#restoreSubscription(durable, record.id);
      if (stored === undefined) {
        await storage.delete(record.id);
        return false;
      }

      const consumed = await storage.compareAndSet(record.id, durable, undefined);
      record.durableConsumed = consumed;
      return consumed;
    } finally {
      storage.close();
    }
  }

  #subscriptionStorage(context: BoundedContext): RecordStorage<string, Any> | undefined {
    const store = this.#subscriptionStores.find((candidate) => candidate.context === context);

    if (store === undefined) {
      return undefined;
    }

    return createSubscriptionStorage(store);
  }
}

/** Options for registering Spine service adapters over built bounded contexts. */
export interface SpineServicesOptions {
  /** Contexts exposed by these service adapters. */
  readonly contexts: readonly BoundedContext[];
  /**
   * Milliseconds before never-activated process-local subscriptions are discarded.
   *
   * Defaults to 30 seconds. Non-positive or non-finite values are coerced to 1.
   */
  readonly inactiveTtlMs?: number;
  /**
   * Maximum queued updates per active subscription before delivery is closed.
   *
   * Defaults to 100. Non-positive or non-finite values are coerced to 1.
   */
  readonly queueLimit?: number;
}

interface CommandRoute {
  readonly context: BoundedContext;
  readonly typeUrl: string;
}

interface StateRoute {
  readonly allowedColumnNames: ReadonlySet<string>;
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
  durableConsumed: boolean;
  inactiveTimer: ReturnType<typeof setTimeout> | undefined;
}

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
      return route.entityFamily === "projection"
        ? undefined
        : {
            type: "INVALID_QUERY",
            message: "QueryService.Read include_all requires a projection target.",
          };
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
  if (filters.filter.length > MAX_QUERY_COMPOSITE_FILTERS) {
    return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
  }

  const fieldFilterCount = filters.filter.reduce(
    (count, composite) => count + composite.filter.length,
    0,
  );
  if (fieldFilterCount > MAX_QUERY_SIMPLE_FILTERS) {
    return invalidQueryError("QueryService.Read may contain at most 16 simple column filters.");
  }

  const filterError = validateCompositeFilters(filters.filter, route);
  if (filterError !== undefined) {
    return filterError;
  }

  return idCount === 0 && fieldFilterCount === 0
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
  for (const filter of filters) {
    const operator = filter.operator;
    if (operator !== CompositeFilter_CompositeOperator.ALL) {
      return unsupportedFilterError("QueryService.Read supports only ALL column filters.");
    }
    if (filter.compositeFilter.length > 0) {
      return unsupportedFilterError("QueryService.Read does not support nested column filters.");
    }
    if (route.entityFamily !== "projection" && filter.filter.length > 0) {
      return unsupportedFilterError(
        "QueryService.Read column filters require a projection target.",
      );
    }
    const simpleError = validateSimpleFilters(filter.filter, route);
    if (simpleError !== undefined) {
      return simpleError;
    }
  }

  return undefined;
}

function validateSimpleFilters(
  filters: readonly Filter[],
  route: StateRoute,
): ContractError | undefined {
  for (const filter of filters) {
    if (filter.operator !== Filter_Operator.EQUAL) {
      return unsupportedFilterError("QueryService.Read supports only EQUAL column filters.");
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

function createReadQuery(target: Target, query: Query): RecordQuery<unknown> {
  return Object.freeze({
    ...criterionQuery(target),
    ...formatQuery(query.format),
  });
}

function criterionQuery(target: Target): RecordQuery<unknown> {
  switch (target.criterion.case) {
    case "includeAll":
      return {};
    case "filters":
      return filtersQuery(target.criterion.value);
    default:
      return {};
  }
}

function filtersQuery(filters: TargetFilters): RecordQuery<unknown> {
  const ids = filters.idFilter?.id.map((id) => decodeAnyValue(id)) ?? [];
  const recordFilters = filters.filter.flatMap((composite) => composite.filter.map(toRecordFilter));

  return {
    ...(ids.length === 0 ? {} : { ids }),
    ...(recordFilters.length === 0 ? {} : { filters: recordFilters }),
  };
}

function toRecordFilter(filter: Filter): RecordFilter {
  return {
    column: filter.fieldPath?.fieldName[0] ?? "",
    value: decodeAnyValue(filter.value),
  };
}

function formatQuery(format: Query["format"]): RecordQuery<unknown> {
  if (format === undefined) {
    return {};
  }

  const sort = format.orderBy.map(toRecordOrder);

  return {
    ...(format.fieldMask === undefined ? {} : { mask: format.fieldMask.paths }),
    ...(sort.length === 0 ? {} : { sort }),
    ...(format.limit > 0 ? { limit: format.limit } : {}),
  };
}

function toRecordOrder(order: OrderBy): RecordOrder {
  return {
    field: order.column,
    direction: order.direction === OrderBy_Direction.DESCENDING ? "desc" : "asc",
  };
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
const DEFAULT_QUEUE_LIMIT = 100;
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
    durableConsumed: false,
    inactiveTimer: undefined,
    ...input.shape,
  };
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
  if (error instanceof CommandRefusalError) {
    return {
      type: error.type,
      message: error.clientMessage,
    };
  }

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
        event: [clone(EventSchema, event)],
      }),
    },
  });
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
