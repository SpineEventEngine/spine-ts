import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema } from "@spine-event-engine/proto";
import { DeliveryServer } from "../../delivery-server/src/index.js";
import {
  DeliveryBuilder,
  DeliverySupervisor,
  ShardIndex,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { afterEach, expect, it } from "vitest";

import { DeliveryClient, RemoteInbox, RemoteWorkRegistry } from "../src/index.js";

const servers: DeliveryServer[] = [];
const clients: DeliveryClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

it("fans out one real Admin shard update to two supervisors and drains rows arriving mid-run", async () => {
  const server = trackedServer();
  await server.start();
  const alpha = node(server.baseUrl, "alpha");
  const beta = node(server.baseUrl, "beta");
  const firstStarted = Promise.withResolvers<undefined>();
  const releaseFirst = Promise.withResolvers<undefined>();
  const deliveries: string[] = [];
  const first = supervisor(alpha, (signalId) => {
    deliveries.push(`alpha:${signalId}`);
    if (signalId === "first") {
      firstStarted.resolve(undefined);
      return releaseFirst.promise;
    }
    return Promise.resolve();
  });
  const second = supervisor(beta, (signalId) => {
    deliveries.push(`beta:${signalId}`);
    return Promise.resolve();
  });

  await Promise.all([first.start(), second.start()]);
  await alpha.inbox.receive(message("first"));
  await firstStarted.promise;
  await alpha.inbox.receive(message("during-drain"));
  releaseFirst.resolve(undefined);
  await eventually(() => {
    expect(deliveries).toHaveLength(2);
  });

  expect(deliveries.filter((value) => value.endsWith(":first"))).toHaveLength(1);
  expect(deliveries.filter((value) => value.endsWith(":during-drain"))).toHaveLength(1);
  await Promise.all([first.close({ graceMs: 1_000 }), second.close({ graceMs: 1_000 })]);
});

function trackedServer(): DeliveryServer {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  return server;
}

function node(baseUrl: string, name: string) {
  const client = DeliveryClient.connectTo(baseUrl);
  clients.push(client);
  const records = new Map();
  const inbox = new RemoteInbox(client, {
    get: (id) => Promise.resolve(records.get(id)),
    put: (record) => {
      records.set(record.id, record);
      return Promise.resolve();
    },
    delete: (id) => {
      records.delete(id);
      return Promise.resolve();
    },
  });
  const delivery = new DeliveryBuilder()
    .withInbox(inbox)
    .withWorkRegistry(new RemoteWorkRegistry(client))
    .withStrategy(UniformAcrossAllShards.singleShard())
    .withNode(name)
    .build();
  return { client, delivery, inbox };
}

function supervisor(
  value: ReturnType<typeof node>,
  onSignal: (signalId: string) => Promise<void>,
): DeliverySupervisor {
  return new DeliverySupervisor({
    source: value.client,
    delivery: value.delivery,
    recoveryMs: 10_000,
    staleMs: 10_000,
    watchInitialBackoffMs: 10,
    watchMaxBackoffMs: 10,
    onMessage: (value) => onSignal(value.signalId),
  });
}

function message(signalId: string) {
  return {
    inboxId: {
      targetId: `type.spine.io/test.Id:${signalId}`,
      targetTypeUrl: "type.spine.io/test.Target",
    },
    signalId,
    signal: create(AnySchema, {
      typeUrl: "type.spine.io/spine.core.Command",
      value: toBinary(CommandSchema, create(CommandSchema)),
    }),
    label: "HANDLE_COMMAND" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived: new Date(),
    version: 1n,
  };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}
