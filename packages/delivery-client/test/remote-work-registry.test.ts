import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { ShardIndex } from "@spine-ts/server";
import {
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  LiquorPickUpOutcomeSchema,
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  ShardAlreadyPickedUpSchema,
  ShardPickedUpSchema,
} from "@spine-ts/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-ts/proto/delivery";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  RemoteWorkRegistry,
} from "../src/index.js";
import { transport } from "./shared-fixtures.js";

describe("RemoteWorkRegistry", () => {
  it("keeps pickup blocked through an in-flight or unknown release until its safe resolution", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "spine-ts:node" });
    const pickedUp = () =>
      create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "pickedUp",
          value: create(ShardPickedUpSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            worker,
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      });
    const notPicked = () => Object.freeze({ shard, status: "NOT_PICKED" as const, messages: 0 });

    fake.reply(pickedUp());
    const firstSession = await registry.pickUp(shard, "node");
    if (firstSession === undefined) throw new Error("Remote shard was not acquired.");

    const heldRelease = fake.replyAndHold(create(EmptySchema));
    const firstRelease = registry.release(firstSession);
    await vi.waitFor(() => {
      expect(fake.unary).toHaveBeenCalledTimes(2);
    });
    registry.reconcile(notPicked());
    await expect(registry.pickUp(shard, "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);

    heldRelease.release();
    await expect(firstRelease).resolves.toBe(true);
    fake.reply(pickedUp());
    const secondSession = await registry.pickUp(shard, "node");
    if (secondSession === undefined) throw new Error("Remote shard was not reacquired.");
    expect(fake.unary).toHaveBeenCalledTimes(3);

    fake.fail(new Error("release outcome lost"));
    await expect(registry.release(secondSession)).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
    await expect(registry.pickUp(shard, "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(4);

    registry.reconcile(notPicked());
    fake.reply(pickedUp());
    await expect(registry.pickUp(shard, "node")).resolves.toMatchObject({
      kind: "EXCLUSIVE",
      shard,
    });
    expect(fake.unary).toHaveBeenCalledTimes(5);
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

  it("quarantines ambiguous shard mutation outcomes without retry or diagnostics", async () => {
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
