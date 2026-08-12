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
import { AnySchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { InMemoryStorageBackend } from "../../src/memory/in-memory-storage-backend.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { TenantBoundary } from "../../src/internal/tenancy.js";
import { RecordSpec } from "../../src/record/record-spec.js";

describe("InMemoryStorageBackend", () => {
  it("keeps equal record types separate when their source types differ", () => {
    const backend = new InMemoryStorageBackend();
    const firstSpec = new RecordSpec<string, StringValue>({
      sourceType: AnySchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const secondSpec = new RecordSpec<string, StringValue>({
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = { rows: [] as string[] };
    const second = { rows: [] as string[] };
    const tenant = TenantBoundary.single;

    const firstRows = InMemoryStorageBackend.bind(
      backend,
      "record",
      tenant,
      firstSpec.sourceType.typeName,
      () => first,
    );
    const secondRows = InMemoryStorageBackend.bind(
      backend,
      "record",
      tenant,
      secondSpec.sourceType.typeName,
      () => second,
    );

    expect(firstRows).toBe(first);
    expect(secondRows).toBe(second);
    expect(firstRows).not.toBe(secondRows);
  });

  it("lists admitted tenants in stable boundary order", () => {
    const backend = new InMemoryStorageBackend();
    const second = TenantBoundary.from(
      create(TenantIdSchema, { kind: { case: "value", value: "z" } }),
    );
    const first = TenantBoundary.from(
      create(TenantIdSchema, { kind: { case: "value", value: "a" } }),
    );

    InMemoryStorageBackend.admit(backend, second);
    InMemoryStorageBackend.admit(backend, first);

    expect(InMemoryStorageBackend.tenants(backend).map(({ key }) => key)).toEqual(
      [first.key, second.key].sort(),
    );

    const reverseBackend = new InMemoryStorageBackend();
    InMemoryStorageBackend.admit(reverseBackend, first);
    InMemoryStorageBackend.admit(reverseBackend, second);
    expect(InMemoryStorageBackend.tenants(reverseBackend).map(({ key }) => key)).toEqual(
      [first.key, second.key].sort(),
    );
  });

  it("rejects single-tenant and closed catalog admissions", async () => {
    const factory = new InMemoryStorageFactory();
    const catalog = factory.tenantCatalog();

    await catalog.keep(
      TenantBoundary.from(create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } })),
    );
    await expect(catalog.all()).resolves.toHaveLength(1);

    await expect(catalog.keep(TenantBoundary.single)).rejects.toThrow(/requires a tenant boundary/);
    await catalog.close();
    await expect(catalog.all()).rejects.toThrow(/catalog is closed/);
    await expect(
      catalog.keep(
        TenantBoundary.from(create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } })),
      ),
    ).rejects.toThrow(/catalog is closed/);
  });
});
