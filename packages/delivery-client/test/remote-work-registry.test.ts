/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { ShardService } from "@spine-event-engine/proto/delivery-server";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import { ShardIndex } from "@spine-event-engine/server";
import { DeliveryClient } from "../src/client/client.js";
import { RemoteWorkRegistry } from "../src/remote/adapters.js";

const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });

describe("RemoteWorkRegistry", () => {
  it("uses distinct worker IDs for concurrent runs", () => {
    const core = InMemoryDelivery.create();
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(
        createRouterTransport((router) => router.service(ShardService, core.shards)),
      ),
    );
    const first = registry.workerForRun(worker);
    const second = registry.workerForRun(worker);
    expect(first.nodeId?.value).toBe("node");
    expect(second.value).not.toBe(first.value);
    core.close();
  });

  it("picks, validates locally, and releases a worker's shard", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    const registry = new RemoteWorkRegistry(client);
    const other = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    const session = await registry.pickUp(shard, worker);
    expect(session).toBeDefined();
    if (session === undefined) throw new Error("Pickup failed.");
    expect(await registry.validateOwnership(session)).toBe(session);
    expect(await other.release(session)).toBe(false);
    expect(await registry.release(session)).toBe(true);
    expect(await registry.validateOwnership(session)).toBeUndefined();
    expect(await registry.release(session)).toBe(false);
    client.close();
    core.close();
  });

  it("reports another worker's pickup as busy without a session", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    const registry = new RemoteWorkRegistry(client);
    const rival = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "rival" });
    const shard = ShardIndex.single();
    expect(await registry.pickUp(shard, worker)).toBeDefined();
    expect(await registry.pickUp(shard, rival)).toBeUndefined();
    client.close();
    core.close();
  });
});
