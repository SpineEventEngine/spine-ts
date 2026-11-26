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
import { EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { Time } from "@spine-event-engine/core/time";
import { ShardIndex } from "@spine-event-engine/server";
import {
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  DeliveryShardPickupOutcomeSchema,
  DeliveryShardBusySchema,
  DeliverySessionHandleSchema,
  DeliveryShardPickupSchema,
  OptionalInboxMessageSchema,
  ReleaseExpiredSessionsSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  RemoteWorkRegistry,
} from "../src/index.js";
import { deliveryClientAccess } from "../src/client/client.js";
import { echoPickup, message, transport } from "./shared-fixtures.js";

describe("RemoteWorkRegistry", () => {
  it("rejects a managed pickup cancelled before dispatch and a pickup after client close", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const worker = { nodeId: "node", value: "run" };
    const caller = new AbortController();
    caller.abort(new Error("pickup cancelled"));
    await expect(
      client.pickUpForDelivery(ShardIndex.single(), worker, { signal: caller.signal }),
    ).rejects.toThrow("pickup cancelled");
    client.close();
    await expect(client.pickUpForDelivery(ShardIndex.single(), worker)).rejects.toThrow(
      "Delivery client is closed.",
    );
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("keeps a full UUID per run within the existing UTF-8 worker boundary", () => {
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(transport().transport));
    for (const length of [92, 93, 100, 127]) {
      const nodeId = "n".repeat(length);
      const configured = workerId(nodeId, "x");
      const first = registry.workerForRun(configured);
      const second = registry.workerForRun(configured);
      expect(first.value).not.toBe(second.value);
      expect(first.nodeId?.value).toBe(second.nodeId?.value);
      if (length <= 92) expect(first.nodeId?.value).toBe(nodeId);
      else expect(first.nodeId?.value).toMatch(/^n-[0-9a-f]{64}$/);
      expect(
        new TextEncoder().encode((first.nodeId?.value ?? "") + first.value).length,
      ).toBeLessThanOrEqual(128);
    }
  });

  it("fails closed when package-internal client access is unavailable", () => {
    const unavailable = {} as DeliveryClient;

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
    expect(
      registry.renewalIntervalMs({ kind: "LEASED", shard: ShardIndex.single() } as never),
    ).toBeUndefined();
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

  it("invalidates a retained session only after an Admin free-shard observation", async () => {
    const fake = transport();
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));
    const shard = ShardIndex.single();
    echoPickup(fake);
    const session = await registry.pickUp(shard, workerId("node", "worker"));
    if (session === undefined) throw new Error("Expected the managed session.");
    expect(registry.renewalIntervalMs(session)).toBe(20_000);
    registry.reconcile({ shard, status: "PICKED", messages: 1 });
    expect(registry.renewalIntervalMs(session)).toBe(20_000);
    registry.reconcile({ shard, status: "NOT_PICKED", messages: 1 });
    expect(registry.renewalIntervalMs(session)).toBeUndefined();
    await expect(registry.validateOwnership(session)).resolves.toBeUndefined();
    await expect(registry.release(session)).resolves.toBe(false);
    expect(fake.unary).toHaveBeenCalledOnce();
  });

  it("refuses renewal after the last confirmed server lifetime elapses", async () => {
    let now = 0;
    const previous = Time.setProvider({
      currentTime: () => create(TimestampSchema),
      monotonicTime: () => now,
    });
    try {
      const fake = transport();
      const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));
      echoPickup(fake);
      const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker"));
      if (session === undefined) throw new Error("Expected the managed session.");
      now = 60_000;
      await expect(registry.validateOwnership(session)).resolves.toBeUndefined();
      expect(registry.renewalIntervalMs(session)).toBeUndefined();
      await expect(registry.release(session)).resolves.toBe(false);
      expect(fake.unary).toHaveBeenCalledOnce();
    } finally {
      Time.setProvider(previous);
    }
  });

  it("does not revive a renewal whose reply arrives after its known-live deadline", async () => {
    let now = 0;
    const previous = Time.setProvider({
      currentTime: () => create(TimestampSchema),
      monotonicTime: () => now,
    });
    try {
      const fake = transport();
      const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));
      const shard = ShardIndex.single();
      const worker = workerId("node", "worker");
      echoPickup(fake);
      const session = await registry.pickUp(shard, worker);
      if (session === undefined) throw new Error("Expected the managed session.");
      const held = fake.replyAndHold(
        create(DeliverySessionHandleSchema, {
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          worker,
          whenPicked: { seconds: 2n, nanos: 0 },
          sessionId: "fixture-session",
          lifetime: { seconds: 60n, nanos: 0 },
        }),
      );
      const renewal = registry.validateOwnership(session);
      await Promise.resolve();
      now = 60_000;
      held.release();
      await expect(renewal).resolves.toBeUndefined();
      expect(registry.renewalIntervalMs(session)).toBeUndefined();
      await expect(registry.release(session)).resolves.toBe(false);
      expect(fake.unary).toHaveBeenCalledTimes(2);
    } finally {
      Time.setProvider(previous);
    }
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
      expect.objectContaining({ name: "PickShardForDelivery" }),
      expect.any(AbortSignal),
      123,
      undefined,
      expect.anything(),
    );
  });

  it("keeps the original worker identity when a caller changes its object during recovery", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const worker = { nodeId: "node", value: "worker" };
    fake.fail(new Error("pickup reply lost"));
    fake.replyPickup();
    const pickup = client.pickUpForDelivery(ShardIndex.single(), worker);
    worker.value = "another-run";
    await expect(pickup).resolves.toMatchObject({
      kind: "PICKED",
      session: { worker: { value: "worker" } },
    });
    expect(fake.unary).toHaveBeenCalledTimes(2);
    expect(fake.unary.mock.calls[1]?.[4]).toEqual(fake.unary.mock.calls[0]?.[4]);
    client.close();
  });

  it("stops ambiguous pickup recovery at the original deadline", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { retryBackoffMs: 1_000 });
    fake.fail(new Error("first pickup reply lost"));
    fake.fail(new Error("recovery reply lost"));
    const started = Date.now();
    await expect(
      client.pickUpForDelivery(
        ShardIndex.single(),
        { nodeId: "node", value: "worker" },
        { timeoutMs: 10 },
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(fake.unary).toHaveBeenCalledTimes(2);
    expect(fake.unary.mock.calls[0]?.[4]).toMatchObject({
      worker: { nodeId: { value: "node" }, value: "worker" },
    });
    expect(fake.unary.mock.calls[1]?.[4]).toEqual(fake.unary.mock.calls[0]?.[4]);
  });

  it("ends managed pickup recovery promptly when the client closes during backoff", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { retryBackoffMs: 1_000 });
    fake.fail(new Error("first reply lost"));
    fake.fail(new Error("recovery reply lost"));
    const pickup = client.pickUpForDelivery(ShardIndex.single(), {
      nodeId: "node",
      value: "worker",
    });
    await vi.waitFor(() => {
      expect(fake.unary).toHaveBeenCalledTimes(2);
    });
    client.close();
    await expect(pickup).rejects.toThrow("Delivery client is closed.");
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("ends managed pickup recovery when the caller aborts during backoff", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { retryBackoffMs: 1_000 });
    const controller = new AbortController();
    fake.fail(new Error("first reply lost"));
    fake.fail(new Error("recovery reply lost"));
    const pickup = client.pickUpForDelivery(
      ShardIndex.single(),
      { nodeId: "node", value: "worker" },
      { signal: controller.signal },
    );
    await vi.waitFor(() => {
      expect(fake.unary).toHaveBeenCalledTimes(2);
    });
    controller.abort(new Error("caller stopped"));
    await expect(pickup).rejects.toThrow("caller stopped");
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("paces repeated immediate ambiguous replies within one deadline", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    for (let index = 0; index < 20; index++) fake.fail(new Error("reply lost"));
    await expect(
      client.pickUpForDelivery(
        ShardIndex.single(),
        { nodeId: "node", value: "worker" },
        { timeoutMs: 30 },
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(fake.unary.mock.calls.length).toBeGreaterThan(1);
    expect(fake.unary.mock.calls.length).toBeLessThan(10);
  });

  it.each([
    Code.Unauthenticated,
    Code.PermissionDenied,
    Code.InvalidArgument,
    Code.Unimplemented,
    Code.FailedPrecondition,
  ])("does not retry definitive managed pickup rejection %s", async (code) => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    fake.fail(new ConnectError("server detail", code));
    await expect(
      client.pickUpForDelivery(ShardIndex.single(), { nodeId: "node", value: "worker" }),
    ).rejects.toMatchObject({ code });
    expect(fake.unary).toHaveBeenCalledTimes(1);
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

  it("renews only the exact retained remote session", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(workerTransport(workers, "same-owner")),
    );
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(registry.validateOwnership(session)).resolves.toBe(session);
    expect(workers).toHaveLength(1);
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

  it("retains a healthy session during renewal without another pickup", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const registry = new RemoteWorkRegistry(
      DeliveryClient.usingTransport(workerTransport(workers)),
    );
    const session = await registry.pickUp(ShardIndex.single(), workerId("node", "worker-1"));
    if (session === undefined) throw new Error("Remote shard was not acquired.");

    await expect(registry.validateOwnership(session)).resolves.toBe(session);
    await expect(registry.release(session)).resolves.toBe(true);
    expect(workers).toHaveLength(1);
  });

  it("makes release terminal while an earlier renewal response is delayed", async () => {
    const fake = transport();
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(fake.transport));
    const shard = ShardIndex.single();
    echoPickup(fake);
    const session = await registry.pickUp(shard, workerId("node", "worker"));
    if (session === undefined) throw new Error("Expected a managed session.");
    const held = fake.replyAndHold(
      create(DeliverySessionHandleSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        worker: workerId("node", "worker"),
        whenPicked: { seconds: 2n, nanos: 0 },
        sessionId: "fixture-session",
        lifetime: { seconds: 60n, nanos: 0 },
      }),
    );
    fake.reply(create(EmptySchema));
    const renewal = registry.validateOwnership(session);
    await Promise.resolve();
    const release = registry.release(session);
    await expect(registry.validateOwnership(session)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
    held.release();
    await expect(renewal).resolves.toBeUndefined();
    await expect(release).resolves.toBe(true);
    await expect(registry.release(session)).resolves.toBe(false);
    expect(fake.unary).toHaveBeenCalledTimes(3);
    expect(fake.unary.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      "PickShardForDelivery",
      "RenewShardSession",
      "ReleaseShardSession",
    ]);
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
      create(DeliveryShardPickupOutcomeSchema, {
        result: {
          case: "pickedUp",
          value: create(DeliverySessionHandleSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
            worker: wireWorker,
            whenPicked: { seconds: 2n, nanos: 0 },
            sessionId: "raw-session",
            lifetime: { seconds: 60n, nanos: 0 },
          }),
        },
      }),
    );

    const session = await client.pickUp(shard, worker);

    expect(session).toMatchObject({
      kind: "EXCLUSIVE",
      shard,
      worker,
      whenPicked: { seconds: 2n, nanos: 0 },
      sessionId: "raw-session",
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session?.worker)).toBe(true);
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "PickShardRaw" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      create(DeliveryShardPickupSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
        worker: wireWorker,
      }),
    );

    fake.reply(create(EmptySchema));
    if (session === undefined) throw new Error("Shard session was not acquired.");
    await expect(client.release(session)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "ReleaseShardSession" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      create(DeliverySessionHandleSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
        worker: wireWorker,
        sessionId: "raw-session",
        whenPicked: { seconds: 2n, nanos: 0 },
        lifetime: { seconds: 60n, nanos: 0 },
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
        whenPicked: { seconds: 2n, nanos: 0 },
        whenReleased: { seconds: 3n, nanos: 0 },
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

  it("maps busy pickup, validates shard mutation responses, and prevents invalid calls", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = ShardIndex.single();
    const worker = { nodeId: "node-a", value: "worker-a" };
    fake.reply(
      create(DeliveryShardPickupOutcomeSchema, {
        result: {
          case: "busy",
          value: create(DeliveryShardBusySchema, {
            worker: create(WorkerIdSchema, { nodeId: { value: "node-b" }, value: "worker-b" }),
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      }),
    );
    await expect(client.pickUp(shard, worker)).resolves.toBeUndefined();

    fake.reply(create(DeliveryShardPickupOutcomeSchema));
    await expect(client.pickUp(shard, worker)).rejects.toBeInstanceOf(DeliveryProtocolError);
    fake.reply(
      create(DeliveryShardPickupOutcomeSchema, {
        result: { case: "busy", value: create(DeliveryShardBusySchema) },
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

  it("rejects invalid session lifetimes and a renewal with another session ID", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const worker = workerId("node", "worker");
    const reply = (seconds: bigint, nanos: number, sessionId = "session") =>
      create(DeliveryShardPickupOutcomeSchema, {
        result: {
          case: "pickedUp",
          value: create(DeliverySessionHandleSchema, {
            shard,
            worker,
            sessionId,
            whenPicked: { seconds: 1n, nanos: 0 },
            lifetime: { seconds, nanos },
          }),
        },
      });
    for (const [seconds, nanos] of [
      [0n, 0],
      [315_576_000_001n, 0],
      [1n, 1_000_000_000],
      [1n, 0.5],
    ] as const) {
      fake.reply(reply(seconds, nanos));
      await expect(
        client.pickUp(ShardIndex.single(), {
          nodeId: "node",
          value: "worker",
        }),
      ).rejects.toBeInstanceOf(DeliveryProtocolError);
    }
    fake.reply(reply(60n, 0));
    const session = await client.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    if (session === undefined) throw new Error("Expected a typed session.");
    expect(Object.isFrozen(session.lifetime)).toBe(true);
    fake.reply(
      create(DeliverySessionHandleSchema, {
        shard,
        worker,
        sessionId: "another-session",
        whenPicked: { seconds: 2n, nanos: 0 },
        lifetime: { seconds: 60n, nanos: 0 },
      }),
    );
    await expect(client.renew(session)).rejects.toBeInstanceOf(DeliveryProtocolError);
  });

  it("reads every released session across a large shard group", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const ofTotal = 1_201;
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    fake.reply(
      create(ExpiredSessionsReleasedSchema, {
        shard: Array.from({ length: ofTotal }, (_, index) =>
          create(ExpiredSessionSchema, {
            shard: create(ShardIndexSchema, { index, ofTotal }),
            worker,
            whenPicked: { seconds: 1n },
            whenReleased: { seconds: 2n },
          }),
        ),
      }),
    );

    const sessions = await client.releaseExpired(1);
    expect(sessions.map(({ shard }) => shard.index)).toEqual(
      Array.from({ length: ofTotal }, (_, index) => index),
    );
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
      client.release({
        kind: "EXCLUSIVE",
        shard,
        worker,
        whenPicked: { $typeName: "google.protobuf.Timestamp", seconds: 0n, nanos: 0 },
        sessionId: "session-1",
        lifetime: { $typeName: "google.protobuf.Duration", seconds: 60n, nanos: 0 },
      }),
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
  renewalOutcome?: "same-owner" | "other-owner",
): Transport {
  let pickups = 0;
  const unaryTransport: Pick<Transport, "unary"> = {
    unary: (method, _signal, _timeoutMs, _header, input) => {
      let response: unknown;
      if (method.name === "FindOne") {
        response = create(OptionalInboxMessageSchema, {
          message: message("command", "synchronize"),
        });
      } else if (method.name === "ReleaseShardSession") {
        response = create(EmptySchema);
      } else if (method.name === "RenewShardSession") {
        if (renewalOutcome === "other-owner")
          return Promise.reject(new ConnectError("Session ended.", Code.FailedPrecondition));
        response = input;
      } else if (method.name === "PickShardForDelivery") {
        const request = input as {
          shard: unknown;
          worker: { nodeId?: { value: string }; value: string };
        };
        workers.push({
          nodeId: request.worker.nodeId?.value ?? "",
          value: request.worker.value,
        });
        pickups += 1;
        response = create(DeliveryShardPickupOutcomeSchema, {
          result: {
            case: "pickedUp",
            value: create(DeliverySessionHandleSchema, {
              shard: request.shard as never,
              worker: request.worker as never,
              sessionId: `fixture-${String(pickups)}`,
              whenPicked: { seconds: BigInt(pickups), nanos: 0 },
              lifetime: { seconds: 60n, nanos: 0 },
            }),
          },
        });
      } else {
        throw new Error(`Unexpected method ${method.name}`);
      }
      return Promise.resolve({
        stream: false,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: response,
      } as never);
    },
  };
  return unaryTransport as unknown as Transport;
}

function workerId(node: string, value: string) {
  return create(WorkerIdSchema, { nodeId: { value: node }, value });
}
