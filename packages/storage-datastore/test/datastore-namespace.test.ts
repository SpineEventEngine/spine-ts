import { create } from "@bufbuild/protobuf";
import {
  EmailAddressSchema,
  InternetDomainSchema,
  TenantIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { DefaultNamespaceConverter, NamespaceAssignments } from "../src/datastore/namespace.js";

describe("DefaultNamespaceConverter", () => {
  const converter = new DefaultNamespaceConverter();

  it("uses the Spine JVM type prefixes for complete tenant variants", () => {
    expect(converter.toNamespace(domain("example.test"))).toBe("Dexample.test");
    expect(() => converter.toNamespace(email("person@example.test"))).toThrow(
      /custom namespace converter/i,
    );
    expect(converter.toNamespace(value("example.test"))).toBe("Vexample.test");
  });

  it("restores owned prefixed namespaces and ignores unrelated/default namespaces", () => {
    expect(converter.fromNamespace("Dexample.test")).toEqual(domain("example.test"));
    expect(converter.fromNamespace("Eperson-at-example.test")).toBeUndefined();
    expect(converter.fromNamespace("Vexample.test")).toEqual(value("example.test"));
    expect(converter.fromNamespace("unrelated")).toBeUndefined();
    expect(converter.fromNamespace("")).toBeUndefined();
  });

  it("validates custom namespace mappings before storage use", () => {
    const assignments = new NamespaceAssignments({
      toNamespace: (tenantId) =>
        tenantId.kind.case === "value" ? `custom-${tenantId.kind.value}` : "",
      fromNamespace: (namespace) =>
        namespace.startsWith("custom-") ? value(namespace.slice(7)) : undefined,
    });

    expect(assignments.toNamespace(value("first"))).toBe("custom-first");
    expect(assignments.fromNamespace("custom-first")).toEqual(value("first"));
  });

  it("rejects empty, non-reversible, and colliding custom mappings", () => {
    expect(() =>
      new NamespaceAssignments({
        toNamespace: () => "",
        fromNamespace: () => value("first"),
      }).toNamespace(value("first")),
    ).toThrow(/non-empty/i);

    expect(() =>
      new NamespaceAssignments({
        toNamespace: () => "custom-first",
        fromNamespace: () => value("different"),
      }).toNamespace(value("first")),
    ).toThrow(/round trip/i);

    const colliding = new NamespaceAssignments({
      toNamespace: () => "shared",
      fromNamespace: () => value("first"),
    });
    expect(colliding.toNamespace(value("first"))).toBe("shared");
    expect(() => colliding.toNamespace(value("second"))).toThrow(/round trip|already assigned/i);
  });

  it("rejects incomplete tenants", () => {
    expect(() => converter.toNamespace(create(TenantIdSchema))).toThrow(/non-empty TenantId/i);
  });
});

function domain(text: string) {
  return create(TenantIdSchema, {
    kind: { case: "domain", value: create(InternetDomainSchema, { value: text }) },
  });
}

function email(text: string) {
  return create(TenantIdSchema, {
    kind: { case: "email", value: create(EmailAddressSchema, { value: text }) },
  });
}

function value(text: string) {
  return create(TenantIdSchema, { kind: { case: "value", value: text } });
}
