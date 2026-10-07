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

interface CapacityRequest {
  readonly key: string;
  readonly signal: AbortSignal;
  readonly run: () => Promise<void>;
}

interface RetainedRequest extends CapacityRequest {
  readonly completion: PromiseWithResolvers<undefined>;
  readonly onAbort: () => void;
  started: boolean;
  settled: boolean;
}

const capacities = new WeakMap<AiRegistry, AgentExecutionCapacity>();

/**
 * Bounds active Agent transitions and resident waiting hints across one AI registry.
 */
export class AgentExecutionCapacity {
  readonly #entries = new Map<string, RetainedRequest>();

  readonly #active = new Set<RetainedRequest>();

  readonly #waiting: RetainedRequest[] = [];

  /**
   * Creates a registry gate with finite active and resident waiting limits.
   * @param concurrent Maximum simultaneously active Agent transitions.
   * @param queued Maximum additional resident waiting descriptors.
   */
  constructor(
    private readonly concurrent: number,
    private readonly queued: number,
  ) {
    if (
      !Number.isSafeInteger(concurrent) ||
      concurrent < 1 ||
      !Number.isSafeInteger(queued) ||
      queued < 0
    )
      throw new TypeError("Agent execution capacity requires finite registry limits.");
  }

  /**
   * Finds the process-local capacity shared by contexts using this registry object.
   * @param registry Exact registry object shared by the contexts.
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
   * @returns Whether another descriptor must remain only in durable storage.
   */
  full(): boolean {
    return this.#active.size >= this.concurrent && this.#waiting.length >= this.queued;
  }

  /**
   * Tries to retain one descriptor; overflow remains in durable storage.
   * @param request Keyed work hint and cancellation signal from one context.
   * @returns Completion of retained work, or undefined when admission is declined.
   */
  trySubmit(request: CapacityRequest): Promise<void> | undefined {
    if (request.signal.aborted || this.#entries.has(request.key) || this.full()) return undefined;
    const completion = Promise.withResolvers<undefined>();
    const entry: RetainedRequest = {
      ...request,
      completion,
      started: false,
      settled: false,
      onAbort: () => {
        this.#cancelWaiting(entry);
      },
    };
    this.#entries.set(entry.key, entry);
    entry.signal.addEventListener("abort", entry.onAbort, { once: true });
    if (this.#active.size < this.concurrent) this.#start(entry);
    else this.#waiting.push(entry);
    return completion.promise;
  }

  /**
   * Starts a retained descriptor only after it receives an active slot.
   */
  #start(entry: RetainedRequest): void {
    entry.started = true;
    this.#active.add(entry);
    void Promise.resolve()
      .then(() => {
        if (!entry.signal.aborted) return entry.run();
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
    const index = this.#waiting.indexOf(entry);
    if (index >= 0) this.#waiting.splice(index, 1);
    this.#settle(entry);
  }

  /**
   * Releases a finished slot once, then starts the oldest eligible hint.
   */
  #finish(entry: RetainedRequest, error?: unknown): void {
    if (entry.settled) return;
    this.#active.delete(entry);
    this.#settle(entry, error);
    while (this.#active.size < this.concurrent && this.#waiting.length > 0) {
      const next = this.#waiting.shift();
      if (next !== undefined && !next.settled) this.#start(next);
    }
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
