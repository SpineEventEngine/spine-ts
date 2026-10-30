import { Time } from "@spine-event-engine/core/time";

import { create } from "@bufbuild/protobuf";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { createManagedProjectContext } from "./managed-project-context.mjs";
import { EnvironmentType, ServerEnvironment, ShardIndex } from "@spine-event-engine/server";
import { commitFenced } from "../../server/test-fixtures/internal.mjs";
import process from "node:process";

const endpoint = process.env.DELIVERY_SERVER_URL;
const node = process.env.DELIVERY_NODE;
const observationBufferSize = Number(process.env.DELIVERY_OBSERVATION_BUFFER ?? "100");
if (endpoint === undefined || node === undefined || process.send === undefined) process.exit(1);

const delivery = RemoteDelivery.connectTo({
  endpoint,
  clientOptions: { observationBufferSize, observationReconnects: 0 },
});
const sourceEvidence = { snapshots: 0, watches: 0, failures: 0 };
let holdSource = false;
let releaseSource = Promise.withResolvers();
const source = {
  async shardSnapshot(options) {
    sourceEvidence.snapshots += 1;
    return delivery.source.shardSnapshot(options);
  },
  async *observeShardUpdates(options) {
    sourceEvidence.watches += 1;
    try {
      for await (const update of delivery.source.observeShardUpdates(options)) {
        if (holdSource) await releaseSource.promise;
        yield update;
      }
    } catch (error) {
      sourceEvidence.failures += 1;
      throw error;
    }
  },
  releaseExpired: (inactivityMs, options) => delivery.source.releaseExpired(inactivityMs, options),
};
ServerEnvironment.when(EnvironmentType.Local).use({
  delivery: {
    open: () => delivery.open(),
    close: () => delivery.close(),
    get inbox() { return delivery.inbox; },
    get workRegistry() { return delivery.workRegistry; },
    source,
  },
});
const environment = ServerEnvironment.instance();
let holdFirst = false;
let releaseFirst = Promise.withResolvers();
await environment.completeSetup();
const context = await createManagedProjectContext({
  onCreateProject: async (command) => {
    const signalId = command.id;
    if (signalId === "first" && holdFirst) {
      process.send({ type: "dispatched", node, signalId: "first-started" });
      await releaseFirst.promise;
      process.send({ type: "dispatched", node, signalId: "resumed-first" });
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

process.on("message", async (frame) => {
  if (isControl(frame)) {
    if (frame.command === "block-first") holdFirst = true;
    else if (frame.command === "release-first") {
      holdFirst = false;
      releaseFirst.resolve();
    } else if (frame.command === "hold-source") {
      holdSource = true;
    } else if (frame.command === "release-source") {
      holdSource = false;
      releaseSource.resolve();
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
      shard: ShardIndex.single(),
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
    await context.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await environment.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Fixture close failed.");
}

process.once("SIGTERM", () => {
  holdFirst = false;
  releaseFirst.resolve();
  holdSource = false;
  releaseSource.resolve();
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
    typeof frame.signalId === "string"
  );
}

function isControl(frame) {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame.command === "block-first" ||
      frame.command === "release-first" ||
      frame.command === "hold-source" ||
      frame.command === "release-source" ||
      frame.command === "source-evidence") &&
    typeof frame.id === "string"
  );
}
