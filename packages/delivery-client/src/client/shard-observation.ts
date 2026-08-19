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

import type { SubscriptionResponse } from "@spine-event-engine/proto/delivery-server";

import {
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  type DeliveryShardObservationStream,
  type RemoteShardObservation,
} from "./types.js";

/**
 * Buffers one bounded, reconnecting remote shard-observation stream.
 */
export class ShardObservationStream implements DeliveryShardObservationStream {
  readonly #values: RemoteShardObservation[] = [];
  readonly #waiters: ((result: IteratorResult<RemoteShardObservation>) => void)[] = [];
  #error: Error | undefined;
  #done = false;

  /**
   * Creates and begins an observation stream.
   * @param config Supplies bounded transport, decoding, and cleanup operations.
   */
  constructor(
    private readonly config: {
      readonly signal: AbortSignal;
      readonly setupTimeoutMs: number;
      readonly capacity: number;
      readonly reconnects: number;
      readonly reconnectBackoffMs: number;
      readonly open: (signal: AbortSignal) => AsyncIterable<SubscriptionResponse>;
      readonly acknowledge: (frame: SubscriptionResponse) => boolean;
      readonly decodeUpdate: (frame: SubscriptionResponse) => RemoteShardObservation;
      readonly finish: () => void;
      readonly cancel: () => void;
    },
  ) {
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

  async #pump(): Promise<void> {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.#observeAttempt();
        } catch (error) {
          if (this.config.signal.aborted) return;
          if (
            error instanceof DeliveryProtocolError ||
            error instanceof ShardObservationOverflowError
          )
            throw error;
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

  async #observeAttempt(): Promise<never> {
    const setup = new AbortController();
    const abort = () => setup.abort(this.config.signal.reason);
    this.config.signal.addEventListener("abort", abort, { once: true });
    let setupTimedOut = false;
    const timeout = setTimeout(() => {
      setupTimedOut = true;
      setup.abort(new DeliveryShardObservationError());
    }, this.config.setupTimeoutMs);
    try {
      let acknowledged = false;
      for await (const frame of this.config.open(setup.signal)) {
        if (!acknowledged) {
          if (!this.config.acknowledge(frame)) throw new DeliveryProtocolError();
          acknowledged = true;
          clearTimeout(timeout);
          continue;
        }
        this.#push(this.config.decodeUpdate(frame));
      }
      if (!acknowledged || setupTimedOut) throw new DeliveryShardObservationError();
      throw new DeliveryShardObservationError();
    } finally {
      clearTimeout(timeout);
      this.config.signal.removeEventListener("abort", abort);
    }
  }

  #push(value: RemoteShardObservation): void {
    if (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (waiter === undefined) throw new DeliveryShardObservationError();
      waiter({ done: false, value });
      return;
    }
    if (this.#values.length >= this.config.capacity) throw new ShardObservationOverflowError();
    this.#values.push(value);
  }

  #next(): Promise<IteratorResult<RemoteShardObservation>> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    const value = this.#values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.#done) return Promise.resolve({ done: true, value: undefined });
    if (this.#waiters.length >= this.config.capacity) {
      const error = new ShardObservationOverflowError();
      this.#error = error;
      this.config.cancel();
      this.#finish();
      return Promise.reject(error);
    }
    return new Promise<IteratorResult<RemoteShardObservation>>((resolve) =>
      this.#waiters.push(resolve),
    ).then((result) => {
      if (this.#error !== undefined) throw this.#error;
      return result;
    });
  }

  #finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.config.finish();
    const result: IteratorResult<RemoteShardObservation> = { done: true, value: undefined };
    for (const resolve of this.#waiters.splice(0)) resolve(result);
  }

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
      const timer = setTimeout(finish, delay);
      const abort = () => {
        clearTimeout(timer);
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
