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

import { Datastore } from "@google-cloud/datastore";
import { PropertyFilter, and } from "@google-cloud/datastore";
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

/**
 * Discovers Spine tenants from Datastore's native namespace metadata.
 */
export class DatastoreTenantCatalog implements TenantCatalog {
  readonly #cursorIdentity = {};

  readonly #converter: NamespaceAssignments;

  #open = true;

  /**
   * Creates a native namespace catalog.
   *
   * @param client The caller-owned Datastore client.
   * @param converter Converts owned native namespaces to tenant identifiers.
   */
  constructor(
    private readonly client: Datastore,
    converter: NamespaceConverter,
  ) {
    this.#converter =
      converter instanceof NamespaceAssignments ? converter : new NamespaceAssignments(converter);
  }

  /**
   * Checks exact native namespace metadata without listing the catalog.
   *
   * @param boundary Complete named tenant boundary.
   * @returns Whether Datastore has metadata for its namespace.
   */
  async contains(boundary: TenantBoundaryValue): Promise<boolean> {
    this.requireOpen();
    if (boundary.single || boundary.tenantId === undefined)
      throw new Error("Datastore tenant catalog requires a tenant boundary.");
    const namespace = this.#converter.toNamespace(boundary.tenantId);
    const key = this.client.key({ namespace: "", path: ["__namespace__", namespace] });
    const query = this.client
      .createQuery("", "__namespace__")
      .select("__key__")
      .filter(
        and([new PropertyFilter("__key__", ">=", key), new PropertyFilter("__key__", "<=", key)]),
      );
    const response = await this.client.runQuery(query);
    this.requireOpen();
    if (!Array.isArray(response) || !Array.isArray(response[0]))
      throw new Error("Datastore returned invalid namespace metadata.");
    return (response[0] as unknown[]).some(
      (value) => namespaceName(value, this.client.KEY) === namespace,
    );
  }

  /**
   * Lists tenant boundaries represented by owned native namespaces.
   *
   * @returns The discovered native tenant boundaries.
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
    }
    return [...byBoundary.values()]
      .sort((left, right) => left.namespace.localeCompare(right.namespace))
      .map(({ boundary }) => boundary);
  }

  /**
   * Reads one bounded native namespace page.
   *
   * @param request Finite candidate limit and instance-bound continuation.
   * @returns A possibly empty continuing tenant page.
   */
  async page(request: TenantCatalogRead): Promise<TenantCatalogPage> {
    this.requireOpen();
    TenantCatalogReads.require(request);
    const prior = request.after;
    if (prior !== undefined && !(prior instanceof DatastoreTenantCursor))
      throw new TypeError("Datastore tenant catalog continuation is invalid.");
    return this.#nativePage(request, prior?.state(this.#cursorIdentity));
  }

  /**
   * Converts one finite native metadata response without filling filtered pages.
   */
  async #nativePage(request: TenantCatalogRead, start?: string): Promise<TenantCatalogPage> {
    const boundaries: TenantBoundaryValue[] = [];
    let cursor = start;
    let remaining = request.count;
    for (;;) {
      const limit = Math.min(128, remaining);
      const query = this.client.createQuery("", "__namespace__").select("__key__").limit(limit);
      if (cursor !== undefined) query.start(cursor);
      const result = await this.#nativeCandidates(query, request, limit);
      request.signal.throwIfAborted();
      this.requireOpen();
      const chunk = this.#nativeResult(result, cursor, this.#nativeBoundaries(result.values));
      boundaries.push(...chunk.boundaries);
      remaining -= result.values.length;
      if (!chunk.hasMore || remaining === 0)
        return {
          boundaries,
          ...(chunk.after === undefined ? {} : { after: chunk.after }),
          hasMore: chunk.hasMore,
        };
      cursor = result.endCursor;
    }
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
    }
    return boundaries;
  }

  /**
   * Validates the native continuation before exposing a catalog page.
   */
  #nativeResult(
    result: NativeCandidatePage,
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
    const after =
      more && result.endCursor !== undefined
        ? new DatastoreTenantCursor(this.#cursorIdentity, result.endCursor)
        : undefined;
    return { boundaries, ...(after === undefined ? {} : { after }), hasMore: more };
  }

  /**
   * Collects no more than one native query limit with caller cancellation.
   */
  #nativeCandidates(
    query: ReturnType<Datastore["createQuery"]>,
    request: TenantCatalogRead,
    limit: number,
  ): Promise<NativeCandidatePage> {
    const stream = this.client.runQueryStream(query);
    return collectNativeCandidates(stream, request, limit);
  }

  /**
   * Checks an existing native namespace without creating one.
   *
   * @param boundary The admitted multitenant boundary.
   * @returns Completion when native metadata confirms membership.
   */
  async keep(boundary: TenantBoundaryValue): Promise<void> {
    if (!(await this.contains(boundary)))
      throw new Error("Datastore tenant namespace is not present.");
  }

  /**
   * Closes this catalog without closing the caller-owned Datastore client.
   *
   * @returns Completion of catalog closure.
   */
  close(): Promise<void> {
    this.#open = false;
    return Promise.resolve();
  }

  /**
   * Rejects catalog operations after closure.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Datastore tenant catalog is closed.");
  }
}

/**
 * Immutable native cursor tied to one Datastore catalog.
 */
class DatastoreTenantCursor implements TenantCatalogCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #nativeCursor: string;

  /**
   * Captures one native namespace continuation.
   *
   * @param identity Private catalog issuance identity.
   * @param nativeCursor Native namespace continuation.
   */
  constructor(identity: object, nativeCursor: string) {
    this.#identity = identity;
    this.#nativeCursor = nativeCursor;
    Object.freeze(this);
  }

  /**
   * Verifies issuance before exposing this catalog's sweep position.
   *
   * @param identity Private identity of the reading catalog.
   * @returns Native namespace continuation.
   */
  state(identity: object): string {
    if (this.#identity !== identity)
      throw new TypeError("Datastore tenant catalog continuation is invalid.");
    return this.#nativeCursor;
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
 * Collects one finite native namespace query with caller cancellation.
 *
 * @param stream Public Datastore query stream.
 * @param request Finite page request and cancellation.
 * @returns Native candidates and continuation metadata.
 */
function collectNativeCandidates(
  stream: ReturnType<Datastore["runQueryStream"]>,
  request: TenantCatalogRead,
  limit: number,
): Promise<NativeCandidatePage> {
  return new Promise((resolve, reject) => {
    const state: NativeCollection = { values: [], info: {}, settled: false };
    const finish = (error?: Error) => {
      if (state.settled) return;
      state.settled = true;
      request.signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolve({ values: state.values, ...state.info });
      else reject(error);
    };
    const onAbort = () => {
      finish(new Error("Datastore tenant catalog discovery was cancelled."));
      stream.destroy();
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    observeNativeCandidates(stream, limit, state, finish);
    if (request.signal.aborted) onAbort();
  });
}

/**
 * Observes one bounded stream and ignores data after settlement.
 *
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
      onFinish(new Error("Datastore tenant catalog exceeded the page limit."));
      stream.destroy();
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
  stream.on("close", () => {
    onFinish(new Error("Datastore namespace discovery closed before completion."));
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
