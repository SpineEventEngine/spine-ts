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

import { Code, ConnectError, type ConnectRouter, type HandlerContext } from "@connectrpc/connect";
import {
  clone,
  create,
  toBinary,
  ScalarType,
  type DescField,
  type Message,
} from "@bufbuild/protobuf";
import type { ReaderProofVerifier } from "@spine-event-engine/core/spi/reader-forwarding";
import {
  ReaderIdentities,
  type ReaderIdentity,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";
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
import { TypeUrls, AnyPacker, Validate } from "@spine-event-engine/core";
import {
  CommandIdSchema,
  CommandValidationError as CommandValidationErrorCode,
  type Command,
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
  QuerySchema,
  type OrderBy,
  type Query,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import {
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
import { type StandReadResult } from "../stand/stand.js";
import { QueryReader } from "./query-reader.js";
import { ReadRequestStatus } from "./read-request-status.js";
import { TrustedReaderIngress, type DirectReaderAuthenticator } from "./trusted-reader-ingress.js";
import { RegisteredTargets } from "./registered-targets.js";
import { emitServerError, emitServerWarning } from "../server/server-log.js";
import { managedChildSubscriptionAccess } from "../server/managed-child-subscription.js";
import { type StandSubscriptionRegistry } from "../stand/subscription-registry.js";

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
 * reject with structured `INVALID_ARGUMENT` and `INVALID_QUERY` details before
 * Stand storage is read.
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
 * dispatch. Unknown or expired activation IDs fail with `NOT_FOUND` and
 * `UNKNOWN_SUBSCRIPTION` details. A duplicate active activation completes
 * without another update stream.
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

  readonly #queueLimit: number;

  readonly #subscriptionLimit: number;

  readonly #readerAdmission: SpineServicesOptions["readerAdmission"];

  readonly #readMaxBytes: number;

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
    this.#readerAdmission = options.readerAdmission;
    this.#readMaxBytes = options.readMaxBytes ?? 4_194_304;
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
    this.#registerUnary(router);
    this.#registerSubscriptions(router);
    return router;
  }

  /**
   * Registers admitted Command and Query routes.
   *
   * @param router Connect service router.
   */
  #registerUnary(router: ConnectRouter): void {
    router.service(CommandService, {
      post: async (command, context) => {
        await this.#admit(
          "spine.client.CommandService",
          "Post",
          toBinary(CommandService.method.post.input, command),
          context,
        );
        return this.#post(command);
      },
    });
    router.service(QueryService, {
      read: async (query, context) => {
        await this.#admit(
          "spine.client.QueryService",
          "Read",
          toBinary(QuerySchema, query),
          context,
        );
        return this.#read(query);
      },
      execute: async (query, context) => {
        await this.#admit(
          "spine.client.QueryService",
          "Execute",
          toBinary(QueryService.method.execute.input, query),
          context,
        );
        throw new ConnectError("App Query execution is unavailable.", Code.Unimplemented);
      },
    });
  }

  /**
   * Registers reader-bound subscription routes.
   *
   * @param router Connect service router.
   */
  #registerSubscriptions(router: ConnectRouter): void {
    router.service(SubscriptionService, {
      subscribe: (topic, context) => this.#subscribeAdmitted(topic, context),
      activate: (subscription, context) => this.#activateAdmitted(subscription, context),
      cancel: (subscription, context) => this.#cancelAdmitted(subscription, context),
    });
  }

  /**
   * Keeps direct in-process Subscribe validation synchronous while admitting native peers.
   *
   * @param topic Requested subscription topic.
   * @param context Native transport context, absent for direct in-process calls.
   * @returns Subscription or admitted native operation promise.
   */
  #subscribeAdmitted(topic: Topic, context?: HandlerContext): Subscription | Promise<Subscription> {
    if (context === undefined) return this.#subscribe(topic, { kind: "anonymous" });
    return this.#admit(
      "spine.client.SubscriptionService",
      "Subscribe",
      toBinary(TopicSchema, topic),
      context,
    ).then((reader) => this.#subscribe(topic, ReaderIdentities.from(reader)));
  }

  /**
   * Keeps direct in-process Cancel synchronous while admitting native peers.
   *
   * @param subscription Requested subscription definition.
   * @param context Native transport context, absent for direct in-process calls.
   * @returns Cancel acknowledgment or admitted native operation promise.
   */
  #cancelAdmitted(
    subscription: Subscription,
    context?: HandlerContext,
  ): Response | Promise<Response> {
    if (context === undefined) return this.#cancel(subscription, { kind: "anonymous" });
    return this.#admit(
      "spine.client.SubscriptionService",
      "Cancel",
      toBinary(SubscriptionSchema, subscription),
      context,
    ).then((reader) => this.#cancel(subscription, ReaderIdentities.from(reader)));
  }

  /**
   * Verifies one native reader assertion before service side effects.
   *
   * @param service Canonical RPC service.
   * @param method Canonical RPC method.
   * @param bytes Canonical request bytes.
   * @param context Native transport context when called through Connect.
   * @returns Detached trusted reader facts.
   */
  async #admit(
    service: string,
    method: string,
    bytes: Uint8Array,
    context?: HandlerContext,
  ): Promise<TrustedReaderContext> {
    if (context === undefined) return Object.freeze({});
    return TrustedReaderIngress.admit({
      service,
      method,
      request: bytes,
      headers: context.requestHeader,
      peer: context,
      maxBytes: this.#readMaxBytes,
      ...this.#readerAdmission,
    });
  }

  /**
   * Verifies activation before entering the subscription lifecycle generator.
   *
   * @param subscription Native activation request.
   * @param context Native transport context.
   * @returns Admitted subscription update stream.
   */
  async *#activateAdmitted(
    subscription: Subscription,
    context?: HandlerContext,
  ): AsyncIterable<SubscriptionUpdate> {
    const reader = await this.#admit(
      "spine.client.SubscriptionService",
      "Activate",
      toBinary(SubscriptionSchema, subscription),
      context,
    );
    yield* this.#activate(subscription, ReaderIdentities.from(reader));
  }

  /**
   * Resolves a public Command route before attempting dispatch.
   *
   * @param command Public Command request.
   * @returns Acknowledgement for route validation or dispatch.
   */
  async #post(command: Command): Promise<Ack> {
    const messageId = command.id && AnyPacker.pack(CommandIdSchema, command.id);
    try {
      CommandValidationError.checkEnvelope(command);
    } catch (error) {
      const failure = ServiceValues.commandPostError(error);
      return ServiceValues.commandErrorAck(
        messageId,
        failure.type,
        failure.message,
        failure.code,
        failure.details,
      );
    }
    const typeUrl = command.message.typeUrl;
    const admission = this.#commandAdmission(command, messageId, typeUrl);
    if ("ack" in admission) return admission.ack;
    return this.#dispatchCommand(admission.route, command, messageId);
  }

  /**
   * Dispatches an admitted Command and maps its completed or failed outcome.
   *
   * @param route Selected Command route.
   * @param command Validated Command envelope.
   * @param messageId Packed ID for the acknowledgement.
   * @returns The completed Command acknowledgement.
   */
  async #dispatchCommand(
    route: CommandRoute,
    command: Command,
    messageId: Any | undefined,
  ): Promise<Ack> {
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
        status: ServiceValues.errorStatus(
          postError.type,
          postError.message,
          postError.details,
          postError.code,
        ),
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
          "spine.core.CommandValidationError",
          "No bounded context accepted the command.",
          CommandValidationErrorCode.UNSUPPORTED_COMMAND,
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
   * @returns States for an admitted Query.
   * @throws ConnectError for invalid input or a sanitized read failure.
   */
  async #read(query: Query): Promise<QueryResponse> {
    ReadRequestStatus.check("query", () => Validate.check(QuerySchema, query));
    const target = query.target;
    const route = this.#readRoute(target);
    if (target === undefined || route === undefined) {
      throw ReadRequestStatus.invalid("query", true, "No bounded context owns query target.");
    }
    const queryError = ServiceValues.validateReadQuery(query, target, route);
    if (queryError !== undefined) {
      throw ReadRequestStatus.invalid("query", false, queryError.message);
    }
    return this.#readValidated(query, target, route);
  }

  /**
   * Resolves the effective tenant and executes an already validated read.
   *
   * @param query Validated public query.
   * @param target Registered query target.
   * @param route Route containing the target Stand and schema.
   * @returns States when tenant admission and storage read succeed.
   */
  async #readValidated(query: Query, target: Target, route: StateRoute): Promise<QueryResponse> {
    const tenantId = ServiceValues.tenantValue(query.context?.tenantId);
    const tenantError = ServiceValues.tenantMismatch(
      route.context.isMultitenant,
      tenantId,
      "query",
    );
    if (tenantError !== undefined) {
      throw ReadRequestStatus.tenant(tenantError.type, tenantError.message);
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
      throw new ConnectError("Query read failed.", Code.Internal);
    }
  }

  /**
   * Finds the registered Entity state route for a query target.
   *
   * @param target Declared query or Topic target.
   * @returns The matching read route, if present.
   */ #readRoute(target: Target | undefined): StateRoute | undefined {
    return target === undefined ? undefined : this.#stateRoutes.get(target.type);
  }

  /**
   * Executes a validated Entity state read through its registered route.
   *
   * @param route Registered target route with schema and tenancy.
   * @param plan Validated Entity read plan.
   * @param tenantId Declared Proto tenant identifier.
   * @returns The Entity query response.
   */ async #query(
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
   * @param reader The verified reader facts for this operation.
   */
  #subscribe(topic: Topic, reader: ReaderIdentity): Promise<Subscription> {
    ReadRequestStatus.check("topic", () => Validate.check(TopicSchema, topic));
    const route = this.#subscriptionRoute(topic);
    ServiceValues.checkTopicSemantics(topic, route);
    const tenantId = ServiceValues.topicTenant(topic);
    const tenantError = ServiceValues.tenantMismatch(
      route.context.isMultitenant,
      tenantId,
      "subscription",
    );

    if (tenantError !== undefined) {
      throw ReadRequestStatus.tenant(tenantError.type, tenantError.message);
    }

    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${randomUUID()}` }),
      topic: clone(TopicSchema, topic),
    });
    const id = subscription.id?.value;

    if (id === undefined) {
      throw new ConnectError("Subscription ID is required.", Code.InvalidArgument);
    }

    const registry = boundedContextAccess.subscriptionRegistry(route.context);
    return TenantStatuses.require(route.context, tenantId, async () => {
      await registry.create(subscription, reader);
    }).then(() => clone(SubscriptionSchema, subscription));
  }

  /**
   * Verifies membership and activates a retained subscription.
   *
   * @param subscription The subscription definition being processed.
   * @param reader The verified reader facts for this operation.
   * @returns The update stream after admission.
   */ async *#activate(
    subscription: Subscription,
    reader: ReaderIdentity,
  ): AsyncIterable<SubscriptionUpdate> {
    ReadRequestStatus.check("subscription", () => Validate.check(SubscriptionSchema, subscription));
    ReadRequestStatus.checkLifecycleCriterion(subscription);
    const id = subscription.id?.value;
    if (id === undefined) {
      return;
    }

    const record = await this.#activationRecord(id, reader);
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
   * @param reader The verified reader facts for this operation.
   */
  async #activationRecord(
    id: string,
    reader: ReaderIdentity,
  ): Promise<SubscriptionRecord | undefined> {
    let attached: SubscriptionRecord | undefined;
    await this.#serializeActivation(id, async () => {
      attached = await this.#startActivationRecord(id, reader);
    });
    return attached;
  }

  /**
   * Validates and attaches one retained subscription before acknowledging readiness.
   *
   * @param id The logical subscription identifier.
   * @returns The attached record, or undefined when unavailable.
   * @param reader The verified reader facts for this operation.
   */
  async #startActivationRecord(
    id: string,
    reader: ReaderIdentity,
  ): Promise<SubscriptionRecord | undefined> {
    const record = this.#subscriptions.get(id) ?? (await this.#findSubscription(id));
    if (record === undefined) throw ReadRequestStatus.unknownSubscription();
    if (!ReaderIdentities.matches(record.reader, reader)) throw this.#readerDenied();
    let attached: SubscriptionRecord | undefined;
    await this.#requireSubscriptionTenant(record, async () => {
      attached = await this.#activateKnownRecord(record, id, reader);
    });
    return attached;
  }

  /**
   * Activates and attaches one admitted record before its registry closes.
   *
   * @param record Discovered subscription record.
   * @param id Canonical subscription ID.
   * @returns Attached record, if activation remains eligible.
   * @param reader The verified reader facts for this operation.
   */
  async #activateKnownRecord(
    record: SubscriptionRecord,
    id: string,
    reader: ReaderIdentity,
  ): Promise<SubscriptionRecord | undefined> {
    if (record.delivery.active) return undefined;
    const activation = await boundedContextAccess
      .subscriptionRegistry(record.route.context)
      .activate(create(SubscriptionIdSchema, { value: id }), reader);
    if (activation.kind === "denied") throw this.#readerDenied();
    if (activation.kind === "missing" || activation.kind === "expired")
      throw ReadRequestStatus.unknownSubscription();
    if (record.delivery.closed) return undefined;
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

  /**
   * Serializes activation callbacks for the same subscription ID.
   *
   * @param id The stable identifier for this record.
   * @param work Accepted lifecycle operation.
   * @returns Completion after the operation settles.
   */ async #serializeActivation(id: string, work: () => Promise<void>): Promise<void> {
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
   * @param reader The verified reader facts for this operation.
   */
  #cancel(subscription: Subscription, reader: ReaderIdentity): Response | Promise<Response> {
    ReadRequestStatus.check("subscription", () => Validate.check(SubscriptionSchema, subscription));
    ReadRequestStatus.checkLifecycleCriterion(subscription);
    const id = subscription.id?.value;

    if (id === undefined) {
      return ServiceValues.okResponse();
    }

    return this.#cancelKnown(id, reader);
  }

  /**
   * Checks the canonical record's tenant before cancellation side effects.
   *
   * @param id Subscription ID with a possible shared-registry record.
   * @returns Successful cancellation response after removal.
   * @param reader The verified reader facts for this operation.
   */
  async #cancelKnown(id: string, reader: ReaderIdentity): Promise<Response> {
    const live = this.#subscriptions.get(id);
    const record = live ?? (await this.#findSubscription(id));
    if (record === undefined) return ServiceValues.okResponse();
    if (!ReaderIdentities.matches(record.reader, reader)) throw this.#readerDenied();
    await this.#requireSubscriptionTenant(record, async () => {
      if (live !== undefined) return this.#removeSubscription(id, reader);
      await this.#registryOperation(record.route.context, async () => {
        const outcome = await boundedContextAccess
          .subscriptionRegistry(record.route.context)
          .delete(create(SubscriptionIdSchema, { value: id }), reader);
        if (outcome === "denied") throw this.#readerDenied();
      });
    });
    return ServiceValues.okResponse();
  }

  /**
   * Returns a sanitized denial for a foreign or legacy-bound subscription.
   *
   * @returns The reader authorization error.
   */
  #readerDenied(): ConnectError {
    return new ConnectError("Subscription reader is not authorized.", Code.PermissionDenied);
  }

  /**
   * Checks the discovered subscription tenant before tenant-specific control work.
   *
   * @param record Canonical shared-registry subscription record.
   * @param onReady Complete admitted one-shot mutation, if present.
   * @returns Completion after the operation settles.
   */
  async #requireSubscriptionTenant(
    record: SubscriptionRecord,
    onReady?: () => Promise<void>,
  ): Promise<void> {
    await TenantStatuses.require(record.route.context, record.tenantId, onReady);
  }

  /**
   * Finds the registered state or event route for a Topic target.
   *
   * @param topic Framework subscription Topic.
   * @returns The matching subscription route.
   */ #subscriptionRoute(topic: Topic): SubscriptionRoute {
    const target = topic.target;
    const route =
      target === undefined
        ? undefined
        : (this.#stateRoutes.get(target.type) ?? this.#eventRoutes.get(target.type));

    if (target === undefined || route === undefined) {
      throw ReadRequestStatus.invalid("topic", true, "Unsupported subscription target.");
    }

    return route;
  }

  /**
   * Attaches delivery for the validated retained subscription.
   *
   * @param record The durable subscription record.
   * @returns Completion after the operation settles.
   */ async #activateRecord(record: SubscriptionRecord): Promise<void> {
    const consumer = await boundedContextAccess.consumeSubscription(
      record.route.context,
      record.id,
      (update) => {
        record.delivery.push(update);
        if (record.delivery.closed) this.#removeDetachedSubscription(record.id);
      },
    );
    record.delivery.attach(consumer);
    managedChildSubscriptionAccess.installed(record.id);
  }

  /**
   * Serializes removal of a retained subscription and its delivery.
   *
   * @param id The stable identifier for this record.
   * @param reader The verified reader facts for this operation.
   * @returns Completion after the operation settles.
   */ #removeSubscription(id: string, reader?: ReaderIdentity): Promise<void> {
    const existing = this.#removals.get(id);
    if (existing !== undefined) {
      return existing.settled;
    }

    const record = this.#subscriptions.get(id);
    const unknown = record === undefined;
    if (reader !== undefined && unknown) return Promise.resolve();
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
    } else if (reader === undefined) {
      record.delivery.close();
      this.#subscriptions.delete(id);
    }

    const removal = ServiceValues.createSubscriptionRemoval();
    this.#removals.set(id, removal);
    void this.#runRemoval(id, removal, record, unknown, reader);
    return removal.settled;
  }

  /**
   * Cleans up delivery after a subscription record is detached.
   *
   * @param id The stable identifier for this record.
   */ #removeDetachedSubscription(id: string): void {
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

  /**
   * Executes serialized subscription cleanup for one ID.
   *
   * @param id The stable identifier for this record.
   * @param removal Shared subscription-removal task.
   * @param record The durable subscription record.
   * @param unknown Unrecognized route or filter value.
   * @param reader The verified reader facts for this operation.
   * @returns Completion after the operation settles.
   */ async #runRemoval(
    id: string,
    removal: SubscriptionRemoval,
    record: SubscriptionRecord | undefined,
    unknown: boolean,
    reader?: ReaderIdentity,
  ): Promise<void> {
    try {
      if (record !== undefined) {
        const deleted = await boundedContextAccess
          .subscriptionRegistry(record.route.context)
          .delete(create(SubscriptionIdSchema, { value: id }), reader);
        if (deleted === "denied") throw this.#readerDenied();
        if (reader !== undefined) {
          record.delivery.close();
          this.#subscriptions.delete(id);
        }
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
   * @returns Completion after the operation settles.
   */
  async #deleteUnknownSubscription(id: string): Promise<void> {
    await Promise.all(
      ServiceValues.uniqueContexts(this.#contexts).map((context) =>
        this.#registryOperation(context, async () => {
          await boundedContextAccess
            .subscriptionRegistry(context)
            .delete(create(SubscriptionIdSchema, { value: id }));
        }),
      ),
    );
  }

  /**
   * Loads a retained subscription record by opaque ID.
   *
   * @param id The stable identifier for this record.
   * @returns The retained record, if present.
   */ async #findSubscription(id: string): Promise<SubscriptionRecord | undefined> {
    const subscriptionId = create(SubscriptionIdSchema, { value: id });
    for (const context of ServiceValues.uniqueContexts(this.#contexts)) {
      let entry: Awaited<ReturnType<StandSubscriptionRegistry["get"]>>;
      await this.#registryOperation(context, async () => {
        entry = await boundedContextAccess.subscriptionRegistry(context).get(subscriptionId);
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
        ...(entry.reader === undefined ? {} : { reader: entry.reader }),
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
    return boundedContextAccess.admitServiceRegistryOperation(context, onOperation);
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
   * Existing native request-size bound used for internal reader assertions.
   */
  readonly readMaxBytes?: number;

  /**
   * Configured direct and trusted-peer authentication ports.
   */
  readonly readerAdmission?: Readonly<{
    forwarded?: ReaderProofVerifier<HandlerContext>;
    direct?: DirectReaderAuthenticator<HandlerContext>;
  }>;

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
  readonly reader?: ReaderIdentity;
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
}

interface StateSubscriptionRecord extends SubscriptionRecordBase {
  readonly kind: "state";
  readonly route: StateRoute;
}

type SubscriptionShape =
  | {
      readonly kind: "event";
      readonly route: EventRoute;
    }
  | {
      readonly kind: "state";
      readonly route: StateRoute;
    };

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
 *
 * @returns The successful status.
 */
function okStatus(): Status {
  return create(StatusSchema, {
    status: {
      case: "ok",
      value: create(EmptySchema),
    },
  });
}

/**
 * Builds a structured status from a public validation error.
 *
 * @param type Registered target type URL.
 * @param message Public validation or error message.
 * @param details Structured validation details.
 * @param code Public status code.
 * @returns The structured error status.
 */ function errorStatus(type: string, message: string, details?: Any, code?: number): Status {
  return create(StatusSchema, {
    status: {
      case: "error",
      value: create(ErrorSchema, {
        type,
        message,
        ...(code === undefined ? {} : { code }),
        ...(details === undefined ? {} : { details }),
      }),
    },
  });
}

/**
 * Builds a successful subscription service response.
 *
 * @returns The OK response.
 */ function okResponse(): Response {
  return create(ResponseSchema, { status: okStatus() });
}

/**
 * Checks a read query envelope and target before routing.
 *
 * @param query Framework Entity read query.
 * @param target Declared query or Topic target.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated read request.
 */ function validateReadQuery(
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

/**
 * Checks target filters against the registered Entity schema.
 *
 * @param filters Target or subscription filter collection.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated target filters.
 */ function validateFilters(filters: TargetFilters, route: StateRoute): ContractError | undefined {
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

/**
 * Checks nested composite filters and their traversal bounds.
 *
 * @param filters Target or subscription filter collection.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated composite filters.
 */ function validateCompositeFilters(
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

/**
 * Checks query ID Any payloads against the registered Entity ID.
 *
 * @param ids Opaque query or subscription IDs.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated query IDs.
 */ function validateQueryIds(
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

/**
 * Counts leaf filters in a nested subscription criterion.
 *
 * @param filters Target or subscription filter collection.
 * @returns The number of simple filter nodes.
 */ function countSimpleFilters(filters: readonly CompositeFilter[]): number {
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

/**
 * Checks field filters and their typed Any values.
 *
 * @param filters Target or subscription filter collection.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated simple filters.
 */ function validateSimpleFilters(
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
 *
 * @param format Declared filter value format.
 * @param route Registered target route with schema and tenancy.
 * @returns The structured read error.
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
 *
 * @param target Declared query or Topic target.
 * @param query Framework Entity read query.
 * @param route Registered target route with schema and tenancy.
 * @returns The validated Entity read plan.
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

/**
 * Converts validated target filters to executable predicates.
 *
 * @param filters Target or subscription filter collection.
 * @param route Registered target route with schema and tenancy.
 * @returns The normalized filter predicates.
 */ function normalizedFilters(
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

/**
 * Decodes an opaque query ID using the registered Entity ID schema.
 *
 * @param value Packed Entity ID Any from the query.
 * @param route Registered target route with schema and tenancy.
 * @returns The typed Entity ID.
 */ function decodeQueryIdValue(value: Any, route: StateRoute): unknown {
  const schema = route.idField.message;
  return schema === undefined ? decodeAnyValue(value) : decodeAnyValue(value, schema);
}

/**
 * Converts a validated composite filter to its execution form.
 *
 * @param filter One target or subscription filter.
 * @param route Registered target route with schema and tenancy.
 * @returns The normalized composite criterion.
 */ function normalizedComposite(
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

/**
 * Resolves a declared state column for a field filter.
 *
 * @param filter One target or subscription filter.
 * @returns The required state column.
 */ function requiredFilterColumn(filter: Filter): string {
  const column = filter.fieldPath?.fieldName[0];
  if (column !== undefined) return column;
  throw new TypeError("Validated query filter has no column.");
}

/**
 * Maps a wire filter operator to a supported comparison.
 *
 * @param filter One target or subscription filter.
 * @returns The required comparison operator.
 */ function requiredComparison(filter: Filter): NormalizedComparisonOperator {
  const operator = wireComparison(filter.operator);
  if (operator !== undefined) return operator;
  throw new TypeError("Validated query filter has no supported comparison operator.");
}

/**
 * Decodes a filter value for the target state column.
 *
 * @param filter One target or subscription filter.
 * @param route Registered target route with schema and tenancy.
 * @returns The typed column value.
 */ function decodeColumnValue(filter: Filter, route: StateRoute): unknown {
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

/**
 * Checks an Any filter value against the registered field schema.
 *
 * @param field Registered Protobuf field descriptor.
 * @param value Packed field-filter value.
 * @returns Whether the filter value has the expected type.
 */ function filterValueMatches(field: DescField, value: Any): boolean {
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

/**
 * Selects the Protobuf schema required for a state field filter.
 *
 * @param field Registered Protobuf field descriptor.
 * @returns The declared filter-value schema.
 */ function filterValueSchema(field: DescField): MessageSchema | undefined {
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

/**
 * Checks special state columns against a wire filter value.
 *
 * @param column Registered Entity state column.
 * @param value Packed value for a system state column.
 * @returns Whether the special value matches.
 */ function systemValueMatches(column: string, value: Any): boolean {
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

/**
 * Checks whether a field type supports ordered comparisons.
 *
 * @param field Registered Protobuf field descriptor.
 * @returns Whether range comparisons are supported.
 */ function supportsRange(field: DescField): boolean {
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

/**
 * Maps a wire filter enum to the execution comparison.
 *
 * @param operator Wire filter comparison enum.
 * @returns The comparison operator.
 */ function wireComparison(operator: Filter_Operator): NormalizedComparisonOperator | undefined {
  if (operator === Filter_Operator.EQUAL) return "equal";
  if (operator === Filter_Operator.GREATER_THAN) return "greaterThan";
  if (operator === Filter_Operator.LESS_THAN) return "lessThan";
  if (operator === Filter_Operator.GREATER_OR_EQUAL) return "greaterOrEqual";
  if (operator === Filter_Operator.LESS_OR_EQUAL) return "lessOrEqual";
  return undefined;
}

/**
 * Creates a structured error for an unsupported filter.
 *
 * @param message Public validation or error message.
 * @returns The invalid-filter error.
 */ function unsupportedFilterError(message: string): ContractError {
  return invalidQueryError(message);
}

/**
 * Creates a structured error for an unsupported filter format.
 *
 * @param message Public validation or error message.
 * @returns The invalid-format error.
 */ function unsupportedFormatError(message: string): ContractError {
  return invalidQueryError(message);
}

/**
 * Creates the structured invalid-query error.
 *
 * @param message Public validation or error message.
 * @returns The invalid-query error.
 */ function invalidQueryError(message: string): ContractError {
  return {
    type: "INVALID_QUERY",
    message,
  };
}

/**
 * Creates the structured invalid-subscription criterion error.
 *
 * @returns The invalid-criterion error.
 */ function invalidCriterionError(): ContractError {
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

/**
 * Normalizes a configured positive integer to a safe fallback.
 *
 * @param value Configured numeric value.
 * @returns The positive integer setting.
 */ function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

/**
 * Validates the configured maximum concurrent subscriptions.
 *
 * @param value Configured maximum concurrent subscriptions.
 * @returns The accepted subscription limit.
 */ function subscriptionLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("SpineServices subscriptionLimit must be a positive safe integer.");
  }

  return value;
}

/**
 * Constructs an in-memory subscription record with its reader binding.
 *
 * @param input Fields for a new reader-bound subscription record.
 * @returns The new subscription record.
 */ function createSubscriptionRecord(input: {
  readonly id: string;
  readonly subscription: Subscription;
  readonly shape: SubscriptionShape;
  readonly tenantId: TenantId | undefined;
  readonly queueLimit: number;
  readonly reader?: ReaderIdentity;
}): SubscriptionRecord {
  return {
    id: input.id,
    subscription: clone(SubscriptionSchema, input.subscription),
    ...(input.reader === undefined ? {} : { reader: input.reader }),
    tenantId: input.tenantId === undefined ? undefined : clone(TenantIdSchema, input.tenantId),
    delivery: new SubscriptionDelivery(input.queueLimit),
    ...input.shape,
  };
}

/**
 * Creates a shared removal task for concurrent cancellation.
 *
 * @returns The removal task and its completion promise.
 */ function createSubscriptionRemoval(): SubscriptionRemoval {
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

/**
 * Deduplicates registered bounded contexts for routing.
 *
 * @param contexts Built bounded contexts available for routing.
 * @returns The distinct bounded contexts.
 */ function uniqueContexts(contexts: readonly BoundedContext[]): readonly BoundedContext[] {
  return [...new Set(contexts)];
}

/**
 * Checks Topic identity, context, target and criterion.
 *
 * @param topic Framework subscription Topic.
 */ function validateTopic(topic: Topic): void {
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
 * Validates a topic and returns its state or Event subscription shape.
 *
 * @param topic Framework subscription Topic.
 * @param route Registered target route with schema and tenancy.
 * @returns The normalized subscription shape.
 */
function createSubscriptionShape(topic: Topic, route: SubscriptionRoute): SubscriptionShape {
  const target = topic.target;
  if (target === undefined) {
    throw new ConnectError("Subscription topic target is required.", Code.InvalidArgument);
  }
  if (route.kind === "event") {
    validateEventSubscriptionTopic(target);
    return { kind: "event", route };
  }

  switch (target.criterion.case) {
    case "includeAll":
      if (!target.criterion.value) {
        throw new ConnectError(
          "SubscriptionService.Subscribe requires filters or include_all = true.",
          Code.InvalidArgument,
        );
      }
      return { kind: "state", route };
    case "filters":
      ServiceValues.validateFilteredSubscriptionTopic(target.criterion.value, route);
      return { kind: "state", route };
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

/**
 * Checks the supported event topic criteria.
 *
 * @param target Declared query or Topic target.
 */
function validateEventSubscriptionTopic(target: Target): void {
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
      EventOriginFilters.compile(target.criterion.value);
      return;
    default:
      throw new ConnectError(
        "SubscriptionService.Subscribe requires filters or include_all = true.",
        Code.InvalidArgument,
      );
  }
}

/**
 * Checks a Topic filter tree before accepting its definition.
 *
 * @param filters Target or subscription filter collection.
 */ function validateSubscriptionFilterTree(filters: readonly CompositeFilter[]): void {
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

/**
 * Checks one nested subscription filter node and its bounds.
 *
 * @param filter One target or subscription filter.
 * @param depth Current composite-filter nesting depth.
 * @param counts Current filter traversal counts.
 */ function validateSubscriptionFilterNode(
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

/**
 * Queues nested filter children for bounded traversal.
 *
 * @param filter One target or subscription filter.
 * @param depth Current composite-filter nesting depth.
 * @param stack Pending filter traversal stack.
 */ function enqueueSubscriptionFilterChildren(
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

/**
 * Checks a state filter path before resolving its fields.
 *
 * @param fieldPath Declared filter field path.
 * @param label Diagnostic label for the invalid input.
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

/**
 * Decodes a subscription ID filter using the target ID schema.
 *
 * @param value Packed subscription ID Any.
 * @param route Registered target route with schema and tenancy.
 * @returns The typed subscription filter ID.
 */ function decodeSubscriptionIdValue(value: Any, route: StateRoute): unknown {
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

/**
 * Decodes a field-filter Any with its declared value schema.
 *
 * @param value Packed field-filter Any, if present.
 * @param schema Registered Protobuf message schema.
 * @returns The typed field-filter value.
 */ function decodeFieldFilterValue(value: Any | undefined, schema: MessageSchema | undefined) {
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

/**
 * Decodes a known Any payload against its declared schema.
 *
 * @param value Packed Any payload, if present.
 * @param schema Registered Protobuf message schema.
 * @returns The decoded payload value.
 */ function decodeAnyValue(value: Any | undefined, schema?: MessageSchema): unknown {
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
  readonly leafSchema?: MessageSchema;
}

interface MessageFieldInfo {
  readonly name: string;
  readonly localName: string;
  readonly message?: MessageSchema;
}

/**
 * Resolves a state filter path to generated message fields.
 *
 * @param schema Registered Protobuf message schema.
 * @param fieldPath Declared filter field path.
 * @param label Diagnostic label for the invalid input.
 * @returns The registered field at the declared path.
 */
function resolveMessagePath(
  schema: MessageSchema,
  fieldPath: readonly string[],
  label: "field filter",
): ResolvedMessagePath {
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
    ...(leafSchema === undefined ? {} : { leafSchema }),
  });
}

/**
 * Finds a declared field in a registered Protobuf message.
 *
 * @param schema Registered Protobuf message schema.
 * @param name Configured header or field name.
 * @returns The matching field descriptor, if present.
 */ function findMessageField(
  schema: MessageSchema | undefined,
  name: string,
): MessageFieldInfo | undefined {
  const fields = (schema?.fields ?? []) as unknown as readonly MessageFieldInfo[];

  return fields.find((field) => field.name === name || field.localName === name);
}

/**
 * Recognizes a Protobuf message value.
 *
 * @param value Candidate value to inspect as a Protobuf message.
 * @returns Whether the value is a message.
 */ function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && "$typeName" in value;
}

/**
 * Recognizes a Protobuf Any message by its declared type name.
 *
 * @param value Candidate value to inspect as a Protobuf Any.
 * @returns Whether the value is an Any message.
 */ function isAny(value: unknown): value is Any {
  return isMessage(value) && value.$typeName === "google.protobuf.Any";
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

/**
 * Extracts the declared tenant from a command actor context.
 *
 * @param command Framework command envelope.
 * @returns The declared command tenant, if present.
 */ function commandTenant(command: Command): TenantId | undefined {
  return tenantValue(command.context?.actorContext?.tenantId);
}

/**
 * Extracts the declared tenant from a Topic actor context.
 *
 * @param topic Framework subscription Topic.
 * @returns The Topic tenant, if present.
 */ function topicTenant(topic: Topic | undefined): TenantId | undefined {
  return tenantValue(topic?.context?.tenantId);
}

/**
 * Extracts the tenant value from a Proto tenant identifier.
 *
 * @param tenantId Declared Proto tenant identifier.
 * @returns The tenant value, if present.
 */ function tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
  if (tenantId === undefined) return undefined;
  try {
    return TenantBoundary.from(tenantId).tenantId;
  } catch {
    return undefined;
  }
}

/**
 * Finds the declared Entity ID field for a registered state route.
 *
 * @param schema Registered Protobuf message schema.
 * @param idField Registered Entity ID field.
 * @returns The Entity ID field descriptor.
 */ function stateRouteIdField(
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

/**
 * Checks a request tenant against bounded-context tenancy.
 *
 * @param multitenant Whether the bounded context requires a tenant.
 * @param tenantId Declared Proto tenant identifier.
 * @param subject Verified request subject.
 * @returns The tenant mismatch status, if any.
 */ function tenantMismatch(
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
  readonly code?: number;
}

/**
 * Maps a command-post failure to its public structured status.
 *
 * @param error The failure being classified or propagated.
 * @returns The sanitized command status.
 */ function commandPostError(error: unknown): ContractError {
  if (error instanceof TransitionValidationError) {
    return {
      type: error.type,
      message: error.clientMessage,
      details: AnyPacker.pack(ValidationErrorSchema, error.validationError),
    };
  }

  if (error instanceof CommandValidationError) {
    return {
      type: "spine.core.CommandValidationError",
      code: CommandValidationErrorCode.INVALID_COMMAND,
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
 * Groups non-public service contract, query, and subscription operations.
 */
const ServiceValues = Object.freeze({
  /**
   * Maps supported Topic shape errors to structured public failures.
   *
   * @param topic Constraint-valid Topic to inspect.
   * @param route Registered state or Event route.
   */
  checkTopicSemantics(topic: Topic, route: SubscriptionRoute): void {
    try {
      ServiceValues.validateTopic(topic);
      ServiceValues.createSubscriptionShape(topic, route);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
        throw ReadRequestStatus.invalid("topic", false, error.rawMessage);
      }
      throw new ConnectError("Topic validation failed.", Code.Internal);
    }
  },

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
   * Validates state ID and field filters before storing the topic.
   *
   * @param filters The topic's declared filters.
   * @param route The registered state route.
   */
  validateFilteredSubscriptionTopic(filters: TargetFilters, route: StateRoute): void {
    ServiceValues.validateSubscriptionFilters(filters);
    for (const id of filters.idFilter?.id ?? []) decodeSubscriptionIdValue(id, route);
    for (const filter of filters.filter) ServiceValues.validateCompositeFilter(filter, route);
  },

  /**
   * Validates nested state filter values without retaining an observer predicate.
   *
   * @param filter A validated composite filter.
   * @param route The registered state route.
   */
  validateCompositeFilter(filter: CompositeFilter, route: StateRoute): void {
    for (const simple of filter.filter) ServiceValues.validateSimpleFilter(simple, route);
    for (const nested of filter.compositeFilter)
      ServiceValues.validateCompositeFilter(nested, route);
  },

  /**
   * Validates one field path and packed comparison value.
   *
   * @param filter A simple field filter.
   * @param route The registered state route.
   */
  validateSimpleFilter(filter: Filter, route: StateRoute): void {
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
    decodeFieldFilterValue(filter.value, resolved.leafSchema);
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
   * @param type The error type.
   * @param message The public error message.
   * @param code Numeric Proto error code when available.
   * @param details Packed structured validation details when available.
   * @returns A sanitized Ack.
   */
  commandErrorAck(
    messageId: Any | undefined,
    type: string,
    message: string,
    code?: number,
    details?: Any,
  ): Ack {
    return create(AckSchema, { messageId, status: errorStatus(type, message, details, code) });
  },
  commandTenant,
  createReadPlan,
  createSubscriptionRecord,
  createSubscriptionRemoval,
  createSubscriptionShape,
  defaultQueueLimit: DEFAULT_QUEUE_LIMIT,
  defaultSubscriptionLimit: DEFAULT_SUBSCRIPTION_LIMIT,
  errorStatus,
  okResponse,
  okStatus,
  positiveInteger,
  packVersionedState,
  queryResultLimit: QueryLimits.resultCount,
  stateRouteIdField,
  subscriptionLimit,
  tenantMismatch,
  tenantValue,
  topicTenant,
  uniqueContexts,
  validateReadQuery,
  validateTopic,
});
