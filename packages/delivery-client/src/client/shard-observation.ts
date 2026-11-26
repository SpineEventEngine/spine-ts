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

import { DeliveryTimers } from "./delivery-timers.js";
import type { SubscriptionResponse } from "@spine-event-engine/proto/delivery-server";

import {
  DeliveryProtocolError,
  DeliveryShardObservationError,
  type DeliveryShardObservationStream,
  type RemoteShardObservation,
} from "./types.js";

/**
 * Reads the next Admin update when the subscriber consumes the current one.
 */
export class ShardObservationStream implements DeliveryShardObservationStream {
  #pending: { value: RemoteShardObservation; consumed: () => void } | undefined;

  readonly #waiters = new Set<(result: IteratorResult<RemoteShardObservation>) => void>();

  #error: Error | undefined;

  #done = false;

  /**
   * Creates and begins an observation stream.
   * @param config Supplies bounded transport, decoding, and cleanup operations.
   */
  constructor(
    private readonly config: {
      readonly signal: AbortSignal;
      readonly setupTimeoutMs: number | undefined;
      readonly reconnects: number;
      readonly reconnectBackoffMs: number;
      readonly open: (signal: AbortSignal) => AsyncIterable<SubscriptionResponse>;
      readonly acknowledge: (frame: SubscriptionResponse) => boolean;
      readonly decodeUpdate: (frame: SubscriptionResponse) => RemoteShardObservation;
      readonly finish: () => void;
      readonly cancel: () => void;
    },
  ) {
    config.signal.addEventListener("abort", this.#stop, { once: true });
    void this.#pump();
  }

  /**
   * Cancels this stream and releases its local resources.
   */
  cancel(): void {
    if (this.#done) return;
    this.config.cancel();
    this.#finish();
  }

  /**
   * Returns this stream's async iterator.
   * @returns An iterator that yields detached observations.
   */
  [Symbol.asyncIterator](): AsyncIterator<RemoteShardObservation> {
    return {
      next: () => this.#next(),
      return: () => {
        this.cancel();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  /**
   * Reads Admin updates and reconnects when requested by the caller.
   */
  async #pump(): Promise<void> {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.#observeAttempt();
        } catch (error) {
          if (this.config.signal.aborted) return;
          if (error instanceof DeliveryProtocolError) throw error;
          if (attempt === this.config.reconnects) throw new DeliveryShardObservationError();
          await ShardObservationStream.#pause(this.config.reconnectBackoffMs, this.config.signal);
        }
      }
    } catch (error) {
      if (!this.config.signal.aborted)
        this.#error = error instanceof Error ? error : new DeliveryShardObservationError();
    } finally {
      this.#finish();
    }
  }

  /**
   * Opens one Admin stream and waits for the initial subscription response.
   */
  async #observeAttempt(): Promise<never> {
    const setup = new AbortController();
    const abort = () => {
      setup.abort(this.config.signal.reason);
    };
    this.config.signal.addEventListener("abort", abort, { once: true });
    const cancelTimer = DeliveryTimers.after(() => {
      setup.abort(new DeliveryShardObservationError());
    }, this.config.setupTimeoutMs);
    try {
      let acknowledged = false;
      for await (const frame of this.config.open(setup.signal)) {
        if (!acknowledged) {
          if (!this.config.acknowledge(frame)) throw new DeliveryProtocolError();
          acknowledged = true;
          cancelTimer?.();
          continue;
        }
        await this.#push(this.config.decodeUpdate(frame));
      }
      throw new DeliveryShardObservationError();
    } finally {
      cancelTimer?.();
      this.config.signal.removeEventListener("abort", abort);
    }
  }

  /**
   * Passes an update to the next reader and waits until the reader accepts it.
   */
  #push(value: RemoteShardObservation): Promise<void> {
    const waiter = this.#waiters.values().next().value;
    if (waiter !== undefined) {
      this.#waiters.delete(waiter);
      waiter({ done: false, value });
      return Promise.resolve();
    }
    if (this.#done) return Promise.resolve();
    return new Promise<void>((consumed) => {
      this.#pending = { value, consumed };
    });
  }

  /**
   * Returns the pending update or waits for the next one.
   */
  #next(): Promise<IteratorResult<RemoteShardObservation>> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    const pending = this.#pending;
    if (pending !== undefined) {
      this.#pending = undefined;
      pending.consumed();
      return Promise.resolve({ done: false, value: pending.value });
    }
    if (this.#done) return Promise.resolve({ done: true, value: undefined });
    return new Promise<IteratorResult<RemoteShardObservation>>((resolve) =>
      this.#waiters.add(resolve),
    ).then((result) => {
      if (this.#error !== undefined) throw this.#error;
      return result;
    });
  }

  readonly #stop = (): void => {
    this.#finish();
  };

  /**
   * Releases an unread update and wakes every waiting reader.
   */
  #finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.config.signal.removeEventListener("abort", this.#stop);
    this.#pending?.consumed();
    this.#pending = undefined;
    this.config.finish();
    const result: IteratorResult<RemoteShardObservation> = { done: true, value: undefined };
    for (const resolve of this.#waiters) resolve(result);
    this.#waiters.clear();
  }

  /**
   * Waits before reconnecting and stops if the stream closes.
   */
  static #pause(delay: number, signal: AbortSignal): Promise<void> {
    if (delay === 0)
      return signal.aborted
        ? Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Delivery observation aborted."),
          )
        : Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (reason?: Error) => {
        signal.removeEventListener("abort", abort);
        if (reason === undefined) resolve();
        else reject(reason);
      };
      const cancelTimer = DeliveryTimers.after(finish, delay);
      const abort = () => {
        cancelTimer?.();
        finish(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Delivery observation aborted."),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
