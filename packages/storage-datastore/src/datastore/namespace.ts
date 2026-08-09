import { create } from "@bufbuild/protobuf";
import {
  EmailAddressSchema,
  InternetDomainSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage";

/**
 * Converts complete tenant identifiers to and from Datastore namespaces.
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
 * Spine JVM-compatible `D`, `E`, and `V` Datastore namespace conversion.
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
        return create(TenantIdSchema, {
          kind: { case: "email", value: create(EmailAddressSchema, { value }) },
        });
      case "V":
        return create(TenantIdSchema, { kind: { case: "value", value } });
      default:
        return undefined;
    }
  }

  /**
   * Converts a complete tenant to the Spine JVM-prefixed namespace.
   *
   * Spine JVM replaces the `@` character because Datastore namespaces do not
   * admit it. This deliberately preserves that physical compatibility.
   *
   * @param tenantId The complete tenant identifier.
   * @returns The native Datastore namespace.
   */
  toNamespace(tenantId: TenantId): string {
    TenantBoundary.from(tenantId);
    const kind = tenantId.kind;
    const namespace =
      kind.case === "domain"
        ? `D${kind.value.value}`
        : kind.case === "email"
          ? `E${kind.value.value}`
          : kind.case === "value"
            ? `V${kind.value}`
            : "";
    return namespace.replaceAll("@", "-at-");
  }
}
