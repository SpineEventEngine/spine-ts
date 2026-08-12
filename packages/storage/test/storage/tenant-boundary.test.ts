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
import {
  EmailAddressSchema,
  InternetDomainSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { TenantBoundary } from "../../src/internal/tenancy.js";

describe("TenantBoundary", () => {
  it("distinguishes the complete generated tenant variants", () => {
    const value = TenantBoundary.from(tenant("value", "example.test"));
    const domain = TenantBoundary.from(tenant("domain", "example.test"));
    const email = TenantBoundary.from(tenant("email", "example.test"));

    expect(new Set([value.key, domain.key, email.key])).toHaveLength(3);
    expect(value.tenantId).toEqual(tenant("value", "example.test"));
    expect(domain.tenantId).toEqual(tenant("domain", "example.test"));
    expect(email.tenantId).toEqual(tenant("email", "example.test"));
  });

  it("uses one explicit boundary for single tenancy", () => {
    expect(TenantBoundary.single).toBe(TenantBoundary.single);
    expect(typeof TenantBoundary.single.key).toBe("symbol");
    expect(TenantBoundary.single).toMatchObject({
      single: true,
      tenantId: undefined,
    });
  });

  it("rejects contradictory and incomplete storage boundaries", () => {
    expect(() =>
      TenantBoundary.of({
        name: "Tasks",
        multitenant: false,
        tenantId: tenant("value", "unexpected"),
      } as never),
    ).toThrow(/does not accept context\.tenantId/);
    expect(() => TenantBoundary.from(create(TenantIdSchema))).toThrow(/non-empty TenantId/);
  });

  it("keeps tenant identity stable across source and result mutation", () => {
    const source = tenant("value", "tenant-one");
    const boundary = TenantBoundary.from(source);
    const key = boundary.key;
    source.kind = { case: "value", value: "tenant-two" };
    const returned = boundary.tenantId;
    returned.kind = { case: "value", value: "tenant-three" };

    expect(boundary.key).toBe(key);
    expect(boundary.tenantId).toEqual(tenant("value", "tenant-one"));
    expect(TenantBoundary.from(tenant("value", "tenant-one")).key).toBe(key);
  });

  it.each(["value", "domain", "email"] as const)("rejects a blank %s tenant", (kind) => {
    expect(() => TenantBoundary.from(tenant(kind, "  "))).toThrow(
      "Multitenant storage requires a non-empty TenantId.",
    );
  });
});

function tenant(kind: "value" | "domain" | "email", value: string): TenantId {
  switch (kind) {
    case "value":
      return create(TenantIdSchema, { kind: { case: "value", value } });
    case "domain":
      return create(TenantIdSchema, {
        kind: { case: "domain", value: create(InternetDomainSchema, { value }) },
      });
    case "email":
      return create(TenantIdSchema, {
        kind: { case: "email", value: create(EmailAddressSchema, { value }) },
      });
  }
}
