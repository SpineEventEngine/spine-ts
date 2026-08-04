import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { DeliveryBuilder, ShardIndex } from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "../../storage/src/index.js";
import {
  LiquorPickUpOutcomeSchema,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
  ShardAlreadyPickedUpSchema,
  ShardPickedUpSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { describe, expect, it } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  RemoteInbox,
  RemoteWorkRegistry,
} from "../src/index.js";
import { domainMessage, echoPickup, message, quarantine, transport } from "./shared-fixtures.js";

describe("RemoteInbox and remote work adapters", () => {
  it("adapts an exact remote inbox snapshot and reconciles an unknown removal without replay", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const inbox = new RemoteInbox(client, quarantine());
    const session = Object.freeze({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });

    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "remote-work") }));
    const value = await client.findOne({ value: "remote-work", shard: ShardIndex.single() });
    expect(value).toBeDefined();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "remote-work") }));
    if (value === undefined) throw new Error("Remote message was not found.");
    const work = await inbox.begin(value, session);
    expect(work?.message.id.value).toBe("remote-work");
    fake.fail(new Error("response lost"));
    await expect(work?.complete()).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);

    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "remote-work") }));
    fake.reply(create(EmptySchema));
    await expect(inbox.begin(value, session)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(5);
  });

  it("fails closed at a timestamp-tied remote page boundary and quarantines unknown shard release", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 2 });
    const inbox = new RemoteInbox(client, quarantine());
    fake.reply(
      create(PageOfMessagesSchema, { message: [message("command", "a"), message("command", "b")] }),
    );
    await expect(inbox.read(ShardIndex.single())).rejects.toBeInstanceOf(DeliveryPagingError);

    const registry = new RemoteWorkRegistry(client);
    echoPickup(fake);
    const session = await registry.pickUp(ShardIndex.single(), "node");
    fake.fail(new Error("response lost"));
    if (session === undefined) throw new Error("Shard session was not acquired.");
    await expect(registry.release(session)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    registry.reconcile(
      Object.freeze({ shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 }),
    );
  });

  it("quarantines a shard before release dispatch and retains it when the release outcome is lost", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    echoPickup(fake);
    const session = await registry.pickUp(ShardIndex.single(), "node");
    if (session === undefined) throw new Error("Remote session was not acquired.");
    let rejectRelease: ((error: Error) => void) | undefined;
    const pendingRelease = new Promise<void>((_resolve, reject) => {
      rejectRelease = reject;
    });
    fake.unary.mockReturnValueOnce(pendingRelease);
    fake.replyPickup();

    const release = registry.release(session);
    registry.reconcile(
      Object.freeze({ shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 }),
    );
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
    rejectRelease?.(new Error("release response lost"));
    await expect(release).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
    registry.reconcile(
      Object.freeze({ shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 }),
    );

    fake.replyPickup();
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toMatchObject({
      kind: "EXCLUSIVE",
    });
  });

  it("clears a held release guard only after a successful release settles", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    echoPickup(fake);
    const session = await registry.pickUp(ShardIndex.single(), "node");
    if (session === undefined) throw new Error("Remote session was not acquired.");
    let resolveRelease: (() => void) | undefined;
    fake.unary.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRelease = resolve;
      }),
    );
    fake.replyPickup();

    const release = registry.release(session);
    registry.reconcile(
      Object.freeze({ shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 }),
    );
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
    resolveRelease?.();
    await expect(release).resolves.toBe(true);

    fake.replyPickup();
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toMatchObject({
      kind: "EXCLUSIVE",
    });
  });

  it("quarantines an unknown pickup and rejects a timestamp continuation absent from its page", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 2 });
    const registry = new RemoteWorkRegistry(client);
    fake.fail(new Error("lost pickup"));
    await expect(registry.pickUp(ShardIndex.single(), "node")).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();

    const inbox = new RemoteInbox(client, quarantine());
    fake.reply(create(PageOfMessagesSchema, { message: [message("command", "later")] }));
    await expect(
      inbox.read(ShardIndex.single(), {
        after: { messageId: "missing", whenReceived: new Date(1_000), version: 2n },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
  });

  it("preserves optional delivery fields and every supported wire label and status", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const labels = [InboxLabel.UPDATE_SUBSCRIBER, InboxLabel.REACT_UPON_EVENT, InboxLabel.CATCH_UP];
    const statuses = [
      InboxMessageStatus.SCHEDULED,
      InboxMessageStatus.DELIVERED,
      InboxMessageStatus.TO_CATCH_UP,
    ];

    for (const [index, label] of labels.entries()) {
      fake.reply(
        create(OptionalInboxMessageSchema, {
          message: create(InboxMessageSchema, {
            ...message(index === 1 ? "event" : "command", `optional-${String(index)}`),
            label,
            status: statuses[index] as never,
            keepUntil: { seconds: 3n, nanos: 0 } as never,
          }),
        }),
      );
      await expect(
        client.findOne({ value: `optional-${String(index)}`, shard: ShardIndex.single() }),
      ).resolves.toMatchObject({
        label: ["UPDATE_SUBSCRIBER", "REACT_UPON_EVENT", "CATCH_UP"][index],
        status: ["SCHEDULED", "DELIVERED", "TO_CATCH_UP"][index],
        keepUntil: new Date(3_000),
      });
    }
  });

  it("filters a remote page and rejects unsupported continuation offsets before reading", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 3 });
    const inbox = new RemoteInbox(client, quarantine());
    fake.reply(
      create(PageOfMessagesSchema, {
        message: [
          message("command", "pending"),
          create(InboxMessageSchema, {
            ...message("command", "delivered"),
            status: InboxMessageStatus.DELIVERED,
          }),
        ],
      }),
    );

    await expect(
      inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ id: { value: "pending" } }]);
    await expect(inbox.read(ShardIndex.single(), { offset: 1 })).rejects.toBeInstanceOf(
      DeliveryPagingError,
    );
    expect(fake.unary).toHaveBeenCalledTimes(1);
  });

  it("keeps remote work exclusive and fails closed on invalid synchronization", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const inbox = new RemoteInbox(client, quarantine());
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "lifecycle") }));
    const value = await client.findOne({ value: "lifecycle", shard: ShardIndex.single() });
    const exclusive = Object.freeze({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });
    if (value === undefined) throw new Error("Remote message was not found.");

    await expect(
      inbox.begin(value, { kind: "LEASED", shard: ShardIndex.single() } as never),
    ).resolves.toBeUndefined();
    await expect(
      inbox.begin(value, { kind: "EXCLUSIVE", shard: new ShardIndex(0, 2) }),
    ).resolves.toBeUndefined();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "lifecycle") }));
    const work = await inbox.begin(value, exclusive);
    if (work === undefined) throw new Error("Remote work was not created.");
    const exposed = work.message;
    exposed.whenReceived.setTime(9_999);
    exposed.signal?.value.fill(7);
    expect(work.message.whenReceived.getTime()).toBe(1_000);
    expect(Array.from(work.message.signal?.value ?? [])).not.toEqual(
      Array.from(exposed.signal?.value ?? []),
    );
    await expect(
      work.synchronize({ kind: "LEASED", shard: ShardIndex.single() } as never),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
    fake.reply(create(EmptySchema));
    await expect(work.complete()).resolves.toBe(true);
    expect(() => work.message).toThrow(DeliveryProtocolError);
    await expect(work.complete()).resolves.toBe(false);
    await expect(work.abandon()).resolves.toBeUndefined();
  });

  it("reconciles a quarantined remote pickup only after a valid shard observation", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    fake.fail(new Error("pickup outcome lost"));
    await expect(registry.pickUp(ShardIndex.single(), "node")).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
    expect(() => {
      registry.reconcile({ shard: {} as ShardIndex, status: "PICKED", messages: -1 });
    }).toThrow(DeliveryProtocolError);
    registry.reconcile(
      Object.freeze({ shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 }),
    );
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "alreadyPickedUp",
          value: create(ShardAlreadyPickedUpSchema, {
            worker: create(WorkerIdSchema, { nodeId: { value: "other" }, value: "other" }),
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      }),
    );
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    await expect(
      registry.release({ kind: "LEASED", shard: ShardIndex.single() } as never),
    ).resolves.toBe(false);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("writes a generated remote inbox message and treats a vanished admitted message as complete", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const inbox = new RemoteInbox(client, quarantine());
    const input = domainMessage("generated");
    fake.reply(create(EmptySchema));

    const received = await inbox.receive({
      inboxId: input.inboxId,
      signalId: input.signalId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      label: input.label,
      status: input.status,
      shard: input.shard,
      whenReceived: input.whenReceived,
      version: input.version,
    });
    expect(received).toMatchObject({ outcome: "WRITTEN" });
    expect(received.message.id.value).not.toBe("generated");
    expect(Object.isFrozen(received.message)).toBe(true);

    const session = Object.freeze({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });
    await expect(inbox.begin(received.message, session)).resolves.toBeUndefined();
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("continues a filtered remote page only after its exact timestamp cursor", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 3 });
    const inbox = new RemoteInbox(client, quarantine());
    fake.reply(
      create(PageOfMessagesSchema, {
        message: [message("command", "before"), message("command", "after")],
      }),
    );

    await expect(
      inbox.read(ShardIndex.single(), {
        after: { messageId: "before", whenReceived: new Date(1_000), version: 2n },
      }),
    ).resolves.toMatchObject([{ id: { value: "after" } }]);
    const request = fake.unary.mock.calls[0]?.[4] as {
      sinceWhen?: { seconds: bigint; nanos: number };
    };
    expect(request.sinceWhen).toMatchObject({ seconds: 0n, nanos: 999_000_000 });
  });

  it("rejects a minimum-Protobuf-timestamp continuation before issuing an RPC", async () => {
    const fake = transport();
    const inbox = new RemoteInbox(DeliveryClient.usingTransport(fake.transport), quarantine());
    await expect(
      inbox.read(ShardIndex.single(), {
        after: { messageId: "anchor", whenReceived: new Date(-62_135_596_800_000), version: 1n },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("rejects invalid observed release timestamps without clearing a quarantined remote shard", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    fake.fail(new Error("pickup outcome lost"));
    await expect(registry.pickUp(ShardIndex.single(), "node")).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );

    expect(() => {
      registry.reconcile({
        shard: ShardIndex.single(),
        status: "PICKED",
        messages: 0,
        lastPicked: new Date("invalid"),
      });
    }).toThrow(DeliveryProtocolError);
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
  });

  it("uses remote ports through DeliveryBuilder without renewal or callback replay", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const inbox = new RemoteInbox(client, quarantine());
    const registry = new RemoteWorkRegistry(client);
    const builder = () =>
      new DeliveryBuilder()
        .withStorageFactory(
          new InMemoryStorageFactory() as unknown as Parameters<
            DeliveryBuilder["withStorageFactory"]
          >[0],
        )
        .withNode("node")
        .withInbox(inbox)
        .withWorkRegistry(registry)
        .withPageSize(1)
        .build();
    const pickup = () => {
      fake.replyPickup();
    };

    fake.reply(create(PageOfMessagesSchema, { message: [message("command", "builder")] }));
    pickup();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "builder") }));
    fake.reply(create(EmptySchema));
    fake.reply(create(EmptySchema));
    let callbacks = 0;
    await builder().run({
      onMessage: () => {
        callbacks += 1;
      },
    });
    expect(callbacks).toBe(1);
    expect(fake.unary).toHaveBeenCalledTimes(5);

    fake.reply(
      create(PageOfMessagesSchema, {
        message: [{ ...message("command", "terminal"), status: InboxMessageStatus.DELIVERED }],
      }),
    );
    pickup();
    fake.reply(create(EmptySchema));
    await builder().run({
      onMessage: () => {
        callbacks += 1;
      },
    });
    expect(callbacks).toBe(1);

    fake.reply(create(PageOfMessagesSchema, { message: [message("command", "unknown")] }));
    pickup();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "unknown") }));
    fake.fail(new Error("lost remove"));
    fake.reply(create(EmptySchema));
    await builder().run({
      onMessage: () => {
        callbacks += 1;
      },
    });
    fake.reply(create(PageOfMessagesSchema, { message: [message("command", "unknown")] }));
    pickup();
    fake.reply(create(OptionalInboxMessageSchema, { message: message("command", "unknown") }));
    fake.reply(create(EmptySchema));
    fake.reply(create(EmptySchema));
    await builder().run({
      onMessage: () => {
        callbacks += 1;
      },
    });
    expect(callbacks).toBe(2);
  });
});
