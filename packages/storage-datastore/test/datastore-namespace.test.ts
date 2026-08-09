import { create } from "@bufbuild/protobuf";
import {
  EmailAddressSchema,
  InternetDomainSchema,
  TenantIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { DefaultNamespaceConverter } from "../src/datastore/namespace.js";

describe("DefaultNamespaceConverter", () => {
  const converter = new DefaultNamespaceConverter();

  it("uses the Spine JVM type prefixes for complete tenant variants", () => {
    expect(converter.toNamespace(domain("example.test"))).toBe("Dexample.test");
    expect(converter.toNamespace(email("person@example.test"))).toBe("Eperson-at-example.test");
    expect(converter.toNamespace(value("example.test"))).toBe("Vexample.test");
  });

  it("restores owned prefixed namespaces and ignores unrelated/default namespaces", () => {
    expect(converter.fromNamespace("Dexample.test")).toEqual(domain("example.test"));
    expect(converter.fromNamespace("Eperson-at-example.test")).toEqual(
      email("person-at-example.test"),
    );
    expect(converter.fromNamespace("Vexample.test")).toEqual(value("example.test"));
    expect(converter.fromNamespace("unrelated")).toBeUndefined();
    expect(converter.fromNamespace("")).toBeUndefined();
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
