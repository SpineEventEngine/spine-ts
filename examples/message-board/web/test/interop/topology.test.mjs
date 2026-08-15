import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "../../../../../packages/server/node_modules/@connectrpc/connect/dist/esm/index.js";
import { createGrpcTransport as createNativeTransport } from "../../../../../packages/server/node_modules/@connectrpc/connect-node/dist/esm/index.js";
import { createGrpcWebTransport } from "../../../../../packages/client-web/node_modules/@connectrpc/connect-web/dist/esm/index.js";
import {
  AuthenticationService,
  ResolveContextRequestSchema,
} from "../../../../../packages/proto/dist/src/auth/index.js";
import {
  create,
  toBinary,
} from "../../../../../packages/proto/node_modules/@bufbuild/protobuf/dist/esm/index.js";
import { AnyMessages, TypeUrls } from "../../../../../packages/core/dist/index.js";
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
import { PostMessageSchema } from "../../../model/dist/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "../../../model/dist/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema as BoardUserIdSchema } from "../../../model/dist/generated/spine/examples/messageboard/user_pb.js";

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
        message: AnyMessages.pack(
          PostMessageSchema,
          create(PostMessageSchema, {
            id: create(MessageIdSchema, { value: "interop-1" }),
            board: create(BoardIdSchema, { value: "board-a" }),
            author: create(BoardUserIdSchema, { value: "ada" }),
            username: "Ada",
            text: "interop",
            postedAt: create(TimestampSchema, { seconds: 1n }),
          }),
        ),
      }),
    );
    assert.equal(acknowledgement.status?.status.case, "ok", JSON.stringify(acknowledgement));
    const query = create(QuerySchema, {
      target: create(TargetSchema, {
        type: TypeUrls.derive(BoardMessageViewSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            filter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.ALL,
                filter: [
                  create(FilterSchema, {
                    fieldPath: { fieldName: ["board"] },
                    operator: Filter_Operator.EQUAL,
                    value: AnyMessages.pack(
                      BoardIdSchema,
                      create(BoardIdSchema, { value: "board-a" }),
                    ),
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
    assert.equal(view?.typeUrl, TypeUrls.derive(BoardMessageViewSchema));
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
          message: AnyMessages.pack(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: `interop-${probe}` }),
              board: create(BoardIdSchema, { value: "board-a" }),
              author: create(BoardUserIdSchema, { value: "ada" }),
              username: "Ada",
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

test("terminates accepted and missing-origin preflight without Gateway admission", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const topology = await startTopology();
  try {
    const before = topology.counters();
    for (const [headers, allowed, status] of [
      [
        {
          origin: "https://127.0.0.1:4175",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-grpc-web,x-spine-csrf",
        },
        true,
        200,
      ],
      [{ "access-control-request-method": "POST" }, false, 204],
      [
        {
          origin: "https://rejected.example.test",
          "access-control-request-method": "POST",
        },
        false,
        200,
      ],
    ]) {
      const response = await globalThis.fetch(
        `${topology.baseUrl}/spine.auth.AuthenticationService/ResolveContext`,
        { method: "OPTIONS", headers },
      );
      assert.equal(response.status, status);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        allowed ? headers.origin : null,
      );
    }
    assert.deepEqual(topology.counters(), before);
  } finally {
    await topology.close();
  }
});

test("keeps a direct native passive subscription alive for three sequential writer commands", async () => {
  const topology = await startTopology();
  try {
    const transport = createNativeTransport({ baseUrl: topology.nativeBaseUrl });
    const commands = createClient(CommandService, transport);
    const subscriptions = createClient(SubscriptionService, transport);
    const context = create(ActorContextSchema, { actor: create(UserIdSchema, { value: "ada" }) });
    const query = create(QuerySchema, {
      target: create(TargetSchema, {
        type: TypeUrls.derive(BoardMessageViewSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            filter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.ALL,
                filter: [
                  create(FilterSchema, {
                    fieldPath: { fieldName: ["board"] },
                    operator: Filter_Operator.EQUAL,
                    value: AnyMessages.pack(
                      BoardIdSchema,
                      create(BoardIdSchema, { value: "board-a" }),
                    ),
                  }),
                ],
              }),
            ],
          }),
        },
      }),
      context,
    });
    const subscription = await subscriptions.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: "native-passive-viewer" }),
        target: query.target,
        context,
      }),
    );
    const updates = subscriptions.activate(subscription)[Symbol.asyncIterator]();
    for (let updateNumber = 1; updateNumber <= 3; updateNumber += 1) {
      const next = updates.next();
      const acknowledgement = await commands.post(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: `native-passive-command-${updateNumber}` }),
          context: create(CommandContextSchema, { actorContext: context }),
          message: AnyMessages.pack(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: `native-passive-${updateNumber}` }),
              board: create(BoardIdSchema, { value: "board-a" }),
              author: create(BoardUserIdSchema, { value: "bert" }),
              username: "Bert",
              text: "native passive",
              postedAt: create(TimestampSchema, { seconds: BigInt(updateNumber) }),
            }),
          ),
        }),
      );
      assert.equal(acknowledgement.status?.status.case, "ok", JSON.stringify(acknowledgement));
      const update = await Promise.race([
        next,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("native update timeout")), 5_000),
        ),
      ]);
      assert.equal(update.done, false);
    }
    await updates.return?.();
    await subscriptions.cancel(subscription);
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
  throw new Error("MessageBoard projection was not materialized within 250 attempts");
}
