import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  DeliveryClient,
  RemoteInbox,
  RemoteWorkRegistry,
} from "@spine-event-engine/delivery-client";
import { CommandSchema } from "@spine-event-engine/proto";
import process from "node:process";
import {
  DeliveryBuilder,
  DeliverySupervisor,
  ShardIndex,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";

export function createMultiMachineApplication({ baseUrl, node }) {
  const client = DeliveryClient.connectTo(baseUrl, {
    observationReconnects: 2,
    observationReconnectBackoffMs: 50,
  });
  const inbox = new RemoteInbox(client);
  const registry = new RemoteWorkRegistry(client);
  const delivery = new DeliveryBuilder()
    .withInbox(inbox)
    .withWorkRegistry(registry)
    .withStrategy(UniformAcrossAllShards.singleShard())
    .withNode(node)
    .build();
  let supervisor;
  let directSession;
  let stallOnce = false;

  const send = (frame) => process.send?.(frame);
  const supervisorFor = () =>
    new DeliverySupervisor({
      source: client,
      delivery,
      recoveryMs: 100,
      staleMs: 1_000,
      watchInitialBackoffMs: 50,
      watchMaxBackoffMs: 200,
      onMessage: async (message) => {
        send({ type: "dispatched", signalId: message.signalId, node });
        if (message.signalId === "stall" && stallOnce) {
          stallOnce = false;
          await new Promise(() => undefined);
        }
      },
    });

  return {
    async pickUp() {
      directSession = await client.pickUp(ShardIndex.single(), { nodeId: node, value: node });
      return directSession !== undefined;
    },
    async release() {
      if (directSession === undefined) return false;
      await client.release(directSession);
      directSession = undefined;
      return true;
    },
    async start() {
      supervisor ??= supervisorFor();
      await supervisor.start();
    },
    async replace() {
      await supervisor?.close({ graceMs: 5_000 });
      supervisor = supervisorFor();
      await supervisor.start();
    },
    async write(signalId) {
      await inbox.receive({
        inboxId: {
          targetId: `type.spine.io/test.Id:${signalId}`,
          targetTypeUrl: "type.spine.io/test.Target",
        },
        signalId,
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
    },
    armStall() {
      stallOnce = true;
    },
    disarmStall() {
      stallOnce = false;
    },
    async close() {
      await supervisor?.close({ graceMs: 5_000 });
      client.close();
    },
  };
}

if (process.env.DELIVERY_SERVER_URL !== undefined && process.send !== undefined) {
  const application = createMultiMachineApplication({
    baseUrl: process.env.DELIVERY_SERVER_URL,
    node: process.env.DELIVERY_NODE,
  });
  process.on("message", async (frame) => {
    const request = controlFrame(frame);
    if (request === undefined) {
      process.send?.({ type: "error", id: "", message: "Fixture control frame is invalid." });
      return;
    }
    try {
      const result = await invoke(application, request);
      process.send?.({ type: "result", id: request.id, result });
      if (request.command === "close") process.disconnect();
    } catch {
      process.send?.({
        type: "error",
        id: request.id,
        message: "Fixture command failed.",
      });
    }
  });
  process.send({ type: "ready" });
}

export function controlFrame(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { id, command, signalId } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return undefined;
  if (
    ![
      "pickUp",
      "release",
      "start",
      "replace",
      "write",
      "armStall",
      "disarmStall",
      "close",
    ].includes(command)
  )
    return undefined;
  if (command === "write") {
    if (!exactKeys(value, ["command", "id", "signalId"])) return undefined;
    if (typeof signalId !== "string" || signalId.length === 0 || signalId.length > 128)
      return undefined;
  } else if (signalId !== undefined || !exactKeys(value, ["command", "id"])) return undefined;
  return { id, command, signalId };
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function invoke(application, request) {
  switch (request.command) {
    case "pickUp":
      return application.pickUp();
    case "release":
      return application.release();
    case "start":
      return application.start();
    case "replace":
      return application.replace();
    case "write":
      return application.write(request.signalId);
    case "armStall":
      return application.armStall();
    case "disarmStall":
      return application.disarmStall();
    case "close":
      return application.close();
  }
}
