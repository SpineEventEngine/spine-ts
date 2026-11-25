import { Time } from "@spine-event-engine/core/time";

import { create } from "@bufbuild/protobuf";
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  DeliveryClient,
  RemoteInbox,
  RemoteWorkRegistry,
} from "@spine-event-engine/delivery-client";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import process from "node:process";
import { ShardIndex, UniformAcrossAllShards } from "@spine-event-engine/server";
import { Delivery as CoreDelivery } from "../../server/dist/delivery/delivery.js";
import { deliveryControls } from "../../server/dist/delivery/delivery-builder.js";
import { ApplicationWorkObserver } from "../../server/dist/delivery/application-work-observer.js";

export function createMultiMachineApplication({ baseUrl, node }) {
  const client = DeliveryClient.connectTo(baseUrl, {
    observationReconnects: 2,
    observationReconnectBackoffMs: 50,
  });
  const inbox = new RemoteInbox(client);
  const registry = new RemoteWorkRegistry(client);
  const storageFactory = new InMemoryStorageFactory();
  const core = new CoreDelivery({
    context: { name: "MultiMachineDelivery", multitenant: false },
    inbox,
    workRegistry: registry,
    storageFactory,
    strategy: UniformAcrossAllShards.singleShard(),
    node,
  });
  const delivery = deliveryControls.managed(core);
  let observer;
  let directSession;
  let stallOnce = false;

  const send = (frame) => process.send?.(frame);
  core.setDispatcher(async (message) => {
    send({ type: "dispatched", signalId: message.signalId, node });
    if (message.signalId === "stall" && stallOnce) {
      stallOnce = false;
      await new Promise(() => undefined);
    }
  });
  const observerFor = () =>
    new ApplicationWorkObserver(
      { observeAvailableShards: (options) => client.observeAvailableShards(options) },
      delivery,
      baseUrl,
      undefined,
      undefined,
    );

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
      observer ??= observerFor();
      await observer.start();
    },
    async replace() {
      await observer?.close();
      observer = observerFor();
      await observer.start();
    },
    async write(signalId) {
      await inbox.receive({
        inboxId: {
          targetId: Identifiers.pack("string", signalId),
          targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
        },
        signalId,
        signal: AnyPacker.pack(
          CommandSchema,
          SignalEnvelopes.command({
            schema: CreateProjectSchema,
            message: create(CreateProjectSchema, { id: signalId, name: signalId }),
            context: create(CommandContextSchema),
          }),
        ),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
        whenReceived: Time.currentTime(),
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
      await observer?.close();
      await core.close();
      client.close();
      await storageFactory.close();
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
