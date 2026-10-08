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

import { clone, toBinary } from "@bufbuild/protobuf";
import {
  AgentInvocationKeySchema,
  type AgentExecutionRecord,
  type AgentInvocationKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentPendingCursor, AgentPendingPage } from "@spine-event-engine/storage/provider";
import { Time } from "@spine-event-engine/core";
import { withoutDeliveryCommitFence } from "../repository/commit-fence.js";
import { AgentExecutionCapacity } from "./agent-execution-capacity.js";

/**
 * One complete repository and tenant visited by the Agent scheduler.
 */
export interface AgentScanScope {
  /**
   * Identifies one repository and tenant scan scope.
   */
  readonly id: string;

  /**
   * Reads a finite page of unresolved Agent invocations.
   * @param after Provider continuation from the prior page.
   * @param count Maximum records requested for this scan.
   * @returns Pending records and their next continuation.
   */
  pending(after: AgentPendingCursor | undefined, count: number): Promise<AgentPendingPage>;

  /**
   * Executes one invocation after attempting its provider claim.
   * @param key Exact accepted invocation selected by the scan.
   * @param signal Context shutdown cancellation signal.
   * @returns Completion after the claimed work settles.
   */
  run(key: AgentInvocationKey, signal: AbortSignal): Promise<void>;
}

/**
 * Bounded, round-robin scan of provider-indexed Agent heads.
 */
export class AgentScheduler {
  readonly #controller = new AbortController();

  readonly #cursors = new Map<string, AgentPendingCursor>();

  readonly #active = new Map<string, Promise<void>>();

  readonly #urgent = new Map<string, AgentScanScope>();

  #snapshot: readonly AgentScanScope[] = [];

  #refreshAt = 0n;

  #sweepFirst = false;

  #nextScope = 0;

  #timer: ReturnType<typeof setTimeout> | undefined;

  #scanning: Promise<void> | undefined;

  #closed = false;

  /**
   * Creates bounded discovery for the context's registered Agent scopes.
   * @param scopes Enumerates current repository and tenant scan scopes.
   * @param capacity Shared registry execution gate.
   * @param onError Reports failed discovery or execution turns.
   */
  constructor(
    private readonly scopes: () => Promise<readonly AgentScanScope[]>,
    private readonly capacity: AgentExecutionCapacity,
    private readonly onError: (error: unknown) => void,
  ) {}

  /**
   * Starts periodic discovery, including pending work after process reconstruction.
   */
  start(): void {
    this.#schedule(100);
  }

  /**
   * Schedules a prompt bounded turn without resetting the fixed-time sweep.
   * @param scope Newly accepted repository and tenant, when available.
   */
  wake(scope?: AgentScanScope): void {
    if (this.#closed) return;
    if (scope !== undefined && (this.#urgent.has(scope.id) || this.#urgent.size < 64))
      this.#urgent.set(scope.id, scope);
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.turn()
        .catch(this.onError)
        .finally(() => {
          this.#schedule(100);
        });
    }, 0);
  }

  /**
   * Reads at most four indexed pages and retains continuation across turns.
   * @returns Completion after this bounded scan, or the scan already in progress.
   */
  async turn(): Promise<void> {
    if (this.#closed) return;
    if (this.#scanning !== undefined) return this.#scanning;
    const scan = this.#scan();
    this.#scanning = scan;
    try {
      await scan;
    } finally {
      this.#scanning = undefined;
    }
  }

  async #scan(): Promise<void> {
    const scopes = await this.#scopeSnapshot();
    const sweepFirst = this.#sweepFirst;
    const firstSweep = sweepFirst ? await this.#sweepPages(scopes, 1, 0) : 0;
    let pages = firstSweep;
    pages += await this.#urgentPages(3 - pages);
    pages += await this.#sweepPages(scopes, 4 - pages, firstSweep);
    if (pages > 0) this.#sweepFirst = !sweepFirst;
  }

  /**
   * Visits a bounded set of accepted scopes ahead of catalog rotation.
   * @param limit Maximum indexed pages to visit.
   * @returns Number of pages visited.
   */
  async #urgentPages(limit: number): Promise<number> {
    let pages = 0;
    for (const [id, scope] of this.#urgent) {
      if (pages === limit || this.#closed || this.capacity.full()) break;
      this.#urgent.delete(id);
      await this.#visit(scope);
      pages += 1;
    }
    return pages;
  }

  /**
   * Advances the periodic catalog sweep even under sustained accepted work.
   * @param scopes Current catalog snapshot.
   * @param limit Remaining page budget.
   * @param alreadyVisited Scope pages visited earlier in this turn.
   * @returns Number of pages visited.
   */
  async #sweepPages(
    scopes: readonly AgentScanScope[],
    limit: number,
    alreadyVisited: number,
  ): Promise<number> {
    let pages = 0;
    for (; pages < Math.min(limit, scopes.length - alreadyVisited); pages += 1) {
      if (this.#closed || this.capacity.full()) break;
      const scope = scopes[this.#nextScope % scopes.length];
      this.#nextScope += 1;
      if (scope === undefined) break;
      await this.#visit(scope);
    }
    return pages;
  }

  /**
   * Amortizes the provider's full tenant catalog across bounded page turns.
   * @returns The current sweep snapshot, refreshed after five provider-time seconds.
   */
  async #scopeSnapshot(): Promise<readonly AgentScanScope[]> {
    const now = Time.currentTime();
    const current = now.seconds * 1_000_000_000n + BigInt(now.nanos);
    if (current >= this.#refreshAt) {
      this.#snapshot = await this.scopes();
      this.#refreshAt = current + 5_000_000_000n;
      this.#nextScope %= Math.max(1, this.#snapshot.length);
    }
    return this.#snapshot;
  }

  async #visit(scope: AgentScanScope): Promise<void> {
    if (this.capacity.full()) return;
    const page = await scope.pending(this.#cursors.get(scope.id), 16);
    if (page.hasMore && page.after === undefined)
      throw new Error("Agent pending provider omitted its required continuation.");
    for (const record of page.records) this.#submit(scope, record);
    if (page.hasMore && page.after !== undefined) this.#cursors.set(scope.id, page.after);
    else this.#cursors.delete(scope.id);
  }

  #submit(scope: AgentScanScope, record: AgentExecutionRecord): void {
    const key = record.accepted?.key;
    if (key === undefined || this.#closed) return;
    const id = `${scope.id}:${Buffer.from(toBinary(AgentInvocationKeySchema, key)).toString("base64")}`;
    if (this.#active.has(id)) return;
    const invocation = clone(AgentInvocationKeySchema, key);
    const task = this.capacity.trySubmit({
      key: id,
      signal: this.#controller.signal,
      run: () =>
        withoutDeliveryCommitFence(() => {
          if (this.#closed) return Promise.resolve();
          return scope.run(invocation, this.#controller.signal);
        }),
    });
    if (task === undefined) return;
    this.#active.set(id, task);
    void task.catch(this.onError).finally(() => {
      this.#active.delete(id);
      this.wake();
    });
  }

  #schedule(delay: number): void {
    if (this.#closed || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.turn()
        .catch(this.onError)
        .finally(() => {
          this.#schedule(100);
        });
    }, delay);
  }

  /**
   * Stops discovery and waits for already dispatched bounded work.
   */
  stop(): void {
    this.#closed = true;
    this.#controller.abort();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#urgent.clear();
  }

  /**
   * Waits for dispatched work after stopping new discovery.
   * @returns Completion after active work has settled.
   */
  async close(): Promise<void> {
    this.stop();
    await this.#scanning;
    await Promise.allSettled(this.#active.values());
  }
}
