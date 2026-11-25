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

import type { CapacityTicket, CapacityUsage } from "./capacity-ledger.js";

/**
 * Calls the parent's authenticated private capacity service.
 */
export interface CapacityReservationClient {
  /**
   * Acquires possible positive growth before commit.
   *
   * @param ticket Correlates this mutation.
   * @param growth Counts possible positive resource growth.
   * @returns Completion after the parent reserves capacity.
   */
  reserve(ticket: CapacityTicket, growth: CapacityUsage, signal?: AbortSignal): Promise<void>;

  /**
   * Updates a reservation with exact committed usage.
   *
   * @param ticket Correlates this mutation.
   * @param usage Counts the child's resources after commit.
   * @param revision Orders this report after earlier state transitions.
   * @returns Completion after the parent updates its ledger.
   */
  report(ticket: CapacityTicket, usage: CapacityUsage, revision: bigint,
    signal?: AbortSignal): Promise<void>;

  /**
   * Cancels a reservation when the mutation did not commit.
   *
   * @param ticket Correlates this mutation.
   * @returns Completion after the parent retires the ticket.
   */
  cancel(ticket: CapacityTicket, signal?: AbortSignal): Promise<void>;
}

/**
 * Holds one request while it waits for its child-local mutation turn.
 */
interface PendingMutation {
  readonly ticket: CapacityTicket;
  readonly growth: () => CapacityUsage;
  readonly operation: () => Promise<unknown>;
  readonly snapshot: () => { readonly usage: CapacityUsage; readonly revision: bigint };
  readonly signal: AbortSignal | undefined;
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
}

/**
 * Queues mutations within one child while other children proceed.
 */
export class CapacityMutationGate {
  readonly #pending = new Map<bigint, PendingMutation>();

  readonly #retiredGaps = new Set<bigint>();

  readonly #closed = new AbortController();

  #active: PendingMutation | undefined;

  #identity: string | undefined;

  #retiredThrough = 0n;

  #scheduled = false;

  /**
   * Creates a per-child gate over the global reservation service.
   *
   * @param capacity Calls the parent with correlated tickets.
   */
  constructor(private readonly capacity: CapacityReservationClient) {}

  /**
   * Acquires headroom, applies one mutation, and reports exact committed usage.
   *
   * @typeParam T The mutation result type.
   * @param ticket Names the parent-issued mutation.
   * @param growth Calculates positive growth when this request reaches admission.
   * @param operation Applies the existing validated service handler.
   * @param snapshot Reads exact state after the handler settles.
   * @param signal Cancels the request before its mutation begins.
   * @returns The existing service handler result.
   */
  run<T>(
    ticket: CapacityTicket,
    growth: () => CapacityUsage,
    operation: () => Promise<T>,
    snapshot: () => { readonly usage: CapacityUsage; readonly revision: bigint },
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      this.#requireTicket(ticket);
      if (this.#closed.signal.aborted || this.#retired(ticket.sequence))
        throw new ConnectError("Delivery mutation ticket is retired.", Code.FailedPrecondition);
      const existing =
        this.#pending.get(ticket.sequence) ??
        (this.#active?.ticket.sequence === ticket.sequence ? this.#active : undefined);
      if (existing !== undefined) return existing.promise as Promise<T>;
      if (signal?.aborted) throw CapacityMutationGate.#abort(signal);
      return this.#enqueue(ticket, growth, operation, snapshot, signal);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Delivery mutation failed."),
      );
    }
  }

  /**
   * Queues a distinct ticket after validating its place in this generation.
   *
   * @typeParam T The mutation result type.
   */
  #enqueue<T>(
    ticket: CapacityTicket,
    growth: () => CapacityUsage,
    operation: () => Promise<T>,
    snapshot: () => { readonly usage: CapacityUsage; readonly revision: bigint },
    signal?: AbortSignal,
  ): Promise<T> {
    const deferred = Promise.withResolvers<unknown>();
    const onAbort = () => {
      if (signal !== undefined)
        this.#retireQueued(ticket.sequence, CapacityMutationGate.#abort(signal));
    };
    const entry: PendingMutation = {
      ticket,
      growth,
      operation,
      snapshot,
      signal,
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      onAbort,
    };
    this.#pending.set(ticket.sequence, entry);
    signal?.addEventListener("abort", onAbort, { once: true });
    this.#schedule();
    return entry.promise as Promise<T>;
  }

  /**
   * Cancels a queued mutation or waits for an admitted mutation to settle.
   *
   * @param ticket Names the original public request.
   * @returns Completion after the named mutation settles or is retired.
   */
  async barrier(ticket: CapacityTicket): Promise<void> {
    this.#requireTicket(ticket);
    if (this.#active?.ticket.sequence === ticket.sequence) {
      await this.#active.promise.then(
        () => undefined,
        () => undefined,
      );
      return;
    }
    this.#retireQueued(
      ticket.sequence,
      new ConnectError("Delivery mutation ticket is retired.", Code.FailedPrecondition),
    );
  }

  /**
   * Cancels queued mutations and stops private capacity retries during shutdown.
   */
  close(): void {
    if (this.#closed.signal.aborted) return;
    this.#closed.abort();
    for (const sequence of [...this.#pending.keys()])
      this.#retireQueued(sequence, CapacityMutationGate.#abort(this.#closed.signal));
  }

  /**
   * Rejects a ticket from another child slot or process generation.
   */
  #requireTicket(ticket: CapacityTicket): void {
    if (
      !Number.isSafeInteger(ticket.slot) ||
      ticket.slot < 0 ||
      ticket.sequence < 1n ||
      ticket.generation.length === 0
    )
      throw new ConnectError("Delivery mutation ticket is invalid.", Code.InvalidArgument);
    const identity = `${String(ticket.slot)}:${ticket.generation}`;
    if (this.#identity !== undefined && this.#identity !== identity)
      throw new ConnectError("Delivery child generation is stale.", Code.FailedPrecondition);
    this.#identity ??= identity;
  }

  /**
   * Checks a retired ticket without hiding a lower pending sequence.
   */
  #retired(sequence: bigint): boolean {
    return sequence <= this.#retiredThrough || this.#retiredGaps.has(sequence);
  }

  /**
   * Advances the contiguous sequence only after all earlier tickets retire.
   */
  #retire(sequence: bigint): void {
    this.#retiredGaps.add(sequence);
    while (this.#retiredGaps.delete(this.#retiredThrough + 1n)) this.#retiredThrough++;
  }

  /**
   * Rejects a queued ticket before its growth calculation begins.
   */
  #retireQueued(sequence: bigint, reason: Error): void {
    if (this.#retired(sequence)) return;
    if (this.#active?.ticket.sequence === sequence) return;
    const entry = this.#pending.get(sequence);
    if (entry !== undefined) {
      this.#pending.delete(sequence);
      entry.signal?.removeEventListener("abort", entry.onAbort);
      entry.reject(reason);
    }
    this.#retire(sequence);
    this.#schedule();
  }

  /**
   * Defers admission so a lower sequence can arrive in the same turn.
   */
  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#admitNext();
    });
  }

  /**
   * Starts exactly the next unretired ticket for this child generation.
   */
  #admitNext(): void {
    if (this.#active !== undefined || this.#closed.signal.aborted) return;
    const sequence = this.#retiredThrough + 1n;
    const entry = this.#pending.get(sequence);
    if (entry === undefined) return;
    this.#pending.delete(sequence);
    this.#active = entry;
    void this.#execute(entry)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        entry.signal?.removeEventListener("abort", entry.onAbort);
        this.#active = undefined;
        this.#retire(sequence);
        this.#schedule();
      });
  }

  /**
   * Reserves growth before commit and reports usage even after a handler error.
   */
  async #execute(entry: PendingMutation): Promise<unknown> {
    const { ticket, signal } = entry;
    if (signal?.aborted) throw CapacityMutationGate.#abort(signal);
    const growth = entry.growth();
    try {
      await this.#repeat((abort) => this.capacity.reserve(ticket, growth, abort), signal);
    } catch (error) {
      await this.#cancelTicket(ticket);
      throw error;
    }
    if (signal?.aborted || this.#closed.signal.aborted) {
      await this.#cancelTicket(ticket);
      throw CapacityMutationGate.#abort(signal?.aborted ? signal : this.#closed.signal);
    }
    let outcome: { readonly value: unknown } | { readonly error: unknown };
    try {
      outcome = { value: await entry.operation() };
    } catch (error) {
      outcome = { error };
    }
    const { usage, revision } = entry.snapshot();
    await this.#repeat((abort) => this.capacity.report(ticket, usage, revision, abort));
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }

  /**
   * Retries ambiguous private transport failures until success or shutdown.
   */
  async #repeat(call: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
    let delay = 0;
    for (;;) {
      if (this.#closed.signal.aborted || signal?.aborted)
        throw CapacityMutationGate.#abort(signal ?? this.#closed.signal);
      const started = Time.monotonicTime();
      try {
        await this.#callWithAbort(call, signal);
        return;
      } catch (error) {
        if (this.#closed.signal.aborted || signal?.aborted) throw error;
        if (error instanceof ConnectError && CapacityMutationGate.#terminal(error.code))
          throw error;
        const observed = Math.max(1, Math.ceil(Time.monotonicTime() - started));
        delay = delay === 0 ? observed : delay * 2;
        await this.#pause(delay, signal);
      }
    }
  }

  /**
   * Cancels a granted ticket until acknowledged while live, or once on shutdown.
   */
  async #cancelTicket(ticket: CapacityTicket): Promise<void> {
    if (!this.#closed.signal.aborted) {
      try {
        await this.#repeat((signal) => this.capacity.cancel(ticket, signal));
      } catch (error) {
        if (!this.#closed.signal.aborted) throw error;
      }
      return;
    }
    const attempt = new AbortController();
    const end = setImmediate(() => attempt.abort());
    try {
      await this.#callWithAbort((signal) => this.capacity.cancel(ticket, signal),
        attempt.signal, true);
    } catch {
      // Slot replacement retires uncertain capacity after this child exits.
    } finally {
      clearImmediate(end);
    }
  }

  /**
   * Races a private RPC against caller and child shutdown, including stalled transports.
   */
  #callWithAbort(call: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal,
    ignoreClose = false): Promise<void> {
    const active = ignoreClose ? signal : signal === undefined ? this.#closed.signal :
      AbortSignal.any([signal, this.#closed.signal]);
    if (active === undefined) throw new TypeError("Private cleanup signal is missing.");
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        active.removeEventListener("abort", abort);
        reject(CapacityMutationGate.#abort(active));
      };
      active.addEventListener("abort", abort, { once: true });
      if (active.aborted) { abort(); return; }
      try {
        void call(active).then(() => {
          active.removeEventListener("abort", abort);
          resolve();
        }, (error: unknown) => {
          active.removeEventListener("abort", abort);
          reject(error instanceof Error ? error : new Error("Private capacity call failed."));
        });
      } catch (error) {
        active.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error("Private capacity call failed."));
      }
    });
  }

  /**
   * Waits for an adaptive delay using chained Node timers when necessary.
   */
  async #pause(delay: number, signal?: AbortSignal): Promise<void> {
    let remaining = Number.isFinite(delay) ? delay : Number.MAX_SAFE_INTEGER;
    while (remaining > 0 && !signal?.aborted && !this.#closed.signal.aborted) {
      const slice = Math.min(remaining, 2_147_483_647);
      await new Promise<void>((resolve) => {
        const stop = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", stop);
          this.#closed.signal.removeEventListener("abort", stop);
          resolve();
        };
        const timer = setTimeout(stop, slice);
        signal?.addEventListener("abort", stop, { once: true });
        this.#closed.signal.addEventListener("abort", stop, { once: true });
        if (signal?.aborted || this.#closed.signal.aborted) stop();
      });
      remaining -= slice;
    }
  }

  /**
   * Distinguishes definitive protocol rejections from ambiguous transport errors.
   */
  static #terminal(code: Code): boolean {
    return (
      code === Code.ResourceExhausted ||
      code === Code.InvalidArgument ||
      code === Code.FailedPrecondition ||
      code === Code.Unauthenticated ||
      code === Code.PermissionDenied ||
      code === Code.Unimplemented
    );
  }

  /**
   * Preserves a caller's cancellation reason when available.
   */
  static #abort(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Delivery mutation aborted.");
  }
}
