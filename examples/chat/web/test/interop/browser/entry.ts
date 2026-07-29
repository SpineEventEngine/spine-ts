import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { BrowserSession, Client } from "@spine-event-engine/client-web";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { ActorContextSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { ResolveContextRequestSchema, AuthenticationService } from "@spine-event-engine/proto/auth";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  QuerySchema,
  SubscriptionSchema,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { PostMessageSchema } from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/commands_pb.js";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { UserIdSchema as ChatUserIdSchema } from "@spine-event-engine/example-chat-users-model/generated/spine/example/users/v1/users_pb.js";

const parameters = new URLSearchParams(location.search);
const baseUrl = parameters.get("baseUrl");
if (baseUrl === null) throw new Error("baseUrl is required");
const csrf = parameters.get("csrf");
const bearer = parameters.get("auth") === "invalid" ? "invalid" : "test";
const protocol = parameters.get("protocol") ?? "grpc-web";
if (protocol !== "connect" && protocol !== "grpc-web")
  throw new Error("protocol must be connect or grpc-web");
const actor = parameters.get("actor") ?? "ada";
const tenant = parameters.get("tenant");
const room = parameters.get("room") ?? "room-a";

const session = csrf === null ? BrowserSession.bearer({ token: bearer }) : BrowserSession.cookie();
const sessionFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (csrf !== null) headers.set("x-spine-csrf", csrf);
  return session.fetch(input, { ...init, headers });
};
const createBrowserTransport =
  protocol === "connect" ? createConnectTransport : createGrpcWebTransport;
const auth = createClient(
  AuthenticationService,
  createBrowserTransport({ baseUrl, fetch: sessionFetch }),
);
const wireSubscriptions = createClient(
  SubscriptionService,
  createBrowserTransport({ baseUrl, fetch: sessionFetch }),
);
const client = (
  protocol === "connect" ? Client.forConnect.bind(Client) : Client.forGrpcWeb.bind(Client)
)(baseUrl, {
  credentials: session.credentials,
  ...(tenant === null ? {} : { tenant }),
  onRequestMetadata: () => {
    const headers = session.requestMetadata();
    if (csrf !== null) headers.set("x-spine-csrf", csrf);
    return headers;
  },
});
const request = client.onBehalfOf(actor);
const query = create(QuerySchema, {
  target: create(TargetSchema, {
    type: TypeUrls.derive(ChatMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["room"] },
                operator: Filter_Operator.EQUAL,
                value: AnyMessages.pack(
                  ChatRoomIdSchema,
                  create(ChatRoomIdSchema, { value: room }),
                ),
              }),
            ],
          }),
        ],
      }),
    },
  }),
});
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: "browser-room-a" }),
  target: query.target,
  context: create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: actor }),
    ...(tenant === null
      ? {}
      : { tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenant } }) }),
  }),
});
let sequence = 0;

const resolveContext = async () => {
  await session.reauthenticate(async ({ signal }) => {
    const context = await auth.resolveContext(create(ResolveContextRequestSchema), { signal });
    return context.actor === undefined ? {} : { actor: context.actor.value };
  });
  return session.context;
};

const createPublicSubscription = async () =>
  Array.from(toBinary(SubscriptionSchema, await wireSubscriptions.subscribe(topic)));
const activatePublicSubscription = async (bytes: readonly number[]) => {
  const updates = wireSubscriptions.activate(fromBinary(SubscriptionSchema, new Uint8Array(bytes)));
  await updates[Symbol.asyncIterator]().next();
};
const cancelPublicSubscription = (bytes: readonly number[]) =>
  wireSubscriptions.cancel(fromBinary(SubscriptionSchema, new Uint8Array(bytes)));
const startActiveSubscription = async () => {
  const subscription = await request.createSubscription(topic, {
    kind: "entity",
    authoritativeQuery: () => query,
  });
  await subscription.activate();
  const updates = subscription.updates[Symbol.asyncIterator]();
  const next = updates.next();
  for (let probe = 0; probe < 10; probe += 1) {
    await post();
    const update = await Promise.race([
      next,
      new Promise<undefined>((resolve) => setTimeout(resolve, 200)),
    ]);
    if (update !== undefined && !update.done) return true;
  }
  throw new Error("active subscription did not receive an update");
};

const post = () =>
  request.post(
    PostMessageSchema,
    create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: `browser-interop-${String(++sequence)}` }),
      room: create(ChatRoomIdSchema, { value: room }),
      author: create(ChatUserIdSchema, { value: "ada" }),
      text: "browser",
      postedAt: create(TimestampSchema, { seconds: BigInt(sequence) }),
    }),
  );

const subscribe = async () => {
  const subscription = await request.createSubscription(topic, {
    kind: "entity",
    authoritativeQuery: () => query,
  });
  await subscription.activate();
  const updates = subscription.updates[Symbol.asyncIterator]();
  try {
    const next = updates.next();
    for (let probe = 0; probe < 10; probe += 1) {
      await post();
      const update = await Promise.race([
        next,
        new Promise<undefined>((resolve) => setTimeout(resolve, 200)),
      ]);
      if (update !== undefined) return update;
    }
    throw new Error("subscription update timeout");
  } finally {
    await updates.return?.();
    await subscription.cancel();
    await client.close();
    await session.close();
  }
};

Object.assign(window, {
  interopProtocol: protocol,
  interopClient: request,
  post,
  read: () => request.send(query),
  resolveContext,
  createPublicSubscription,
  activatePublicSubscription,
  cancelPublicSubscription,
  startActiveSubscription,
  subscribe,
});
