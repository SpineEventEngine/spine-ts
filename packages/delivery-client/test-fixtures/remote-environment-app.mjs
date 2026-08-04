import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { CommandSchema } from "@spine-event-engine/proto";
import { EnvironmentType, ServerEnvironment, ShardIndex } from "@spine-event-engine/server";
import { serverEnvironmentAccess } from "../../server/dist/server/server-environment.js";
import { commitFenced } from "../../server/dist/repository/commit-fence.js";
import process from "node:process";

const endpoint = process.env.DELIVERY_SERVER_URL;
const node = process.env.DELIVERY_NODE;
const observationBufferSize = Number(process.env.DELIVERY_OBSERVATION_BUFFER ?? "100");
if (endpoint === undefined || node === undefined || process.send === undefined) process.exit(1);

const quarantine = new Map();
const delivery = RemoteDelivery.connectTo({
  endpoint,
  removalQuarantine: {
    get: (id) => Promise.resolve(quarantine.get(id)),
    put: (record) => {
      quarantine.set(record.id, record);
      return Promise.resolve();
    },
    delete: (id) => {
      quarantine.delete(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  },
  clientOptions: { observationBufferSize, observationReconnects: 0 },
});
ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
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
    else {
      holdFirst = false;
      releaseFirst.resolve();
    }
    process.send({ type: "result", id: frame.id });
    return;
  }
  if (!isWrite(frame)) return;
  try {
    await delivery.inbox.receive({
      inboxId: {
        targetId: `type.spine.io/test.Id:${frame.signalId}`,
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
    await environment.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await serverEnvironmentAccess.detach(environment, attachment);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Fixture close failed.");
}

process.once("SIGTERM", () => {
  holdFirst = false;
  releaseFirst.resolve();
  void close().finally(() => process.exit(0));
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
    (frame.command === "block-first" || frame.command === "release-first") &&
    typeof frame.id === "string"
  );
}
