import { Datastore } from "@google-cloud/datastore";
import {
  TenantBoundary,
  type TenantBoundary as TenantBoundaryValue,
  type TenantCatalog,
} from "@spine-event-engine/storage";

import type { NamespaceConverter } from "./namespace.js";

/**
 * Discovers Spine tenants from Datastore's native namespace metadata.
 */
export class DatastoreTenantCatalog implements TenantCatalog {
  readonly #kept = new Map<string, TenantBoundaryValue>();
  #open = true;

  /**
   * Creates a native namespace catalog.
   *
   * @param client The caller-owned Datastore client.
   * @param converter Converts owned native namespaces to tenant identifiers.
   */
  constructor(
    private readonly client: Datastore,
    private readonly converter: NamespaceConverter,
  ) {}

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

    const byBoundary = new Map<string, { namespace: string; boundary: TenantBoundaryValue }>();
    for (const value of response[0] as unknown[]) {
      const namespace = namespaceName(value, this.client.KEY);
      if (namespace === undefined || namespace.length === 0) continue;
      const tenantId = this.converter.fromNamespace(namespace);
      if (tenantId === undefined) continue;
      const boundary = TenantBoundary.from(tenantId);
      const prior = byBoundary.get(String(boundary.key));
      if (prior !== undefined && prior.namespace !== namespace)
        throw new Error("Datastore namespaces resolve to the same tenant boundary.");
      byBoundary.set(String(boundary.key), { namespace, boundary });
    }
    for (const [namespace, boundary] of this.#kept) {
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
   * Remembers an admitted tenant until native metadata becomes visible.
   *
   * No record is written. Datastore creates namespace metadata when the first
   * application entity is persisted in that namespace.
   *
   * @param boundary The admitted multitenant boundary.
   */
  keep(boundary: TenantBoundaryValue): Promise<void> {
    this.requireOpen();
    if (boundary.single || boundary.tenantId === undefined)
      return Promise.reject(new Error("Datastore tenant catalog requires a tenant boundary."));
    const namespace = this.converter.toNamespace(boundary.tenantId);
    const existing = this.#kept.get(namespace);
    if (existing !== undefined && existing.key !== boundary.key)
      return Promise.reject(
        new Error("Datastore namespace is already assigned to another tenant."),
      );
    this.#kept.set(namespace, boundary);
    return Promise.resolve();
  }

  /**
   * Closes this catalog without closing the caller-owned Datastore client.
   */
  close(): Promise<void> {
    this.#open = false;
    this.#kept.clear();
    return Promise.resolve();
  }

  private requireOpen(): void {
    if (!this.#open) throw new Error("Datastore tenant catalog is closed.");
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
