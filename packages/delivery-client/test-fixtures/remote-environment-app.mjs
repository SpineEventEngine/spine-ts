import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { CommandSchema } from "@spine-event-engine/proto";
import { EnvironmentType, ServerEnvironment, ShardIndex } from "@spine-event-engine/server";
import { commitFenced, serverEnvironmentAccess } from "@spine-event-engine/server/testing";
import process from "node:process";

const endpoint = process.env.DELIVERY_SERVER_URL;
const node = process.env.DELIVERY_NODE;
const observationBufferSize = Number(process.env.DELIVERY_OBSERVATION_BUFFER ?? "100");
if (endpoint === undefined || node === undefined || process.send === undefined) process.exit(1);

const delivery = RemoteDelivery.connectTo({
  endpoint,
  clientOptions: { observationBufferSize, observationReconnects: 0 },
});
await delivery.open();
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
    inbox: delivery.inbox,
    workRegistry: delivery.workRegistry,
    source,
  },
});
const environment = ServerEnvironment.instance();
const ready = {
  label: "HANDLE_COMMAND",
  targetTypeUrl: "type.spine.io/test.Target",
  shard: ShardIndex.single(),
};
const attachOptions = {
  ownership: "caller",
  descriptors: [
    {
      storageFactory: environment.storageFactory,
      startupScopes: () => Promise.resolve([{}]),
      storageContext: () => ({ name: `remote-environment-${node}`, multitenant: false }),
      endpoints: () => [ready],
      replay: async (message) => {
        if (message.signalId === "first" && holdFirst) {
          process.send({ type: "dispatched", node, signalId: "first-started" });
          await releaseFirst.promise;
          process.send({ type: "dispatched", node, signalId: "resumed-first" });
        }
        try {
          await commitFenced({}, () => {
            process.send({ type: "dispatched", node, signalId: `committed-${message.signalId}` });
            return { status: "committed" };
          });
          process.send({ type: "dispatched", node, signalId: message.signalId });
        } catch {
          process.send({ type: "dispatched", node, signalId: "fenced" });
          throw new Error("Delivery commit fence rejected.");
        }
      },
      onReady: () => () => undefined,
      transition: (_scopes, onReady) => Promise.resolve(onReady(ready)).then(() => undefined),
    },
  ],
};
const attachment = await serverEnvironmentAccess.attach(environment, attachOptions);

let holdFirst = false;
let releaseFirst = Promise.withResolvers();
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
    await delivery.inbox.receive({
      inboxId: {
        targetId: create(AnySchema, {
          typeUrl: "type.googleapis.com/google.protobuf.StringValue",
          value: toBinary(StringValueSchema, create(StringValueSchema, { value: frame.signalId })),
        }),
        targetTypeUrl: "type.spine.io/test.Target",
      },
      signalId: frame.signalId,
      signal: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.Command",
        value: toBinary(CommandSchema, create(CommandSchema)),
      }),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date(),
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
    await serverEnvironmentAccess.detach(environment, attachment);
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
