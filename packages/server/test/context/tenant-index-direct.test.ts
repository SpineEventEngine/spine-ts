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
import { InternetDomainSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it, vi } from "vitest";

import { SINGLE_TENANT } from "../../src/context/tenant-index.js";
import { TenantAdmissions, TenantUnknownError } from "../../src/context/tenant-unknown-error.js";
import { TestTenantIndex } from "../tenant-index-fixture.js";
import { tenant } from "../tenant-fixture.js";

describe("tenant admission", () => {
  it("reports a detached complete identity only for confirmed missing membership", async () => {
    const index = new TestTenantIndex();
    const requested = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "original.test" }) },
    });
    const failure = await TenantAdmissions.require(index, "Projects", true, requested).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TenantUnknownError);
    expect(failure).toMatchObject({ type: "TENANT_UNKNOWN", contextName: "Projects" });
    if (!(failure instanceof TenantUnknownError)) throw new Error("Expected typed tenant error.");
    requested.kind = { case: "value", value: "mutated" };
    const copy = failure.tenantId;
    copy.kind = { case: "value", value: "changed result" };
    expect(failure.tenantId.kind).toMatchObject({
      case: "domain",
      value: { value: "original.test" },
    });
    const lookupFailure = new Error("directory unavailable");
    vi.spyOn(index, "contains").mockRejectedValueOnce(lookupFailure);
    await expect(TenantAdmissions.require(index, "Projects", true, requested)).rejects.toBe(
      lookupFailure,
    );
  });

  it("rejects single-tenant IDs and missing multitenant IDs without directory lookup", async () => {
    const index = new TestTenantIndex();
    const lookup = vi.spyOn(index, "contains");
    await expect(
      TenantAdmissions.require(SINGLE_TENANT, "Single", false, tenant("extra")),
    ).rejects.toThrow("does not accept context.tenantId");
    await expect(TenantAdmissions.require(index, "Multi", true)).rejects.toThrow(
      "requires context.tenantId",
    );
    await expect(
      TenantAdmissions.require(SINGLE_TENANT, "Multi", true, tenant("extra")),
    ).rejects.toThrow("requires a tenant index");
    await expect(TenantAdmissions.require(SINGLE_TENANT, "Single", false)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("checks complete registered IDs through an explicitly supplied directory", async () => {
    const index = new TestTenantIndex();
    const domain = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "example.test" }) },
    });
    await index.keep(domain);
    await expect(
      TenantAdmissions.require(index, "Projects", true, domain),
    ).resolves.toBeUndefined();
    await expect(
      TenantAdmissions.require(index, "Projects", true, tenant("example.test")),
    ).rejects.toBeInstanceOf(TenantUnknownError);
  });
});
