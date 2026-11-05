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

import type { Timestamp } from "@bufbuild/protobuf/wkt";

/**
 * Tracks process-local operation lifetimes by authenticated session identity.
 */
export class SessionLifetimes {
  readonly #clock: () => number | undefined;

  readonly #active = new Map<string, Set<SessionMonitor>>();

  #closed = false;

  /**
   * Creates a registry using the strategy's trusted clock for exact expiry.
   *
   * @param clock Returns current Unix milliseconds, or undefined on failure.
   */
  constructor(clock: () => number | undefined) {
    this.#clock = clock;
  }

  /**
   * Registers before the authoritative validity read.
   *
   * @param identity Authenticated stable session or token identity.
   * @param operation Host-managed operation lifetime.
   * @returns Monitor removed when the operation ends.
   */
  register(identity: string, operation: AbortSignal): SessionMonitor {
    operation.throwIfAborted();
    if (this.#closed) throw new Error("Session strategy is closed.");
    const monitor = new SessionMonitor(operation, this.#clock, () => {
      this.#remove(identity, monitor);
    });
    const group = this.#active.get(identity) ?? new Set<SessionMonitor>();
    group.add(monitor);
    this.#active.set(identity, group);
    monitor.attach();
    return monitor;
  }

  /**
   * Stops current process operations for a stable authenticated identity.
   *
   * @param identity Stable session or scoped token identity.
   */
  invalidate(identity: string): void {
    for (const monitor of [...(this.#active.get(identity) ?? [])]) monitor.release();
  }

  /**
   * Stops every retained operation before strategy close drains work.
   */
  close(): void {
    this.#closed = true;
    for (const identity of [...this.#active.keys()]) this.invalidate(identity);
  }

  /**
   * Removes one completed monitor without affecting sibling operations.
   *
   * @param identity Stable identity used at registration.
   * @param monitor Completed operation monitor.
   */
  #remove(identity: string, monitor: SessionMonitor): void {
    const group = this.#active.get(identity);
    group?.delete(monitor);
    if (group?.size === 0) this.#active.delete(identity);
  }
}

/**
 * One operation's invalidation signal and exact expiry timer.
 */
export class SessionMonitor {
  readonly #operation: AbortSignal;

  readonly #clock: () => number | undefined;

  readonly #onRemove: () => void;

  readonly #controller = new AbortController();

  #timer: ReturnType<typeof setTimeout> | undefined;

  #deadline: bigint | undefined;

  /**
   * Captures one host operation and its removal callback.
   *
   * @param operation Host cancellation signal.
   * @param clock Strategy's trusted clock.
   * @param onRemove Removes this monitor from the identity registry.
   */
  constructor(operation: AbortSignal, clock: () => number | undefined, onRemove: () => void) {
    this.#operation = operation;
    this.#clock = clock;
    this.#onRemove = onRemove;
  }

  /**
   * Returns the captured invalidation signal.
   *
   * @returns Signal that aborts when this operation loses authority.
   */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Attaches host termination after registration.
   */
  attach(): void {
    this.#operation.addEventListener("abort", this.release, { once: true });
    if (this.#operation.aborted) this.release();
  }

  /**
   * Accepts a resolved deadline only while the operation remains live.
   *
   * @param deadline Exact session expiry from the authoritative read.
   * @returns Whether the session may be forwarded now.
   */
  ready(deadline: Timestamp): boolean {
    if (this.#controller.signal.aborted || this.#operation.aborted) return false;
    this.#deadline = deadline.seconds * 1_000_000_000n + BigInt(deadline.nanos);
    this.#schedule();
    return !this.#controller.signal.aborted;
  }

  /**
   * Stops the local operation and releases its listener and timer.
   */
  release = (): void => {
    if (this.#controller.signal.aborted) return;
    this.#controller.abort();
    this.#operation.removeEventListener("abort", this.release);
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#onRemove();
  };

  /**
   * Schedules only the remaining interval, respecting platform timer range.
   */
  #schedule(): void {
    const now = this.#clock();
    const deadline = this.#deadline;
    if (now === undefined || deadline === undefined) {
      this.release();
      return;
    }
    const remaining = deadline - BigInt(now) * 1_000_000n;
    if (remaining <= 0n) {
      this.release();
      return;
    }
    const milliseconds = (remaining + 999_999n) / 1_000_000n;
    const delay = Number(milliseconds > 2_147_483_647n ? 2_147_483_647n : milliseconds);
    this.#timer = setTimeout(() => {
      this.#schedule();
    }, delay);
  }
}
