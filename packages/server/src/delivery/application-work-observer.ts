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

import { Code, ConnectError } from "@connectrpc/connect";
import type { ILogLayer } from "loglayer";

import { deliveryControls, type ApplicationDelivery } from "./delivery-builder.js";
import type { ShardIndex } from "./shard-index.js";
import { emitServerError } from "../server/server-log.js";

const initialReconnectDelayMs = 100;
const maximumReconnectDelayMs = 30_000;

/**
 * Supplies one live server work stream, with a fresh scan on every call.
 */
export interface ApplicationWorkSource {
  /**
   * Streams free shards with pending rows until cancelled or disconnected.
   *
   * @param options Cancels the current stream on shutdown.
   * @returns Advisory shard notices.
   */
  observeAvailableShards(options?: { readonly signal?: AbortSignal }): AsyncIterable<ShardIndex>;
}

/**
 * Reads the built-in remote work stream and starts distinct shard attempts.
 */
export class ApplicationWorkObserver {
  readonly #controller = new AbortController();

  readonly #active = new Map<string, Promise<unknown>>();

  #reader: Promise<void> | undefined;

  #closed = false;

  #failure: unknown;

  #disconnected = false;

  #reconnectDelayMs = initialReconnectDelayMs;

  /**
   * Creates a node-local reader with an optional positive run count.
   *
   * @param source Opens the server's work stream.
   * @param delivery Starts managed shard attempts.
   * @param endpoint Identifies the remote endpoint in diagnostics.
   * @param logger Receives contained background failures.
   * @param maxConcurrentDeliveries Bounds simultaneous distinct runs when configured.
   */
  constructor(
    private readonly source: ApplicationWorkSource,
    private readonly delivery: ApplicationDelivery,
    private readonly endpoint: string,
    private readonly logger: ILogLayer | undefined,
    private readonly maxConcurrentDeliveries: number | undefined,
  ) {
    if (
      maxConcurrentDeliveries !== undefined &&
      (!Number.isSafeInteger(maxConcurrentDeliveries) || maxConcurrentDeliveries <= 0)
    )
      throw new TypeError("maxConcurrentDeliveries must be a positive safe integer.");
  }

  /**
   * Starts the background stream without waiting for its first work notice.
   *
   * @returns Completion after the reader has been scheduled.
   */
  start(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Delivery observation is closed."));
    this.#reader ??= this.#read();
    return Promise.resolve();
  }

  /**
   * Returns a permanent work-stream failure for startup diagnostics.
   *
   * @returns The original unsupported-method error, when one occurred.
   */
  get failure(): unknown {
    return this.#failure;
  }

  /**
   * Waits for current shard attempts without waiting for the idle stream.
   *
   * @returns Completion after all admitted attempts settle.
   */
  async whenIdle(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled([...this.#active.values()]);
  }

  /**
   * Cancels the stream and waits for already admitted work.
   *
   * @returns Completion after the reader and admitted attempts settle.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#controller.abort(new Error("Delivery observation closed."));
    await this.#reader;
    await this.whenIdle();
  }

  /**
   * Reopens on transient disconnect and stops after an unsupported method.
   */
  async #read(): Promise<void> {
    while (!this.#closed) {
      try {
        for await (const shard of this.source.observeAvailableShards({
          signal: this.#controller.signal,
        })) {
          if (this.#controller.signal.aborted) return;
          this.#disconnected = false;
          this.#reconnectDelayMs = initialReconnectDelayMs;
          this.#offer(shard);
        }
      } catch (error) {
        if (this.#controller.signal.aborted) return;
        if (error instanceof ConnectError && error.code === Code.Unimplemented) {
          this.#failure = error;
          this.#report(error, "unsupported");
          return;
        }
        if (!this.#disconnected) this.#report(error, "disconnected");
        this.#disconnected = true;
      }
      if (!this.#controller.signal.aborted) {
        const delay = this.#reconnectDelayMs;
        this.#reconnectDelayMs = Math.min(maximumReconnectDelayMs, delay * 2);
        await this.#pauseReconnect(delay);
      }
    }
  }

  /**
   * Reserves one place before pickup and coalesces repeated shard notices.
   *
   * @param shard Identifies the shard in the work notice.
   */
  #offer(shard: ShardIndex): void {
    const key = shard.key();
    if (this.#active.has(key)) return;
    if (
      this.maxConcurrentDeliveries !== undefined &&
      !deliveryControls.isShardActive(this.delivery, shard) &&
      deliveryControls.activeRunCount(this.delivery) >= this.maxConcurrentDeliveries
    )
      return;
    const work = this.delivery.deliverMessagesFrom(shard, { signal: this.#controller.signal });
    this.#active.set(key, work);
    void work
      .then(undefined, (error: unknown) => {
        this.#report(error, "run_failed");
      })
      .finally(() => {
        if (this.#active.get(key) === work) this.#active.delete(key);
      });
  }

  /**
   * Paces reconnects with the established increasing delay policy.
   *
   * @param delayMs Waits this long unless shutdown cancels the reader.
   */
  async #pauseReconnect(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const signal = this.#controller.signal;
      const onFinish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onFinish);
        resolve();
      };
      const timer = setTimeout(onFinish, delayMs);
      signal.addEventListener("abort", onFinish, { once: true });
      if (signal.aborted) onFinish();
    });
  }

  /**
   * Logs a stream or run failure with the endpoint and method identity.
   *
   * @param error Supplies the original failure.
   * @param reasonCode Classifies the failure.
   */
  #report(error: unknown, reasonCode: string): void {
    if (this.logger === undefined) return;
    emitServerError(this.logger, "Delivery work observation failed.", {
      method: "spine.delivery.ShardObservingService.ObserveAll",
      endpoint: this.endpoint,
      reasonCode,
      errorCode: error instanceof ConnectError ? Code[error.code] : undefined,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
