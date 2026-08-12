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
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  AdminService,
  ShardInfoListSchema,
  ShardInfoSchema,
  ShardInfoUpdateSchema,
  ShardStatus,
  SubscriptionResponseSchema,
  type SubscriptionResponse,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex } from "@spine-event-engine/proto/delivery";

import type { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { MAX_DELIVERY_RESPONSE_SHARDS } from "../core/limits.js";
import { DeliveryShards } from "../core/wire-values.js";

/**
 * Represents administrative observation publishing resources.
 */
export interface AdminPublisherHandle {
  // prettier-ignore

  /**
   * Serves administrative delivery RPCs.
   */
  readonly service: ServiceImpl<typeof AdminService>;

  /**
   * Reports active update subscribers.
   */
  readonly subscriberCount: number;

  /**
   * Publishes a shard observation update.
   *
   * @param shard Identifies the changed shard.
   */
  publish(shard: ShardIndex): void;

  /**
   * Records an Inbox message-count transition.
   *
   * @param shard Identifies the changed shard.
   * @param delta Supplies the inserted or removed count.
   */
  recordMessageTransition(shard: ShardIndex, delta: 1 | -1): void;

  /**
   * Closes all active administrative subscriptions.
   */
  close(): void;
}

/**
 * Publishes administrative shard observations.
 */
export const AdminPublisher: Readonly<{
  // prettier-ignore

  /**
   * Creates an administrative publisher.
   *
   * @param state Supplies shared delivery state.
   * @returns Provides the publisher handle.
   */
  create: (state: InMemoryDeliveryState) => AdminPublisherHandle;
}> = Object.freeze({
  create: (state: InMemoryDeliveryState): AdminPublisherHandle => {
    const subscribers = new Set<Subscriber>();
    const messageCounts = new Map<string, { readonly shard: ShardIndex; count: number }>();
    const update = (shard: ShardIndex): SubscriptionResponse =>
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(
            ShardInfoUpdateSchema,
            AdminSnapshots.observation(state, messageCounts, shard),
          ),
        },
      });
    return {
      get subscriberCount() {
        return subscribers.size;
      },
      service: {
        getShardInfo: () => AdminSnapshots.snapshot(state, messageCounts),
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
        const key = DeliveryShards.key(shard);
        const current = messageCounts.get(key);
        const count = (current?.count ?? 0) + delta;
        if (count < 0) throw new TypeError("Delivery shard message count is invalid.");
        if (count === 0) messageCounts.delete(key);
        else if (current === undefined)
          messageCounts.set(key, { shard: DeliveryShards.copy(shard), count });
        else current.count = count;
        const frame = update(shard);
        for (const subscriber of subscribers) subscriber.push(frame);
      },
      close() {
        for (const subscriber of subscribers) subscriber.close();
        subscribers.clear();
      },
    };
  },
});

/**
 * Produces administrative shard observation snapshots.
 */
const AdminSnapshots: Readonly<{
  // prettier-ignore

  /**
   * Produces a bounded deterministic shard snapshot.
   */
  snapshot: (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex; readonly count: number }>,
  ) => ReturnType<typeof create<typeof ShardInfoListSchema>>;

  /**
   * Produces one shard observation.
   */
  observation: (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly count: number }>,
    shard: ShardIndex,
  ) => {
    readonly index: ShardIndex;
    readonly status: ShardStatus;
    readonly lastPicked?: { readonly seconds: bigint; readonly nanos: number };
    readonly whenLastPicked?: { readonly seconds: bigint; readonly nanos: number };
    readonly messages: number;
    readonly newStatus: ShardStatus;
    readonly newMessagesCount: number;
  };

  /**
   * Lists every observed shard in deterministic order.
   */
  shards: (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex }>,
  ) => Iterable<ShardIndex>;

  /**
   * Converts milliseconds to a protobuf timestamp.
   */
  timestamp: (milliseconds: number) => { readonly seconds: bigint; readonly nanos: number };
}> = Object.freeze({
  snapshot: (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex; readonly count: number }>,
  ): ReturnType<typeof create<typeof ShardInfoListSchema>> =>
    create(ShardInfoListSchema, {
      shards: [...AdminSnapshots.shards(state, messageCounts)]
        .slice(0, MAX_DELIVERY_RESPONSE_SHARDS)
        .map((shard) =>
          create(ShardInfoSchema, AdminSnapshots.observation(state, messageCounts, shard)),
        ),
    }),

  observation: (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly count: number }>,
    shard: ShardIndex,
  ) => {
    const key = DeliveryShards.key(shard);
    const record = state.shards.get(key);
    const messages = messageCounts.get(key)?.count ?? 0;
    return {
      index: shard,
      status: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
      ...(record?.whenLastPicked === undefined
        ? {}
        : {
            lastPicked: AdminSnapshots.timestamp(record.whenLastPicked),
            whenLastPicked: AdminSnapshots.timestamp(record.whenLastPicked),
          }),
      messages,
      newStatus: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
      newMessagesCount: messages,
    };
  },

  shards: function* (
    state: InMemoryDeliveryState,
    messageCounts: ReadonlyMap<string, { readonly shard: ShardIndex }>,
  ): Iterable<ShardIndex> {
    const all = new Map<string, ShardIndex>();
    for (const [key, record] of state.shards) all.set(key, record.shard);
    for (const [key, record] of messageCounts) all.set(key, record.shard);
    yield* [...all.values()].sort(
      (left, right) => left.ofTotal - right.ofTotal || left.index - right.index,
    );
  },

  timestamp: (milliseconds: number): { readonly seconds: bigint; readonly nanos: number } => {
    const seconds = Math.floor(milliseconds / 1_000);
    return { seconds: BigInt(seconds), nanos: (milliseconds - seconds * 1_000) * 1_000_000 };
  },
});

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
