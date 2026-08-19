// Exercises Message Board RPCs from inside a Compose network during live checks.
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  UserIdSchema as ActorUserIdSchema,
} from "@spine-event-engine/proto";
import {
  CommandService,
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  QueryService,
  QuerySchema,
  SubscriptionSchema,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema as BoardUserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { Buffer } from "node:buffer";
import process from "node:process";

const target = required("TARGET");
const origin = required("ORIGIN");
const mode = required("MODE");
const runId = required("RUN_ID");
const transport = createGrpcWebTransport({
  baseUrl: target,
  interceptors: [
    (next) => async (request) => {
      request.header.set("origin", origin);
      return next(request);
    },
  ],
});
const commands = createClient(CommandService, transport);
const queries = createClient(QueryService, transport);
const subscriptions = createClient(SubscriptionService, transport);
const context = create(ActorContextSchema, {
  actor: create(ActorUserIdSchema, { value: "ada" }),
});
const board = create(BoardIdSchema, { value: "general" });
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
                value: AnyMessages.pack(BoardIdSchema, board),
              }),
            ],
          }),
        ],
      }),
    },
  }),
  context,
});
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: `compose-${runId}` }),
  target: query.target,
  context,
});

try {
  if (mode === "full") await fullFlow();
  else if (mode === "distributed-full") await distributedFlow();
  else if (mode === "subscribe") await createSubscription();
  else if (mode === "cancel") await cancelSubscription();
  else if (mode === "assert-cancelled") await assertCancelled();
  else if (mode === "query") await authoritativeQuery();
  else throw new Error(`Unknown Compose RPC client mode: ${mode}.`);
} finally {
  await signer.close();
}

async function fullFlow() {
  await post("initial", "Compose public query");
  await authoritativeQuery();
  const subscription = await subscriptions.subscribe(topic);
  const controller = new globalThis.AbortController();
  const updates = subscriptions
    .activate(subscription, { signal: controller.signal })
    [Symbol.asyncIterator]();
  try {
    const next = updates.next();
    await post("update", "Compose public subscription");
    const update = await deadline(next, 5_000, "subscription update");
    if (update.done) throw new Error("Compose subscription ended before an update.");
  } finally {
    controller.abort();
    await updates.return?.();
    await subscriptions.cancel(subscription);
  }
  process.stdout.write("full-ok\n");
}

async function distributedFlow() {
  await post("initial", "Distributed authoritative query");
  await authoritativeQueryFor(`${runId}-initial`);
  const subscription = await subscriptions.subscribe(topic);
  const controller = new globalThis.AbortController();
  const updates = subscriptions
    .activate(subscription, { signal: controller.signal })
    [Symbol.asyncIterator]();
  try {
    let next = updates.next();
    const posted = new Set();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = `${runId}-update-${attempt}`;
      await post(`update-${attempt}`, "Distributed subscription notice");
      posted.add(id);
      const update = await Promise.race([next, pause(1_000)]);
      if (update === undefined) continue;
      if (update.done) throw new Error("Distributed subscription ended before an update.");
      if (noticeFor(update, posted)) return process.stdout.write("full-ok\n");
      next = updates.next();
    }
    throw new Error("Timed out waiting for a matching distributed subscription update.");
  } finally {
    controller.abort();
    await updates.return?.();
    await subscriptions.cancel(subscription);
  }
}

function noticeFor(result, ids) {
  if (result.done || result.value.response?.status?.status.case !== "ok") return false;
  return (
    result.value.update.case === "entityUpdates" &&
    result.value.update.value.update.some(
      (update) =>
        update.kind.case === "state" &&
        ids.has(AnyMessages.unpack(update.kind.value, BoardMessageViewSchema)?.id?.value),
    )
  );
}

async function createSubscription() {
  const subscription = await subscriptions.subscribe(topic);
  process.stdout.write(
    `${Buffer.from(toBinary(SubscriptionSchema, subscription)).toString("base64")}\n`,
  );
}

async function cancelSubscription() {
  const subscription = fromBinary(
    SubscriptionSchema,
    Buffer.from(required("SUBSCRIPTION"), "base64"),
  );
  await subscriptions.cancel(subscription);
  process.stdout.write("cancel-ok\n");
}

async function assertCancelled() {
  const subscription = fromBinary(
    SubscriptionSchema,
    Buffer.from(required("SUBSCRIPTION"), "base64"),
  );
  const controller = new globalThis.AbortController();
  const updates = subscriptions
    .activate(subscription, { signal: controller.signal })
    [Symbol.asyncIterator]();
  try {
    const result = await deadline(updates.next(), 5_000, "cancelled subscription closure");
    if (!result.done) throw new Error("Cancelled Compose subscription delivered an update.");
  } catch (error) {
    if (!isCancelledSubscriptionClosure(error)) throw error;
  } finally {
    controller.abort();
    await updates.return?.();
  }
  process.stdout.write("cancelled-ok\n");
}

function isCancelledSubscriptionClosure(error) {
  return (
    error instanceof ConnectError &&
    (error.code === Code.NotFound ||
      (error.code === Code.PermissionDenied && error.rawMessage === "gateway rejected denied"))
  );
}

async function authoritativeQuery() {
  await authoritativeQueryFor(undefined);
}

async function authoritativeQueryFor(id) {
  await eventually(async () => {
    const response = await queries.read(query);
    if (id === undefined) return response.message.length > 0 ? true : undefined;
    const matches = response.message.filter(
      (entry) => AnyMessages.unpack(entry.state, BoardMessageViewSchema)?.id?.value === id,
    );
    return matches.length === 1 ? true : undefined;
  });
  process.stdout.write("query-ok\n");
}

async function post(suffix, text) {
  const acknowledgement = await commands.post(
    create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: `${runId}-${suffix}` }),
      context: create(CommandContextSchema, { actorContext: context }),
      message: AnyMessages.pack(
        PostMessageSchema,
        create(PostMessageSchema, {
          id: create(MessageIdSchema, { value: `${runId}-${suffix}` }),
          board,
          author: create(BoardUserIdSchema, { value: "ada" }),
          username: "Ada",
          text,
          postedAt: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) }),
        }),
      ),
    }),
  );
  if (acknowledgement.status?.status.case !== "ok")
    throw new Error(`Compose command failed: ${JSON.stringify(acknowledgement)}.`);
}

async function eventually(operation) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await operation();
    if (result !== undefined) return result;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error("Compose authoritative query did not observe the posted message.");
}

async function deadline(operation, milliseconds, name) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`Timed out waiting for ${name}.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function pause(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), milliseconds));
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing Compose client environment: ${name}.`);
  return value;
}
