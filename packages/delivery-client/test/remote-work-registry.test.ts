import {
  create,
  type DescMessage,
  type DescMethodUnary,
  type MessageShape,
} from "@bufbuild/protobuf";
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
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  RemoteInbox,
  RemoteWorkRegistry,
} from "../src/index.js";
import { deliveryClientAccess } from "../src/client/client.js";
import { conditionalPickUp } from "@spine-event-engine/server/internal/conditional-pickup";
import { echoPickup, message, quarantine, transport } from "./shared-fixtures.js";

describe("RemoteWorkRegistry", () => {
  it("uses a distinct opaque worker value for each remote pickup while retaining the node", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const client = DeliveryClient.usingTransport(workerTransport(workers));
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();

    const first = await registry.pickUp(shard, "node");
    if (first === undefined) throw new Error("First remote shard was not acquired.");
    await registry.release(first);
    const second = await registry.pickUp(shard, "node");
    if (second === undefined) throw new Error("Second remote shard was not acquired.");

    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.nodeId)).toEqual(["node", "node"]);
    expect(workers[0]?.value).not.toBe(workers[1]?.value);
  });

  it("authorizes live inbox synchronization when a header-ignorant frozen probe reports the original session", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const client = DeliveryClient.usingTransport(workerTransport(workers, "already-held"));
    const registry = new RemoteWorkRegistry(client);
    const session = await registry.pickUp(ShardIndex.single(), "node");
    if (session === undefined) throw new Error("Remote shard was not acquired.");
    const inbox = new RemoteInbox(client, quarantine());
    const fake = client;
    void fake;

    // The transport exposes no private acknowledgement headers. Synchronization must
    // authorize only the frozen `already_picked_up` worker and generation.
    const remoteMessage = await client.findOne({
      value: "synchronize",
      shard: ShardIndex.single(),
    });
    if (remoteMessage === undefined) throw new Error("Remote message was not found.");
    const work = await inbox.begin(remoteMessage, session);
    if (work === undefined) throw new Error("Remote work was not created.");
    await expect(work.synchronize(session)).resolves.toBeUndefined();
    expect(workers).toHaveLength(2);
    expect(workers[1]).not.toEqual(workers[0]);
  });

  it("fences live inbox synchronization and releases a challenger that accidentally acquires", async () => {
    const workers: { nodeId: string; value: string }[] = [];
    const client = DeliveryClient.usingTransport(workerTransport(workers, "picked"));
    const registry = new RemoteWorkRegistry(client);
    const session = await registry.pickUp(ShardIndex.single(), "node");
    if (session === undefined) throw new Error("Remote shard was not acquired.");
    const inbox = new RemoteInbox(client, quarantine());
    const remoteMessage = await client.findOne({
      value: "synchronize",
      shard: ShardIndex.single(),
    });
    if (remoteMessage === undefined) throw new Error("Remote message was not found.");
    const work = await inbox.begin(remoteMessage, session);
    if (work === undefined) throw new Error("Remote work was not created.");

    await expect(work.synchronize(session)).rejects.toBeInstanceOf(DeliveryProtocolError);
    await expect(registry.release(session)).resolves.toBe(false);
    expect(workers).toHaveLength(2);
  });

  it("fails closed for missing or altered conditional pickup acknowledgements", async () => {
    const fake = transport();
    const shard = ShardIndex.single();
    const worker = { nodeId: "node", value: "worker" };
    const reply = create(LiquorPickUpOutcomeSchema, {
      value: {
        case: "pickedUp",
        value: create(ShardPickedUpSchema, {
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          worker: create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
          whenPicked: { seconds: 1n, nanos: 0 },
        }),
      },
    });
    const client = DeliveryClient.usingTransport(fake.transport);
    fake.reply(reply);
    await expect(
      deliveryClientAccess.pickUpPending(client, shard, worker, {}),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    const registry = new RemoteWorkRegistry(client);
    const conditional = conditionalPickUp.for(registry);
    if (conditional === undefined) throw new Error("Conditional pickup is unavailable.");
    fake.reply(reply);
    await expect(conditional(shard, "node")).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(registry.pickUp(shard, "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("accepts only an exact successful conditional pickup acknowledgement", async () => {
    const fake = transport();
    const shard = ShardIndex.single();
    const worker = { nodeId: "node", value: "worker" };
    const reply = create(LiquorPickUpOutcomeSchema, {
      value: {
        case: "pickedUp",
        value: create(ShardPickedUpSchema, {
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          worker: create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
          whenPicked: { seconds: 1n, nanos: 0 },
        }),
      },
    });
    const withHeader = (value: string): Transport => ({
      ...fake.transport,
      unary: async <I extends DescMessage, O extends DescMessage>(
        method: DescMethodUnary<I, O>,
        signal: AbortSignal | undefined,
        timeoutMs: number | undefined,
        header: HeadersInit | undefined,
        input: MessageShape<I>,
        contextValues: Parameters<Transport["unary"]>[5],
      ) => ({
        ...(await fake.transport.unary(method, signal, timeoutMs, header, input, contextValues)),
        header: new Headers([["x-spine-delivery-outcome", value]]),
      }),
    });
    fake.reply(reply);
    await expect(
      deliveryClientAccess.pickUpPending(
        DeliveryClient.usingTransport(withHeader("pending-acknowledged")),
        shard,
        worker,
        {},
      ),
    ).resolves.toMatchObject({ kind: "EXCLUSIVE" });
    fake.reply(reply);
    await expect(
      deliveryClientAccess.pickUpPending(
        DeliveryClient.usingTransport(withHeader("altered")),
        shard,
        worker,
        {},
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });

  it("recognizes only the exact conditional no-work outcome", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const shard = ShardIndex.single();
    const worker = { nodeId: "node", value: "worker" };

    fake.fail(
      new ConnectError(
        "No work.",
        Code.FailedPrecondition,
        new Headers([["x-spine-delivery-outcome", "no-pending-work"]]),
      ),
    );
    await expect(
      deliveryClientAccess.pickUpPending(client, shard, worker, {}),
    ).resolves.toBeUndefined();
    expect(pickupMode(fake)).toBe("pending");

    fake.fail(new ConnectError("No work.", Code.FailedPrecondition));
    await expect(
      deliveryClientAccess.pickUpPending(client, shard, worker, {}),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    fake.fail(
      new ConnectError(
        "No work.",
        Code.FailedPrecondition,
        new Headers([["x-spine-delivery-outcome", "other"]]),
      ),
    );
    await expect(
      deliveryClientAccess.pickUpPending(client, shard, worker, {}),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });

  it("uses conditional pickup through the work-registry port without quarantining no work", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();

    fake.fail(
      new ConnectError(
        "No work.",
        Code.FailedPrecondition,
        new Headers([["x-spine-delivery-outcome", "no-pending-work"]]),
      ),
    );
    const pickUpPending = conditionalPickUp.for(registry);
    if (pickUpPending === undefined) throw new Error("Conditional pickup is unavailable.");
    await expect(pickUpPending(shard, "node")).resolves.toBeUndefined();
    expect(pickupMode(fake)).toBe("pending");

    echoPickup(fake);
    await expect(registry.pickUp(shard, "node")).resolves.toMatchObject({ kind: "EXCLUSIVE" });
  });

  it("keeps pickup blocked through an in-flight or unknown release until its safe resolution", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    const notPicked = () => Object.freeze({ shard, status: "NOT_PICKED" as const, messages: 0 });

    echoPickup(fake);
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
    echoPickup(fake);
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
    echoPickup(fake);
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

function pickupMode(fake: ReturnType<typeof transport>): string | null {
  const calls = fake.unary.mock.calls as unknown as unknown[][];
  return (calls.at(-1)?.[3] as Headers | undefined)?.get("x-spine-delivery-pickup-mode") ?? null;
}

function workerTransport(
  workers: { nodeId: string; value: string }[],
  probeOutcome?: "already-held" | "picked",
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
            pickups > 1 && probeOutcome === "already-held"
              ? {
                  value: {
                    case: "alreadyPickedUp",
                    value: create(ShardAlreadyPickedUpSchema, {
                      worker: create(WorkerIdSchema, {
                        nodeId: { value: workers[0]?.nodeId ?? "" },
                        value: workers[0]?.value ?? "",
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
