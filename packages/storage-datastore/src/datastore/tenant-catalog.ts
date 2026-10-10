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

import { Time } from "@spine-event-engine/core/time";
import { Datastore } from "@google-cloud/datastore";
import {
  TenantBoundary,
  TenantCatalogReads,
  type TenantBoundary as TenantBoundaryValue,
  type TenantCatalog,
  type TenantCatalogCursor,
  type TenantCatalogPage,
  type TenantCatalogRead,
} from "@spine-event-engine/storage/provider";

import { NamespaceAssignments, type NamespaceConverter } from "./namespace.js";

const earlyTenantTtlMs = 60_000;
const maxEarlyTenants = 1_000;
const nativePageDeadlineMs = 5_000;

interface EarlyTenantOptions {
  readonly now?: () => number;
  readonly earlyTenantTtlMs?: number;
  readonly maxEarlyTenants?: number;
}

/**
 * Discovers Spine tenants from Datastore's native namespace metadata.
 */
export class DatastoreTenantCatalog implements TenantCatalog {
  readonly #cursorIdentity = {};

  readonly #kept = new Map<
    string,
    { readonly boundary: TenantBoundaryValue; readonly expiresAt: number }
  >();

  readonly #converter: NamespaceAssignments;

  readonly #now: () => number;

  readonly #earlyTenantTtlMs: number;

  readonly #maxEarlyTenants: number;

  #open = true;

  /**
   * Creates a native namespace catalog.
   *
   * @param client The caller-owned Datastore client.
   * @param converter Converts owned native namespaces to tenant identifiers.
   * @param options Internal deterministic early-admission cache controls.
   */
  constructor(
    private readonly client: Datastore,
    converter: NamespaceConverter,
    options: EarlyTenantOptions = {},
  ) {
    this.#converter =
      converter instanceof NamespaceAssignments ? converter : new NamespaceAssignments(converter);
    this.#now = options.now ?? (() => Time.currentTimeMillis());
    this.#earlyTenantTtlMs = options.earlyTenantTtlMs ?? earlyTenantTtlMs;
    this.#maxEarlyTenants = options.maxEarlyTenants ?? maxEarlyTenants;
    if (!Number.isFinite(this.#earlyTenantTtlMs) || this.#earlyTenantTtlMs <= 0)
      throw new Error("Datastore early-admission TTL must be finite and positive.");
    if (!Number.isSafeInteger(this.#maxEarlyTenants) || this.#maxEarlyTenants <= 0)
      throw new Error("Datastore early-admission capacity must be a positive safe integer.");
  }

  /**
   * Lists tenant boundaries represented by owned native namespaces.
   *
   * @returns The discovered and early-admitted tenant boundaries.
   */
  async all(): Promise<readonly TenantBoundaryValue[]> {
    this.requireOpen();
    const query = this.client.createQuery("", "__namespace__").select("__key__");
    let response: unknown;
    try {
      response = await this.client.runQuery(query);
    } catch {
      throw new Error("Datastore namespace discovery failed.");
    }
    if (!Array.isArray(response) || !Array.isArray(response[0]))
      throw new Error("Datastore returned invalid namespace metadata.");

    this.purgeExpired();
    const byBoundary = new Map<string, { namespace: string; boundary: TenantBoundaryValue }>();
    for (const value of response[0] as unknown[]) {
      const namespace = namespaceName(value, this.client.KEY);
      if (namespace === undefined || namespace.length === 0) continue;
      const tenantId = this.#converter.fromNamespace(namespace);
      if (tenantId === undefined) continue;
      const boundary = TenantBoundary.from(tenantId);
      const prior = byBoundary.get(String(boundary.key));
      if (prior !== undefined && prior.namespace !== namespace)
        throw new Error("Datastore namespaces resolve to the same tenant boundary.");
      byBoundary.set(String(boundary.key), { namespace, boundary });
      this.#kept.delete(namespace);
    }
    for (const [namespace, { boundary }] of this.#kept) {
      const prior = byBoundary.get(String(boundary.key));
      if (prior !== undefined && prior.namespace !== namespace)
        throw new Error("Datastore namespaces resolve to the same tenant boundary.");
      byBoundary.set(String(boundary.key), { namespace, boundary });
    }
    return [...byBoundary.values()]
      .sort((left, right) => left.namespace.localeCompare(right.namespace))
      .map(({ boundary }) => boundary);
  }

  /**
   * Reads one bounded early-admission or native namespace page.
   * @param request Finite candidate limit and instance-bound continuation.
   * @returns A possibly empty continuing tenant page.
   */
  async page(request: TenantCatalogRead): Promise<TenantCatalogPage> {
    this.requireOpen();
    TenantCatalogReads.require(request);
    const prior = request.after;
    if (prior !== undefined && !(prior instanceof DatastoreTenantCursor))
      throw new TypeError("Datastore tenant catalog continuation is invalid.");
    const cursor = prior?.state(this.#cursorIdentity);
    if (cursor === undefined) {
      this.purgeExpired();
      const early = Object.freeze([...this.#kept.values()].map(({ boundary }) => boundary));
      return this.#earlyPage(request, early, 0);
    }
    if (cursor.phase === "early") return this.#earlyPage(request, cursor.early, cursor.index);
    return this.#nativePage(request, cursor.early, cursor.nativeCursor);
  }

  /**
   * Reads only a bounded part of the fixed early-admission snapshot.
   */
  #earlyPage(
    request: TenantCatalogRead,
    early: readonly TenantBoundaryValue[],
    index: number,
  ): TenantCatalogPage {
    const end = Math.min(early.length, index + request.count);
    if (index === end)
      return {
        boundaries: [],
        after: new DatastoreTenantCursor(this.#cursorIdentity, early, "native", 0),
        hasMore: true,
      };
    request.signal.throwIfAborted();
    this.requireOpen();
    return {
      boundaries: early.slice(index, end),
      after: new DatastoreTenantCursor(
        this.#cursorIdentity,
        early,
        end < early.length ? "early" : "native",
        end,
      ),
      hasMore: true,
    };
  }

  /**
   * Converts one finite native metadata response without filling filtered pages.
   */
  async #nativePage(
    request: TenantCatalogRead,
    early: readonly TenantBoundaryValue[],
    start?: string,
  ): Promise<TenantCatalogPage> {
    const query = this.client
      .createQuery("", "__namespace__")
      .select("__key__")
      .limit(request.count);
    if (start !== undefined) query.start(start);
    const result = await this.#nativeCandidates(query, request);
    request.signal.throwIfAborted();
    this.requireOpen();
    const boundaries = this.#nativeBoundaries(result.values);
    return this.#nativeResult(result, early, start, boundaries);
  }

  /**
   * Converts only this native page's recognized namespaces.
   */
  #nativeBoundaries(values: readonly unknown[]): TenantBoundaryValue[] {
    const boundaries: TenantBoundaryValue[] = [];
    for (const value of values) {
      const namespace = namespaceName(value, this.client.KEY);
      if (namespace === undefined || namespace.length === 0) continue;
      const tenantId = this.#converter.fromNamespace(namespace);
      if (tenantId === undefined) continue;
      boundaries.push(TenantBoundary.from(tenantId));
      this.#kept.delete(namespace);
    }
    return boundaries;
  }

  /**
   * Validates the native continuation before exposing a catalog page.
   */
  #nativeResult(
    result: NativeCandidatePage,
    early: readonly TenantBoundaryValue[],
    start: string | undefined,
    boundaries: readonly TenantBoundaryValue[],
  ): TenantCatalogPage {
    const more =
      result.moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT ||
      result.moreResults === Datastore.MORE_RESULTS_AFTER_CURSOR;
    if (
      result.moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT &&
      result.values.length === 0 &&
      start !== undefined &&
      result.endCursor === start
    )
      return { boundaries, hasMore: false };
    if (
      more &&
      (result.endCursor === undefined ||
        result.endCursor.length === 0 ||
        result.endCursor === start)
    )
      throw new Error("Datastore tenant catalog returned a nonadvancing continuation.");
    if (!more && result.moreResults !== Datastore.NO_MORE_RESULTS)
      throw new Error("Datastore tenant catalog returned invalid continuation metadata.");
    const after = more
      ? new DatastoreTenantCursor(this.#cursorIdentity, early, "native", 0, result.endCursor)
      : undefined;
    return { boundaries, ...(after === undefined ? {} : { after }), hasMore: more };
  }

  /**
   * Collects no more than one native query limit under a finite deadline.
   */
  #nativeCandidates(
    query: ReturnType<Datastore["createQuery"]>,
    request: TenantCatalogRead,
  ): Promise<NativeCandidatePage> {
    const stream = this.client.runQueryStream(query, {
      gaxOptions: { timeout: nativePageDeadlineMs },
    });
    return collectNativeCandidates(stream, request);
  }

  /**
   * Records an admitted tenant until native metadata becomes visible.
   *
   * No record is written. Datastore creates namespace metadata when the first
   * application entity is persisted in that namespace.
   *
   * @param boundary The admitted multitenant boundary.
   * @returns Completion of the in-memory catalog update.
   */
  keep(boundary: TenantBoundaryValue): Promise<void> {
    return Promise.resolve().then(() => {
      this.keepNow(boundary);
    });
  }

  /**
   * Stores a tenant namespace until native Datastore metadata becomes visible.
   * @param boundary The tenant admitted for early reads.
   */
  private keepNow(boundary: TenantBoundaryValue): void {
    this.requireOpen();
    if (boundary.single || boundary.tenantId === undefined)
      throw new Error("Datastore tenant catalog requires a tenant boundary.");
    this.purgeExpired();
    const namespace = this.#converter.toNamespace(boundary.tenantId);
    const existing = this.#kept.get(namespace);
    if (existing !== undefined && existing.boundary.key !== boundary.key)
      throw new Error("Datastore namespace is already assigned to another tenant.");
    if (existing === undefined && this.#kept.size >= this.#maxEarlyTenants)
      throw new Error("Datastore early-admission cache is full.");
    this.#kept.set(namespace, {
      boundary,
      expiresAt: this.#now() + this.#earlyTenantTtlMs,
    });
  }

  /**
   * Closes this catalog without closing the caller-owned Datastore client.
   *
   * @returns Completion of catalog closure.
   */
  close(): Promise<void> {
    this.#open = false;
    this.#kept.clear();
    return Promise.resolve();
  }

  /**
   * Rejects catalog operations after closure.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Datastore tenant catalog is closed.");
  }

  /**
   * Removes early tenant admissions after their configured TTL.
   */
  private purgeExpired(): void {
    const now = this.#now();
    for (const [namespace, admission] of this.#kept) {
      if (admission.expiresAt <= now) this.#kept.delete(namespace);
    }
  }
}

/**
 * Immutable phase and native cursor tied to one Datastore catalog.
 */
class DatastoreTenantCursor implements TenantCatalogCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #early: readonly TenantBoundaryValue[];

  readonly #phase: "early" | "native";

  readonly #index: number;

  readonly #nativeCursor: string | undefined;

  /**
   * Captures one early-cache or native namespace continuation.
   * @param identity Private catalog issuance identity.
   * @param early Bounded early-admission snapshot.
   * @param phase Current early or native phase.
   * @param index Next early-admission position.
   * @param nativeCursor Native namespace continuation, when present.
   */
  constructor(
    identity: object,
    early: readonly TenantBoundaryValue[],
    phase: "early" | "native",
    index: number,
    nativeCursor?: string,
  ) {
    this.#identity = identity;
    this.#early = early;
    this.#phase = phase;
    this.#index = index;
    this.#nativeCursor = nativeCursor;
    Object.freeze(this);
  }

  /**
   * Verifies issuance before exposing this catalog's sweep position.
   * @param identity Private identity of the reading catalog.
   * @returns Bounded early snapshot and phase-specific continuation.
   */
  state(identity: object): {
    early: readonly TenantBoundaryValue[];
    phase: "early" | "native";
    index: number;
    nativeCursor?: string;
  } {
    if (this.#identity !== identity)
      throw new TypeError("Datastore tenant catalog continuation is invalid.");
    return {
      early: this.#early,
      phase: this.#phase,
      index: this.#index,
      ...(this.#nativeCursor === undefined ? {} : { nativeCursor: this.#nativeCursor }),
    };
  }
}

interface NativeCandidatePage {
  readonly values: readonly unknown[];
  readonly moreResults?: string;
  readonly endCursor?: string;
}

interface NativeCollection {
  readonly values: unknown[];
  info: Omit<NativeCandidatePage, "values">;
  settled: boolean;
}

/**
 * Collects one finite native namespace query with cancellation and a total deadline.
 * @param stream Public Datastore query stream.
 * @param request Finite page request and cancellation.
 * @returns Native candidates and continuation metadata.
 */
function collectNativeCandidates(
  stream: ReturnType<Datastore["runQueryStream"]>,
  request: TenantCatalogRead,
): Promise<NativeCandidatePage> {
  return new Promise((resolve, reject) => {
    const state: NativeCollection = { values: [], info: {}, settled: false };
    const finish = (error?: Error) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolve({ values: state.values, ...state.info });
      else reject(error);
    };
    const onAbort = () => {
      stream.destroy();
      finish(new Error("Datastore tenant catalog discovery was cancelled."));
    };
    const timer = setTimeout(() => {
      stream.destroy();
      finish(new Error("Datastore tenant catalog page deadline expired."));
    }, nativePageDeadlineMs);
    request.signal.addEventListener("abort", onAbort, { once: true });
    observeNativeCandidates(stream, request.count, state, finish);
    if (request.signal.aborted) onAbort();
  });
}

/**
 * Observes one bounded stream and ignores data after settlement.
 * @param stream Public Datastore query stream.
 * @param count Maximum native candidates.
 * @param state Mutable state for this one page.
 * @param onFinish Completes the page once.
 */
function observeNativeCandidates(
  stream: ReturnType<Datastore["runQueryStream"]>,
  count: number,
  state: NativeCollection,
  onFinish: (error?: Error) => void,
): void {
  stream.on("data", (value: unknown) => {
    if (state.settled) return;
    if (state.values.length >= count) {
      stream.destroy();
      onFinish(new Error("Datastore tenant catalog exceeded the page limit."));
    } else state.values.push(value);
  });
  stream.on("info", (value: NativeCollection["info"]) => {
    if (!state.settled) state.info = value;
  });
  stream.on("error", () => {
    onFinish(new Error("Datastore namespace discovery failed."));
  });
  stream.on("end", () => {
    onFinish();
  });
}

function namespaceName(value: unknown, keySymbol: symbol): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const key = (value as Record<symbol, unknown>)[keySymbol];
  if (typeof key !== "object" || key === null) return undefined;
  const record = key as { readonly name?: unknown; readonly path?: readonly unknown[] };
  const name = record.name ?? record.path?.at(-1);
  return typeof name === "string" ? name : undefined;
}
