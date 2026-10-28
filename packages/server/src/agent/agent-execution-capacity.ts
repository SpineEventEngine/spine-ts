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

import type { AiRegistry } from "@spine-event-engine/ai";
import { registryOptions } from "@spine-event-engine/ai/spi/runtime";

/**
 * A local slot retained before an Agent receipt is accepted.
 */
export interface AgentCapacityReservation {
  /**
   * Starts work after Inbox acknowledgement and the Agent turn become available.
   *
   * @param onRun Callback to run after capacity admission.
   * @returns Completion after admitted Agent work finishes.
   */
  run(onRun: () => Promise<void>): Promise<void>;

  /**
   * Clears a slot when receipt or acknowledgement admission does not complete.
   */
  release(): void;
}

interface RetainedRequest {
  readonly key: string;
  readonly signal: AbortSignal;
  run?: () => Promise<void>;
  readonly completion: PromiseWithResolvers<undefined>;
  readonly onAbort: () => void;
  started: boolean;
  settled: boolean;
}

const capacities = new WeakMap<AiRegistry, AgentExecutionCapacity>();

/**
 * Schedules active Agent transitions and resident waiting hints across one AI registry.
 */
export class AgentExecutionCapacity {
  readonly #entries = new Map<string, RetainedRequest>();

  readonly #active = new Set<RetainedRequest>();

  readonly #waiting: RetainedRequest[] = [];

  readonly #listeners = new Set<(key: string) => void>();

  #availabilityGeneration = 0;

  /**
   * Creates a registry gate with optional active and resident waiting limits.
   *
   * @param concurrent Maximum simultaneously active Agent transitions.
   * @param queued Maximum additional resident waiting descriptors.
   */
  constructor(
    private readonly concurrent?: number,
    private readonly queued?: number,
  ) {
    if (
      (concurrent !== undefined && (!Number.isSafeInteger(concurrent) || concurrent < 1)) ||
      (queued !== undefined && (!Number.isSafeInteger(queued) || queued < 0))
    )
      throw new TypeError("Agent execution capacity requires valid configured registry limits.");
  }

  /**
   * Finds the process-local capacity shared by Bounded Contexts using this registry object.
   *
   * @param registry Exact registry object shared by the Bounded Contexts.
   * @returns Existing gate or one initialized from registry limits.
   */
  static for(registry: AiRegistry): AgentExecutionCapacity {
    const existing = capacities.get(registry);
    if (existing !== undefined) return existing;
    const options = registryOptions(registry);
    const created = new AgentExecutionCapacity(
      options.concurrentOperations,
      options.queuedOperations,
    );
    capacities.set(registry, created);
    return created;
  }

  /**
   * Checks whether active and waiting slots are both filled.
   *
   * @returns Whether another descriptor must remain only in durable storage.
   */
  full(): boolean {
    return (
      this.concurrent !== undefined &&
      this.#active.size >= this.concurrent &&
      this.queued !== undefined &&
      this.#waiting.length >= this.queued
    );
  }

  /**
   * Observes released Agent identities and available registry capacity.
   *
   * @param onAvailable Callback invoked when capacity becomes available.
   * @returns A callback that removes this capacity listener.
   */
  onAvailable(onAvailable: (key: string) => void): () => void {
    this.#listeners.add(onAvailable);
    return () => {
      this.#listeners.delete(onAvailable);
    };
  }

  /**
   * Captures the current release generation for gap-free rechecking.
   *
   * @returns The current release generation for gap-free rechecking.
   */
  availabilityGeneration(): number {
    return this.#availabilityGeneration;
  }

  /**
   * Acquires bounded resident capacity before a durable Agent receipt attempt.
   *
   * @param key Physical or logical identity key.
   * @param signal Signal or cancellation signal for this operation.
   * @returns A capacity reservation or undefined when admission is unavailable.
   */
  reserve(key: string, signal: AbortSignal): AgentCapacityReservation | undefined {
    if (signal.aborted || this.#entries.has(key) || this.full()) return undefined;
    const completion = Promise.withResolvers<undefined>();
    const entry: RetainedRequest = {
      key,
      signal,
      completion,
      started: false,
      settled: false,
      onAbort: () => {
        this.#cancelWaiting(entry);
      },
    };
    this.#entries.set(entry.key, entry);
    entry.signal.addEventListener("abort", entry.onAbort, { once: true });
    if (this.concurrent === undefined || this.#active.size < this.concurrent)
      this.#active.add(entry);
    else this.#waiting.push(entry);
    return {
      run: (onRun) => this.#run(entry, onRun),
      release: () => {
        this.#cancelWaiting(entry);
      },
    };
  }

  /**
   * Starts a reserved descriptor only when it has an active slot.
   */
  #run(entry: RetainedRequest, onRun: () => Promise<void>): Promise<void> {
    if (entry.settled || entry.run !== undefined)
      throw new Error("Agent capacity reservation is no longer available.");
    entry.run = onRun;
    if (this.#active.has(entry)) this.#start(entry);
    return entry.completion.promise;
  }

  /**
   * Starts a retained descriptor only after it receives an active slot.
   */
  #start(entry: RetainedRequest): void {
    if (entry.run === undefined || entry.started || entry.settled) return;
    entry.started = true;
    void Promise.resolve()
      .then(() => {
        if (!entry.signal.aborted) return entry.run?.();
      })
      .then(
        () => {
          this.#finish(entry);
        },
        (error: unknown) => {
          this.#finish(entry, error);
        },
      );
  }

  /**
   * Removes a cancelled descriptor that has not claimed provider authority.
   */
  #cancelWaiting(entry: RetainedRequest): void {
    if (entry.started || entry.settled) return;
    if (this.#active.has(entry)) this.#finish(entry);
    else {
      const index = this.#waiting.indexOf(entry);
      if (index >= 0) this.#waiting.splice(index, 1);
      this.#settle(entry);
      this.#notifyAvailable(entry.key);
    }
  }

  /**
   * Releases a finished slot once, then starts the oldest eligible hint.
   */
  #finish(entry: RetainedRequest, error?: unknown): void {
    if (entry.settled) return;
    this.#active.delete(entry);
    this.#settle(entry, error);
    while (
      (this.concurrent === undefined || this.#active.size < this.concurrent) &&
      this.#waiting.length > 0
    ) {
      const next = this.#waiting.shift();
      if (next !== undefined && !next.settled) {
        this.#active.add(next);
        this.#start(next);
      }
    }
    this.#notifyAvailable(entry.key);
  }

  /**
   * Wakes eligibility observers after active and queued positions settle.
   */
  #notifyAvailable(key: string): void {
    this.#availabilityGeneration += 1;
    for (const listener of this.#listeners) listener(key);
  }

  /**
   * Removes one reservation and completes its bounded wait promise.
   */
  #settle(entry: RetainedRequest, error?: unknown): void {
    entry.settled = true;
    entry.signal.removeEventListener("abort", entry.onAbort);
    this.#entries.delete(entry.key);
    if (error === undefined) entry.completion.resolve(undefined);
    else entry.completion.reject(error);
  }
}
