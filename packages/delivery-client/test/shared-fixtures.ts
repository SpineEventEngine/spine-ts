import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Transport } from "@connectrpc/connect";
import { type InboxMessage, ShardIndex } from "@spine-event-engine/server";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  LiquorPickUpOutcomeSchema,
  OptionalInboxMessageSchema,
  ShardPickedUpSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxIdSchema,
  InboxLabel,
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
  InboxSignalIdSchema,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";
import type { RemovalQuarantine, RemovalQuarantineRecord } from "../src/index.js";
import { vi } from "vitest";

export function transport(): {
  readonly transport: Transport;
  readonly unary: ReturnType<typeof vi.fn>;
  readonly stream: ReturnType<typeof vi.fn>;
  readonly streamStarted: number;
  readonly streamAborts: number;
  readonly streamFinished: number;
  reply(value: Message): void;
  replyPickup(): void;
  replyAndHold(value: Message): { release(): void };
  fail(error: Error): void;
  streamReply(values: readonly Message[]): void;
  streamReplyAndHold(values: readonly Message[]): void;
  closed: boolean;
} {
  const replies: (
    Message | Error | { readonly value: Message; readonly held: Promise<void> } | "PICKUP"
  )[] = [];
  const unary = vi.fn(async (...args: unknown[]) => {
    await Promise.resolve();
    const reply = replies.shift() ?? create(OptionalInboxMessageSchema);
    if (reply === "PICKUP") {
      const request = args[4] as { shard: unknown; worker: unknown };
      return create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "pickedUp",
          value: create(ShardPickedUpSchema, {
            shard: request.shard as never,
            worker: request.worker as never,
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      });
    }
    if (typeof reply === "object" && "held" in reply) {
      await reply.held;
      return reply.value;
    }
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const streams: (
    readonly Message[] | { readonly values: readonly Message[]; readonly hold: true }
  )[] = [];
  let streamAborts = 0;
  let streamFinished = 0;
  let streamStarted = 0;
  const stream = vi.fn(
    async (
      method: { parent: unknown },
      signal: AbortSignal | undefined,
      ..._ignored: unknown[]
    ) => {
      void _ignored;
      await Promise.resolve();
      streamStarted += 1;
      let terminated = false;
      const terminatedOnce = () => {
        if (terminated) return;
        terminated = true;
        streamAborts += 1;
        streamFinished += 1;
      };
      signal?.addEventListener("abort", terminatedOnce, { once: true });
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {
          const plan = streams.shift() ?? [];
          const values: readonly Message[] = Array.isArray(plan)
            ? (plan as readonly Message[])
            : (plan as { readonly values: readonly Message[] }).values;
          for (const value of values) {
            if (signal?.aborted) return;
            yield value;
          }
          if (!Array.isArray(plan))
            await new Promise<void>((resolve) => {
              if (signal?.aborted) resolve();
              else
                signal?.addEventListener(
                  "abort",
                  () => {
                    resolve();
                  },
                  { once: true },
                );
            });
        })(),
      };
    },
  );
  const fake = {
    closed: false,
    unary,
    stream,
    transport: {
      async unary(method, signal, timeoutMs, header, input) {
        return {
          stream: false,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: await unary(method, signal, timeoutMs, header, input),
        } as never;
      },
      async stream(method, signal, timeoutMs, header, input) {
        await Promise.resolve();
        return stream(method, signal, timeoutMs, header, input) as never;
      },
    } satisfies Transport,
  };
  const result = Object.assign(fake, {
    reply: (value: Message) => replies.push(value),
    replyPickup: () => replies.push("PICKUP"),
    replyAndHold: (value: Message) => {
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      replies.push({ value, held });
      return { release: () => release?.() };
    },
    fail: (error: Error) => replies.push(error),
    streamReply: (values: readonly Message[]) => streams.push(values),
    streamReplyAndHold: (values: readonly Message[]) => streams.push({ values, hold: true }),
  });
  Object.defineProperties(result, {
    streamStarted: { get: () => streamStarted },
    streamAborts: { get: () => streamAborts },
    streamFinished: { get: () => streamFinished },
  });
  return result as unknown as ReturnType<typeof transport>;
}

export function echoPickup(fake: ReturnType<typeof transport>): void {
  fake.unary.mockImplementationOnce(
    (_method: unknown, _signal: unknown, _timeoutMs: unknown, _header: unknown, input: unknown) => {
      const request = input as { shard: unknown; worker: unknown };
      return create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "pickedUp",
          value: create(ShardPickedUpSchema, {
            shard: request.shard as never,
            worker: request.worker as never,
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      });
    },
  );
}

export function message(kind: "command" | "event", id = "message-1", payloadBytes = 0) {
  const payload = new Uint8Array(payloadBytes);
  return create(InboxMessageSchema, {
    id: create(InboxMessageIdSchema, {
      uuid: id,
      index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
    }),
    signalId: create(InboxSignalIdSchema, { value: "signal-1" }),
    inboxId: create(InboxIdSchema, {
      entityId: { id: { typeUrl: "type.spine.io/test.EntityId", value: new Uint8Array() } },
      typeUrl: "type.spine.io/test.Entity",
    }),
    payload:
      kind === "command"
        ? {
            case: "command",
            value: create(CommandSchema, {
              message: { typeUrl: "type.spine.io/test.Command", value: payload },
            }),
          }
        : {
            case: "event",
            value: create(EventSchema, {
              message: { typeUrl: "type.spine.io/test.Event", value: payload },
            }),
          },
    label: kind === "command" ? InboxLabel.HANDLE_COMMAND : InboxLabel.REACT_UPON_EVENT,
    status: InboxMessageStatus.TO_DELIVER,
    whenReceived: { seconds: 1n, nanos: 0 },
    version: 2,
  });
}

export function domainMessage(id = "message-1"): InboxMessage {
  return Object.freeze({
    id: { value: id, shard: ShardIndex.single() },
    inboxId: {
      targetId: "type.spine.io/test.EntityId:",
      targetTypeUrl: "type.spine.io/test.Entity",
    },
    signalId: "signal-1",
    signal: create(AnySchema, {
      typeUrl: "type.spine.io/spine.core.Command",
      value: new Uint8Array(),
    }),
    label: "HANDLE_COMMAND" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived: new Date(1_000),
    version: 2n,
  });
}

export function quarantine(): RemovalQuarantine {
  const records = new Map<string, RemovalQuarantineRecord>();
  return {
    get: (id) => Promise.resolve(records.get(id)),
    put: (record) => {
      records.set(record.id, record);
      return Promise.resolve();
    },
    delete: (id) => {
      records.delete(id);
      return Promise.resolve();
    },
  };
}
