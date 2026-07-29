import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "../../../../../packages/server/node_modules/@connectrpc/connect/dist/esm/index.js";
import { createGrpcWebTransport } from "../../../../../packages/client-web/node_modules/@connectrpc/connect-web/dist/esm/index.js";
import {
  AuthenticationService,
  ResolveContextRequestSchema,
} from "../../../../../packages/proto/dist/src/auth/index.js";
import {
  create,
  toBinary,
} from "../../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/index.js";
import { packAny, deriveTypeUrl } from "../../../../../packages/core/dist/index.js";
import { TimestampSchema } from "../../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/wkt/gen/google/protobuf/timestamp_pb.js";
import {
  CommandSchema,
  CommandContextSchema,
  ActorContextSchema,
  UserIdSchema,
  CommandIdSchema,
} from "../../../../../packages/proto/dist/src/index.js";
import {
  CommandService,
  QueryService,
  SubscriptionService,
  QuerySchema,
  TopicSchema,
  TopicIdSchema,
  TargetSchema,
  TargetFiltersSchema,
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
} from "../../../../../packages/proto/dist/src/client/index.js";
import { PostMessageSchema } from "../../../model/dist/generated/spine/example/chat/v1/commands_pb.js";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "../../../model/dist/generated/spine/example/chat/v1/chat_pb.js";

import { startTopology } from "./harness.mjs";

test("routes gRPC-Web ResolveContext through Envoy and the native gateway", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const topology = await startTopology();
  try {
    const bearerTransport = () =>
      createGrpcWebTransport({
        baseUrl: topology.baseUrl,
        interceptors: [
          (next) => async (request) => {
            request.header.set("authorization", "Bearer test");
            return next(request);
          },
        ],
      });
    const anonymous = createClient(
      AuthenticationService,
      createGrpcWebTransport({ baseUrl: topology.baseUrl }),
    );
    await assert.rejects(anonymous.resolveContext(create(ResolveContextRequestSchema)));
    const client = createClient(AuthenticationService, bearerTransport());
    const response = await client.resolveContext(create(ResolveContextRequestSchema));
    assert.equal(response.actor?.value, "ada");
    const commands = createClient(CommandService, bearerTransport());
    const queries = createClient(QueryService, bearerTransport());
    const subscriptions = createClient(SubscriptionService, bearerTransport());
    const context = create(ActorContextSchema, { actor: create(UserIdSchema, { value: "ada" }) });
    const acknowledgement = await commands.post(
      create(CommandSchema, {
        id: create(CommandIdSchema, { uuid: "interop-command-1" }),
        context: create(CommandContextSchema, { actorContext: context }),
        message: packAny(
          PostMessageSchema,
          create(PostMessageSchema, {
            id: create(MessageIdSchema, { value: "interop-1" }),
            room: create(ChatRoomIdSchema, { value: "room-a" }),
            author: create(UserIdSchema, { value: "ada" }),
            text: "interop",
            postedAt: create(TimestampSchema, { seconds: 1n }),
          }),
        ),
      }),
    );
    assert.equal(acknowledgement.status?.status.case, "ok", JSON.stringify(acknowledgement));
    const query = create(QuerySchema, {
      target: create(TargetSchema, {
        type: deriveTypeUrl(ChatMessageViewSchema),
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
                    value: packAny(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: "room-a" })),
                  }),
                ],
              }),
            ],
          }),
        },
      }),
      context,
    });
    const read = await eventually(async () => {
      const response = await queries.read(query);
      return response.message.length === 0 ? undefined : response;
    });
    const view = read.message[0]?.state;
    assert.equal(view?.typeUrl, deriveTypeUrl(ChatMessageViewSchema));
    const subscription = await subscriptions.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: "interop-topic" }),
        target: query.target,
        context,
      }),
    );
    assert.equal(topology.bindingCount(), 1);
    const controller = new AbortController();
    const updates = subscriptions
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const next = updates.next();
    let update;
    for (let probe = 2; probe < 12 && update === undefined; probe += 1) {
      const ack = await commands.post(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: `interop-command-${probe}` }),
          context: create(CommandContextSchema, { actorContext: context }),
          message: packAny(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: `interop-${probe}` }),
              room: create(ChatRoomIdSchema, { value: "room-a" }),
              author: create(UserIdSchema, { value: "ada" }),
              text: "subscription",
              postedAt: create(TimestampSchema, { seconds: BigInt(probe) }),
            }),
          ),
        }),
      );
      assert.equal(ack.status?.status.case, "ok", JSON.stringify(ack));
      update = await Promise.race([
        next.then((value) => (value.done ? undefined : value)),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
    }
    await eventually(async () =>
      (await queries.read(query)).message.length > 1 ? true : undefined,
    );
    assert.ok(update, `subscription update timeout ${JSON.stringify(topology.counters())}`);
    assert.equal(update.done, false);
    assert.deepEqual(
      toBinary(TargetSchema, update.value.subscription?.topic?.target),
      toBinary(TargetSchema, subscription.topic?.target),
      "the public update must retain the accepted subscription target",
    );
    controller.abort();
    await updates.return?.();
    await subscriptions.cancel(subscription);
    await Promise.race([
      eventually(async () => (topology.bindingCount() === 0 ? true : undefined)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("binding cleanup exceeded 5s")), 5_000),
      ),
    ]);
    assert.ok(topology.counters().cancel + topology.counters().dispose > 0);
  } finally {
    await topology.close();
  }
});

async function eventually(operation) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await operation();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Chat projection was not materialized within 250 attempts");
}
