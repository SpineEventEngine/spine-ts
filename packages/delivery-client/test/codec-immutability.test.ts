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

import { create, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { ShardIndex } from "@spine-event-engine/server";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxLabel,
  InboxMessageStatus,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";
import { describe, expect, it } from "vitest";
import {
  DeliveryClient,
  DeliveryPagingError,
  DeliveryProtocolError,
  RemoteInbox,
} from "../src/index.js";
import {
  DeliveryMessageCodec,
  DeliveryRequestCodec,
  DeliveryShardCodec,
} from "../src/wire/codec.js";
import { domainMessage, message, stringTarget, transport } from "./shared-fixtures.js";
import { TaskCreatedSchema } from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";
import { TaskSchema } from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

describe("delivery codec and immutable snapshots", () => {
  it("preserves microsecond receive time through delivery wire encoding", () => {
    const whenReceived = create(TimestampSchema, { seconds: 1n, nanos: 123_456_000 });
    const source = { ...domainMessage(), whenReceived };
    const wire = DeliveryMessageCodec.encode(source);
    expect(wire.whenReceived).toEqual(whenReceived);
    expect(DeliveryMessageCodec.decode(wire, ShardIndex.single()).whenReceived).toEqual(
      whenReceived,
    );
  });

  it("opens a remote inbox without retained removal state", () => {
    const client = DeliveryClient.usingTransport(transport().transport);

    expect(new RemoteInbox(client)).toBeInstanceOf(RemoteInbox);
  });

  it("writes, pages, and directly removes only an exact pending remote row", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 2 });
    const inbox = new RemoteInbox(client);
    const source = domainMessage();

    fake.reply(create(EmptySchema));
    await expect(inbox.receive(source)).resolves.toMatchObject({ outcome: "WRITTEN" });
    fake.reply(create(PageOfMessagesSchema, { message: [DeliveryMessageCodec.encode(source)] }));
    await expect(inbox.read(ShardIndex.single())).resolves.toHaveLength(1);
    await expect(inbox.read(ShardIndex.single(), { offset: 1 })).rejects.toBeInstanceOf(
      DeliveryPagingError,
    );

    const currentWire = DeliveryMessageCodec.encode({
      ...source,
      id: { ...source.id, value: "work" },
    });
    fake.reply(create(OptionalInboxMessageSchema, { message: currentWire }));
    const current = await client.findOne({ value: "work", shard: ShardIndex.single() });
    if (current === undefined) throw new Error("Expected remote message.");
    fake.reply(create(OptionalInboxMessageSchema, { message: currentWire }));
    fake.reply(create(EmptySchema));
    await expect(inbox.markDelivered(current)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("cleans only expired delivered rows and pending duplicates by exact remote ID", async () => {
    const fake = transport();
    const inbox = new RemoteInbox(DeliveryClient.usingTransport(fake.transport));
    const pending = domainMessage("pending-duplicate");
    const delivered = { ...pending, status: "DELIVERED" as const };

    await expect(inbox.removeDelivered(pending)).resolves.toBe(false);
    await expect(
      inbox.removeDelivered({ ...delivered, keepUntil: new Date(8_640_000_000_000) }),
    ).resolves.toBe(false);
    expect(fake.unary).not.toHaveBeenCalled();

    fake.reply(create(EmptySchema));
    await expect(inbox.removeDelivered({ ...delivered, keepUntil: new Date(0) })).resolves.toBe(
      true,
    );
    await expect(inbox.removeDuplicate(delivered)).resolves.toBe(false);
    fake.reply(create(EmptySchema));
    await expect(inbox.removeDuplicate(pending)).resolves.toBe(true);
    expect(fake.unary).toHaveBeenCalledTimes(2);
    expect(
      fake.unary.mock.calls.map(
        (call) => (call[4] as { message?: { id?: { uuid?: string } } }).message?.id?.uuid,
      ),
    ).toEqual([pending.id.value, pending.id.value]);
  });

  it("validates an empty-filter read cursor and caller cancellation before remote I/O", async () => {
    const fake = transport();
    const inbox = new RemoteInbox(DeliveryClient.usingTransport(fake.transport));
    await expect(inbox.read(ShardIndex.single(), { statuses: [] })).resolves.toEqual([]);
    await expect(
      inbox.read(ShardIndex.single(), {
        statuses: [],
        after: {
          messageId: " ",
          whenReceived: create(TimestampSchema, { seconds: 1n }),
          version: 1n,
        },
      }),
    ).rejects.toThrow("cursor is invalid");
    const cancelled = new AbortController();
    cancelled.abort(new Error("caller stopped"));
    await expect(inbox.read(ShardIndex.single(), { signal: cancelled.signal })).rejects.toThrow(
      "caller stopped",
    );
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("stops a collected remote read when its monotonic budget expires before a page", async () => {
    const fake = transport();
    const inbox = new RemoteInbox(DeliveryClient.usingTransport(fake.transport));
    let reads = 0;
    const previous = Time.setProvider({
      currentTime: () => create(TimestampSchema),
      monotonicTime: () => (reads++ === 0 ? 0 : 10),
    });
    try {
      await expect(inbox.read(ShardIndex.single(), { timeoutMs: 1 })).rejects.toThrow(
        "read timed out",
      );
      expect(fake.unary).not.toHaveBeenCalled();
    } finally {
      Time.setProvider(previous);
    }
  });

  it("keeps malformed wire-message decoding on the public protocol-error identity", () => {
    const wire = create(InboxMessageSchema, {
      ...message("command"),
      id: create(InboxMessageIdSchema, {
        uuid: "message-1",
        index: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
      }),
    });

    expect(() => DeliveryMessageCodec.decode(wire, ShardIndex.single())).toThrow(
      DeliveryProtocolError,
    );
  });

  it("rejects unknown inbox label and status values from a remote peer", () => {
    const valid = message("command");
    expect(() =>
      DeliveryMessageCodec.decode(
        create(InboxMessageSchema, { ...valid, label: 99 as InboxLabel }),
        ShardIndex.single(),
      ),
    ).toThrow(DeliveryProtocolError);
    expect(() =>
      DeliveryMessageCodec.decode(
        create(InboxMessageSchema, { ...valid, status: 99 as InboxMessageStatus }),
        ShardIndex.single(),
      ),
    ).toThrow(DeliveryProtocolError);
  });

  it("uses the declared wire values for every remote label and delivery status", () => {
    const command = domainMessage();
    const taskId = create(TaskIdSchema, { value: "task-1" });
    const taskListId = create(TaskListIdSchema, { value: "list-1" });
    const eventId = create(EventIdSchema, { value: "event-1" });
    const event = create(EventSchema, {
      id: eventId,
      context: create(EventContextSchema, {
        producerId: AnyPacker.pack(TaskIdSchema, taskId),
        version: create(VersionSchema, { number: 1 }),
      }),
      message: AnyPacker.pack(
        TaskCreatedSchema,
        create(TaskCreatedSchema, { id: taskId, taskListId, title: "Task 1" }),
      ),
    });
    const labels = [
      ["HANDLE_COMMAND", InboxLabel.HANDLE_COMMAND],
      ["UPDATE_SUBSCRIBER", InboxLabel.UPDATE_SUBSCRIBER],
      ["REACT_UPON_EVENT", InboxLabel.REACT_UPON_EVENT],
      ["CATCH_UP", InboxLabel.CATCH_UP],
    ] as const;
    const statuses = [
      ["TO_DELIVER", InboxMessageStatus.TO_DELIVER],
      ["SCHEDULED", InboxMessageStatus.SCHEDULED],
      ["DELIVERED", InboxMessageStatus.DELIVERED],
      ["TO_CATCH_UP", InboxMessageStatus.TO_CATCH_UP],
    ] as const;
    for (const [label, wireLabel] of labels) {
      for (const [status, wireStatus] of statuses) {
        const subscriber = label === "UPDATE_SUBSCRIBER" || label === "CATCH_UP";
        const row =
          label === "HANDLE_COMMAND"
            ? { ...command, status }
            : {
                ...command,
                label,
                status,
                signalId: eventId.value,
                signal: AnyPacker.pack(EventSchema, event),
                inboxId: {
                  targetId: subscriber
                    ? AnyPacker.pack(TaskListIdSchema, taskListId)
                    : AnyPacker.pack(TaskIdSchema, taskId),
                  targetTypeUrl: TypeUrls.derive(subscriber ? TaskListSchema : TaskSchema),
                },
              };
        const encoded = DeliveryMessageCodec.encode(row);
        expect(encoded.label).toBe(wireLabel);
        expect(encoded.status).toBe(wireStatus);
        const decoded = DeliveryMessageCodec.decode(
          create(InboxMessageSchema, { ...encoded, label: wireLabel, status: wireStatus }),
          ShardIndex.single(),
        );
        expect(decoded).toMatchObject({ label, status });
      }
    }
  });

  it("rejects malformed remote timestamps and worker identities", () => {
    for (const nanos of [-1, 1_000_000_000, 0.5]) {
      expect(() => DeliveryShardCodec.date({ seconds: 1n, nanos })).toThrow(DeliveryProtocolError);
    }
    expect(() => DeliveryShardCodec.date({ seconds: 9_007_199_254_741n, nanos: 0 })).toThrow(
      DeliveryProtocolError,
    );
    expect(() => DeliveryShardCodec.date({ seconds: 8_640_000_000_001n, nanos: 0 })).toThrow(
      DeliveryProtocolError,
    );
    for (const worker of [
      { value: "worker" },
      { nodeId: { value: " " }, value: "worker" },
      { nodeId: { value: "node" }, value: " " },
    ]) {
      expect(() => DeliveryShardCodec.decodeWorker(worker)).toThrow(DeliveryProtocolError);
    }
  });

  it("rejects an invalid local retention deadline before a remote write", () => {
    expect(() => DeliveryRequestCodec.expiry(new Date(Number.NaN))).toThrow(TypeError);
  });

  it("keeps remote pickup validation on protocol errors", () => {
    const worker = { nodeId: { value: "node" }, value: "worker" };
    const whenPicked = { seconds: 1n, nanos: 0 };
    expect(() => {
      DeliveryShardCodec.validatePicked({ whenPicked }, ShardIndex.single());
    }).toThrow(DeliveryProtocolError);
    expect(() => {
      DeliveryShardCodec.validatePicked({ worker }, ShardIndex.single());
    }).toThrow(DeliveryProtocolError);
    expect(() => {
      DeliveryShardCodec.validatePicked(
        { worker, whenPicked, shard: { index: 1, ofTotal: 2 } },
        ShardIndex.single(),
      );
    }).toThrow(DeliveryProtocolError);
  });

  it("bounds call options", () => {
    const signal = new AbortController().signal;
    expect(DeliveryRequestCodec.callOptions(undefined)).toEqual({});
    expect(DeliveryRequestCodec.callOptions(signal)).toEqual({ signal });
    expect(DeliveryRequestCodec.callOptions(undefined, 200)).toEqual({ timeoutMs: 200 });
    expect(DeliveryRequestCodec.callOptions(signal, 200)).toEqual({ timeoutMs: 200, signal });
  });

  it("accepts a response at the 4 MiB limit and rejects a larger response", () => {
    const within = create(StringValueSchema, { value: "a".repeat(4 * 1024 * 1024 - 5) });
    const oversized = create(StringValueSchema, { value: "a".repeat(4 * 1024 * 1024 - 4) });
    expect(toBinary(StringValueSchema, within)).toHaveLength(4 * 1024 * 1024);
    expect(toBinary(StringValueSchema, oversized)).toHaveLength(4 * 1024 * 1024 + 1);
    expect(() => {
      DeliveryRequestCodec.responseBytes(StringValueSchema, within);
    }).not.toThrow();
    expect(() => {
      DeliveryRequestCodec.responseBytes(StringValueSchema, oversized);
    }).toThrow(DeliveryProtocolError);
  });

  it("rejects a request that exceeds the delivery RPC byte limit", () => {
    const oversized = create(StringValueSchema, { value: "a".repeat(4 * 1024 * 1024) });
    expect(() => {
      DeliveryRequestCodec.requestBytes(StringValueSchema, oversized);
    }).toThrow("4 MiB");
  });

  it("isolates decoded receive timestamps and payload bytes from later caller mutation", () => {
    const wire = message("command");
    const first = DeliveryMessageCodec.decode(wire, ShardIndex.single());
    const second = DeliveryMessageCodec.decode(wire, ShardIndex.single());
    const expectedPayload = Array.from(second.signal?.value ?? []);

    if (first.whenReceived instanceof Date) throw new Error("Expected a precise timestamp.");
    first.whenReceived.nanos = 999_000_000;
    first.signal?.value.fill(7);

    expect(second.whenReceived).toEqual(create(TimestampSchema, { seconds: 1n }));
    expect(Array.from(second.signal?.value ?? [])).toEqual(expectedPayload);
  });

  it("detaches target identity bytes in every immutable snapshot", () => {
    const source = domainMessage();
    const first = DeliveryMessageCodec.snapshot(source);
    const second = DeliveryMessageCodec.snapshot(source);
    const expected = Array.from(second.inboxId.targetId.value);

    source.inboxId.targetId.value.fill(7);
    expect(Array.from(first.inboxId.targetId.value)).toEqual(expected);
    first.inboxId.targetId.value.fill(9);
    expect(Array.from(second.inboxId.targetId.value)).toEqual(expected);
  });

  it("round-trips zero-valued numeric target identities", () => {
    for (const [schema, typeUrl] of [
      [Int32ValueSchema, "type.googleapis.com/google.protobuf.Int32Value"],
      [Int64ValueSchema, "type.googleapis.com/google.protobuf.Int64Value"],
    ] as const) {
      const targetId = create(AnySchema, {
        typeUrl,
        value: toBinary(schema, create(schema)),
      });
      const source = domainMessage();
      const messageWithZero = { ...source, inboxId: { ...source.inboxId, targetId } };

      expect(
        DeliveryMessageCodec.decode(
          DeliveryMessageCodec.encode(messageWithZero),
          ShardIndex.single(),
        ).inboxId.targetId,
      ).toEqual(targetId);
    }
  });

  it("rejects blank string targets before remote persistence", () => {
    const source = domainMessage();
    expect(() =>
      DeliveryMessageCodec.encode({
        ...source,
        inboxId: { ...source.inboxId, targetId: stringTarget(" ") },
      }),
    ).toThrow(TypeError);
  });

  it("preserves plain framework target IDs across the frozen wire EntityId", () => {
    const source = domainMessage();
    const plain = {
      ...source,
      inboxId: { ...source.inboxId, targetId: stringTarget("message-1") },
    };

    const decoded = DeliveryMessageCodec.decode(
      DeliveryMessageCodec.encode(plain),
      ShardIndex.single(),
    );

    expect(decoded.inboxId).toEqual(plain.inboxId);
  });

  it("encodes packed-looking framework target IDs as explicit StringValue payloads", () => {
    const source = domainMessage();
    const targetId = "type.spine.io/test.EntityId:cm91dGluZy1rZXk=";
    const wire = DeliveryMessageCodec.encode({
      ...source,
      inboxId: { ...source.inboxId, targetId: stringTarget(targetId) },
    });

    expect(wire.inboxId?.entityId?.id?.typeUrl).toBe(
      "type.googleapis.com/google.protobuf.StringValue",
    );
    expect(DeliveryMessageCodec.decode(wire, ShardIndex.single()).inboxId.targetId).toEqual(
      stringTarget(targetId),
    );
  });

  it("normalizes malformed StringValue target bytes to the delivery protocol error", () => {
    expect(() => DeliveryMessageCodec.decodeTarget("", Uint8Array.of(1))).toThrow(
      DeliveryProtocolError,
    );
    expect(
      DeliveryMessageCodec.decodeTarget("type.spine.io/test.EntityId", new Uint8Array()),
    ).toEqual(create(AnySchema, { typeUrl: "type.spine.io/test.EntityId" }));
    expect(() =>
      DeliveryMessageCodec.decodeTarget(
        "type.googleapis.com/google.protobuf.StringValue",
        new Uint8Array([0xff]),
      ),
    ).toThrow(DeliveryProtocolError);
    expect(() =>
      DeliveryMessageCodec.decodeTarget(
        "type.googleapis.com/google.protobuf.StringValue",
        toBinary(StringValueSchema, create(StringValueSchema, { value: " " })),
      ),
    ).toThrow(DeliveryProtocolError);

    expect(
      DeliveryMessageCodec.decodeTarget(
        "type.spine.io/test.EntityId",
        toBinary(StringValueSchema, create(StringValueSchema, { value: "legacy" })),
      ),
    ).toEqual(
      create(AnySchema, {
        typeUrl: "type.spine.io/test.EntityId",
        value: toBinary(StringValueSchema, create(StringValueSchema, { value: "legacy" })),
      }),
    );
  });
});
