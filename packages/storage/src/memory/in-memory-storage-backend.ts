/**
 * Opaque token selecting one ephemeral in-memory storage backend.
 *
 * A factory constructed without a token owns a fresh backend. Pass this same
 * token to independently constructed factories only when they must share rows.
 */
export class InMemoryStorageBackend {
  // prettier-ignore

  /**
   * Identifies this opaque backend in diagnostics.
   */
  readonly [Symbol.toStringTag] = "InMemoryStorageBackend";

  /**
   * Binds one tenant and record family to one backend-owned value.
   * @param backend Selects the shared ephemeral backend.
   * @param namespace Separates Entity and generic record backend values.
   * @param tenant Selects the provider tenant boundary.
   * @param family Identifies the record family inside the tenant.
   * @param create Creates the value when the scope is first bound.
   * @returns The existing or newly created backend-owned value.
   */
  static bind<T>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    tenant: TenantBoundary,
    family: string,
    create: () => T,
  ): T {
    return MemoryBackendScopes.bind(backend, namespace, tenant, family, create);
  }
}

const scopesByBackend = new WeakMap<
  InMemoryStorageBackend,
  Map<string, Map<string | symbol, Map<string, unknown>>>
>();

/**
 * Binds provider tenant and record-family identities for each backend.
 */
const MemoryBackendScopes = {
  // prettier-ignore

  /**
   * Binds one canonical scope to one backend-owned value.
   */
  bind<T>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    tenant: TenantBoundary,
    family: string,
    create: () => T,
  ): T {
    let scopes = scopesByBackend.get(backend);
    if (scopes === undefined) {
      scopes = new Map();
      scopesByBackend.set(backend, scopes);
    }
    let tenants = scopes.get(namespace);
    if (tenants === undefined) {
      tenants = new Map();
      scopes.set(namespace, tenants);
    }
    let families = tenants.get(tenant.key);
    if (families === undefined) {
      families = new Map();
      tenants.set(tenant.key, families);
    }
    const existing = families.get(family);
    if (existing === undefined) {
      const value = create();
      families.set(family, value);
      return value;
    }
    return existing as T;
  },
};
import type { TenantBoundary } from "../internal/tenancy.js";
