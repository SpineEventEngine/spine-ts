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

import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordColumn } from "../record/record-column.js";
import type { TenantBoundary } from "../internal/tenancy.js";

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
   *
   * @param backend Selects the shared ephemeral backend.
   * @param namespace Separates Entity and generic record backend values.
   * @param tenant Selects the provider tenant boundary.
   * @param family Identifies the record family inside the tenant.
   * @param create Creates the value when the scope is first bound.
   * @returns The existing or newly created backend-owned value.
   * @typeParam T Value retained for one backend scope.
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
   * Validates a physical family without binding storage or admitting a tenant.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param backend Shared backend token.
   * @param namespace Separates current Entity and generic records.
   * @param tenant Complete tenant boundary.
   * @param family Source and optional group identity.
   * @param spec Declarative record layout.
   */
  static define<I, R extends Message>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    tenant: TenantBoundary,
    family: string,
    spec: RecordSpec<I, R>,
  ): void {
    MemoryDefinitions.define(backend, namespace, tenant, family, spec);
  }

  /**
   * Compares two physical column declarations without evaluating their readers.
   *
   * @typeParam R Stored record message type.
   * @param left First column declaration.
   * @param right Second column declaration.
   * @returns Whether names and value types match.
   */
  static sameColumns<R extends Message>(
    left: readonly RecordColumn<R>[],
    right: readonly RecordColumn<R>[],
  ): boolean {
    return MemoryDefinitions.columns(left) === MemoryDefinitions.columns(right);
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

  /**
   * Returns the current finite tenant-index length without copying rows.
   *
   * @param backend Backend containing the admission index.
   * @returns Number of distinct admitted multitenant boundaries.
   */
  static tenantCount(backend: InMemoryStorageBackend): number {
    return MemoryBackendScopes.tenantCount(backend);
  }

  /**
   * Reads only one bounded range from the admission-time tenant index.
   *
   * @param backend Backend containing the admission index.
   * @param start First admission-order position to examine.
   * @param count Maximum number of boundaries to copy.
   * @returns The bounded admission-order page.
   */
  static tenantPage(
    backend: InMemoryStorageBackend,
    start: number,
    count: number,
  ): readonly TenantBoundary[] {
    return MemoryBackendScopes.tenantPage(backend, start, count);
  }
}

const scopesByBackend = new WeakMap<
  InMemoryStorageBackend,
  Map<string, Map<string | symbol, Map<string, unknown>>>
>();
const tenantsByBackend = new WeakMap<InMemoryStorageBackend, Map<string, TenantBoundary>>();
const tenantOrderByBackend = new WeakMap<InMemoryStorageBackend, TenantBoundary[]>();
const definitionsByBackend = new WeakMap<
  InMemoryStorageBackend,
  Map<string | symbol, Map<string, string>>
>();

/**
 * Checks one backend's immutable record-family declarations.
 */
const MemoryDefinitions = {
  /**
   * Records or checks a declaration without application data or tenant admission.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param backend Shared backend token.
   * @param namespace Current Entity or ordinary records.
   * @param tenant Complete tenant boundary.
   * @param family Source and optional group identity.
   * @param spec Complete provider-visible layout.
   */
  define<I, R extends Message>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    tenant: TenantBoundary,
    family: string,
    spec: RecordSpec<I, R>,
  ): void {
    let tenants = definitionsByBackend.get(backend);
    if (tenants === undefined)
      definitionsByBackend.set(
        backend,
        (tenants = new Map<string | symbol, Map<string, string>>()),
      );
    let families = tenants.get(tenant.key);
    if (families === undefined) tenants.set(tenant.key, (families = new Map<string, string>()));
    const key = JSON.stringify([namespace, family]);
    const signature = this.signature(spec);
    const existing = families.get(key);
    if (existing !== undefined && existing !== signature)
      throw new Error("Memory storage family has an incompatible record definition.");
    families.set(key, signature);
  },

  /**
   * Encodes the physical declaration without invoking extractors or comparing callbacks.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param spec Declarative record layout.
   * @returns Stable source, record, ID, and column structure.
   */
  signature<I, R extends Message>(spec: RecordSpec<I, R>): string {
    const id = spec.idType;
    return JSON.stringify([
      spec.sourceType.typeName,
      spec.recordType.typeName,
      typeof id === "string" ? ["primitive", id] : ["message", id.typeName],
      this.columns(spec.columns),
    ]);
  },

  /**
   * Encodes columns in name order without changing the supplied declaration.
   *
   * @typeParam R Stored record message type.
   * @param columns Declarative query columns.
   * @returns Canonical column names and value types.
   */
  columns<R extends Message>(columns: readonly RecordColumn<R>[]): string {
    return JSON.stringify(
      columns
        .map((column) => {
          const type = column.type;
          return {
            name: column.name,
            type: [
              type.kind,
              type.kind === "scalar"
                ? [type.scalar, type.longAsString]
                : type.kind === "enum"
                  ? type.enum.typeName
                  : type.message.typeName,
            ],
          };
        })
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    );
  },
};

/**
 * Binds provider tenant and record-family identities for each backend.
 */
const MemoryBackendScopes = {
  // prettier-ignore

  /**
   * Binds one tenant and record family to one backend-owned value.
   *
   * @typeParam T Value retained for the selected scope.
   * @param backend Backend containing record families.
   * @param namespace Entity or generic record family namespace.
   * @param tenant Complete tenant boundary.
   * @param family Record family name inside the tenant.
   * @param create Factory called for a missing scoped value.
   * @returns The existing or newly created scoped value.
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

  /**
   * Records a multitenant boundary exactly once in admission order.
   *
   * @param backend Backend containing the admission index.
   * @param tenant Complete boundary to admit.
   */
  admit(backend: InMemoryStorageBackend, tenant: TenantBoundary): void {
    if (tenant.single) return;
    let tenants = tenantsByBackend.get(backend);
    if (tenants === undefined) {
      tenants = new Map();
      tenantsByBackend.set(backend, tenants);
    }
    if (tenants.has(String(tenant.key))) return;
    tenants.set(String(tenant.key), tenant);
    let ordered = tenantOrderByBackend.get(backend);
    if (ordered === undefined) {
      ordered = [];
      tenantOrderByBackend.set(backend, ordered);
    }
    ordered.push(tenant);
  },

  /**
   * Lists all admitted boundaries for legacy catalog callers.
   *
   * @param backend Backend containing the tenant index.
   * @returns Complete sorted boundary snapshots.
   */
  tenants(backend: InMemoryStorageBackend): readonly TenantBoundary[] {
    return Object.freeze(
      [...(tenantsByBackend.get(backend)?.entries() ?? [])]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, boundary]) => boundary),
    );
  },

  /**
   * Reads the admission-order index length without copying entries.
   *
   * @param backend Backend containing the tenant index.
   * @returns Number of admitted multitenant boundaries.
   */
  tenantCount(backend: InMemoryStorageBackend): number {
    return tenantOrderByBackend.get(backend)?.length ?? 0;
  },

  /**
   * Copies only one admission-order index range.
   *
   * @param backend Backend containing the tenant index.
   * @param start First position to examine.
   * @param count Maximum copied boundaries.
   * @returns One bounded page of boundaries.
   */
  tenantPage(
    backend: InMemoryStorageBackend,
    start: number,
    count: number,
  ): readonly TenantBoundary[] {
    return tenantOrderByBackend.get(backend)?.slice(start, start + count) ?? [];
  },
};
