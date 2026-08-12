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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { RecordSpec, type StorageContext } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreRecordStorage } from "../src/datastore/record-storage.js";

describe("DatastoreRecordStorage physical identity", () => {
  it("uses source type as the kind and does not partition equal rows by Context", async () => {
    const client = new RecordingClient();
    const first = storage(client, { name: "one", multitenant: false });
    const second = storage(client, { name: "two", multitenant: false });
    await first.write(create(StringValueSchema, { value: "task" }));
    await second.write(create(StringValueSchema, { value: "task" }));

    expect(client.saved.map((row) => row.key.path)).toEqual([
      [StringValueSchema.typeName, "task"],
      [StringValueSchema.typeName, "task"],
    ]);
    expect(client.saved.map((row) => Object.keys(row.data))).toEqual([["bytes"], ["bytes"]]);
  });

  it("uses JVM native namespaces to isolate complete tenants", async () => {
    const client = new RecordingClient();
    await storage(client, multitenant("same")).write(create(StringValueSchema, { value: "task" }));
    await storage(client, multitenant("other")).write(create(StringValueSchema, { value: "task" }));

    expect(client.saved.map((row) => row.key.namespace)).toEqual(["Vsame", "Vother"]);
    expect(client.saved.map((row) => row.key.path[1])).toEqual(["task", "task"]);
  });

  it("preserves the caller client's namespace for single tenancy", async () => {
    const client = new RecordingClient("caller-owned");
    await storage(client, { name: "one", multitenant: false }).write(
      create(StringValueSchema, { value: "task" }),
    );

    expect(client.saved[0]?.key.namespace).toBe("caller-owned");
  });

  it("validates a custom namespace before creating a multitenant key", () => {
    const client = new RecordingClient();
    expect(
      () =>
        new DatastoreRecordStorage(
          multitenant("same"),
          spec(),
          client as never,
          1_000,
          undefined,
          undefined,
          { toNamespace: () => "", fromNamespace: () => undefined },
        ),
    ).toThrow(/non-empty native namespace/i);
    expect(client.saved).toHaveLength(0);
  });

  it("rejects an oversized explicit layout before client activity", () => {
    const client = new RecordingClient();
    expect(
      () =>
        new DatastoreRecordStorage(
          { name: "scope", multitenant: false },
          spec(),
          client as never,
          1_000,
          undefined,
          "x".repeat(1_501),
        ),
    ).toThrow("1,500");
    expect(client.saved).toHaveLength(0);
  });
});

function spec() {
  return new RecordSpec({
    sourceType: StringValueSchema,
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (value) => value.value,
  });
}

function storage(client: RecordingClient, context: StorageContext) {
  return new DatastoreRecordStorage(context, spec(), client as never, 1_000);
}

function multitenant(value: string): StorageContext {
  return {
    name: "shared",
    multitenant: true,
    tenantId: create(TenantIdSchema, { kind: { case: "value", value } }),
  };
}

class RecordingClient {
  readonly KEY = Symbol("key");
  readonly saved: {
    key: { path: readonly [string, string]; namespace?: string };
    data: Record<string, unknown>;
  }[] = [];

  constructor(readonly namespace?: string) {}

  key(value: { path: readonly [string, string]; namespace?: string }) {
    return value;
  }

  save(value: {
    key: { path: readonly [string, string]; namespace?: string };
    data: Record<string, unknown>;
  }) {
    this.saved.push(value);
    return Promise.resolve();
  }

  get() {
    return Promise.resolve([undefined] as const);
  }
}
