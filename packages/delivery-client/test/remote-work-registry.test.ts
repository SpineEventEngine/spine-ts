/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { ShardIndex } from "@spine-event-engine/server";
import {
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  LiquorPickUpOutcomeSchema,
  OptionalInboxMessageSchema,
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  ShardAlreadyPickedUpSchema,
  ShardPickedUpSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  RemoteWorkRegistry,
} from "../src/index.js";
import { deliveryClientAccess } from "../src/client/client.js";
import { echoPickup, message, transport } from "./shared-fixtures.js";

describe("RemoteWorkRegistry", () => {
  it("fails closed when package-internal client access is unavailable", () => {
    const unavailable = {} as DeliveryClient;

    expect(() =>
      deliveryClientAccess.probePickUp(
        unavailable,
        ShardIndex.single(),
        { nodeId: "node", value: "worker" },
        {},
      ),
    ).toThrow("Delivery client probe access is unavailable.");
    expect(() => deliveryClientAccess.observeOnce(unavailable)).toThrow(
      "Delivery client observation access is unavailable.",
    );
  });

  it("refuses unknown and incompatible local sessions without a remote release", async () => {
    const fake = transport();
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));

    await expect(
      registry.release({ kind: "LEASED", shard: ShardIndex.single() } as never),
    ).resolves.toBe(false);
    await expect(registry.release({ kind: "EXCLUSIVE", shard: ShardIndex.single() })).resolves.toBe(
      false,
    );
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("keeps issued sessions private to one registry wrapper", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const client = DeliveryClient.usingTransport(workerTransport(workers));
    const owner = new RemoteWorkRegistry(client);
    const sibling = new RemoteWorkRegistry(client);
    const session = await owner.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(sibling.validateOwnership(session)).resolves.toBeUndefined();
    await expect(sibling.release(session)).resolves.toBe(false);
    await expect(owner.release(session)).resolves.toBe(true);
  });

  it("forwards both operation bounds when acquiring a remote shard", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const controller = new AbortController();
    echoPickup(fake);

    await expect(
      registry.pickUp(ShardIndex.single(), workerId("node", "worker"), {
        signal: controller.signal,
        timeoutMs: 123,
      }),
    ).resolves.toMatchObject({ kind: "EXCLUSIVE" });
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "PickShard" }),
      expect.any(AbortSignal),
      123,
      undefined,
      expect.anything(),
    );
  });

  it("rejects an incomplete worker before attempting remote ownership", async () => {
    const fake = transport();
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));

    await expect(registry.pickUp(ShardIndex.single(), create(WorkerIdSchema))).rejects.toThrow(
      "Delivery worker ID is invalid.",
    );
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("forwards each complete opaque worker identity", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const client = DeliveryClient.usingTransport(workerTransport(workers));
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();

    const first = await registry.pickUp(shard, workerId("node", "worker-1"));
    if (first === undefined) throw new Error("First remote shard was not acquired.");
    await registry.release(first);
    const second = await registry.pickUp(shard, workerId("node", "worker-2"));
    if (second === undefined) throw new Error("Second remote shard was not acquired.");

    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.nodeId)).toEqual(["node", "node"]);
    expect(workers[0]?.value).not.toBe(workers[1]?.value);
  });

  it("validates only the exact retained remote worker and pickup time", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(workerTransport(workers, "same-owner")),
    );
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(registry.validateOwnership(session)).resolves.toBe(session);
    expect(workers).toHaveLength(2);
  });

  it("invalidates a retained session after a different worker takes over", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(workerTransport(workers, "other-owner")),
    );
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(registry.validateOwnership(session)).resolves.toBeUndefined();
    await expect(registry.release(session)).resolves.toBe(false);
  });

  it("releases an accidental probe pickup and fails validation closed", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(workerTransport(workers)),
    );
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(registry.validateOwnership(session)).resolves.toBeUndefined();
    await expect(registry.release(session)).resolves.toBe(false);
    expect(workers).toHaveLength(2);
  });

  it("fails an uncertain ownership probe closed without retaining a marker", async () => {
    const fake = transport();
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));
    echoPickup(fake);
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");
    fake.fail(new Error("probe outcome lost"));

    await expect(registry.validateOwnership(session)).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
  });

  it("retains no client-side release marker after an unknown outcome", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    echoPickup(fake);
    const firstSession = await registry.pickUp(shard, workerId("node", "worker-1"));
    if (firstSession === undefined) throw new Error("Remote shard was not acquired.");
    fake.fail(new Error("release outcome lost"));
    await expect(registry.release(firstSession)).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
    echoPickup(fake);
    await expect(registry.pickUp(shard, workerId("node", "worker-2"))).resolves.toMatchObject({
      kind: "EXCLUSIVE",
      shard,
    });
    expect(fake.unary).toHaveBeenCalledTimes(3);
  });

  it("picks up, releases, and observes expired exclusive shard sessions exactly once", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const shard = new ShardIndex(0, 2);
    const worker = { nodeId: "node-a", value: "worker-a" };
    const wireWorker = create(WorkerIdSchema, { nodeId: { value: "node-a" }, value: "worker-a" });
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "pickedUp",
          value: create(ShardPickedUpSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
            worker: wireWorker,
            whenPicked: { seconds: 2n, nanos: 0 },
          }),
        },
      }),
    );

    const session = await client.pickUp(shard, worker);

    expect(session).toMatchObject({
      kind: "EXCLUSIVE",
      shard,
      worker,
      whenPicked: new Date(2_000),
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session?.worker)).toBe(true);
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "PickShard" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      create(PickUpShardSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
        worker: wireWorker,
      }),
    );

    fake.reply(create(EmptySchema));
    if (session === undefined) throw new Error("Shard session was not acquired.");
    await expect(client.release(session)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "ReleaseSession" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      create(ReleaseShardSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
        worker: wireWorker,
      }),
    );

    fake.reply(
      create(ExpiredSessionsReleasedSchema, {
        shard: [
          create(ExpiredSessionSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
            worker: wireWorker,
            whenPicked: { seconds: 2n, nanos: 0 },
            whenReleased: { seconds: 3n, nanos: 0 },
          }),
        ],
      }),
    );
    const released = await client.releaseExpired(500);
    expect(released).toMatchObject([
      {
        kind: "EXCLUSIVE",
        shard,
        worker,
        whenPicked: new Date(2_000),
        whenReleased: new Date(3_000),
      },
    ]);
    expect(Object.isFrozen(released)).toBe(true);
    expect(Object.isFrozen(released[0])).toBe(true);
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "ReleaseSessions" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 500_000_000 },
      }),
    );
    expect(fake.unary).toHaveBeenCalledTimes(3);
  });

  it("maps already-picked-up, validates shard mutation responses, and prevents invalid calls", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = ShardIndex.single();
    const worker = { nodeId: "node-a", value: "worker-a" };
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "alreadyPickedUp",
          value: create(ShardAlreadyPickedUpSchema, {
            worker: create(WorkerIdSchema, { nodeId: { value: "node-b" }, value: "worker-b" }),
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      }),
    );
    await expect(client.pickUp(shard, worker)).resolves.toBeUndefined();

    fake.reply(create(LiquorPickUpOutcomeSchema));
    await expect(client.pickUp(shard, worker)).rejects.toBeInstanceOf(DeliveryProtocolError);
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: { case: "alreadyPickedUp", value: create(ShardAlreadyPickedUpSchema) },
      }),
    );
    await expect(client.pickUp(shard, worker)).rejects.toBeInstanceOf(DeliveryProtocolError);
    fake.reply(create(ExpiredSessionsReleasedSchema, { shard: [create(ExpiredSessionSchema)] }));
    await expect(client.releaseExpired(1)).rejects.toMatchObject({
      operation: "RELEASE_EXPIRED",
      reconciliation: { kind: "OBSERVE_SHARD", scope: "ALL_SHARDS" },
    });
    await expect(client.pickUp(shard, { nodeId: "", value: "worker" })).rejects.toThrow();
    await expect(client.pickUp(shard, { nodeId: "node", value: "é".repeat(63) })).rejects.toThrow(
      "Delivery worker ID is invalid.",
    );
    await expect(client.release({} as never)).rejects.toThrow();
    for (const duration of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(client.releaseExpired(duration)).rejects.toThrow();
    const aborted = new AbortController();
    aborted.abort(new Error("caller stopped"));
    await expect(client.pickUp(shard, worker, { signal: aborted.signal })).rejects.toThrow(
      "caller stopped",
    );
    client.close();
    await expect(client.releaseExpired(1)).rejects.toThrow("Delivery client is closed.");
    expect(fake.unary).toHaveBeenCalledTimes(4);
  });

  it("accepts response collections above the former artificial bound", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    fake.reply(
      create(ExpiredSessionsReleasedSchema, {
        shard: Array.from({ length: 101 }, () =>
          create(ExpiredSessionSchema, {
            shard,
            worker,
            whenPicked: { seconds: 1n, nanos: 0 },
            whenReleased: { seconds: 2n, nanos: 0 },
          }),
        ),
      }),
    );

    await expect(client.releaseExpired(1)).resolves.toHaveLength(101);
  });

  it("rejects expiration responses above the shared tracked-shard bound", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    fake.reply(
      create(ExpiredSessionsReleasedSchema, {
        shard: Array.from({ length: 1_001 }, () =>
          create(ExpiredSessionSchema, {
            shard,
            worker,
            whenPicked: { seconds: 0n },
            whenReleased: { seconds: 1n },
          }),
        ),
      }),
    );
    await expect(client.releaseExpired(1)).rejects.toMatchObject({
      operation: "RELEASE_EXPIRED",
    });
  });

  it("reports ambiguous shard mutation outcomes without retry or diagnostics", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const shard = ShardIndex.single();
    const worker = { nodeId: "node-a", value: "worker-a" };
    fake.fail(new Error("dropped response: secret-payload"));
    await expect(client.pickUp(shard, worker)).rejects.toMatchObject({
      operation: "PICK_UP_SHARD",
      reconciliation: { kind: "OBSERVE_SHARD", shards: [shard] },
    });
    fake.fail(new Error("timeout: secret-payload"));
    await expect(
      client.release({ kind: "EXCLUSIVE", shard, worker, whenPicked: new Date(0) }),
    ).rejects.toMatchObject({ operation: "RELEASE_SHARD" });
    fake.fail(new ConnectError("cancelled: secret-payload", Code.Canceled));
    try {
      await client.releaseExpired(1);
    } catch (error) {
      const unknown = error as DeliveryOutcomeUnknownError;
      expect(unknown).toMatchObject({
        operation: "RELEASE_EXPIRED",
        reconciliation: { kind: "OBSERVE_SHARD", scope: "ALL_SHARDS" },
      });
      expect(Object.isFrozen(unknown.reconciliation)).toBe(true);
      expect(String(unknown)).not.toContain("secret-payload");
    }
    expect(fake.unary).toHaveBeenCalledTimes(3);
  });
});

function workerTransport(
  workers: { nodeId: string; value: string }[],
  probeOutcome?: "same-owner" | "other-owner",
): Transport {
  let pickups = 0;
  const unaryTransport: Pick<Transport, "unary"> = {
    unary: (method, _signal, _timeoutMs, _header, input) => {
      if (method.name === "FindOne") {
        return Promise.resolve({
          stream: false,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: create(OptionalInboxMessageSchema, {
            message: message("command", "synchronize"),
          }),
        } as never);
      }
      if (method.name === "ReleaseSession") {
        return Promise.resolve({
          stream: false,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: create(EmptySchema),
        } as never);
      }
      if (method.name === "PickShard") {
        const request = input as {
          shard: unknown;
          worker: { nodeId?: { value: string }; value: string };
        };
        const worker = {
          nodeId: request.worker.nodeId?.value ?? "",
          value: request.worker.value,
        };
        workers.push(worker);
        pickups += 1;
        return Promise.resolve({
          stream: false,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: create(
            LiquorPickUpOutcomeSchema,
            pickups > 1 && probeOutcome !== undefined
              ? {
                  value: {
                    case: "alreadyPickedUp",
                    value: create(ShardAlreadyPickedUpSchema, {
                      worker: create(WorkerIdSchema, {
                        nodeId: {
                          value:
                            probeOutcome === "same-owner"
                              ? (workers[0]?.nodeId ?? "")
                              : "replacement-node",
                        },
                        value:
                          probeOutcome === "same-owner"
                            ? (workers[0]?.value ?? "")
                            : "replacement-worker",
                      }),
                      whenPicked: { seconds: 1n, nanos: 0 },
                    }),
                  },
                }
              : {
                  value: {
                    case: "pickedUp",
                    value: create(ShardPickedUpSchema, {
                      shard: request.shard as never,
                      worker: create(WorkerIdSchema, {
                        nodeId: { value: worker.nodeId },
                        value: worker.value,
                      }),
                      whenPicked: { seconds: BigInt(pickups), nanos: 0 },
                    }),
                  },
                },
          ),
        } as never);
      }
      throw new Error(`Unexpected method ${method.name}`);
    },
  };
  return unaryTransport as unknown as Transport;
}

function workerId(node: string, value: string) {
  return create(WorkerIdSchema, { nodeId: { value: node }, value });
}
