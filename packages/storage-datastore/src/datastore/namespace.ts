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

import { create } from "@bufbuild/protobuf";
import { InternetDomainSchema, TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

/**
 * Converts complete tenant identifiers to and from Datastore namespaces.
 *
 * A converter must return a non-empty namespace and be injective over every
 * admitted tenant. Converting in either direction and back must restore the
 * exact complete tenant or namespace. Return `undefined` only for native
 * namespaces that the converter does not own.
 */
export interface NamespaceConverter {
  // prettier-ignore

  /**
   * Converts an owned namespace to a complete tenant identifier.
   *
   * @param namespace The native Datastore namespace.
   * @returns The tenant, or `undefined` when this converter does not own the namespace.
   */
  fromNamespace(namespace: string): TenantId | undefined;

  /**
   * Converts a complete tenant identifier to its native namespace.
   *
   * @param tenantId The complete tenant identifier.
   * @returns The native Datastore namespace.
   */
  toNamespace(tenantId: TenantId): string;
}

/**
 * Safe Spine JVM-compatible `D` and `V` Datastore namespace conversion.
 */
export class DefaultNamespaceConverter implements NamespaceConverter {
  // prettier-ignore

  /**
   * Restores a tenant from an owned prefixed namespace.
   *
   * @param namespace The native Datastore namespace.
   * @returns The restored tenant, or `undefined` for another namespace.
   */
  fromNamespace(namespace: string): TenantId | undefined {
    if (namespace.length < 2) return undefined;
    const value = namespace.slice(1);
    switch (namespace[0]) {
      case "D":
        return create(TenantIdSchema, {
          kind: { case: "domain", value: create(InternetDomainSchema, { value }) },
        });
      case "E":
        return undefined;
      case "V":
        return create(TenantIdSchema, { kind: { case: "value", value } });
      default:
        return undefined;
    }
  }

  /**
   * Converts a complete tenant to the Spine JVM-prefixed namespace.
   *
   * The Spine JVM email conversion replaces `@` with `-at-`. That mapping is
   * not reversible and can assign distinct tenants to the same namespace, so
   * this safe default rejects email tenants. Applications that use email
   * tenant IDs must install the same injective custom converter in both
   * runtimes.
   *
   * @param tenantId The complete tenant identifier.
   * @returns The native Datastore namespace.
   */
  toNamespace(tenantId: TenantId): string {
    TenantBoundary.from(tenantId);
    const kind = tenantId.kind;
    if (kind.case === "email")
      throw new Error(
        "The default email namespace mapping is unsafe; install a reversible custom namespace converter.",
      );
    const namespace =
      kind.case === "domain"
        ? `D${kind.value.value}`
        : kind.case === "value"
          ? `V${kind.value}`
          : "";
    return namespace;
  }
}

/**
 * Validates reversible tenant-to-namespace assignments.
 *
 * The same instance serves catalog admission and storage creation. A mapping
 * is accepted only when applying the converter in the opposite direction
 * restores the exact complete tenant or namespace.
 */
export class NamespaceAssignments implements NamespaceConverter {
  // prettier-ignore

  /**
   * Creates an assignment validator around an application converter.
   *
   * @param converter The converter whose mappings are validated.
   */
  constructor(private readonly converter: NamespaceConverter) {}

  /**
   * Restores and validates an owned namespace.
   *
   * @param namespace The native namespace.
   * @returns The restored tenant, or `undefined` when not owned.
   */
  fromNamespace(namespace: string): TenantId | undefined {
    if (namespace.length === 0) return undefined;
    const tenantId = this.converter.fromNamespace(namespace);
    if (tenantId === undefined) return undefined;
    TenantBoundary.from(tenantId);
    const roundTrip = this.converter.toNamespace(tenantId);
    if (roundTrip !== namespace)
      throw new Error("Datastore namespace conversion must round trip exactly.");
    return tenantId;
  }

  /**
   * Converts and validates a complete tenant.
   *
   * @param tenantId The complete tenant identifier.
   * @returns Its unique, reversible native namespace.
   */
  toNamespace(tenantId: TenantId): string {
    const boundary = TenantBoundary.from(tenantId);
    const namespace = this.converter.toNamespace(tenantId);
    if (namespace.trim().length === 0)
      throw new Error("Datastore multitenancy requires a non-empty native namespace.");
    const restored = this.converter.fromNamespace(namespace);
    if (restored === undefined || TenantBoundary.from(restored).key !== boundary.key)
      throw new Error("Datastore namespace conversion must round trip exactly.");
    return namespace;
  }
}
