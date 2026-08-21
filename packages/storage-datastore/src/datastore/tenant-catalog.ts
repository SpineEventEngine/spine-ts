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
import {
  TenantBoundary,
  type TenantBoundary as TenantBoundaryValue,
  type TenantCatalog,
} from "@spine-event-engine/storage/provider";

import { NamespaceAssignments, type NamespaceConverter } from "./namespace.js";

const earlyTenantTtlMs = 60_000;
const maxEarlyTenants = 1_000;

interface EarlyTenantOptions {
  readonly now?: () => number;
  readonly earlyTenantTtlMs?: number;
  readonly maxEarlyTenants?: number;
}

/**
 * Discovers Spine tenants from Datastore's native namespace metadata.
 */
export class DatastoreTenantCatalog implements TenantCatalog {
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
    this.#now = options.now ?? Date.now;
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

  private requireOpen(): void {
    if (!this.#open) throw new Error("Datastore tenant catalog is closed.");
  }

  private purgeExpired(): void {
    const now = this.#now();
    for (const [namespace, admission] of this.#kept) {
      if (admission.expiresAt <= now) this.#kept.delete(namespace);
    }
  }
}

function namespaceName(value: unknown, keySymbol: symbol): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const key = (value as Record<symbol, unknown>)[keySymbol];
  if (typeof key !== "object" || key === null) return undefined;
  const record = key as { readonly name?: unknown; readonly path?: readonly unknown[] };
  const name = record.name ?? record.path?.at(-1);
  return typeof name === "string" ? name : undefined;
}
