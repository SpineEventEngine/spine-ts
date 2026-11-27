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
import type { ServiceImpl } from "@connectrpc/connect";
import {
  ShardObservingService,
  ShardedWorkAvailableSchema,
  type ShardedWorkAvailable,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex } from "@spine-event-engine/proto/delivery";

import type { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { DeliveryShards } from "./wire-values.js";

/**
 * Publishes advisory notifications for free shards with pending work.
 */
export interface ShardObservingHandle {
  /**
   * Serves the work observation stream.
   */
  readonly service: ServiceImpl<typeof ShardObservingService>;

  /**
   * Checks a shard after an Inbox or session mutation.
   *
   * @param shard Identifies the changed shard.
   */
  changed(shard: ShardIndex): void;

  /**
   * Clears streams and cancels reminder timers.
   */
  close(): void;
}

/**
 * Creates a publisher around the shared in-memory delivery state.
 */
export const ShardObserving: Readonly<{
  /**
   * Creates the observing service.
   *
   * @param state Supplies the shared Inbox and session state.
   * @param reminderMs Sets the interval between unclaimed-work reminders.
   * @returns The service and its mutation and lifecycle hooks.
   */
  create(state: InMemoryDeliveryState, reminderMs: number): ShardObservingHandle;
}> = Object.freeze({
  /**
   * Creates the observing service.
   *
   * @param state Supplies the shared Inbox and session state.
   * @param reminderMs Sets the interval between unclaimed-work reminders.
   * @returns The service and its mutation and lifecycle hooks.
   */
  create(state: InMemoryDeliveryState, reminderMs: number): ShardObservingHandle {
    if (!Number.isSafeInteger(reminderMs) || reminderMs <= 0)
      throw new RangeError(
        "Work reminder interval must be a positive number of whole milliseconds.",
      );
    return new WorkPublisher(state, reminderMs);
  },
});

/**
 * Coordinates subscriptions and reminder timers for one delivery state.
 */
class WorkPublisher implements ShardObservingHandle {
  readonly #subscribers = new Map<WorkSubscriber, () => void>();

  readonly #reminders = new Map<string, LongReminder>();

  #closed = false;

  /**
   * Creates the publisher and its Connect service.
   *
   * @param state Supplies the shared delivery state.
   * @param reminderMs Sets the repeat interval in milliseconds.
   */
  constructor(
    private readonly state: InMemoryDeliveryState,
    private readonly reminderMs: number,
  ) {}

  /**
   * Serves one independent observation stream.
   */
  readonly service: ServiceImpl<typeof ShardObservingService> = {
    observeAll: async function* (
      this: WorkPublisher,
      _request: Parameters<ServiceImpl<typeof ShardObservingService>["observeAll"]>[0],
      context: Parameters<ServiceImpl<typeof ShardObservingService>["observeAll"]>[1],
    ) {
      if (this.#closed || context.signal.aborted) return;
      const subscriber = new WorkSubscriber();
      const detach = () => {
        context.signal.removeEventListener("abort", detach);
        this.#subscribers.delete(subscriber);
        subscriber.close();
        if (this.#subscribers.size === 0) {
          for (const timer of this.#reminders.values()) timer.cancel();
          this.#reminders.clear();
        }
      };
      context.signal.addEventListener("abort", detach, { once: true });
      this.#subscribers.set(subscriber, detach);
      try {
        for (const shard of this.state.pendingShards()) {
          if (this.#available(shard)) {
            subscriber.push(this.#notice(shard));
            if (!this.#reminders.has(DeliveryShards.key(shard))) this.#schedule(shard);
          }
        }
        for await (const notice of subscriber)
          if (notice.shard !== undefined && this.#available(notice.shard)) yield notice;
      } finally {
        detach();
      }
    }.bind(this),
  };

  /**
   * Checks availability after a committed state transition.
   *
   * @param shard Identifies the changed shard.
   */
  changed(shard: ShardIndex): void {
    if (this.#closed) return;
    const key = DeliveryShards.key(shard);
    if (!this.#available(shard)) {
      this.#reminders.get(key)?.cancel();
      this.#reminders.delete(key);
      for (const subscriber of this.#subscribers.keys()) subscriber.invalidate(key);
      return;
    }
    this.#publish(shard);
    if (this.#subscribers.size > 0 && !this.#reminders.has(key)) this.#schedule(shard);
  }

  /**
   * Clears streams and cancels all reminders.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#reminders.values()) timer.cancel();
    this.#reminders.clear();
    for (const detach of this.#subscribers.values()) detach();
    this.#subscribers.clear();
  }

  /**
   * Checks whether pending work can be picked up.
   *
   * @param shard Identifies the shard.
   * @returns Whether the shard is free with pending work.
   */
  #available(shard: ShardIndex): boolean {
    return this.state.hasPending(shard) && this.state.session(shard) === undefined;
  }

  /**
   * Creates one detached work notice.
   *
   * @param shard Identifies the shard.
   * @returns The wire notice.
   */
  #notice(shard: ShardIndex): ShardedWorkAvailable {
    return create(ShardedWorkAvailableSchema, { shard: DeliveryShards.copy(shard) });
  }

  /**
   * Sends a notice to every current subscriber.
   *
   * @param shard Identifies the shard.
   */
  #publish(shard: ShardIndex): void {
    const notice = this.#notice(shard);
    for (const subscriber of this.#subscribers.keys()) subscriber.push(notice);
  }

  /**
   * Sets the next reminder for an available shard.
   *
   * @param shard Identifies the shard.
   */
  #schedule(shard: ShardIndex): void {
    const key = DeliveryShards.key(shard);
    this.#reminders.set(
      key,
      new LongReminder(this.reminderMs, () => {
        this.#reminders.delete(key);
        if (this.#closed || this.#subscribers.size === 0 || !this.#available(shard)) return;
        this.#publish(shard);
        this.#schedule(shard);
      }),
    );
  }
}

/**
 * Waits through multiple Node timer slots for a long configured interval.
 */
class LongReminder {
  #remaining: number;

  #timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Starts the reminder countdown.
   *
   * @param milliseconds Sets the complete delay.
   * @param onFire Runs when the complete delay elapses.
   */
  constructor(
    milliseconds: number,
    private readonly onFire: () => void,
  ) {
    this.#remaining = milliseconds;
    this.#arm();
  }

  /**
   * Clears the current timer slot.
   */
  cancel(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Sets the next timer slot without truncating the configured interval.
   */
  #arm(): void {
    const slot = Math.min(this.#remaining, 2_147_483_647);
    this.#remaining -= slot;
    this.#timer = setTimeout(() => {
      if (this.#remaining > 0) this.#arm();
      else this.onFire();
    }, slot);
    this.#timer.unref();
  }
}

/**
 * Buffers notices for one stream until its reader accepts them.
 */
class WorkSubscriber implements AsyncIterable<ShardedWorkAvailable> {
  readonly #pending = new Map<string, ShardedWorkAvailable>();

  #wake: (() => void) | undefined;

  #closed = false;

  /**
   * Adds a shard notice, coalescing unread notices for the same shard.
   *
   * @param notice Supplies the work notice.
   */
  push(notice: ShardedWorkAvailable): void {
    if (this.#closed || notice.shard === undefined) return;
    this.#pending.set(DeliveryShards.key(notice.shard), notice);
    this.#wake?.();
  }

  /**
   * Removes a queued shard after it becomes unavailable.
   *
   * @param key Identifies the unavailable shard.
   */
  invalidate(key: string): void {
    this.#pending.delete(key);
  }

  /**
   * Clears the stream and wakes its reader.
   */
  close(): void {
    this.#closed = true;
    this.#pending.clear();
    this.#wake?.();
  }

  /**
   * Reads notices until cancellation or service closure.
   *
   * @returns The pending notices.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<ShardedWorkAvailable> {
    for (;;) {
      const next = this.#pending.entries().next().value;
      if (next !== undefined) {
        this.#pending.delete(next[0]);
        yield next[1];
      } else if (this.#closed) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
        this.#wake = undefined;
      }
    }
  }
}
