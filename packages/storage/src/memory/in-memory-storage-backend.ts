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

  /**
   * Records one tenant in this backend without creating a record family.
   *
   * @param backend Selects the shared backend.
   * @param tenant The complete provider tenant boundary.
   */
  static admit(backend: InMemoryStorageBackend, tenant: TenantBoundary): void {
    MemoryBackendScopes.admit(backend, tenant);
  }

  /**
   * Lists multitenant boundaries admitted to this backend.
   *
   * @param backend Selects the shared backend.
   * @returns Immutable boundary snapshots.
   */
  static tenants(backend: InMemoryStorageBackend): readonly TenantBoundary[] {
    return MemoryBackendScopes.tenants(backend);
  }
}

const scopesByBackend = new WeakMap<
  InMemoryStorageBackend,
  Map<string, Map<string | symbol, Map<string, unknown>>>
>();
const tenantsByBackend = new WeakMap<InMemoryStorageBackend, Map<string, TenantBoundary>>();

/**
 * Binds provider tenant and record-family identities for each backend.
 */
const MemoryBackendScopes = {
  // prettier-ignore

  /**
   * Binds one tenant and record family to one backend-owned value.
   */
  bind<T>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    tenant: TenantBoundary,
    family: string,
    create: () => T,
  ): T {
    this.admit(backend, tenant);
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

  admit(backend: InMemoryStorageBackend, tenant: TenantBoundary): void {
    if (tenant.single) return;
    let tenants = tenantsByBackend.get(backend);
    if (tenants === undefined) {
      tenants = new Map();
      tenantsByBackend.set(backend, tenants);
    }
    tenants.set(String(tenant.key), tenant);
  },

  tenants(backend: InMemoryStorageBackend): readonly TenantBoundary[] {
    return Object.freeze(
      [...(tenantsByBackend.get(backend)?.entries() ?? [])]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, boundary]) => boundary),
    );
  },
};
import type { TenantBoundary } from "../internal/tenancy.js";
