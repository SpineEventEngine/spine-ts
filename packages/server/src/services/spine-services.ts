import { randomUUID } from "node:crypto";

import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { EmptySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { MessageSchema } from "@spine-ts/core";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import { CommandIdSchema, type Command, type TenantId, VersionSchema } from "@spine-ts/proto";
import { ErrorSchema } from "@spine-ts/proto/generated/spine/base/error_pb.js";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import type { Target } from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  EntityStateWithVersionSchema,
  QueryResponseSchema,
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
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

import type { BoundedContext } from "../context/bounded-context.js";
import type { StandReadResult, StandSubscription, StandUpdate } from "../stand/stand.js";

/** Small route registrar for the first public Spine gRPC service slice. */
export class SpineServices {
  readonly #contexts: readonly BoundedContext[];
  readonly #commandRoutes = new Map<string, CommandRoute>();
  readonly #stateRoutes = new Map<string, StateRoute>();
  readonly #subscriptions = new Map<string, SubscriptionRecord>();
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
          context,
          schema,
          typeUrl,
        });
      }
    }
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
    } catch {
      return create(AckSchema, {
        messageId,
        status: errorStatus("COMMAND_POST_ERROR", "Command post failed."),
      });
    }
  }

  async #read(query: Query): Promise<QueryResponse> {
    const target = query.target;
    const route = target === undefined ? undefined : this.#stateRoutes.get(target.type);

    if (target === undefined || route === undefined) {
      return create(QueryResponseSchema, {
        response: errorResponse(
          "UNSUPPORTED_QUERY_TARGET",
          "No bounded context owns query target.",
        ),
      });
    }

    const tenantId = tenantValue(query.context?.tenantId);
    const tenantError = tenantMismatch(route.context.isMultitenant, tenantId, "query");
    if (tenantError !== undefined) {
      return create(QueryResponseSchema, {
        response: errorResponse(tenantError.type, tenantError.message),
      });
    }

    try {
      if (target.criterion.case === "includeAll" && target.criterion.value) {
        const results = await route.context
          .stand()
          .readAllVersioned(route.schema, tenantOptions(tenantId));

        return create(QueryResponseSchema, {
          response: okResponse(),
          message: results.map((result) => packVersionedState(route.schema, result)),
        });
      }

      const ids = targetIds(target);
      if (ids.length === 0) {
        return create(QueryResponseSchema, {
          response: errorResponse("INVALID_QUERY", "QueryService.Read requires an ID filter."),
        });
      }

      const messages = [];

      for (const id of ids) {
        const result = await route.context
          .stand()
          .readVersioned(route.schema, id, tenantOptions(tenantId));
        if (result !== undefined) {
          messages.push(packVersionedState(route.schema, result));
        }
      }

      return create(QueryResponseSchema, {
        response: okResponse(),
        message: messages,
      });
    } catch {
      return create(QueryResponseSchema, {
        response: errorResponse("QUERY_READ_ERROR", "Query read failed."),
      });
    }
  }

  #subscribe(topic: Topic): Subscription {
    const route = this.#subscriptionRoute(topic);
    validateTopic(topic);
    const tenantError = tenantMismatch(
      route.context.isMultitenant,
      topicTenant(topic),
      "subscription",
    );

    if (tenantError !== undefined) {
      throw new ConnectError(tenantError.message, Code.InvalidArgument);
    }

    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${randomUUID()}` }),
      topic,
    });
    const id = subscription.id?.value;

    if (id === undefined) {
      throw new ConnectError("Subscription ID is required.", Code.InvalidArgument);
    }

    const record: SubscriptionRecord = {
      id,
      subscription,
      route,
      delivery: new SubscriptionDelivery(this.#queueLimit),
      inactiveTimer: undefined,
    };
    record.inactiveTimer = setTimeout(() => {
      this.#removeSubscription(id);
    }, this.#inactiveTtlMs);
    record.inactiveTimer.unref();
    this.#subscriptions.set(id, record);

    return subscription;
  }

  async *#activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate> {
    const id = subscription.id?.value;
    const record = id === undefined ? undefined : this.#subscriptions.get(id);

    if (id === undefined || record === undefined) {
      return;
    }

    this.#activateRecord(record);

    try {
      while (!record.delivery.closed) {
        const update = await record.delivery.next();
        if (update === undefined) {
          return;
        }
        yield update;
      }
    } finally {
      this.#removeSubscription(id);
    }
  }

  #cancel(subscription: Subscription): Response {
    const id = subscription.id?.value;

    if (id !== undefined) {
      this.#removeSubscription(id);
    }

    return okResponse();
  }

  #subscriptionRoute(topic: Topic): StateRoute {
    const target = topic.target;
    const route = target === undefined ? undefined : this.#stateRoutes.get(target.type);

    if (target === undefined || route === undefined) {
      throw new ConnectError("Unsupported subscription target.", Code.InvalidArgument);
    }

    return route;
  }

  #activateRecord(record: SubscriptionRecord): void {
    if (record.delivery.active) {
      return;
    }

    clearInactiveTimer(record);
    const tenantId = topicTenant(record.subscription.topic);
    const standSubscription = record.route.context.stand().subscribe(
      record.route.schema,
      (update) => {
        record.delivery.push(createEntityUpdate(record, update));
        if (record.delivery.closed) {
          this.#removeSubscription(record.id);
        }
      },
      tenantOptions(tenantId),
    );
    record.delivery.attach(standSubscription);
  }

  #removeSubscription(id: string): void {
    const record = this.#subscriptions.get(id);

    if (record !== undefined) {
      clearInactiveTimer(record);
      record.delivery.close();
      this.#subscriptions.delete(id);
    }
  }
}

/** Options for registering Spine service adapters over built bounded contexts. */
export interface SpineServicesOptions {
  /** Contexts exposed by these service adapters. */
  readonly contexts: readonly BoundedContext[];
  /** Milliseconds before never-activated subscriptions are discarded. Defaults to 30 seconds. */
  readonly inactiveTtlMs?: number;
  /** Maximum queued updates per active subscription before delivery is closed. Defaults to 100. */
  readonly queueLimit?: number;
}

interface CommandRoute {
  readonly context: BoundedContext;
  readonly typeUrl: string;
}

interface StateRoute {
  readonly context: BoundedContext;
  readonly schema: MessageSchema;
  readonly typeUrl: string;
}

interface SubscriptionRecord {
  readonly id: string;
  readonly subscription: Subscription;
  readonly route: StateRoute;
  readonly delivery: SubscriptionDelivery;
  inactiveTimer: ReturnType<typeof setTimeout> | undefined;
}

class SubscriptionDelivery {
  readonly #queue: SubscriptionUpdate[] = [];
  readonly #waiters: ((update: SubscriptionUpdate | undefined) => void)[] = [];
  readonly #queueLimit: number;
  #standSubscription: StandSubscription | undefined;
  #closed = false;

  constructor(queueLimit: number) {
    this.#queueLimit = queueLimit;
  }

  get active(): boolean {
    return this.#standSubscription !== undefined;
  }

  get closed(): boolean {
    return this.#closed;
  }

  attach(standSubscription: StandSubscription): void {
    if (this.#closed) {
      standSubscription.unsubscribe();
      return;
    }

    this.#standSubscription = standSubscription;
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
    this.#standSubscription?.unsubscribe();
    this.#standSubscription = undefined;

    for (const waiter of this.#waiters.splice(0)) {
      waiter(undefined);
    }
  }
}

function okStatus(): Status {
  return create(StatusSchema, {
    status: {
      case: "ok",
      value: create(EmptySchema),
    },
  });
}

function errorStatus(type: string, message: string): Status {
  return create(StatusSchema, {
    status: {
      case: "error",
      value: create(ErrorSchema, { type, message }),
    },
  });
}

function okResponse(): Response {
  return create(ResponseSchema, { status: okStatus() });
}

function errorResponse(type: string, message: string): Response {
  return create(ResponseSchema, { status: errorStatus(type, message) });
}

function targetIds(target: Target): unknown[] {
  if (target.criterion.case !== "filters") {
    return [];
  }

  return (target.criterion.value.idFilter?.id ?? []).map(decodeId);
}

const DEFAULT_INACTIVE_TTL_MS = 30_000;
const DEFAULT_QUEUE_LIMIT = 100;

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function clearInactiveTimer(record: SubscriptionRecord): void {
  if (record.inactiveTimer !== undefined) {
    clearTimeout(record.inactiveTimer);
    record.inactiveTimer = undefined;
  }
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

function decodeId(id: Any): unknown {
  const stringId = unpackAny(id, StringValueSchema);
  return stringId?.value ?? id;
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
}

function tenantOptions(tenantId: string | undefined): { readonly tenantId?: string } {
  return tenantId === undefined ? {} : { tenantId };
}

function createEntityUpdate(record: SubscriptionRecord, update: StandUpdate): SubscriptionUpdate {
  return create(SubscriptionUpdateSchema, {
    subscription: record.subscription,
    response: okResponse(),
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: typeof update.id === "string" ? packString(update.id) : undefined,
            kind: {
              case: "state",
              value: packAny(record.route.schema, update.state, { validate: false }),
            },
          }),
        ],
      }),
    },
  });
}

function packString(value: string): Any {
  return packAny(StringValueSchema, create(StringValueSchema, { value }));
}
