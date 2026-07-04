import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { EmptySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { MessageSchema } from "@spine-ts/core";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import { CommandIdSchema, type Command, VersionSchema } from "@spine-ts/proto";
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
import {
  ResponseSchema,
  StatusSchema,
  type Response,
  type Status,
} from "@spine-ts/proto/generated/spine/core/response_pb.js";
import { AckSchema, type Ack } from "@spine-ts/proto/generated/spine/core/ack_pb.js";

import type { BoundedContext } from "../context/bounded-context.js";
import type { StandSubscription, StandUpdate } from "../stand/stand.js";

/** Options for registering Spine service adapters over built bounded contexts. */
export interface SpineServicesOptions {
  /** Contexts exposed by these service adapters. */
  readonly contexts: readonly BoundedContext[];
}

interface StateRoute {
  readonly context: BoundedContext;
  readonly schema: MessageSchema;
  readonly typeUrl: string;
}

interface SubscriptionRecord {
  readonly subscription: Subscription;
  readonly route: StateRoute;
  readonly queue: SubscriptionUpdate[];
  readonly waiters: ((update: SubscriptionUpdate | undefined) => void)[];
  standSubscription: StandSubscription | undefined;
  closed: boolean;
}

/** Small route registrar for the first public Spine gRPC service slice. */
export class SpineServices {
  readonly #contexts: readonly BoundedContext[];
  readonly #stateRoutes = new Map<string, StateRoute>();
  readonly #subscriptions = new Map<string, SubscriptionRecord>();

  /** Create service adapters over the passed built bounded contexts. */
  constructor(options: SpineServicesOptions) {
    this.#contexts = Object.freeze([...options.contexts]);

    for (const context of this.#contexts) {
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
    const unsupported: Error[] = [];

    for (const context of this.#contexts) {
      try {
        await context.commandBus().post(command);
        return create(AckSchema, {
          messageId: command.id && packAny(CommandIdSchema, command.id, { validate: false }),
          status: okStatus(),
        });
      } catch (error) {
        if (isUnsupportedCommand(error)) {
          unsupported.push(error);
        } else {
          return create(AckSchema, {
            messageId: command.id && packAny(CommandIdSchema, command.id, { validate: false }),
            status: errorStatus("COMMAND_POST_ERROR", errorMessage(error)),
          });
        }
      }
    }

    return create(AckSchema, {
      messageId: command.id && packAny(CommandIdSchema, command.id, { validate: false }),
      status: errorStatus(
        "UNSUPPORTED_COMMAND",
        unsupported[0]?.message ?? "No bounded context accepted the command.",
      ),
    });
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

    const ids = targetIds(target);
    if (ids.length === 0) {
      return create(QueryResponseSchema, {
        response: errorResponse("INVALID_QUERY", "QueryService.Read requires an ID filter."),
      });
    }

    const tenantId = tenantValue(query.context?.tenantId);
    const messages = [];

    for (const id of ids) {
      const state = await route.context.stand().read(route.schema, id, tenantOptions(tenantId));
      if (state !== undefined) {
        messages.push(
          create(EntityStateWithVersionSchema, {
            state: packAny(route.schema, state, { validate: false }),
            version: create(VersionSchema),
          }),
        );
      }
    }

    return create(QueryResponseSchema, {
      response: okResponse(),
      message: messages,
    });
  }

  #subscribe(topic: Topic): Subscription {
    const target = topic.target;
    const route = target === undefined ? undefined : this.#stateRoutes.get(target.type);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${crypto.randomUUID()}` }),
      topic,
    });

    if (route !== undefined && subscription.id !== undefined) {
      const record: SubscriptionRecord = {
        subscription,
        route,
        queue: [],
        waiters: [],
        standSubscription: undefined,
        closed: false,
      };
      this.#subscriptions.set(subscription.id.value, record);
      this.#ensureActive(record);
    }

    return subscription;
  }

  async *#activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate> {
    const id = subscription.id?.value;
    const record = id === undefined ? undefined : this.#subscriptions.get(id);

    if (record === undefined) {
      return;
    }

    this.#ensureActive(record);

    try {
      while (!record.closed) {
        const update = await nextSubscriptionUpdate(record);
        if (update === undefined) {
          return;
        }
        yield update;
      }
    } finally {
      closeSubscription(record);
    }
  }

  #cancel(subscription: Subscription): Response {
    const id = subscription.id?.value;
    const record = id === undefined ? undefined : this.#subscriptions.get(id);

    if (record !== undefined) {
      closeSubscription(record);
      this.#subscriptions.delete(record.subscription.id?.value ?? "");
    }

    return okResponse();
  }

  #ensureActive(record: SubscriptionRecord): void {
    if (record.standSubscription !== undefined || record.closed) {
      return;
    }

    const tenantId = tenantValue(record.subscription.topic?.context?.tenantId);
    record.standSubscription = record.route.context.stand().subscribe(
      record.route.schema,
      (update) => {
        pushSubscriptionUpdate(record, createEntityUpdate(record, update));
      },
      tenantOptions(tenantId),
    );
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

function isUnsupportedCommand(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("No command dispatcher registered");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function targetIds(target: Target): unknown[] {
  if (target.criterion.case !== "filters") {
    return [];
  }

  return (target.criterion.value.idFilter?.id ?? []).map(decodeId);
}

function decodeId(id: Any): unknown {
  const stringId = unpackAny(id, StringValueSchema);
  return stringId?.value ?? id;
}

function tenantValue(
  tenantId: { kind: { case: string | undefined; value?: unknown } } | undefined,
): string | undefined {
  return tenantId?.kind.case === "value" && typeof tenantId.kind.value === "string"
    ? tenantId.kind.value
    : undefined;
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

function pushSubscriptionUpdate(record: SubscriptionRecord, update: SubscriptionUpdate): void {
  const waiter = record.waiters.shift();
  if (waiter === undefined) {
    record.queue.push(update);
  } else {
    waiter(update);
  }
}

function nextSubscriptionUpdate(
  record: SubscriptionRecord,
): Promise<SubscriptionUpdate | undefined> {
  const update = record.queue.shift();
  if (update !== undefined || record.closed) {
    return Promise.resolve(update);
  }

  return new Promise((resolve) => record.waiters.push(resolve));
}

function closeSubscription(record: SubscriptionRecord): void {
  if (record.closed) {
    return;
  }

  record.closed = true;
  record.standSubscription?.unsubscribe();
  record.standSubscription = undefined;

  for (const waiter of record.waiters.splice(0)) {
    waiter(undefined);
  }
}
