import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { ShardIndex } from "@spine-event-engine/server";
import {
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
  ReadMessagesSinceTimeSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  MAX_DELIVERY_BATCH_MESSAGES,
} from "../src/index.js";
import { domainMessage, message, transport } from "./shared-fixtures.js";

describe("DeliveryClient RPC and lifecycle", () => {
  it("validates and retains a caller-owned bounded page size", () => {
    const fake = transport();

    const defaultClient = DeliveryClient.usingTransport(fake.transport);
    const configuredClient = DeliveryClient.usingTransport(fake.transport, { pageSize: 7 });

    expect(defaultClient).toMatchObject({ pageSize: 100 });
    expect(configuredClient).toMatchObject({ pageSize: 7 });
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(configuredClient),
      "pageSize",
    );
    expect(typeof descriptor?.get).toBe("function");
    expect(typeof descriptor?.set).toBe("undefined");
    expect(() => DeliveryClient.usingTransport(fake.transport, { pageSize: 0 })).toThrow();
    expect(() => DeliveryClient.usingTransport(fake.transport, { pageSize: 1_001 })).toThrow();
    expect(fake.unary).not.toHaveBeenCalled();
    expect("usingRpc" in DeliveryClient).toBe(false);
  });

  it("connects with the public Node gRPC transport and rejects an invalid URL", () => {
    expect(() => DeliveryClient.connectTo("not-a-url")).toThrow("Delivery client base URL");
  });

  it("maps an absent FindOne request, honours cancellation and closes without owning transport", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const id = { value: "message-1", shard: ShardIndex.single() };

    await expect(client.findOne(id)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "FindOne" }),
      expect.anything(),
      30_000,
      undefined,
      expect.anything(),
    );
    await expect(client.findOne(id, { timeoutMs: 17 })).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FindOne" }),
      expect.anything(),
      17,
      undefined,
      create(InboxMessageIdSchema, {
        uuid: "message-1",
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
      }),
    );
    await expect(client.findOne({ value: "", shard: ShardIndex.single() })).rejects.toThrow();
    await expect(client.findOne({ value: "message-1", shard: {} as ShardIndex })).rejects.toThrow();
    await expect(client.findOne(id, { timeoutMs: 0 })).rejects.toThrow();

    const aborted = new AbortController();
    aborted.abort(new Error("stopped"));
    await expect(client.findOne(id, { signal: aborted.signal })).rejects.toThrow("stopped");
    expect(fake.unary).toHaveBeenCalledTimes(2);

    client.close();
    client.close();
    await expect(client.findOne(id)).rejects.toThrow("Delivery client is closed.");
    expect(fake.closed).toBe(false);
  });

  it("decodes a present command and event into frozen domain inbox messages", async () => {
    const fake = transport();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command") }));
    const client = DeliveryClient.usingTransport(fake.transport);
    const id = { value: "message-1", shard: ShardIndex.single() };

    const command = await client.findOne(id);
    expect(command).toMatchObject({ label: "HANDLE_COMMAND", status: "TO_DELIVER", version: 2n });
    expect(command?.signal?.typeUrl).toBe("type.spine.io/spine.core.Command");
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command?.id)).toBe(true);

    fake.reply(create(OptionalInboxMessageSchema, { message: message("event") }));
    const event = await client.findOne(id);
    expect(event?.signal?.typeUrl).toBe("type.spine.io/spine.core.Event");
  });

  it("requests and decodes the first ordered frozen page", async () => {
    const fake = transport();
    fake.reply(
      create(PageOfMessagesSchema, { message: [message("command", "a"), message("event", "b")] }),
    );
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 2 });

    const page = await client.readPage(ShardIndex.single());

    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "FindManyInShard" }),
      expect.anything(),
      30_000,
      undefined,
      create(ReadMessagesSinceTimeSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        pageSize: 2,
      }),
    );
    expect(page.map((value) => value.id.value)).toEqual(["a", "b"]);
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("rejects a page response larger than the requested bound", async () => {
    const fake = transport();
    fake.reply(
      create(PageOfMessagesSchema, {
        message: [message("command", "a"), message("event", "b")],
      }),
    );

    await expect(
      DeliveryClient.usingTransport(fake.transport, { pageSize: 1 }).readPage(ShardIndex.single()),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
  });

  it("rejects malformed wire messages with a sanitized protocol error", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    for (const bad of [
      create(InboxMessageSchema),
      create(InboxMessageSchema, { ...message("command"), version: -1 }),
      create(InboxMessageSchema, { ...message("command"), payload: { case: undefined } }),
      create(InboxMessageSchema, {
        ...message("command"),
        id: create(InboxMessageIdSchema, {
          uuid: "a",
          index: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
        }),
      }),
    ]) {
      fake.reply(create(OptionalInboxMessageSchema, { message: bad }));
      await expect(
        client.findOne({ value: "a", shard: ShardIndex.single() }),
      ).rejects.toMatchObject({
        name: "DeliveryProtocolError",
      });
    }
  });

  it("bounds payloads and retries only transport reads exactly as configured", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, {
      readRetries: 2,
      retryBackoffMs: 0,
    });
    fake.fail(new Error("transport down"));
    fake.fail(new Error("transport down"));
    fake.reply(create(OptionalInboxMessageSchema));
    await expect(
      client.findOne({ value: "a", shard: ShardIndex.single() }),
    ).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(3);

    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "a", 1_048_577) }));
    await expect(client.findOne({ value: "a", shard: ShardIndex.single() })).rejects.toMatchObject({
      name: "DeliveryProtocolError",
    });
    expect(fake.unary).toHaveBeenCalledTimes(4);
    expect(() => DeliveryClient.usingTransport(fake.transport, { readRetries: 6 })).toThrow();
    expect(() =>
      DeliveryClient.usingTransport(fake.transport, { retryBackoffMs: 10_001 }),
    ).toThrow();
  });

  it("does not retry local validation or protocol decoding", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    await expect(client.findOne({ value: "", shard: ShardIndex.single() })).rejects.toThrow(
      TypeError,
    );
    expect(fake.unary).not.toHaveBeenCalled();
    fake.reply(create(OptionalInboxMessageSchema, { message: create(InboxMessageSchema) }));
    await expect(client.findOne({ value: "a", shard: ShardIndex.single() })).rejects.toMatchObject({
      name: "DeliveryProtocolError",
    });
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("cancels retry backoff without another RPC", async () => {
    vi.useFakeTimers();
    try {
      const fake = transport();
      const client = DeliveryClient.usingTransport(fake.transport, {
        readRetries: 5,
        retryBackoffMs: 100,
      });
      const controller = new AbortController();
      fake.fail(new Error("transport down"));
      const pending = client.findOne(
        { value: "a", shard: ShardIndex.single() },
        { signal: controller.signal },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort(new Error("caller stopped"));
      await expect(pending).rejects.toThrow("caller stopped");
      expect(vi.getTimerCount()).toBe(0);
      expect(fake.unary).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close cancels retry backoff and rejects later reads", async () => {
    vi.useFakeTimers();
    try {
      const fake = transport();
      const client = DeliveryClient.usingTransport(fake.transport, {
        readRetries: 5,
        retryBackoffMs: 100,
      });
      fake.fail(new Error("transport down"));
      const pending = client.findOne({ value: "a", shard: ShardIndex.single() });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      client.close();
      await expect(pending).rejects.toThrow("Delivery client is closed.");
      expect(vi.getTimerCount()).toBe(0);
      expect(fake.unary).toHaveBeenCalledTimes(1);
      await expect(client.findOne({ value: "a", shard: ShardIndex.single() })).rejects.toThrow(
        "Delivery client is closed.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the newest pending message with the safe-read retry policy", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 1 });
    fake.fail(new Error("temporary transport failure"));
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "pending") }));

    await expect(client.newestPending(ShardIndex.single())).resolves.toMatchObject({
      id: { value: "pending" },
    });
    expect(fake.unary).toHaveBeenCalledTimes(2);
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "NewestMessageToDeliver" }),
      expect.anything(),
      30_000,
      undefined,
      create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
    );
  });

  it("writes and removes one message exactly once without safe-read retries", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const value = domainMessage();
    fake.reply(create(EmptySchema));
    await expect(client.writeOne(value)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "WriteOne" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
      expect.anything(),
    );

    fake.reply(create(EmptySchema));
    await expect(client.removeOne(value, { timeoutMs: 19 })).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "RemoveOne" }),
      expect.any(AbortSignal),
      19,
      undefined,
      expect.anything(),
    );
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("rejects pre-aborted mutations before any RPC", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const controller = new AbortController();
    controller.abort(new Error("caller stopped"));

    await expect(client.writeOne(domainMessage(), { signal: controller.signal })).rejects.toThrow(
      "caller stopped",
    );
    await expect(client.removeOne(domainMessage(), { signal: controller.signal })).rejects.toThrow(
      "caller stopped",
    );
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("closes an admitted mutation as an unknown outcome", async () => {
    let started!: () => void;
    const admitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pendingTransport: Transport = {
      unary: async (_method, signal) => {
        started();
        await new Promise<void>((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error ? signal.reason : new Error("Mutation aborted."),
              );
            },
            { once: true },
          ),
        );
        throw new Error("unreachable");
      },
      stream: async () => {
        await Promise.resolve();
        throw new Error("not used");
      },
    };
    const client = DeliveryClient.usingTransport(pendingTransport);
    const mutation = client.writeOne(domainMessage());
    await admitted;
    client.close();

    await expect(mutation).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
  });

  it("reports ambiguous mutation outcomes without payload diagnostics or retry", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const value = domainMessage("sensitive-id");
    fake.fail(new Error("deadline exceeded: secret-payload"));

    try {
      await client.writeOne(value);
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryOutcomeUnknownError);
      expect(error).toMatchObject({
        operation: "WRITE_ONE",
        reconciliation: { kind: "FIND_MESSAGE", messageIds: ["sensitive-id"] },
      });
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("secret-payload");
      expect(Object.isFrozen((error as DeliveryOutcomeUnknownError).reconciliation)).toBe(true);
      const reconciliation = (error as DeliveryOutcomeUnknownError).reconciliation;
      if (reconciliation.kind !== "FIND_MESSAGE")
        throw new Error("Expected message reconciliation.");
      expect(Object.isFrozen(reconciliation.messageIds)).toBe(true);
    }
    expect(fake.unary).toHaveBeenCalledTimes(1);

    fake.fail(new Error("cancelled after write"));
    const controller = new AbortController();
    const pending = client.removeOne(value, { signal: controller.signal });
    controller.abort(new Error("caller cancellation"));
    await expect(pending).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("keeps definite server validation errors distinguishable and sanitized", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    fake.fail(new ConnectError("invalid request: secret-payload", Code.InvalidArgument));

    await expect(client.writeOne(domainMessage())).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("writes and removes ordered same-shard batches with exactly one RPC", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const messages = [domainMessage("first"), domainMessage("second")];

    fake.reply(create(EmptySchema));
    await expect(client.writeMany(messages)).resolves.toBeUndefined();
    const write = fake.unary.mock.lastCall;
    if (write === undefined) throw new Error("WriteMany RPC was not called.");
    expect(write.slice(0, 4)).toEqual([
      expect.objectContaining({ name: "WriteMany" }),
      expect.any(AbortSignal),
      30_000,
      undefined,
    ]);

    fake.reply(create(EmptySchema));
    await expect(client.removeMany(messages, { timeoutMs: 23 })).resolves.toBeUndefined();
    const remove = fake.unary.mock.lastCall;
    if (remove === undefined) throw new Error("RemoveMany RPC was not called.");
    expect(remove.slice(0, 4)).toEqual([
      expect.objectContaining({ name: "RemoveMany" }),
      expect.any(AbortSignal),
      23,
      undefined,
    ]);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid batches before RPC", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const one = domainMessage("one");
    const anotherShard = {
      ...domainMessage("two"),
      id: { value: "two", shard: new ShardIndex(1, 2) },
      shard: new ShardIndex(1, 2),
    };
    const aborted = new AbortController();
    aborted.abort(new Error("caller stopped"));

    for (const invalid of [
      [],
      [one, domainMessage("one")],
      [one, anotherShard],
      [{ ...one, signalId: "" }],
      Array.from({ length: MAX_DELIVERY_BATCH_MESSAGES + 1 }, (_, index) =>
        domainMessage(`id-${String(index)}`),
      ),
    ]) {
      await expect(client.writeMany(invalid)).rejects.toThrow();
      await expect(client.removeMany(invalid)).rejects.toThrow();
    }
    await expect(client.writeMany([one], { timeoutMs: 0 })).rejects.toThrow();
    await expect(client.removeMany([one], { signal: aborted.signal })).rejects.toThrow(
      "caller stopped",
    );
    client.close();
    await expect(client.writeMany([one])).rejects.toThrow("Delivery client is closed.");
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("reports each ambiguous batch outcome without payload leakage or retry", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const messages = [domainMessage("sensitive-first"), domainMessage("sensitive-second")];
    fake.fail(new Error("dropped response: secret-payload"));

    try {
      await client.writeMany(messages);
    } catch (error) {
      expect(error).toMatchObject({
        operation: "WRITE_MANY",
        reconciliation: {
          kind: "FIND_MESSAGE",
          messageIds: ["sensitive-first", "sensitive-second"],
        },
      });
      const unknown = error as DeliveryOutcomeUnknownError;
      expect(Object.isFrozen(unknown.reconciliation)).toBe(true);
      if (unknown.reconciliation.kind !== "FIND_MESSAGE") {
        throw new Error("Expected message reconciliation.");
      }
      expect(Object.isFrozen(unknown.reconciliation.messageIds)).toBe(true);
      expect(String(error)).not.toContain("secret-payload");
    }
    expect(fake.unary).toHaveBeenCalledTimes(1);

    fake.fail(new Error("timeout: secret-payload"));
    try {
      await client.removeMany(messages);
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryOutcomeUnknownError);
      const unknown = error as DeliveryOutcomeUnknownError;
      expect(unknown.operation).toBe("REMOVE_MANY");
      expect(Object.isFrozen(unknown.reconciliation)).toBe(true);
      if (unknown.reconciliation.kind !== "FIND_MESSAGE") {
        throw new Error("Expected message reconciliation.");
      }
      expect(Object.isFrozen(unknown.reconciliation.messageIds)).toBe(true);
      expect(String(error)).not.toContain("secret-payload");
    }
    expect(fake.unary).toHaveBeenCalledTimes(2);

    fake.fail(new ConnectError("cancelled: secret-payload", Code.Canceled));
    await expect(
      client.removeMany(messages, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      operation: "REMOVE_MANY",
    });
    expect(fake.unary).toHaveBeenCalledTimes(3);
  });

  it("keeps definite batch server validation errors distinguishable", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    fake.fail(new ConnectError("invalid batch: secret-payload", Code.InvalidArgument));

    await expect(client.writeMany([domainMessage()])).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("validates optional payload, shard, identifiers, labels, statuses, and dates before RPC", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const value = domainMessage();
    const invalid = [
      { ...value, shard: new ShardIndex(0, 2) },
      { ...value, id: { ...value.id, value: " " } },
      { ...value, signalId: " " },
      { ...value, inboxId: { ...value.inboxId, targetId: " " } },
      { ...value, label: "UNKNOWN" as never },
      { ...value, status: "UNKNOWN" as never },
      { ...value, whenReceived: new Date("invalid") },
      { ...value, version: -1n },
    ];
    for (const message of invalid)
      await expect(client.writeOne(message)).rejects.toThrow(TypeError);
    fake.reply(create(EmptySchema));
    const { signal: _signal, ...withoutSignal } = value;
    void _signal;
    await expect(client.writeOne(withoutSignal)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("returns no newest message and encodes a timestamp-bounded page request", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    fake.reply(create(OptionalInboxMessageSchema));
    await expect(client.newestPending(ShardIndex.single())).resolves.toBeUndefined();
    fake.reply(create(PageOfMessagesSchema));
    await expect(
      client.readPage(ShardIndex.single(), { sinceWhen: new Date(-1), pageSize: 1 }),
    ).resolves.toEqual([]);
    expect(fake.unary).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "FindManyInShard" }),
      expect.anything(),
      30_000,
      undefined,
      create(ReadMessagesSinceTimeSchema, {
        shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        pageSize: 1,
        sinceWhen: { seconds: -1n, nanos: 999_000_000 },
      }),
    );
  });

  it("preserves exhausted page reads without retrying and sanitizes other statuses", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 5 });
    const exhausted = new ConnectError("request a smaller page", Code.ResourceExhausted);
    fake.fail(exhausted);
    await expect(client.readPage(ShardIndex.single())).rejects.toBe(exhausted);

    fake.fail(new ConnectError("not retryable", Code.Unknown));
    await expect(
      client.findOne({ value: "protocol-end", shard: ShardIndex.single() }),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("encodes a present optional delivery deadline without an optional payload", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const { signal: _signal, ...withoutSignal } = domainMessage("deadline");
    void _signal;
    fake.reply(create(EmptySchema));

    await expect(
      client.writeOne({ ...withoutSignal, keepUntil: new Date(2_000) }),
    ).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported public connection URL schemes and paths before a session opens", () => {
    for (const baseUrl of ["ftp://localhost", "https://localhost/delivery", 42 as never])
      expect(() => DeliveryClient.connectTo(baseUrl)).toThrow("Delivery client base URL");
  });
});
