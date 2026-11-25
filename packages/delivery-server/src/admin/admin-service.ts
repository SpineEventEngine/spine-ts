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
    let closed = false;
    const update = (shard: ShardIndex): SubscriptionResponse =>
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, AdminSnapshots.observation(state, shard)),
        },
      });
    return {
      get subscriberCount() {
        return subscribers.size;
      },
      service: AdminSubscriptions.create(state, subscribers, update, () => closed),
      publish(shard) {
        if (closed) return;
        for (const subscriber of subscribers) subscriber.offer(shard);
      },
      close() {
        if (closed) return;
        closed = true;
        for (const subscriber of subscribers) subscriber.close();
        subscribers.clear();
      },
    };
  },
});

/**
 * Constructs the Admin stream handlers around shared state and subscribers.
 */
const AdminSubscriptions = Object.freeze({
  /**
   * Creates Admin RPC handlers with an initial replay outside the live buffer.
   *
   * @param state Supplies current shard state.
   * @param subscribers Tracks active streams.
   * @param update Reads the latest full shard observation.
   * @param isClosed Reports terminal publisher closure.
   * @returns The Admin service handlers.
   */
  create(
    state: InMemoryDeliveryState,
    subscribers: Set<Subscriber>,
    update: (shard: ShardIndex) => SubscriptionResponse,
    isClosed: () => boolean,
  ): ServiceImpl<typeof AdminService> {
    return {
      getShardInfo: () => AdminSnapshots.snapshot(state),
      subscribeToShardUpdates: (_request, context) =>
        AdminStreams.observe(state, subscribers, update, isClosed, context),
    };
  },
});

/**
 * Runs one Admin stream with replay followed by live updates.
 */
const AdminStreams = Object.freeze({
  /**
   * Reads initial known shards and later live updates for one subscriber.
   *
   * @param state Supplies current shard state.
   * @param subscribers Tracks active streams.
   * @param update Reads the latest full shard observation.
   * @param isClosed Reports terminal publisher closure.
   * @param context Supplies cancellation for the stream.
   * @returns The acknowledgement followed by shard updates.
   */
  async *observe(
    state: InMemoryDeliveryState,
    subscribers: Set<Subscriber>,
    update: (shard: ShardIndex) => SubscriptionResponse,
    isClosed: () => boolean,
    context: Parameters<ServiceImpl<typeof AdminService>["subscribeToShardUpdates"]>[1],
  ): AsyncIterable<SubscriptionResponse> {
    if (isClosed() || context.signal.aborted) return;
    const onAbort = () => {
      subscriber.cancel();
    };
    const subscriber = new Subscriber(update, () => {
      subscribers.delete(subscriber);
      context.signal.removeEventListener("abort", onAbort);
    });
    context.signal.addEventListener("abort", onAbort, { once: true });
    try {
      subscribers.add(subscriber);
      const replay = [...state.knownShards()];
      subscriber.setReplay(replay);
      yield create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
      for (const shard of replay) {
        const frame = subscriber.replay(shard);
        if (frame !== undefined) yield frame;
      }
      for (;;) {
        const next = await subscriber.next();
        if (next === undefined) return;
        yield next;
      }
    } finally {
      subscriber.close();
    }
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
  snapshot: (state: InMemoryDeliveryState) => ReturnType<typeof create<typeof ShardInfoListSchema>>;

  /**
   * Produces one shard observation.
   */
  observation: (
    state: InMemoryDeliveryState,
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
}> = Object.freeze({
  snapshot: (state: InMemoryDeliveryState): ReturnType<typeof create<typeof ShardInfoListSchema>> =>
    create(ShardInfoListSchema, {
      shards: [...state.knownShards()]
        .slice(0, MAX_DELIVERY_RESPONSE_SHARDS)
        .map((shard) => create(ShardInfoSchema, AdminSnapshots.observation(state, shard))),
    }),

  observation: (state: InMemoryDeliveryState, shard: ShardIndex) => {
    const key = DeliveryShards.key(shard);
    const record = state.shards.get(key);
    const messages = state.storedCount(shard);
    return {
      index: shard,
      status: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
      ...(record?.whenLastPicked === undefined
        ? {}
        : {
            lastPicked: record.whenLastPicked,
            whenLastPicked: record.whenLastPicked,
          }),
      messages,
      newStatus: record?.worker === undefined ? ShardStatus.NOT_PICKED : ShardStatus.PICKED,
      newMessagesCount: messages,
    };
  },
});

/**
 * Tracks one shard's per-subscriber update interval.
 */
interface ShardCooldown {
  readonly shard: ShardIndex;
  timer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  readonly empty: boolean;
}

/**
 * Buffers one Admin stream and coalesces changes independently per shard.
 */
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

  readonly #replayPending = new Set<string>();

  readonly #cooldowns = new Map<string, ShardCooldown>();

  readonly #lastState = new Map<string, string>();

  readonly #update: (shard: ShardIndex) => SubscriptionResponse;

  readonly #onClose: () => void;

  /**
   * Creates one independently throttled subscriber.
   *
   * @param update Reads the latest full state of a shard.
   * @param onClose Removes the subscriber from the publisher.
   */
  constructor(update: (shard: ShardIndex) => SubscriptionResponse, onClose: () => void) {
    this.#update = update;
    this.#onClose = onClose;
  }

  /**
   * Records shards that will be replayed outside the live frame buffer.
   *
   * @param shards Supplies the initial known shards.
   */
  setReplay(shards: readonly ShardIndex[]): void {
    for (const shard of shards) this.#replayPending.add(DeliveryShards.key(shard));
  }

  /**
   * Reads the latest state of one replay shard without using the live buffer.
   *
   * @param shard Identifies the initial shard.
   * @returns Its current update unless already closed or unchanged.
   */
  replay(shard: ShardIndex): SubscriptionResponse | undefined {
    this.#replayPending.delete(DeliveryShards.key(shard));
    return this.#record(shard);
  }

  /**
   * Updates the stream with a shard state immediately or after its cooldown.
   *
   * @param shard Identifies the changed shard.
   */
  offer(shard: ShardIndex): void {
    if (this.#closed) return;
    const key = DeliveryShards.key(shard);
    if (this.#replayPending.has(key)) return;
    const frame = this.#record(shard);
    if (frame !== undefined) this.#push(frame);
  }

  /**
   * Reads and records the latest state when this shard can send another frame.
   *
   * @param shard Identifies the shard.
   * @returns The new frame, or undefined during cooldown or for an identical state.
   */
  #record(shard: ShardIndex): SubscriptionResponse | undefined {
    if (this.#closed) return undefined;
    const key = DeliveryShards.key(shard);
    const cooldown = this.#cooldowns.get(key);
    if (cooldown !== undefined) {
      cooldown.dirty = true;
      return undefined;
    }
    const frame = this.#update(shard);
    const signature = Buffer.from(toBinary(SubscriptionResponseSchema, frame)).toString("base64");
    const empty =
      frame.value.case === "update" &&
      frame.value.value.newMessagesCount === 0 &&
      frame.value.value.newStatus === ShardStatus.NOT_PICKED;
    if (this.#lastState.get(key) === signature) {
      if (empty) this.#lastState.delete(key);
      return undefined;
    }
    this.#lastState.set(key, signature);
    const entry: ShardCooldown = {
      shard: DeliveryShards.copy(shard),
      dirty: false,
      empty,
    };
    const timer = setTimeout(() => {
      this.#cooldowns.delete(key);
      if (entry.dirty) this.offer(entry.shard);
      else if (entry.empty) this.#lastState.delete(key);
    }, 25);
    entry.timer = timer;
    timer.unref();
    this.#cooldowns.set(key, entry);
    return frame;
  }

  /**
   * Adds a frame to the buffer or hands it to a waiting reader.
   *
   * @param frame Supplies the Admin response.
   */
  #push(frame: SubscriptionResponse): void {
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

  /**
   * Reads the next Admin response.
   *
   * @returns The next frame or undefined after close.
   */
  next(): Promise<SubscriptionResponse | undefined> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    const frame = this.#frames.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    if (this.#closed) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  /**
   * Clears the stream normally.
   */
  close(): void {
    this.#terminate(undefined);
  }

  /**
   * Clears the stream after caller cancellation.
   */
  cancel(): void {
    this.#terminate(
      new ConnectError("Delivery shard update subscription canceled.", Code.Canceled),
    );
  }

  /**
   * Clears queued frames, timers, and the waiting reader.
   *
   * @param error Reports a terminal stream error when present.
   */
  #terminate(error: Error | undefined): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#frames = [];
    for (const entry of this.#cooldowns.values())
      if (entry.timer !== undefined) clearTimeout(entry.timer);
    this.#cooldowns.clear();
    this.#lastState.clear();
    this.#replayPending.clear();
    this.#error = error;
    if (error === undefined) this.#waiter?.resolve(undefined);
    else this.#waiter?.reject(error);
    this.#waiter = undefined;
    this.#onClose();
  }
}
