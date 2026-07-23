import type { SubscriptionResponse } from "@spine-ts/proto/delivery-server";

import {
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  type DeliveryShardObservationStream,
  type RemoteShardObservation,
} from "./types.js";

export class ShardObservationStream implements DeliveryShardObservationStream {
  readonly #values: RemoteShardObservation[] = [];
  readonly #waiters: ((result: IteratorResult<RemoteShardObservation>) => void)[] = [];
  #error: Error | undefined;
  #done = false;

  constructor(
    private readonly config: {
      readonly signal: AbortSignal;
      readonly timeoutMs: number;
      readonly capacity: number;
      readonly reconnects: number;
      readonly reconnectBackoffMs: number;
      readonly open: (
        signal: AbortSignal,
        timeoutMs: number,
      ) => AsyncIterable<SubscriptionResponse>;
      readonly acknowledge: (frame: SubscriptionResponse) => boolean;
      readonly decodeUpdate: (frame: SubscriptionResponse) => RemoteShardObservation;
      readonly finish: () => void;
      readonly cancel: () => void;
    },
  ) {
    void this.#pump();
  }

  cancel(): void {
    if (this.#done) return;
    this.config.cancel();
    this.#finish();
  }

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
          let acknowledged = false;
          for await (const frame of this.config.open(this.config.signal, this.config.timeoutMs)) {
            if (!acknowledged) {
              if (!this.config.acknowledge(frame)) throw new DeliveryProtocolError();
              acknowledged = true;
              continue;
            }
            this.#push(this.config.decodeUpdate(frame));
          }
          if (!acknowledged) throw new DeliveryProtocolError();
          throw new DeliveryShardObservationError();
        } catch (error) {
          if (this.config.signal.aborted) return;
          if (
            error instanceof DeliveryProtocolError ||
            error instanceof ShardObservationOverflowError
          )
            throw error;
          if (attempt === this.config.reconnects) throw new DeliveryShardObservationError();
          await pause(this.config.reconnectBackoffMs, this.config.signal);
        }
      }
    } catch (error) {
      if (!this.config.signal.aborted)
        this.#error = error instanceof Error ? error : new DeliveryShardObservationError();
    } finally {
      this.#finish();
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
}

function pause(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0)
    return signal.aborted
      ? Promise.reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Delivery observation aborted."),
        )
      : Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay);
    const abort = () => {
      clearTimeout(timer);
      done(
        signal.reason instanceof Error ? signal.reason : new Error("Delivery observation aborted."),
      );
    };
    function done(reason?: Error) {
      signal.removeEventListener("abort", abort);
      if (reason === undefined) resolve();
      else reject(reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
