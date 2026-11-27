import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { createManagedProjectContext } from "./managed-project-context.mjs";
import { projectInboxInput } from "./project-inbox-input.ts";
import {
  Application,
  EnvironmentType,
  ServerEnvironment,
  ShardIndex,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { deliveryPortAccess } from "@spine-event-engine/server/spi/delivery";
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
        [deliveryPortAccess]: () => delivery[deliveryPortAccess](),
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
    await delivery[deliveryPortAccess]().inbox.receive(
      projectInboxInput(frame.signalId, new ShardIndex(frame.shardIndex ?? 0, shardCount)),
    );
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
