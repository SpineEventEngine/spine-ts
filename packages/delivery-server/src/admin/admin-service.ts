import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  AdminService,
  ShardInfoListSchema,
  ShardInfoSchema,
  ShardInfoUpdateSchema,
  ShardStatus,
  SubscriptionResponseSchema,
  type SubscriptionResponse,
} from "@spine-ts/proto/delivery-server";
import type { ShardIndex } from "@spine-ts/proto/delivery";

import type { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { MAX_DELIVERY_RESPONSE_SHARDS } from "../core/limits.js";
import { copyShard, shardKey } from "../core/wire-values.js";

export interface AdminPublisher {
  readonly service: ServiceImpl<typeof AdminService>;
  readonly subscriberCount: number;
  publish(shard: ShardIndex): void;
  recordMessageTransition(shard: ShardIndex, delta: 1 | -1): void;
  close(): void;
}

export function createAdminPublisher(state: InMemoryDeliveryState): AdminPublisher {
  const subscribers = new Set<Subscriber>();
  const messageCounts = new Map<string, { readonly shard: ShardIndex; count: number }>();
  const update = (shard: ShardIndex): SubscriptionResponse =>
    create(SubscriptionResponseSchema, {
      value: {
        case: "update",
        value: create(ShardInfoUpdateSchema, observation(state, messageCounts, shard)),
      },
    });
  return {
    get subscriberCount() {
      return subscribers.size;
    },
    service: {
      getShardInfo: () => snapshot(state, messageCounts),
      async *subscribeToShardUpdates(_request, context) {
        const subscriber = new Subscriber(() => {
          subscribers.delete(subscriber);
        });
        const onAbort = () => {
          subscriber.cancel();
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
        try {
          yield create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
          if (context.signal.aborted) return;
          subscribers.add(subscriber);
          for (;;) {
            const next = await subscriber.next();
            if (next === undefined) return;
            yield next;
          }
        } finally {
          context.signal.removeEventListener("abort", onAbort);
          subscribers.delete(subscriber);
          subscriber.close();
        }
      },
    },
    publish(shard) {
      const frame = update(shard);
      for (const subscriber of subscribers) subscriber.push(frame);
    },
    recordMessageTransition(shard, delta) {
      const key = shardKey(shard);
      const current = messageCounts.get(key);
      const count = (current?.count ?? 0) + delta;
      if (count < 0) throw new TypeError("Delivery shard message count is invalid.");
      if (count === 0) messageCounts.delete(key);
      else if (current === undefined) messageCounts.set(key, { shard: copyShard(shard), count });
      else current.count = count;
      const frame = update(shard);
      for (const subscriber of subscribers) subscriber.push(frame);
    },
    close() {
      for (const subscriber of subscribers) subscriber.close();
      subscribers.clear();
    },
  };
}

function snapshot(
  state: InMemoryDeliveryState,
  messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex; readonly count: number }>,
) {
  return create(ShardInfoListSchema, {
    shards: [...shards(state, messageCounts)]
      .slice(0, MAX_DELIVERY_RESPONSE_SHARDS)
      .map((shard) => create(ShardInfoSchema, observation(state, messageCounts, shard))),
  });
}

function observation(
  state: InMemoryDeliveryState,
  messageCounts: ReadonlyMap<string, { readonly count: number }>,
  shard: ShardIndex,
) {
  const key = shardKey(shard);
  const record = state.shards.get(key);
  const messages = messageCounts.get(key)?.count ?? 0;
  return {
    index: shard,
    status: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
    ...(record?.whenLastPicked === undefined
      ? {}
      : {
          lastPicked: timestamp(record.whenLastPicked),
          whenLastPicked: timestamp(record.whenLastPicked),
        }),
    messages,
    newStatus: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
    newMessagesCount: messages,
  };
}

class Subscriber {
  #frames: SubscriptionResponse[] = [];
  #waiter:
    | {
        readonly resolve: (value: SubscriptionResponse | undefined) => void;
        readonly reject: (error: Error) => void;
      }
    | undefined;
  #error: Error | undefined;
  #closed = false;
  readonly #onClose: () => void;

  constructor(onClose: () => void) {
    this.#onClose = onClose;
  }

  push(frame: SubscriptionResponse): void {
    if (this.#closed) return;
    if (this.#waiter !== undefined) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter.resolve(frame);
      return;
    }
    if (this.#frames.length === 100) {
      this.#terminate(
        new ConnectError("Delivery shard update buffer is full.", Code.ResourceExhausted),
      );
      return;
    }
    this.#frames.push(frame);
  }
  next(): Promise<SubscriptionResponse | undefined> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    const frame = this.#frames.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }
  close(): void {
    this.#terminate(undefined);
  }

  cancel(): void {
    this.#terminate(
      new ConnectError("Delivery shard update subscription canceled.", Code.Canceled),
    );
  }

  #terminate(error: Error | undefined): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#frames = [];
    this.#error = error;
    if (error === undefined) this.#waiter?.resolve(undefined);
    else this.#waiter?.reject(error);
    this.#waiter = undefined;
    this.#onClose();
  }
}

function* shards(
  state: InMemoryDeliveryState,
  messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex }>,
) {
  const all = new Map<string, ShardIndex>();
  for (const [key, record] of state.shards) all.set(key, record.shard);
  for (const [key, record] of messageCounts) all.set(key, record.shard);
  yield* [...all.values()].sort(
    (left, right) => left.ofTotal - right.ofTotal || left.index - right.index,
  );
}

function timestamp(milliseconds: number): { seconds: bigint; nanos: number } {
  const seconds = Math.floor(milliseconds / 1_000);
  return { seconds: BigInt(seconds), nanos: (milliseconds - seconds * 1_000) * 1_000_000 };
}
