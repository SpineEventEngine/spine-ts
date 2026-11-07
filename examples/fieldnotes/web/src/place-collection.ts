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

import { QUERY_SERVICE_MAX_RESULTS } from "@spine-event-engine/core";
import type { PlaceView } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";

/**
 * Reads one canonical author-scoped active page from the private gateway.
 *
 * @param cursor Exclusive byte cursor for continuation.
 * @param signal Abort signal for this scan.
 * @returns One bounded page of projected Place views.
 */
export type PlacePageReader = (
  cursor: Uint8Array | undefined,
  signal: AbortSignal,
) => Promise<readonly PlaceView[]>;

/**
 * One pending command's required projected revision or terminal removal.
 */
interface ViewWaiter {
  /**
   * Typed PlaceId expected to change.
   */
  readonly id: string;

  /**
   * Minimum accepted revision for an active result.
   */
  readonly revision: number;

  /**
   * Whether an ID-only terminal removal completes the wait.
   */
  readonly removed: boolean;

  /**
   * Resolves after the matching projected result.
   */
  readonly onResolve: () => void;

  /**
   * Rejects when client work is cancelled or interrupted.
   */
  readonly onReject: (error: Error) => void;
}

/**
 * Maintains one complete private collection while merging live revisioned changes.
 */
export class FieldnotesPlaceCollection {
  readonly #active = new Map<string, PlaceView>();

  readonly #terminal = new Set<string>();

  readonly #waiters = new Set<ViewWaiter>();

  #overlay = new Map<string, PlaceView>();

  #scanning = false;

  #generation = 0;

  #abort: AbortController | undefined;

  #latestScan: Promise<void> | undefined;

  #closed = false;

  /**
   * Binds one verified principal to canonical pages and visible changes.
   *
   * @param author Verified application principal identifier.
   * @param read Reads one active page using the native query contract.
   * @param onChange Reports a collection change without exposing provider data.
   */
  constructor(
    private readonly author: string,
    private readonly read: PlacePageReader,
    private readonly onChange: () => void,
  ) {}

  /**
   * Returns only active places from the last complete scan plus live changes.
   *
   * @returns Current visible states.
   */
  places(): readonly PlaceView[] {
    return [...this.#active.values()];
  }

  /**
   * Reads all byte-cursor pages before replacing the previous collection.
   *
   * @returns Completion after the final empty page and live overlay merge.
   */
  scan(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Place collection closed."));
    this.#abort?.abort();
    const current = ++this.#generation;
    const abort = new AbortController();
    this.#abort = abort;
    this.#overlay = new Map();
    this.#scanning = true;
    const work = this.readAndPublish(current, abort);
    const completion = work.catch((error: unknown) => {
      if (current === this.#generation) throw error;
    }).then(async () => {
      if (current !== this.#generation && !this.#closed) await this.#latestScan;
    });
    this.#latestScan = completion;
    return completion;
  }

  /**
   * Replaces only one current complete scan, retaining higher live revisions.
   *
   * @param current Scan generation.
   * @param abort Cancellation of superseded pages.
   * @returns Completion after a full authoritative replacement.
   */
  private async readAndPublish(current: number, abort: AbortController): Promise<void> {
    try {
      const snapshot = await this.pages(abort.signal);
      if (current !== this.#generation) return;
      for (const [id] of snapshot) {
        const prior = this.#active.get(id);
        if (prior !== undefined) this.put(snapshot, id, prior);
      }
      for (const [id, view] of this.#overlay) this.put(snapshot, id, view);
      for (const id of this.#terminal) snapshot.delete(id);
      this.#active.clear();
      for (const [id, view] of snapshot) this.#active.set(id, view);
      this.onChange();
      this.notify();
    } finally {
      if (current === this.#generation) this.#scanning = false;
    }
  }

  /**
   * Merges one author-scoped live state by revision during or after a scan.
   *
   * @param view Projected PlaceView from the native entity stream.
   */
  receive(view: PlaceView): void {
    if (this.#closed) return;
    const id = this.valid(view);
    if (this.#terminal.has(id)) return;
    if (view.removed) {
      const current = this.#active.get(id);
      if (current !== undefined && view.revision <= current.revision) return;
      this.remove(id);
      return;
    }
    this.put(this.#active, id, view);
    if (this.#scanning) this.put(this.#overlay, id, view);
    this.onChange();
    this.notify();
  }

  /**
   * Records an ID-only terminal removal from the author-only entity stream.
   *
   * @param id Typed PlaceId value carried by the control update.
   */
  remove(id: string): void {
    if (this.#closed) return;
    if (!id) throw new Error("Place removal has no typed ID.");
    this.#terminal.add(id);
    this.#active.delete(id);
    this.#overlay.delete(id);
    this.onChange();
    this.notify();
  }

  /**
   * Waits for a Command result to reach its projected visible revision.
   *
   * @param id Typed PlaceId for the accepted Command.
   * @param revision Minimum committed revision.
   * @param removed Whether a terminal ID-only control is the expected result.
   * @param signal Optional command cancellation.
   * @returns Completion only after the matching projected state or removal.
   */
  waitFor(id: string, revision: number, removed: boolean, signal?: AbortSignal): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Place collection closed."));
    if (this.matches(id, revision, removed)) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(new Error("Place observation cancelled."));
    return new Promise<void>((resolve, reject) => {
      const onResolve = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
      const onReject = (error: Error) => { signal?.removeEventListener("abort", onAbort); reject(error); };
      const waiter: ViewWaiter = { id, revision, removed, onResolve, onReject };
      const onAbort = () => {
        this.#waiters.delete(waiter);
        onReject(new Error("Place observation cancelled."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
    });
  }

  /**
   * Cancels pending pages and clears all private state on principal departure.
   */
  close(): void {
    this.#closed = true;
    this.#generation++;
    this.#abort?.abort();
    this.#scanning = false;
    this.#active.clear();
    this.#overlay.clear();
    this.#terminal.clear();
    this.fail(new Error("Place collection closed."));
  }

  /**
   * Rejects waits when the native stream can no longer confirm results.
   *
   * @param error Current stream or session failure.
   */
  fail(error: Error): void {
    for (const waiter of this.#waiters) waiter.onReject(error);
    this.#waiters.clear();
  }

  /**
   * Completes waits whose projected state now satisfies their result barrier.
   */
  private notify(): void {
    for (const waiter of this.#waiters) {
      if (!this.matches(waiter.id, waiter.revision, waiter.removed)) continue;
      this.#waiters.delete(waiter);
      waiter.onResolve();
    }
  }

  /**
   * Checks a current PlaceView revision or terminal removal.
   *
   * @param id Expected typed PlaceId.
   * @param revision Minimum accepted revision.
   * @param removed Whether the expected result is terminal.
   * @returns Whether the visible result barrier is satisfied.
   */
  private matches(id: string, revision: number, removed: boolean): boolean {
    if (removed) return this.#terminal.has(id);
    return (this.#active.get(id)?.revision ?? -1) >= revision;
  }

  /**
   * Reads until the final empty page, validating order and detached byte keys.
   *
   * @param signal Current scan cancellation.
   * @returns Complete active snapshot.
   */
  private async pages(signal: AbortSignal): Promise<Map<string, PlaceView>> {
    const snapshot = new Map<string, PlaceView>();
    let cursor: Uint8Array | undefined;
    for (;;) {
      const page = await this.read(cursor, signal);
      signal.throwIfAborted();
      if (page.length > QUERY_SERVICE_MAX_RESULTS) throw new Error("Place page exceeds capacity.");
      if (page.length === 0) return snapshot;
      for (const view of page) {
        const id = this.valid(view);
        if (view.removed) throw new Error("Active Place page contains a removed state.");
        if (cursor !== undefined && this.compare(view.placeKey, cursor) <= 0)
          throw new Error("Place page key did not advance.");
        cursor = new Uint8Array(view.placeKey);
        this.put(snapshot, id, view);
      }
    }
  }

  /**
   * Checks identity, author and the immutable UTF-8 continuation key.
   *
   * @param view Native projected state.
   * @returns Typed PlaceId string.
   */
  private valid(view: PlaceView): string {
    const id = view.id?.value;
    if (!id || view.author?.value !== this.author || view.revision <= 0)
      throw new Error("Place view has invalid author or typed ID.");
    if (view.removed) return id;
    const encoded = new TextEncoder().encode(id);
    if (this.compare(view.placeKey, encoded) !== 0)
      throw new Error("Place key differs from the typed ID bytes.");
    return id;
  }

  /**
   * Stores only the latest active revision for a typed identifier.
   *
   * @param target Current or staged states.
   * @param id Typed PlaceId value.
   * @param view Candidate projected state.
   */
  private put(target: Map<string, PlaceView>, id: string, view: PlaceView): void {
    if (this.#terminal.has(id)) return;
    const previous = target.get(id);
    if (previous === undefined || view.revision > previous.revision) target.set(id, view);
  }

  /**
   * Compares complete byte keys without locale or string collation.
   *
   * @param left First encoded key.
   * @param right Second encoded key.
   * @returns Negative, zero or positive order.
   */
  private compare(left: Uint8Array, right: Uint8Array): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return left.length - right.length;
  }
}
