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
import { Time } from "@spine-event-engine/core/time";

import type { CapacityUsage } from "./capacity-ledger.js";

/**
 * Captures one child's exact state after an autonomous transition.
 */
export interface CapacityUsageSnapshot {
  /**
   * Orders this state after earlier child mutations.
   */
  readonly revision: bigint;

  /**
   * Counts rows, bytes, and tracked shards after the transition.
   */
  readonly usage: CapacityUsage;
}

/**
 * Coalesces autonomous child state changes until the parent acknowledges them.
 */
export class CapacityUsageReporter {
  readonly #closed = new AbortController();

  #pending: CapacityUsageSnapshot | undefined;

  #running: Promise<void> | undefined;

  /**
   * Creates a reporter for the child's authenticated private capacity client.
   *
   * @param send Publishes one exact usage snapshot to the parent.
   */
  constructor(private readonly send: (snapshot: CapacityUsageSnapshot) => Promise<void>) {}

  /**
   * Publishes the latest snapshot and retries transient lost responses.
   *
   * @param snapshot Captures state after an autonomous transition.
   * @returns Completion after this snapshot or a newer one is acknowledged.
   */
  publish(snapshot: CapacityUsageSnapshot): Promise<void> {
    if (this.#closed.signal.aborted)
      return Promise.reject(new Error("Delivery capacity reporter is closed."));
    if (this.#pending === undefined || snapshot.revision > this.#pending.revision)
      this.#pending = Object.freeze({
        revision: snapshot.revision,
        usage: Object.freeze({ ...snapshot.usage }),
      });
    this.#running ??= Promise.resolve()
      .then(() => this.#flush())
      .finally(() => {
        this.#running = undefined;
      });
    return this.#running;
  }

  /**
   * Stops retries when the child process closes or is replaced.
   */
  close(): void {
    this.#closed.abort();
  }

  /**
   * Sends the newest snapshot until the parent acknowledges it.
   */
  async #flush(): Promise<void> {
    let delay = 0;
    while (this.#pending !== undefined) {
      if (this.#closed.signal.aborted) throw new Error("Delivery capacity reporter is closed.");
      const snapshot = this.#pending;
      const started = Time.monotonicTime();
      try {
        await this.send(snapshot);
        if (this.#pending.revision <= snapshot.revision) this.#pending = undefined;
        delay = 0;
      } catch (error) {
        if (error instanceof ConnectError && CapacityUsageReporter.#terminal(error.code))
          throw error;
        const observed = Math.max(1, Math.ceil(Time.monotonicTime() - started));
        delay = delay === 0 ? observed : delay * 2;
        await this.#pause(delay);
      }
    }
  }

  /**
   * Waits between ambiguous reports and detaches its shutdown listener.
   */
  async #pause(delay: number): Promise<void> {
    let remaining = Number.isFinite(delay) ? delay : Number.MAX_SAFE_INTEGER;
    while (remaining > 0 && !this.#closed.signal.aborted) {
      const slice = Math.min(remaining, 2_147_483_647);
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.#closed.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, slice);
        this.#closed.signal.addEventListener("abort", finish, { once: true });
        if (this.#closed.signal.aborted) finish();
      });
      remaining -= slice;
    }
  }

  /**
   * Stops retrying definitive protocol and credential rejections.
   */
  static #terminal(code: Code): boolean {
    return (
      code === Code.InvalidArgument ||
      code === Code.FailedPrecondition ||
      code === Code.Unauthenticated ||
      code === Code.PermissionDenied ||
      code === Code.Unimplemented
    );
  }
}
