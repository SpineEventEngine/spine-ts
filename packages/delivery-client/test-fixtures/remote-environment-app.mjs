import { Time } from "@spine-event-engine/core/time";

import { create } from "@bufbuild/protobuf";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { createManagedProjectContext } from "./managed-project-context.mjs";
import {
  Application,
  EnvironmentType,
  ServerEnvironment,
  ShardIndex,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { commitFenced } from "../../server/test-fixtures/internal.mjs";
import process from "node:process";

const endpoint = process.env.DELIVERY_SERVER_URL;
const node = process.env.DELIVERY_NODE;
if (endpoint === undefined || node === undefined || process.send === undefined) process.exit(1);
const shardCount = Number(process.env.DELIVERY_SHARDS ?? "1");
const maxConcurrentDeliveries =
  process.env.DELIVERY_MAX_CONCURRENT === undefined
    ? undefined
    : Number(process.env.DELIVERY_MAX_CONCURRENT);

const delivery = RemoteDelivery.connectTo({
  endpoint,
  clientOptions: { observationReconnects: 0 },
  notifications: {
    kind: "delivery-server",
    ...(maxConcurrentDeliveries === undefined ? {} : { maxConcurrentDeliveries }),
  },
});
const sourceEvidence = { watches: 0, notices: 0 };
const source = {
  async *observeAvailableShards(options) {
    sourceEvidence.watches += 1;
    for await (const shard of delivery.source.observeAvailableShards(options)) {
      sourceEvidence.notices += 1;
      yield shard;
    }
  },
};
const environment = ServerEnvironment.newBuilder()
  .under(EnvironmentType.Local, (setting) =>
    setting.use({
      delivery: {
        open: () => delivery.open(),
        close: () => delivery.close(),
        get inbox() {
          return delivery.inbox;
        },
        get workRegistry() {
          return delivery.workRegistry;
        },
        source,
        endpoint,
        notifications: delivery.notifications,
      },
      deliveryStrategy: UniformAcrossAllShards.forNumber(shardCount),
    }),
  )
  .build();
let holdFirst = false;
let releaseFirst = Promise.withResolvers();
const contextBuilder = createManagedProjectContext({
  onCreateProject: async (command) => {
    const signalId = command.id;
    if ((signalId === "first" || signalId.startsWith("first-")) && holdFirst) {
      process.send({ type: "dispatched", node, signalId: `${signalId}-started` });
      await releaseFirst.promise;
      process.send({
        type: "dispatched",
        node,
        signalId: signalId === "first" ? "resumed-first" : `${signalId}-resumed`,
      });
    }
    try {
      await commitFenced({}, () => {
        process.send({ type: "dispatched", node, signalId: `committed-${signalId}` });
        return { status: "committed" };
      });
      process.send({ type: "dispatched", node, signalId });
    } catch {
      process.send({ type: "dispatched", node, signalId: "fenced" });
      throw new Error("Delivery commit fence rejected.");
    }
  },
});
const application = await Application.newBuilder()
  .setServerEnvironment(environment)
  .add(contextBuilder)
  .build();

process.on("message", async (frame) => {
  if (isControl(frame)) {
    if (frame.command === "block-first") holdFirst = true;
    else if (frame.command === "release-first") {
      holdFirst = false;
      releaseFirst.resolve();
    } else {
      process.send({ type: "result", id: frame.id, ...sourceEvidence });
      return;
    }
    process.send({ type: "result", id: frame.id });
    return;
  }
  if (!isWrite(frame)) return;
  try {
    const signal = SignalEnvelopes.command({
      schema: CreateProjectSchema,
      message: create(CreateProjectSchema, { id: frame.signalId, name: frame.signalId }),
      context: create(CommandContextSchema),
    });
    await environment.delivery.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", frame.signalId),
        targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
      },
      signalId: signal.id.uuid,
      signal: AnyPacker.pack(CommandSchema, signal),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: new ShardIndex(frame.shardIndex ?? 0, shardCount),
      whenReceived: Time.currentTime(),
      version: 1n,
    });
    process.send({ type: "result", id: frame.id });
  } catch {
    process.send({ type: "error", id: frame.id });
  }
});

async function close() {
  const failures = [];
  try {
    await application.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Fixture close failed.");
}

process.once("SIGTERM", () => {
  holdFirst = false;
  releaseFirst.resolve();
  void close().then(
    () => process.exit(0),
    (error) => {
      process.send({
        type: "error",
        error: error instanceof Error ? error.message : "Fixture close failed.",
      });
      process.exit(1);
    },
  );
});
process.send({ type: "ready" });

function isWrite(frame) {
  return (
    typeof frame === "object" &&
    frame !== null &&
    frame.command === "write" &&
    typeof frame.id === "string" &&
    typeof frame.signalId === "string" &&
    (frame.shardIndex === undefined ||
      (Number.isSafeInteger(frame.shardIndex) &&
        frame.shardIndex >= 0 &&
        frame.shardIndex < shardCount))
  );
}

function isControl(frame) {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame.command === "block-first" ||
      frame.command === "release-first" ||
      frame.command === "source-evidence") &&
    typeof frame.id === "string"
  );
}
