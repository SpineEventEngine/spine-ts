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
import { TenantIdSchema } from "@spine-event-engine/proto";
import { SINGLE_TENANT, PersistentTenantIndex } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantScenarios } from "../src/tenant-scenarios.js";

describe("Message Board tenant assembly examples", () => {
  afterEach(async () => ServerTests.resetEnvironment());

  it.each([false, true])(
    "uses SINGLE_TENANT without a directory when explicit is %s",
    async (explicit) => {
      expect(await TenantScenarios.single(explicit)).toBe(SINGLE_TENANT);
    },
  );

  it("rejects an unknown complete tenant with an application directory", async () => {
    expect(await TenantScenarios.external()).toEqual({ registered: true, unknownRejected: true });
  });

  it("uses record-backed membership and rejects an unknown tenant", async () => {
    expect(await TenantScenarios.persistent()).toEqual({ registered: true, unknownRejected: true });
  });

  it("does not treat another complete catalog ID as the registered tenant", async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy calls this method with its original receiver.
    const original = InMemoryStorageFactory.prototype.tenantCatalog;
    const selected = vi
      .spyOn(InMemoryStorageFactory.prototype, "tenantCatalog")
      .mockImplementation(function (this: InMemoryStorageFactory) {
        const catalog = original.call(this);
        return {
          contains: (boundary) => catalog.contains(boundary),
          all: () =>
            Promise.resolve([
              TenantBoundary.from(
                create(TenantIdSchema, { kind: { case: "value", value: "other-team" } }),
              ),
            ]),
          page: (request) => catalog.page(request),
          close: () => catalog.close(),
          keep: (boundary) => catalog.keep(boundary),
        };
      });
    try {
      expect(await TenantScenarios.external()).toEqual({
        registered: false,
        unknownRejected: true,
      });
    } finally {
      selected.mockRestore();
    }
  });

  it("rejects a catalog that returns a single-tenant marker for multitenant IDs", async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy calls this method with its original receiver.
    const original = InMemoryStorageFactory.prototype.tenantCatalog;
    const selected = vi
      .spyOn(InMemoryStorageFactory.prototype, "tenantCatalog")
      .mockImplementation(function (this: InMemoryStorageFactory) {
        const catalog = original.call(this);
        return {
          contains: (boundary) => catalog.contains(boundary),
          all: () => Promise.resolve([TenantBoundary.single]),
          page: (request) => catalog.page(request),
          close: () => catalog.close(),
          keep: (boundary) => catalog.keep(boundary),
        };
      });
    try {
      await expect(TenantScenarios.external()).rejects.toThrow(/single-tenant boundary/u);
    } finally {
      selected.mockRestore();
    }
  });

  it("propagates a directory read failure instead of labeling it unknown membership", async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy calls this method with its original receiver.
    const original = PersistentTenantIndex.prototype.contains;
    const failed = vi
      .spyOn(PersistentTenantIndex.prototype, "contains")
      .mockImplementation(function (this: PersistentTenantIndex, id) {
        if (id.kind.case === "value" && id.kind.value === "unknown-team")
          return Promise.reject(new Error("directory unavailable"));
        return original.call(this, id);
      });
    try {
      await expect(TenantScenarios.persistent()).rejects.toThrow(/directory unavailable/u);
    } finally {
      failed.mockRestore();
    }
  });
});
