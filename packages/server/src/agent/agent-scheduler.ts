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
import type { TenantId } from "@spine-event-engine/proto";
import type {
  AgentPendingCursor,
  AgentPendingPage,
  TenantCatalogCursor,
} from "@spine-event-engine/storage/provider";
import { AgentExecutionRecords } from "@spine-event-engine/storage/provider";
import { Time } from "@spine-event-engine/core";
import type { TenantIndexPage } from "../context/tenant-index.js";
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
 * Produces finite tenant pages and lazily constructs registered scopes.
 */
export interface AgentScopeSource {
  /**
   * Number of registered Agent repository views per tenant.
   */
  readonly repositories: number;

  /**
   * Reads one bounded tenant catalog page.
   * @param after Opaque provider continuation from the prior page.
   * @param signal Scheduler shutdown signal.
   * @returns Complete tenant IDs and a possible continuation.
   */
  page(after: TenantCatalogCursor | undefined, signal: AbortSignal): Promise<TenantIndexPage>;

  /**
   * Creates one registered repository scope for a selected tenant.
   * @param tenant Complete tenant identifier.
   * @param repository Index in the fixed registered repository list.
   * @returns A lazily constructed scan scope.
   */
  scope(tenant: TenantId, repository: number): AgentScanScope;
}

interface ResidentScope {
  readonly scope: AgentScanScope;
  cursor?: AgentPendingCursor;
}

interface VisitedPage {
  readonly page: AgentPendingPage;
  readonly retry: boolean;
}

const catalogPageSize = 16;
const pendingPageSize = 16;
const maxPendingPages = 4;
const maxResidentScopes = 4;
const maxUrgentScopes = 64;
const sweepIntervalNanoseconds = 5_000_000_000n;

/**
 * Bounded, round-robin scan of provider-indexed Agent heads.
 */
export class AgentScheduler {
  readonly #controller = new AbortController();

  readonly #active = new Map<string, Promise<void>>();

  readonly #urgent = new Map<string, ResidentScope>();

  readonly #resident: ResidentScope[] = [];

  #catalogAfter: TenantCatalogCursor | undefined;

  #catalogPage: TenantIndexPage | undefined;

  #catalogReady: TenantIndexPage | undefined;

  #catalogRequest: Promise<void> | undefined;

  #catalogDone = false;

  #tenantAt = 0;

  #repositoryAt = 0;

  #restartAt = 0n;

  #sweepStarted = false;

  #sweepFirst = false;

  #nextResident = 0;

  #timer: ReturnType<typeof setTimeout> | undefined;

  #scanning: Promise<void> | undefined;

  #closed = false;

  /**
   * Creates bounded discovery for the context's registered Agent scopes.
   * @param source Pages tenants and constructs a registered scope on demand.
   * @param capacity Shared registry execution gate.
   * @param onError Reports failed discovery or execution turns.
   */
  constructor(
    private readonly source: AgentScopeSource,
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
    if (scope !== undefined && !this.#urgent.has(scope.id) && this.#urgent.size < maxUrgentScopes)
      this.#urgent.set(scope.id, { scope });
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
    this.#prepareSweep();
    const sweepFirst = this.#sweepFirst;
    const visited = new Set<ResidentScope>();
    const firstSweep = sweepFirst ? await this.#sweepPages(1, visited) : 0;
    let pages = firstSweep;
    pages += await this.#urgentPages(3 - pages);
    pages += await this.#sweepPages(maxPendingPages - pages, visited);
    if (pages > 0) this.#sweepFirst = !sweepFirst;
  }

  /**
   * Visits a bounded set of accepted scopes ahead of catalog rotation.
   * @param limit Maximum indexed pages to visit.
   * @returns Number of pages visited.
   */
  async #urgentPages(limit: number): Promise<number> {
    let pages = 0;
    for (const [id, resident] of this.#urgent) {
      if (pages === limit || this.#closed || this.capacity.full()) break;
      const { page, retry } = await this.#visit(resident);
      if (!retry) {
        if (page.hasMore && page.after !== undefined) resident.cursor = page.after;
        else this.#urgent.delete(id);
      }
      pages += 1;
    }
    return pages;
  }

  /**
   * Advances the periodic catalog sweep even under sustained accepted work.
   * @param limit Remaining page budget.
   * @param visited Residents already read in this turn.
   * @returns Number of pages visited.
   */
  async #sweepPages(limit: number, visited: Set<ResidentScope>): Promise<number> {
    let pages = 0;
    for (let considered = 0; considered < maxResidentScopes && pages < limit; considered += 1) {
      if (this.#closed || this.capacity.full()) break;
      if (this.#resident.length === 0) break;
      const index = this.#nextResident % this.#resident.length;
      const resident = this.#resident[index];
      if (resident === undefined) break;
      if (visited.has(resident)) {
        this.#nextResident = index + 1;
        continue;
      }
      visited.add(resident);
      const { page, retry } = await this.#visit(resident);
      if (page.hasMore || retry) {
        if (!retry && page.after !== undefined) resident.cursor = page.after;
        this.#nextResident = index + 1;
      } else {
        this.#resident.splice(index, 1);
        this.#nextResident = index;
      }
      pages += 1;
    }
    return pages;
  }

  /**
   * Restarts completed traversals only after their original cadence.
   */
  #prepareSweep(): void {
    const now = Time.currentTime();
    const current = now.seconds * 1_000_000_000n + BigInt(now.nanos);
    if (!this.#sweepStarted || (this.#completeSweep() && current >= this.#restartAt)) {
      this.#sweepStarted = true;
      this.#restartAt = current + sweepIntervalNanoseconds;
      this.#catalogDone = false;
      this.#catalogAfter = undefined;
    }
    this.#acceptCatalogPage();
    this.#fillResident();
    if (!this.#catalogDone && this.#catalogPage === undefined && this.#catalogRequest === undefined)
      this.#requestCatalogPage();
  }

  /**
   * Reports whether the prior finite catalog traversal has ended.
   */
  #completeSweep(): boolean {
    return (
      this.#catalogDone &&
      this.#catalogPage === undefined &&
      this.#catalogReady === undefined &&
      this.#catalogRequest === undefined &&
      this.#resident.length === 0
    );
  }

  /**
   * Installs one settled provider page without retaining earlier pages.
   */
  #acceptCatalogPage(): void {
    const page = this.#catalogReady;
    if (page === undefined) return;
    this.#catalogReady = undefined;
    if (page.ids.length > catalogPageSize || (page.hasMore && page.after === undefined))
      throw new Error("Agent tenant catalog returned an invalid bounded page.");
    if (page.hasMore && page.after === this.#catalogAfter)
      throw new Error("Agent tenant catalog returned a nonadvancing continuation.");
    this.#catalogPage = page;
    this.#catalogAfter = page.after;
    this.#catalogDone = !page.hasMore;
    this.#tenantAt = 0;
    this.#repositoryAt = 0;
  }

  /**
   * Constructs at most four resident tenant/repository scopes.
   */
  #fillResident(): void {
    while (this.#resident.length < maxResidentScopes && this.#catalogPage !== undefined) {
      const tenant = this.#catalogPage.ids[this.#tenantAt];
      if (tenant === undefined) {
        this.#catalogPage = undefined;
        break;
      }
      this.#resident.push({ scope: this.source.scope(tenant, this.#repositoryAt) });
      this.#repositoryAt += 1;
      if (this.#repositoryAt === this.source.repositories) {
        this.#repositoryAt = 0;
        this.#tenantAt += 1;
      }
    }
  }

  /**
   * Starts one provider page without making urgent work await its I/O.
   */
  #requestCatalogPage(): void {
    const after = this.#catalogAfter;
    let received = false;
    this.#catalogRequest = Promise.resolve()
      .then(() => {
        if (this.#closed) return undefined;
        return this.source.page(after, this.#controller.signal);
      })
      .then((page) => {
        if (!this.#closed && page !== undefined) {
          this.#catalogReady = page;
          received = true;
        }
      })
      .catch((error: unknown) => {
        if (!this.#closed) this.onError(error);
      })
      .finally(() => {
        this.#catalogRequest = undefined;
        if (this.#closed) return;
        if (received) this.wake();
        else this.#schedule(100);
      });
  }

  /**
   * Reads one indexed pending page with shutdown detachment.
   */
  async #visit(resident: ResidentScope): Promise<VisitedPage> {
    const page = await this.#awaitStop(resident.scope.pending(resident.cursor, pendingPageSize));
    if (page.records.length > pendingPageSize)
      throw new Error("Agent pending provider exceeded the bounded page size.");
    if (page.hasMore && page.after === undefined)
      throw new Error("Agent pending provider omitted its required continuation.");
    if (page.hasMore && !this.#advances(resident.cursor, page.after))
      throw new Error("Agent pending provider returned a nonadvancing continuation.");
    let retry = false;
    if (!this.#closed)
      for (const record of page.records) if (!this.#submit(resident.scope, record)) retry = true;
    return { page, retry };
  }

  /**
   * Verifies that a continuation moves beyond the previously examined head.
   */
  #advances(
    before: AgentPendingCursor | undefined,
    after: AgentPendingCursor | undefined,
  ): boolean {
    if (after === undefined) return false;
    if (before === undefined) return true;
    if (after.asOf.seconds !== before.asOf.seconds || after.asOf.nanos !== before.asOf.nanos)
      return false;
    return (
      AgentExecutionRecords.pendingKey(after.key.eligibleAt, after.key.scope) >
      AgentExecutionRecords.pendingKey(before.key.eligibleAt, before.key.scope)
    );
  }

  /**
   * Detaches promptly from a provider read that ignores cancellation.
   * @typeParam T Provider response type.
   * @param promise Underlying provider read.
   * @returns Response or prompt shutdown rejection.
   */
  #awaitStop<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = this.#controller.signal;
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("Agent discovery stopped."));
      };
      signal.addEventListener("abort", abort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          if (!signal.aborted) resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(
            error instanceof Error ? error : new Error("Agent discovery failed.", { cause: error }),
          );
        },
      );
      if (signal.aborted) abort();
    });
  }

  #submit(scope: AgentScanScope, record: AgentExecutionRecord): boolean {
    const key = record.accepted?.key;
    if (key === undefined || this.#closed) return false;
    const id = `${scope.id}:${Buffer.from(toBinary(AgentInvocationKeySchema, key)).toString("base64")}`;
    if (this.#active.has(id)) return true;
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
    if (task === undefined) return false;
    this.#active.set(id, task);
    void task.catch(this.onError).finally(() => {
      this.#active.delete(id);
      this.wake();
    });
    return true;
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
    this.#resident.length = 0;
    this.#catalogPage = undefined;
    this.#catalogReady = undefined;
  }

  /**
   * Waits for dispatched work after stopping new discovery.
   * @returns Completion after active work has settled.
   */
  async close(): Promise<void> {
    this.stop();
    await this.#scanning?.catch((error: unknown) => {
      if (!this.#closed) throw error;
    });
    await Promise.allSettled(this.#active.values());
  }
}
