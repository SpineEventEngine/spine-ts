/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { randomUUID } from "node:crypto";
import type { ILogLayer } from "loglayer";

import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import {
  clone,
  create,
  ScalarType,
  toBinary,
  type DescField,
  type Message,
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
import { TypeUrls, AnyPacker } from "@spine-event-engine/core";
import {
  CommandIdSchema,
  type Command,
  type Event,
  EventSchema,
  type TenantId,
  TenantIdSchema,
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
  EntityStateWithVersionSchema as EntityStateVersionSchema,
  OrderBy_Direction,
  QueryResponseSchema,
  type OrderBy,
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
import { EventOriginFilters } from "../stand/event-origin-filter.js";
import { TenantAdmissions, TenantUnknownError } from "../context/tenant-unknown-error.js";
import { AckSchema, type Ack } from "@spine-event-engine/proto";
import {
  ResponseSchema,
  StatusSchema,
  type Response,
  type Status,
} from "@spine-event-engine/proto";
import {
  type NormalizedComparisonOperator,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
} from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

import { BoundedContext, boundedContextAccess } from "../context/bounded-context.js";
import { EffectiveTenants } from "../context/effective-tenant.js";
import { CommandValidationError } from "../bus/command-errors.js";
import type { EntityFamily } from "../entity/entity.js";
import { TransitionValidationError } from "../repository/command-errors.js";
import { type StandReadResult, type StandUpdate } from "../stand/stand.js";
import { QueryReader } from "./query-reader.js";
import { RegisteredTargets } from "./registered-targets.js";
import { emitServerError, emitServerWarning } from "../server/server-log.js";
import { managedChildSubscriptionAccess } from "../server/managed-child-subscription.js";
import {
  InMemorySubscriptionRegistry,
  type StandSubscriptionRegistry,
} from "../stand/subscription-registry.js";

const serviceLoggers = new WeakMap<SpineServices, ILogLayer>();
const serviceInstances = new WeakSet<SpineServices>();

interface SpineServicesAccess {
  /**
   * Sets the server logger for service diagnostics.
   *
   * @param services Adapter receiving the logger.
   * @param logger Server logging layer.
   */
  installLogger(services: SpineServices, logger: ILogLayer): void;

  /**
   * Clears the logger installed for a closed service adapter.
   *
   * @param services Adapter whose logger is removed.
   */
  clearLogger(services: SpineServices): void;
}

/**
 * Small route registrar for the first public Spine gRPC service slice.
 *
 * `QueryService.Read` supports ID filters for any registered state route,
 * projection-state `include_all = true` reads, and column filters with
 * `EQUAL`, `GREATER_THAN`, `LESS_THAN`, `GREATER_OR_EQUAL`, or `LESS_OR_EQUAL`
 * comparisons inside nested `ALL`/`EITHER` composites. Filter paths name one
 * declared `(column)` proto field or supported system column, and values must
 * match its type. Range comparisons and ordering require a string or numeric
 * scalar column, `Timestamp`, or `version`; ordering accepts only `ASCENDING`
 * or `DESCENDING`. An absent response format or zero
 * wire limit receives an implicit 1,000-row cap without requiring ordering; a
 * positive limit of at most 1,000 requires at least one ordering directive.
 * Queries allow at most 100 IDs, 16 simple filters, 8 composites, and 8 orderings.
 * Use proto column names such as `open_task_count`, not generated TS local names
 * such as `openTaskCount`. Invalid columns, values, operators, and query shapes
 * return stable `INVALID_QUERY` responses before Stand storage is read.
 *
 * `SubscriptionService.Subscribe` accepts known state targets with
 * `include_all` or validated ID/field filters and known event targets exposed
 * by built-context event dispatchers with `include_all = true`. It stores the
 * canonical definition in the bounded context's subscription registry and
 * attaches delivery only when the opaque subscription ID is activated: state
 * subscriptions attach to `Stand`, while
 * event subscriptions attach to a framework-internal `EventBus` listener.
 * Filtered state topics deliver matching states, emit `no_longer_matching`
 * when previous state matched and new state does not, and deliver complete states.
 * Event topics stream wire-level `event_updates`
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

  readonly #activationTails = new Map<string, Promise<void>>();

  readonly #removals = new Map<string, SubscriptionRemoval>();

  readonly #unknownRemovals = new Set<string>();

  readonly #testRegistries = new WeakMap<object, StandSubscriptionRegistry>();

  readonly #queueLimit: number;

  readonly #subscriptionLimit: number;

  /**
   * Creates service adapters over built bounded contexts.
   *
   * @param options Configures contexts and subscription bounds.
   */
  constructor(options: SpineServicesOptions) {
    serviceInstances.add(this);
    this.#contexts = Object.freeze([...options.contexts]);
    this.#queueLimit = ServiceValues.positiveInteger(
      options.queueLimit ?? ServiceValues.defaultQueueLimit,
    );
    this.#subscriptionLimit = ServiceValues.subscriptionLimit(
      options.subscriptionLimit ?? ServiceValues.defaultSubscriptionLimit,
    );
    this.#registerSignalRoutes();
    this.#registerStateRoutes(new RegisteredTargets(this.#contexts));
  }

  /**
   * Registers Command and Event routes exposed by the assembled contexts.
   */
  #registerSignalRoutes(): void {
    for (const context of this.#contexts) {
      for (const typeUrl of context.commandBus().acceptedCommandTypes()) {
        if (!this.#commandRoutes.has(typeUrl)) {
          this.#commandRoutes.set(typeUrl, { context, typeUrl });
        }
      }

      for (const typeUrl of context.eventBus().acceptedEventTypes()) {
        if (!this.#eventRoutes.has(typeUrl)) {
          this.#eventRoutes.set(typeUrl, { context, kind: "event", typeUrl });
        }
      }
    }
  }

  /**
   * Registers state routes from the validated server-wide Entity lookup.
   *
   * @param targets Validated state registrations.
   */
  #registerStateRoutes(targets: RegisteredTargets): void {
    for (const { context, repository, typeUrl } of targets.all()) {
      const schema = repository.stateSchema;
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
        idField: ServiceValues.stateRouteIdField(schema, repository.idField),
        kind: "state",
        schema,
        typeUrl,
      });
    }
  }

  /**
   * Registers CommandService, QueryService, and SubscriptionService routes.
   *
   * @param router Receives the Connect service procedures.
   * @returns Returns the registered router.
   */
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

  /**
   * Resolves a public Command route before attempting dispatch.
   *
   * @param command Public Command request.
   * @returns Acknowledgement for route validation or dispatch.
   */
  async #post(command: Command): Promise<Ack> {
    const messageId = command.id && AnyPacker.pack(CommandIdSchema, command.id);
    const typeUrl = command.message?.typeUrl;
    if (typeUrl === undefined || typeUrl.length === 0)
      return ServiceValues.commandErrorAck(
        messageId,
        "INVALID_COMMAND",
        "Command message type is required.",
      );
    const admission = this.#commandAdmission(command, messageId, typeUrl);
    if ("ack" in admission) return admission.ack;
    const { route } = admission;

    try {
      await route.context.commandBus().post(command);
      return create(AckSchema, {
        messageId,
        status: ServiceValues.okStatus(),
      });
    } catch (error) {
      if (error instanceof TenantUnknownError) throw TenantStatuses.unknown(error);
      const postError = ServiceValues.commandPostError(error);
      this.#logCommandPostFailure(route, command, error);
      return create(AckSchema, {
        messageId,
        status: ServiceValues.errorStatus(postError.type, postError.message, postError.details),
      });
    }
  }

  /**
   * Checks route and tenant admission before command dispatch.
   *
   * @param command The public Command request.
   * @param messageId The packed Command ID returned in the Ack.
   * @param typeUrl The validated Command message type.
   * @returns A selected route or a stable rejection Ack.
   */
  #commandAdmission(
    command: Command,
    messageId: Any | undefined,
    typeUrl: string,
  ): { route: CommandRoute } | { ack: Ack } {
    const route = this.#commandRoutes.get(typeUrl);
    if (route === undefined) {
      return {
        ack: ServiceValues.commandErrorAck(
          messageId,
          "UNSUPPORTED_COMMAND",
          "No bounded context accepted the command.",
        ),
      };
    }

    const tenantError = ServiceValues.tenantMismatch(
      route.context.isMultitenant,
      ServiceValues.commandTenant(command),
      "command",
    );
    if (tenantError !== undefined) {
      return {
        ack: ServiceValues.commandErrorAck(messageId, tenantError.type, tenantError.message),
      };
    }
    return { route };
  }

  /**
   * Records one failed command post with safe correlation fields.
   *
   * @param route The selected bounded context and command type.
   * @param command The failed Command envelope.
   * @param error The internal failure, retained for diagnostic classification only.
   */
  #logCommandPostFailure(route: CommandRoute, command: Command, error: unknown): void {
    if (error instanceof TransitionValidationError || error instanceof CommandValidationError)
      return;
    const logger = serviceLoggers.get(this);
    if (logger === undefined) return;
    emitServerError(logger, "Command post failed.", {
      contextName: route.context.name.value,
      commandId: command.id?.uuid,
      commandType: route.typeUrl,
      operation: "command.post",
      errorName: InternalErrorFacts.name(error),
      errorCode: InternalErrorFacts.code(error),
    });
  }

  /**
   * Validates a public state query before reading its registered Stand.
   *
   * @param query Public query request.
   * @returns States or a stable query error response.
   */
  async #read(query: Query): Promise<QueryResponse> {
    const target = query.target;
    const route = this.#readRoute(target);

    if (target === undefined || route === undefined) {
      return ServiceValues.queryErrorResponse(
        "UNSUPPORTED_QUERY_TARGET",
        "No bounded context owns query target.",
      );
    }

    const queryError = ServiceValues.validateReadQuery(query, target, route);
    if (queryError !== undefined) {
      return ServiceValues.queryErrorResponse(queryError.type, queryError.message);
    }

    return this.#readValidated(query, target, route);
  }

  /**
   * Resolves the effective tenant and executes an already validated read.
   *
   * @param query Validated public query.
   * @param target Registered query target.
   * @param route Route containing the target Stand and schema.
   * @returns States or a stable tenant/read error response.
   */
  async #readValidated(query: Query, target: Target, route: StateRoute): Promise<QueryResponse> {
    const tenantId = ServiceValues.tenantValue(query.context?.tenantId);
    const tenantError = ServiceValues.tenantMismatch(
      route.context.isMultitenant,
      tenantId,
      "query",
    );
    if (tenantError !== undefined) {
      return ServiceValues.queryErrorResponse(tenantError.type, tenantError.message);
    }

    try {
      const effective = EffectiveTenants.current(route.context.isMultitenant, tenantId);
      const destination = EffectiveTenants.destination(effective, route.context.isMultitenant);
      return await this.#query(
        route,
        ServiceValues.createReadPlan(target, query, route),
        destination,
      );
    } catch (error) {
      if (error instanceof TenantUnknownError) throw TenantStatuses.unknown(error);
      return ServiceValues.queryErrorResponse("QUERY_READ_ERROR", "Query read failed.");
    }
  }

  #readRoute(target: Target | undefined): StateRoute | undefined {
    return target === undefined ? undefined : this.#stateRoutes.get(target.type);
  }

  async #query(
    route: StateRoute,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
  ): Promise<QueryResponse> {
    const results = await QueryReader.read(
      route.context.stand(),
      route.schema,
      plan,
      tenantId,
      ServiceValues.queryResultLimit,
    );

    return create(QueryResponseSchema, {
      response: ServiceValues.okResponse(),
      message: results.map((result) => ServiceValues.packVersionedState(route.schema, result)),
    });
  }

  /**
   * Validates a topic synchronously and checks live membership before registry creation.
   *
   * @param topic Requested subscription topic.
   * @returns Created subscription after admission.
   */
  #subscribe(topic: Topic): Promise<Subscription> {
    const route = this.#subscriptionRoute(topic);
    ServiceValues.validateTopic(topic);
    const shape = ServiceValues.createSubscriptionShape(topic, route);
    const tenantId = ServiceValues.topicTenant(topic);
    const tenantError = ServiceValues.tenantMismatch(
      route.context.isMultitenant,
      tenantId,
      "subscription",
    );

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

    void shape;
    const registry = this.#subscriptionRegistry(route.context);
    if (registry === undefined) {
      throw new ConnectError("Subscription registry is unavailable.", Code.FailedPrecondition);
    }
    return TenantStatuses.require(route.context, tenantId, async () => {
      await registry.create(subscription);
    }).then(() => clone(SubscriptionSchema, subscription));
  }

  async *#activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate> {
    const id = subscription.id?.value;
    if (id === undefined) {
      return;
    }

    const record = await this.#activationRecord(id);
    if (record === undefined) return;

    try {
      yield create(SubscriptionUpdateSchema, {
        subscription: clone(SubscriptionSchema, record.subscription),
        response: ServiceValues.okResponse(),
      });
      for (;;) {
        const update = await record.delivery.next();
        if (update === undefined) {
          return;
        }
        yield update;
      }
    } finally {
      if (!record.delivery.closed) {
        await this.#removeSubscription(id);
      }
    }
  }

  /**
   * Serializes one native activation and returns its attached record.
   *
   * @param id The logical subscription identifier.
   * @returns The attached record, or undefined when admission fails.
   */
  async #activationRecord(id: string): Promise<SubscriptionRecord | undefined> {
    let attached: SubscriptionRecord | undefined;
    await this.#serializeActivation(id, async () => {
      attached = await this.#startActivationRecord(id);
    });
    return attached;
  }

  /**
   * Validates and attaches one retained subscription before acknowledging readiness.
   *
   * @param id The logical subscription identifier.
   * @returns The attached record, or undefined when unavailable.
   */
  async #startActivationRecord(id: string): Promise<SubscriptionRecord | undefined> {
    const record = this.#subscriptions.get(id) ?? (await this.#findSubscription(id));
    if (record === undefined) return undefined;
    let attached: SubscriptionRecord | undefined;
    await this.#requireSubscriptionTenant(record, async () => {
      attached = await this.#activateKnownRecord(record, id);
    });
    return attached;
  }

  /**
   * Activates and attaches one admitted record before its registry closes.
   *
   * @param record Discovered subscription record.
   * @param id Canonical subscription ID.
   * @returns Attached record, if activation remains eligible.
   */
  async #activateKnownRecord(
    record: SubscriptionRecord,
    id: string,
  ): Promise<SubscriptionRecord | undefined> {
    if (record.delivery.active) return undefined;
    const activation = await this.#subscriptionRegistry(record.route.context)?.activate(
      create(SubscriptionIdSchema, { value: id }),
    );
    if (
      activation === undefined ||
      activation.kind === "missing" ||
      activation.kind === "expired" ||
      record.delivery.closed
    )
      return undefined;
    try {
      this.#subscriptions.set(id, record);
      await this.#activateRecord(record);
      return record;
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
  }

  async #serializeActivation(id: string, work: () => Promise<void>): Promise<void> {
    const previous = this.#activationTails.get(id) ?? Promise.resolve();
    let finish: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const tail = previous.then(() => settled);
    this.#activationTails.set(id, tail);
    await previous;
    try {
      await work();
    } finally {
      finish();
      if (this.#activationTails.get(id) === tail) this.#activationTails.delete(id);
    }
  }

  /**
   * Leaves an absent subscription ID inert and checks known records before removal.
   *
   * @param subscription Subscription identity supplied by the caller.
   * @returns Cancellation response after any required membership check.
   */
  #cancel(subscription: Subscription): Response | Promise<Response> {
    const id = subscription.id?.value;

    if (id === undefined) {
      return ServiceValues.okResponse();
    }

    return this.#cancelKnown(id);
  }

  /**
   * Checks the canonical record's tenant before cancellation side effects.
   *
   * @param id Subscription ID with a possible shared-registry record.
   * @returns Successful cancellation response after removal.
   */
  async #cancelKnown(id: string): Promise<Response> {
    const record = this.#subscriptions.get(id) ?? (await this.#findSubscription(id));
    if (record === undefined) await this.#removeSubscription(id);
    else await this.#requireSubscriptionTenant(record, () => this.#removeSubscription(id));
    return ServiceValues.okResponse();
  }

  /**
   * Checks the discovered subscription tenant before tenant-specific control work.
   *
   * @param record Canonical shared-registry subscription record.
   * @param onReady Complete admitted one-shot mutation, if present.
   */
  async #requireSubscriptionTenant(
    record: SubscriptionRecord,
    onReady?: () => Promise<void>,
  ): Promise<void> {
    await TenantStatuses.require(record.route.context, record.tenantId, onReady);
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

  async #activateRecord(record: SubscriptionRecord): Promise<void> {
    const registry = this.#subscriptionRegistry(record.route.context);
    if (registry === undefined) {
      this.#createSubscriptionAttachment(record);
      managedChildSubscriptionAccess.installed(record.id);
      return;
    }
    try {
      const consumer = await boundedContextAccess.consumeSubscription(
        record.route.context,
        record.id,
        (update) => {
          record.delivery.push(update);
          if (record.delivery.closed) {
            this.#removeDetachedSubscription(record.id);
          }
        },
      );
      record.delivery.attach(consumer);
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        (!error.message.includes("requires a Stand instance") &&
          !error.message.includes("requires a built BoundedContext instance"))
      ) {
        throw error;
      }
      this.#createSubscriptionAttachment(record);
    }
    managedChildSubscriptionAccess.installed(record.id);
  }

  #createSubscriptionAttachment(record: SubscriptionRecord): SubscriptionAttachment {
    if (record.kind === "event") return this.#attachEventSubscription(record);

    const stateRecord = record;
    const standSubscription = stateRecord.route.context.stand().subscribe(
      stateRecord.route.schema,
      (update) => {
        const subscriptionUpdate = ServiceValues.createEntityUpdate(stateRecord, update);
        if (subscriptionUpdate !== undefined) {
          stateRecord.delivery.push(subscriptionUpdate);
        }
        if (stateRecord.delivery.closed) {
          this.#removeDetachedSubscription(stateRecord.id);
        }
      },
      ServiceValues.tenantOptions(stateRecord.tenantId),
    );
    stateRecord.delivery.attach(standSubscription);
    return standSubscription;
  }

  /**
   * Attaches one filtered Event observer to its bounded context.
   * @param record The tracked Event subscription.
   * @returns The attached Event observer.
   */
  #attachEventSubscription(record: EventSubscriptionRecord): SubscriptionAttachment {
    const eventSubscription = boundedContextAccess.subscribeToEvent(
      record.route.context,
      record.route.typeUrl,
      {
        onEvent: (event) => {
          if (!ServiceValues.eventTenantMatches(record, event)) return;
          if (record.eventMatcher !== undefined && !record.eventMatcher(event)) return;
          record.delivery.push(ServiceValues.createEventUpdate(record, event));
          if (record.delivery.closed) this.#removeDetachedSubscription(record.id);
        },
      },
    );
    record.delivery.attach(eventSubscription);
    return eventSubscription;
  }

  #removeSubscription(id: string): Promise<void> {
    const existing = this.#removals.get(id);
    if (existing !== undefined) {
      return existing.settled;
    }

    const record = this.#subscriptions.get(id);
    const unknown = record === undefined;
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
      record.delivery.close();
      this.#subscriptions.delete(id);
    }

    const removal = ServiceValues.createSubscriptionRemoval();
    this.#removals.set(id, removal);
    void this.#runRemoval(id, removal, record, unknown);
    return removal.settled;
  }

  #removeDetachedSubscription(id: string): void {
    // spine-log-boundary: server.subscription_cleanup_failure
    void this.#removeSubscription(id).catch(() => {
      const logger = serviceLoggers.get(this);
      if (logger !== undefined) {
        emitServerWarning(logger, "Subscription cleanup failed.", {
          subscriptionId: id,
          operation: "service.subscription_cleanup",
          reasonCode: "cleanup_failed",
        });
      }
    });
  }

  async #runRemoval(
    id: string,
    removal: SubscriptionRemoval,
    record: SubscriptionRecord | undefined,
    unknown: boolean,
  ): Promise<void> {
    try {
      if (record !== undefined) {
        await this.#subscriptionRegistry(record.route.context)?.delete(
          create(SubscriptionIdSchema, { value: id }),
        );
      } else {
        await this.#deleteUnknownSubscription(id);
      }
      removal.resolve();
    } catch (error) {
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

  /**
   * Deletes an unknown subscription from every configured context registry.
   *
   * @param id Subscription ID to remove.
   */
  async #deleteUnknownSubscription(id: string): Promise<void> {
    await Promise.all(
      ServiceValues.uniqueContexts(this.#contexts).flatMap((context) => {
        const registry = this.#subscriptionRegistry(context);
        return registry === undefined
          ? []
          : [
              this.#registryOperation(context, async () => {
                await registry.delete(create(SubscriptionIdSchema, { value: id }));
              }),
            ];
      }),
    );
  }

  async #findSubscription(id: string): Promise<SubscriptionRecord | undefined> {
    const subscriptionId = create(SubscriptionIdSchema, { value: id });
    for (const context of ServiceValues.uniqueContexts(this.#contexts)) {
      const registry = this.#subscriptionRegistry(context);
      let entry: Awaited<ReturnType<StandSubscriptionRegistry["get"]>>;
      await this.#registryOperation(context, async () => {
        entry = await registry?.get(subscriptionId);
      });
      const subscription = entry?.subscription;
      const topic = subscription?.topic;
      if (entry === undefined || subscription === undefined || topic === undefined) continue;
      const canonicalTopic = clone(TopicSchema, topic);
      const route = this.#subscriptionRoute(canonicalTopic);
      if (route.context !== context) continue;
      const tenantId = ServiceValues.topicTenant(canonicalTopic);
      if (
        ServiceValues.tenantMismatch(context.isMultitenant, tenantId, "subscription") !== undefined
      ) {
        continue;
      }
      return ServiceValues.createSubscriptionRecord({
        id,
        subscription: clone(SubscriptionSchema, subscription),
        shape: ServiceValues.createSubscriptionShape(canonicalTopic, route),
        tenantId,
        queueLimit: this.#queueLimit,
      });
    }
    return undefined;
  }

  /**
   * Retains one short registry read or delete through the context close drain.
   *
   * @param context Context selected by the shared subscription route.
   * @param onOperation Complete registry callback.
   * @returns Completion before the selected registry may close.
   */
  #registryOperation(context: BoundedContext, onOperation: () => Promise<void>): Promise<void> {
    const runtimeContext: unknown = context;
    return runtimeContext instanceof BoundedContext
      ? boundedContextAccess.admitServiceRegistryOperation(runtimeContext, onOperation)
      : onOperation();
  }

  #subscriptionRegistry(
    context: BoundedContext | undefined,
  ): StandSubscriptionRegistry | undefined {
    if (context === undefined) {
      return undefined;
    }
    try {
      return boundedContextAccess.subscriptionRegistry(context);
    } catch {
      // Direct route tests may use structural context doubles. Production
      // contexts always provide their configured registry through the access seam.
      const key = context as unknown as object;
      let registry = this.#testRegistries.get(key);
      if (registry === undefined) {
        registry = new InMemorySubscriptionRegistry();
        this.#testRegistries.set(key, registry);
      }
      return registry;
    }
  }
}

/**
 * Provides package-private service configuration seams.
 *
 * @internal
 */
export const spineServicesAccess: SpineServicesAccess = Object.freeze({
  /**
   * Clears the logger installed for a closed service adapter.
   *
   * @param services Adapter whose logger is removed.
   */
  clearLogger(services: SpineServices): void {
    if (!serviceInstances.has(services)) {
      throw new TypeError("SpineServices logger requires a SpineServices instance.");
    }
    serviceLoggers.delete(services);
  },

  /**
   * Sets the server logger for service diagnostics.
   *
   * @param services Adapter receiving the logger.
   * @param logger Server logging layer.
   */
  installLogger(services: SpineServices, logger: ILogLayer): void {
    if (!serviceInstances.has(services)) {
      throw new TypeError("SpineServices logger requires a SpineServices instance.");
    }
    serviceLoggers.set(services, logger);
  },
});

/**
 * Options for registering Spine service adapters over built bounded contexts.
 */
export interface SpineServicesOptions {
  // prettier-ignore

  /**
   * Contexts exposed by these service adapters.
   */
  readonly contexts: readonly BoundedContext[];

  /**
   * Maximum queued updates per active subscription before delivery is closed.
   *
   * Defaults to 100. Non-positive or non-finite values are coerced to 1.
   */
  readonly queueLimit?: number;

  /**
   * Maximum concurrent unknown-ID cancellation operations for this
   * `SpineServices` instance.
   *
   * It defaults to 100 and must be a positive safe integer. Each instance has an
   * independent limit; this is neither a registry, process-wide, nor distributed
   * quota.
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

interface MessageFieldInfo {
  readonly name: string;
  readonly localName: string;
  readonly message?: MessageSchema;
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
  readonly tenantId: TenantId | undefined;
  readonly delivery: SubscriptionDelivery;
}

interface SubscriptionRemoval {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: () => void;
  readonly settled: Promise<void>;
}

type SubscriptionRecord = EventSubscriptionRecord | StateSubscriptionRecord;

interface EventSubscriptionRecord extends SubscriptionRecordBase {
  readonly kind: "event";
  readonly route: EventRoute;
  readonly eventMatcher?: (event: Event) => boolean;
}

interface StateSubscriptionRecord extends SubscriptionRecordBase {
  readonly kind: "state";
  readonly route: StateRoute;

  /**
   * Supports isolated structural-context test doubles only.
   */
  readonly matcher?: SubscriptionMatcher;
}

type SubscriptionShape =
  | {
      readonly kind: "event";
      readonly route: EventRoute;
      readonly eventMatcher?: (event: Event) => boolean;
    }
  | {
      readonly kind: "state";
      readonly route: StateRoute;
      readonly matcher?: SubscriptionMatcher;
    };

interface SubscriptionMatcher {
  /**
   * Matches one Stand update against a subscribed state filter.
   *
   * @param update State update to inspect.
   * @returns Delivery kind, if the update affects the subscriber.
   */
  match(update: StandUpdate): SubscriptionMatch | undefined;
}

type SubscriptionMatch = "state" | "noLongerMatching";

/**
 * Buffers subscription updates and wakes active stream readers.
 */
class SubscriptionDelivery {
  readonly #queue: SubscriptionUpdate[] = [];

  readonly #waiters: ((update: SubscriptionUpdate | undefined) => void)[] = [];

  readonly #queueLimit: number;

  #subscription: SubscriptionAttachment | undefined;

  #closed = false;

  /**
   * Sets the bounded update queue capacity.
   *
   * @param queueLimit Maximum pending updates before closure.
   */
  constructor(queueLimit: number) {
    this.#queueLimit = queueLimit;
  }

  /**
   * Checks whether a source attachment is active.
   *
   * @returns `true` after an attachment is installed.
   */
  get active(): boolean {
    return this.#subscription !== undefined;
  }

  /**
   * Checks whether this delivery queue has closed.
   *
   * @returns `true` after closure.
   */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Attaches a source subscription or immediately removes it after close.
   *
   * @param subscription Source attachment to track.
   */
  attach(subscription: SubscriptionAttachment): void {
    if (this.#closed) {
      subscription.unsubscribe();
      return;
    }

    this.#subscription = subscription;
  }

  /**
   * Queues one update or wakes the next waiting stream reader.
   *
   * @param update State or Event update to deliver.
   */
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

  /**
   * Reads the next queued update, waiting while the stream is open and empty.
   *
   * @returns Next update, or `undefined` after closure.
   */
  next(): Promise<SubscriptionUpdate | undefined> {
    const update = this.#queue.shift();
    if (update !== undefined || this.#closed) {
      return Promise.resolve(update);
    }

    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /**
   * Closes the source subscription and completes all waiting readers.
   */
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

  /**
   * Removes the attached source subscription.
   */
  unsubscribe(): void;
}

/**
 * Builds an OK status for service responses.
 */
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
  if (idCount > QueryLimits.idCount) {
    return invalidQueryError("QueryService.Read id_filter may contain at most 100 IDs.");
  }
  const idEntries = filters.idFilter?.id as readonly (Any | undefined)[] | undefined;
  if (idEntries?.some((id) => id === undefined) === true) {
    return invalidQueryError("QueryService.Read id_filter entries are required.");
  }
  const idError = validateQueryIds(idEntries, route);
  if (idError !== undefined) {
    return idError;
  }
  if (filters.filter.length > QueryLimits.compositeCount) {
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
    const error = ServiceValues.validateCompositeNode(
      filter,
      current.depth,
      compositeCount,
      simpleCount,
      pending.length,
      route,
    );
    if (error !== undefined) return error;
    for (const child of filter.compositeFilter) {
      pending.push({ filter: child, depth: current.depth + 1 });
    }
  }

  return undefined;
}

function validateQueryIds(
  ids: readonly (Any | undefined)[] | undefined,
  route: StateRoute,
): ContractError | undefined {
  const schema = route.idField.message;
  if (schema === undefined || ids === undefined) {
    return undefined;
  }

  if (
    ids.some(
      (id) =>
        id === undefined ||
        (schema.typeName !== AnySchema.typeName && AnyPacker.tryUnpack(id, schema) === undefined),
    )
  ) {
    return invalidQueryError(`QueryService.Read id_filter values must pack ${schema.typeName}.`);
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

/**
 * Checks query ordering and limits against the registered state route.
 */
function formatReadError(format: Query["format"], route: StateRoute): ContractError | undefined {
  if (format === undefined) {
    return undefined;
  }
  if (format.orderBy.length > QueryLimits.orderCount) {
    return unsupportedFormatError("QueryService.Read order_by may contain at most 8 entries.");
  }
  if (format.limit > QueryLimits.resultCount) {
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
  return ServiceValues.validateReadOrder(format.orderBy, route);
}

/**
 * Converts an accepted wire query into a storage plan for complete states.
 */
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
    predicates.push({
      kind: "ids",
      ids: filters.idFilter.id.map((id) => decodeQueryIdValue(id, route)),
    });
  }
  predicates.push(...filters.filter.map((filter) => normalizedComposite(filter, route)));
  const onlyPredicate = predicates[0];
  return predicates.length === 1 && onlyPredicate !== undefined
    ? onlyPredicate
    : { kind: "all", predicates };
}

function decodeQueryIdValue(value: Any, route: StateRoute): unknown {
  const schema = route.idField.message;
  return schema === undefined ? decodeAnyValue(value) : decodeAnyValue(value, schema);
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
    const value = AnyPacker.tryUnpack(filter.value, VersionSchema);
    if (value !== undefined) return value;
    throw new TypeError('Validated query column "version" has an invalid value.');
  }
  if ((column === "archived" || column === "deleted") && filter.value !== undefined) {
    const value = AnyPacker.tryUnpack(filter.value, BoolValueSchema);
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
  if (
    schema === undefined ||
    (schema.typeName !== AnySchema.typeName && value.typeUrl !== TypeUrls.derive(schema))
  )
    return false;
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
      value.typeUrl === TypeUrls.derive(VersionSchema) &&
      AnyPacker.tryUnpack(value, VersionSchema) !== undefined
    );
  }
  if (column === "archived" || column === "deleted") {
    return (
      value.typeUrl === TypeUrls.derive(BoolValueSchema) &&
      AnyPacker.tryUnpack(value, BoolValueSchema) !== undefined
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

const DEFAULT_QUEUE_LIMIT = 100;
const DEFAULT_SUBSCRIPTION_LIMIT = 100;

/**
 * Holds bounded request limits for QueryService.
 */
const QueryLimits = Object.freeze({
  idCount: 100,
  filterCount: 16,
  compositeCount: 8,
  orderCount: 8,
  resultCount: 1_000,
});

/**
 * Holds bounded request limits for SubscriptionService.
 */
const SubscriptionLimits = Object.freeze({
  idCount: QueryLimits.idCount,
  compositeCount: 8,
  filterCount: 16,
  compositeDepth: 8,
  pathComponentCount: 16,
  pathSegmentLength: 128,
});

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function subscriptionLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("SpineServices subscriptionLimit must be a positive safe integer.");
  }

  return value;
}

function createSubscriptionRecord(input: {
  readonly id: string;
  readonly subscription: Subscription;
  readonly shape: SubscriptionShape;
  readonly tenantId: TenantId | undefined;
  readonly queueLimit: number;
}): SubscriptionRecord {
  return {
    id: input.id,
    subscription: clone(SubscriptionSchema, input.subscription),
    tenantId: input.tenantId === undefined ? undefined : clone(TenantIdSchema, input.tenantId),
    delivery: new SubscriptionDelivery(input.queueLimit),
    ...input.shape,
  };
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

function uniqueContexts(contexts: readonly BoundedContext[]): readonly BoundedContext[] {
  return [...new Set(contexts)];
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

/**
 * Validates a topic and prepares complete state or event delivery.
 */
function createSubscriptionShape(topic: Topic, route: SubscriptionRoute): SubscriptionShape {
  const target = topic.target;
  if (target === undefined) {
    throw new ConnectError("Subscription topic target is required.", Code.InvalidArgument);
  }
  if (route.kind === "event") {
    const eventMatcher = validateEventSubscriptionTopic(target);
    return { kind: "event", route, ...(eventMatcher === undefined ? {} : { eventMatcher }) };
  }

  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        throw new ConnectError(
          "SubscriptionService.Subscribe requires filters or include_all = true.",
          Code.InvalidArgument,
        );
      }
      return { kind: "state", route, matcher: { match: () => "state" } };
    case "filters":
      return {
        kind: "state",
        route,
        matcher: createFilteredSubscriptionMatcher(target.criterion.value, route),
      };
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

/**
 * Checks the supported event topic criteria.
 */
function validateEventSubscriptionTopic(target: Target): ((event: Event) => boolean) | undefined {
  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        throw new ConnectError(
          "SubscriptionService.Subscribe requires filters or include_all = true.",
          Code.InvalidArgument,
        );
      }
      return undefined;
    case "filters":
      return EventOriginFilters.compile(target.criterion.value);
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

/**
 * Matches complete state updates against a topic's ID and field filters.
 */
function createFilteredSubscriptionMatcher(
  filters: TargetFilters,
  route: StateRoute,
): SubscriptionMatcher {
  ServiceValues.validateSubscriptionFilters(filters);
  const idValues = filters.idFilter?.id.map((id) => decodeSubscriptionIdValue(id, route));
  const statePredicate = createSubscriptionPredicate(filters.filter, route);

  return {
    /**
     * Matches one state update against the topic's ID and field filters.
     *
     * @param update State update to inspect.
     * @returns Delivery kind, if the update changes a matching state.
     */
    match(update) {
      if (
        idValues !== undefined &&
        !idValues.some((id) => valuesEqual(update.id, id, route.idField.message))
      ) {
        return undefined;
      }
      if (statePredicate(update.state)) return "state";
      if (update.previousState !== undefined && statePredicate(update.previousState))
        return "noLongerMatching";
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
  if (filters.length > SubscriptionLimits.compositeCount) {
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
  if (depth > SubscriptionLimits.compositeDepth) {
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
  if (depth === SubscriptionLimits.compositeDepth && filter.compositeFilter.length > 0) {
    throw new ConnectError(
      "SubscriptionService.Subscribe composite filters may nest at most 8 levels.",
      Code.InvalidArgument,
    );
  }

  counts.compositeCount += 1;
  if (counts.compositeCount > SubscriptionLimits.compositeCount) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
      Code.InvalidArgument,
    );
  }

  counts.simpleCount += filter.filter.length;
  if (counts.simpleCount > SubscriptionLimits.filterCount) {
    throw new ConnectError(
      "SubscriptionService.Subscribe may contain at most 16 simple field filters.",
      Code.InvalidArgument,
    );
  }
  if (
    (filter.compositeFilter.length > 1 || depth + 1 < SubscriptionLimits.compositeDepth) &&
    counts.compositeCount + filter.compositeFilter.length > SubscriptionLimits.compositeCount
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
    if (depth + 1 > SubscriptionLimits.compositeDepth) {
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

/**
 * Checks a state filter path before resolving its fields.
 */
function validateSubscriptionPath(fieldPath: readonly string[], label: "field filter"): void {
  if (fieldPath.length === 0 || fieldPath.some((field) => field.trim().length === 0)) {
    throw new ConnectError(
      `SubscriptionService.Subscribe ${label} path is required.`,
      Code.InvalidArgument,
    );
  }
  if (fieldPath.length > SubscriptionLimits.pathComponentCount) {
    throw new ConnectError(
      `SubscriptionService.Subscribe ${label} path may contain at most 16 components.`,
      Code.InvalidArgument,
    );
  }
  if (fieldPath.some((field) => field.length > SubscriptionLimits.pathSegmentLength)) {
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

  const decoded =
    route.idField.message.typeName === AnySchema.typeName
      ? value
      : AnyPacker.tryUnpack(value, route.idField.message);
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

  const decoded =
    schema.typeName === AnySchema.typeName ? value : AnyPacker.tryUnpack(value, schema);
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
    if (schema.typeName === AnySchema.typeName) return value;
    const decoded = AnyPacker.tryUnpack(value, schema);
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

/**
 * Resolves a state filter path to generated message fields.
 */
function resolveMessagePath(
  schema: MessageSchema,
  fieldPath: readonly string[],
  label: "field filter",
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

/**
 * Packs a state snapshot and version for a public query result.
 *
 * @typeParam Schema Generated state schema.
 * @param schema Schema used to pack the state.
 * @param result Stored state and its version.
 * @returns Wire state/version pair.
 */
function packVersionedState<Schema extends MessageSchema>(
  schema: Schema,
  result: StandReadResult<Schema>,
) {
  return create(EntityStateVersionSchema, {
    state: AnyPacker.pack(schema, result.state),
    version: result.version ?? create(VersionSchema),
  });
}

function commandTenant(command: Command): TenantId | undefined {
  return tenantValue(command.context?.actorContext?.tenantId);
}

function topicTenant(topic: Topic | undefined): TenantId | undefined {
  return tenantValue(topic?.context?.tenantId);
}

function eventTenant(event: Event): TenantId | undefined {
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
  const tenantId = eventTenant(event);
  return (
    record.tenantId === undefined ||
    (tenantId !== undefined &&
      TenantBoundary.from(tenantId).key === TenantBoundary.from(record.tenantId).key)
  );
}

function tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
  if (tenantId === undefined) return undefined;
  try {
    return TenantBoundary.from(tenantId).tenantId;
  } catch {
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

/**
 * Maps confirmed tenant absence to native service errors.
 */
const TenantStatuses = Object.freeze({
  /**
   * Checks live membership and maps only confirmed missing membership to NotFound.
   *
   * @param context Receiving context and its selected index.
   * @param tenantId Complete selected tenant identity.
   * @param onReady Complete one-shot mutation after membership and preparation.
   * @returns Completion after membership and any mutation settle.
   */
  async require(
    context: BoundedContext,
    tenantId?: TenantId,
    onReady?: () => Promise<void>,
  ): Promise<void> {
    try {
      const runtimeContext: unknown = context;
      if (runtimeContext instanceof BoundedContext)
        await boundedContextAccess.admitServiceInput(
          runtimeContext,
          tenantId,
          () =>
            TenantAdmissions.require(
              context.tenantIndex,
              context.name.value,
              context.isMultitenant,
              tenantId,
            ),
          onReady,
        );
      else {
        await TenantAdmissions.require(
          context.tenantIndex,
          context.name.value,
          context.isMultitenant,
          tenantId,
        );
        await onReady?.();
      }
    } catch (error) {
      if (error instanceof TenantUnknownError) throw TenantStatuses.unknown(error);
      throw error;
    }
  },

  /**
   * Exposes a confirmed unknown tenant as a native NotFound RPC with Spine details.
   *
   * @param error Receiving-context membership failure.
   * @returns Connect failure preserving its stable Spine error type.
   */
  unknown(error: TenantUnknownError): ConnectError {
    return new ConnectError(
      error.message,
      Code.NotFound,
      undefined,
      [
        {
          desc: ErrorSchema,
          value: create(ErrorSchema, {
            type: error.type,
            code: Code.NotFound,
            message: error.message,
          }),
        },
      ],
      error,
    );
  },
});

function tenantMismatch(
  multitenant: boolean,
  tenantId: TenantId | undefined,
  subject: "command" | "query" | "subscription",
): ContractError | undefined {
  if (multitenant) {
    return tenantId === undefined
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
      details: AnyPacker.pack(ValidationErrorSchema, error.validationError),
    };
  }

  if (error instanceof CommandValidationError) {
    return {
      type: "COMMAND_VALIDATION_ERROR",
      message: "Command payload validation failed.",
      details: AnyPacker.pack(ValidationErrorSchema, error.validationError),
    };
  }

  return {
    type: "COMMAND_POST_ERROR",
    message: "Command post failed.",
  };
}

const recognizedSqlErrorCodes = new Set([
  "40001",
  "40P01",
  "42703",
  "42P01",
  "23503",
  "23505",
  "P0001",
  "08006",
  "ER_BAD_FIELD_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_SIGNAL_EXCEPTION",
]);

const InternalErrorFacts = Object.freeze({
  /**
   * Reads a recognized SQL code from an internal failure chain.
   *
   * @param error The internal failure.
   * @returns A recognized code, if present.
   */
  code(error: unknown): string | undefined {
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      try {
        const code: unknown = Reflect.get(current, "code");
        if (typeof code === "string" && recognizedSqlErrorCodes.has(code)) return code;
        current = Reflect.get(current, "cause");
      } catch {
        return undefined;
      }
    }
    return undefined;
  },

  /**
   * Reads a safe error class name without trusting a rejection's accessors.
   *
   * @param error The internal failure.
   * @returns A known error name, if present.
   */
  name(error: unknown): string | undefined {
    try {
      if (!(error instanceof Error)) return undefined;
      const name = error.name;
      return ["Error", "TypeError", "RangeError", "AggregateError"].includes(name)
        ? name
        : undefined;
    } catch {
      return undefined;
    }
  },
});

function tenantOptions(tenantId: TenantId | undefined): { readonly tenantId?: TenantId } {
  return tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, tenantId) };
}

const VALUE_DECODERS = Object.freeze([
  (value: Any) => AnyPacker.tryUnpack(value, StringValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, BoolValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, Int32ValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, UInt32ValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, Int64ValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, UInt64ValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, FloatValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, DoubleValueSchema)?.value,
  (value: Any) => AnyPacker.tryUnpack(value, BytesValueSchema)?.value,
]);

/**
 * Builds a subscription update with a complete state or a removal signal.
 */
function createEntityUpdate(
  record: StateSubscriptionRecord,
  update: StandUpdate,
): SubscriptionUpdate | undefined {
  const matcher = record.matcher;
  if (matcher === undefined) return undefined;
  const match = matcher.match(update);
  if (match === undefined) return undefined;
  const kind =
    match === "state"
      ? {
          case: "state" as const,
          value: AnyPacker.pack(record.route.schema, clone(record.route.schema, update.state)),
        }
      : { case: "noLongerMatching" as const, value: true };

  return create(SubscriptionUpdateSchema, {
    subscription: clone(SubscriptionSchema, record.subscription),
    response: okResponse(),
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: packEntityId(record.route, update.id),
            kind,
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

function packString(value: string): Any {
  return AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value }));
}

function packEntityId(route: StateRoute, id: unknown): Any | undefined {
  if (isAny(id)) {
    return clone(AnySchema, id);
  }
  if (route.idField.message !== undefined && isMessage(id)) {
    return AnyPacker.pack(route.idField.message, id);
  }
  if (id instanceof Uint8Array) {
    return AnyPacker.pack(BytesValueSchema, create(BytesValueSchema, { value: id }));
  }

  switch (typeof id) {
    case "string":
      return packString(id);
    case "boolean":
      return AnyPacker.pack(BoolValueSchema, create(BoolValueSchema, { value: id }));
    case "number":
      return AnyPacker.pack(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
    case "bigint":
      return AnyPacker.pack(Int64ValueSchema, create(Int64ValueSchema, { value: id }));
    default:
      return undefined;
  }
}

/**
 * Groups non-public service contract, query, and subscription operations.
 */
const ServiceValues = Object.freeze({
  /**
   * Checks one composite query filter and its current traversal bounds.
   *
   * @param filter The composite filter being traversed.
   * @param depth The nesting level of this filter.
   * @param compositeCount The number of composites visited so far.
   * @param simpleCount The number of simple filters visited so far.
   * @param pendingCount The number of composites waiting to be checked.
   * @param route The registered state type and columns used to validate filters.
   * @returns The first invalid-query error, if the filter is invalid.
   */
  validateCompositeNode(
    filter: CompositeFilter,
    depth: number,
    compositeCount: number,
    simpleCount: number,
    pendingCount: number,
    route: StateRoute,
  ): ContractError | undefined {
    if (filter.filter.length === 0 && filter.compositeFilter.length === 0)
      return invalidQueryError("QueryService.Read composite filter must not be empty.");
    if (compositeCount > QueryLimits.compositeCount || depth > 8)
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    if (simpleCount > QueryLimits.filterCount)
      return invalidQueryError("QueryService.Read may contain at most 16 simple column filters.");
    if (compositeCount + pendingCount + filter.compositeFilter.length > QueryLimits.compositeCount)
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    if (depth >= 8 && filter.compositeFilter.length > 0)
      return invalidQueryError("QueryService.Read may contain at most 8 composite filters.");
    if (
      filter.operator !== CompositeFilter_CompositeOperator.ALL &&
      filter.operator !== CompositeFilter_CompositeOperator.EITHER
    )
      return unsupportedFilterError("QueryService.Read composite operator must be ALL or EITHER.");
    return validateSimpleFilters(filter.filter, route);
  },

  /**
   * Checks that every wire ordering names a sortable registered column.
   *
   * @param orders The wire ordering clauses in request order.
   * @param route The registered columns available to this state type.
   * @returns The first unsupported-format error, if an ordering is invalid.
   */
  validateReadOrder(orders: readonly OrderBy[], route: StateRoute): ContractError | undefined {
    for (const order of orders) {
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
  },

  /**
   * Checks that a state topic has a usable ID or field filter.
   *
   * @param filters The ID and field criteria from the subscription topic.
   */
  validateSubscriptionFilters(filters: TargetFilters): void {
    if (filters.idFilter?.id.length === 0) {
      throw new ConnectError(
        "SubscriptionService.Subscribe id_filter requires at least one ID.",
        Code.InvalidArgument,
      );
    }
    if (filters.idFilter !== undefined && filters.idFilter.id.length > SubscriptionLimits.idCount) {
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
  },

  commandPostError,

  /**
   * Builds a stable Command rejection acknowledgement.
   *
   * @param messageId The packed Command ID, if supplied.
   * @param type The public error code.
   * @param message The public error message.
   * @returns A sanitized Ack.
   */
  commandErrorAck(messageId: Any | undefined, type: string, message: string): Ack {
    return create(AckSchema, { messageId, status: errorStatus(type, message) });
  },
  commandTenant,
  createEntityUpdate,
  createEventUpdate,
  createReadPlan,
  createSubscriptionRecord,
  createSubscriptionRemoval,
  createSubscriptionShape,
  defaultQueueLimit: DEFAULT_QUEUE_LIMIT,
  defaultSubscriptionLimit: DEFAULT_SUBSCRIPTION_LIMIT,
  errorStatus,
  eventTenantMatches,
  okResponse,
  okStatus,
  positiveInteger,
  packVersionedState,
  queryErrorResponse,
  queryResultLimit: QueryLimits.resultCount,
  stateRouteIdField,
  subscriptionLimit,
  tenantMismatch,
  tenantOptions,
  tenantValue,
  topicTenant,
  uniqueContexts,
  validateReadQuery,
  validateTopic,
});
