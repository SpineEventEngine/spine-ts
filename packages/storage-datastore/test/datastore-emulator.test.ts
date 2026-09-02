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

import { create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  StorageGroup,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import { DatastoreQueryLimitError, DatastoreStorageFactory } from "../src/index.js";

const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;
const projectId = process.env.DATASTORE_PROJECT_ID ?? "spine-t0135-emulator";

describe.skipIf(emulatorHost === undefined)("Datastore emulator", () => {
  it("persists flat records with native columns, provider queries, pages, CAS, and finite scans", async () => {
    const client = datastore();
    const name = unique("records");
    const kind = unique("FlatRows");
    const context = { name, multitenant: false } as const;
    const records = DatastoreStorageFactory.newBuilder()
      .setClient(client)
      .organizeRecords(StringValueSchema, { kind })
      .build()
      .createRecordStorage(context, stringSpec());
    const values = ["alpha", "beta", "bravo", "charlie"];

    try {
      await records.writeAll(values.map(message));
      await expect(records.read("alpha")).resolves.toMatchObject({ value: "alpha" });
      await expect(
        records.query({
          filters: [{ column: "initial", value: "b" }],
          sort: [{ field: "value", direction: "desc" }],
        }),
      ).resolves.toMatchObject([{ value: "bravo" }, { value: "beta" }]);
      await expect(
        records.queryPlan({
          predicate: {
            kind: "comparison",
            column: "value",
            operator: "greaterOrEqual",
            value: "b",
          },
          order: [{ column: "value", direction: "asc" }],
          mask: { paths: ["value"] },
          limit: 2,
        }),
      ).resolves.toEqual([message("beta"), message("bravo")]);
      await expect(
        records.query({
          sort: [{ field: "id" }],
          after: { id: "beta", values: [{ field: "id", value: "beta" }] },
        }),
      ).resolves.toMatchObject([{ value: "bravo" }, { value: "charlie" }]);

      const [first, second] = await Promise.all(
        [1, 2].map(() => records.compareAndSet("race", undefined, message("race"))),
      );
      expect([first, second].filter(Boolean)).toHaveLength(1);
      await expect(records.compareAndSet("race", message("race"), undefined)).resolves.toBe(true);
      await expect(records.delete("alpha")).resolves.toBe(true);
      await expect(records.delete("alpha")).resolves.toBe(false);

      const [physical] = await client.runQuery(client.createQuery(kind));
      expect(physical).toHaveLength(3);
      const row = physical[0] as Record<string, unknown> | undefined;
      expect(row?.bytes).toBeInstanceOf(Uint8Array);
      expect(row?.initial).toBeTypeOf("string");
      expect(row?.value).toBeTypeOf("string");

      await records.writeAll(
        Array.from({ length: 1_001 }, (_, index) => message(`scan-${String(index)}`)),
      );
      await expect(records.query()).rejects.toEqual(new DatastoreQueryLimitError(1_000));
    } finally {
      await deleteKind(client, kind);
    }
  }, 30_000);

  it("shares context-neutral families while groups and tenant namespaces isolate", async () => {
    const client = datastore();
    const name = unique("isolation");
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const spec = stringSpec();
    const single = factory.createRecordStorage({ name, multitenant: false }, spec);
    const otherContext = factory.createRecordStorage(
      { name: `${name}-other`, multitenant: false },
      spec,
    );
    const group = factory.createRecordStorage(
      { name, multitenant: false },
      spec,
      new StorageGroup("other"),
    );
    const tenantA = factory.createRecordStorage(
      { name, multitenant: true, tenantId: tenant("a") },
      spec,
    );
    const tenantB = factory.createRecordStorage(
      { name, multitenant: true, tenantId: tenant("b") },
      spec,
    );

    try {
      await single.write(message("same"));
      await otherContext.write(message("same"));
      await Promise.all([group, tenantA, tenantB].map((storage) => storage.write(message("same"))));
      await single.write(message("single"));
      await group.write(message("group"));
      await tenantA.write(message("tenant-a"));
      await tenantB.write(message("tenant-b"));
      await expect(single.read("same")).resolves.toMatchObject({ value: "same" });
      await expect(otherContext.read("same")).resolves.toMatchObject({ value: "same" });
      await expect(group.read("same")).resolves.toMatchObject({ value: "same" });
      await expect(tenantA.read("same")).resolves.toMatchObject({ value: "same" });
      await expect(tenantB.read("same")).resolves.toMatchObject({ value: "same" });
      await expect(
        tenantA.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([message("tenant-a")]);
      await expect(
        tenantB.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([message("tenant-b")]);
      await expect(
        group.queryPlan({ predicate: { kind: "ids", ids: ["single", "group"] } }),
      ).resolves.toEqual([message("group")]);
      await expect(
        single.queryPlan({ predicate: { kind: "ids", ids: ["single", "group"] } }),
      ).resolves.toEqual([message("single")]);
      expect(await rows(client, StringValueSchema.typeName)).toHaveLength(2);
      expect(await rows(client, StringValueSchema.typeName, "Va")).toHaveLength(2);
      expect(await rows(client, StringValueSchema.typeName, "Vb")).toHaveLength(2);
      await Promise.all(
        [single, otherContext, group, tenantA, tenantB].flatMap((storage) =>
          ["same", "single", "group", "tenant-a", "tenant-b"].map((id) => storage.delete(id)),
        ),
      );
    } finally {
      await Promise.all(
        [single, otherContext, group, tenantA, tenantB].flatMap((storage) =>
          ["same", "single", "group", "tenant-a", "tenant-b"].map((id) => storage.delete(id)),
        ),
      );
    }
  });

  it("keeps Entity current, histories, and Event Store in separate physical families", async () => {
    const client = datastore();
    const context = { name: unique("entity"), multitenant: false } as const;
    const entity = entityInput(context, true);
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const handle = factory.createEntityStorage(entity);
    const first = entityRecord("current", 1);

    try {
      await expect(
        handle.commits.commit({
          context,
          entity,
          entityId: "task",
          next: first,
          states: [entityRecord("retained", 1)],
          diagnostics: [entityEvent("diagnostic", 1)],
          events: [entityEvent("delivery", 1)],
        }),
      ).resolves.toBe("committed");
      await expect(
        handle.commits.commit({
          context,
          entity,
          entityId: "task",
          expected: entityRecord("wrong", 1),
          next: entityRecord("next", 2),
        }),
      ).resolves.toBe("conflict");
      await expect(
        handle.commits.commit({ context, entity, entityId: "task", next: first }),
      ).resolves.toBe("committed");
      const concurrent = await Promise.all(
        ["two", "three"].map((value) =>
          handle.commits.commit({
            context,
            entity,
            entityId: "task",
            expected: first,
            next: entityRecord(value, 2),
          }),
        ),
      );
      expect(concurrent.filter((result) => result === "committed")).toHaveLength(1);
      expect(concurrent.filter((result) => result === "conflict")).toHaveLength(1);
      await expect(handle.current.read("task")).resolves.toMatchObject({ version: { number: 2 } });

      const kinds = await Promise.all([
        rows(client, StringValueSchema.typeName),
        rows(client, `${StringValueSchema.typeName}_EntityRecord`),
        rows(client, `${StringValueSchema.typeName}_Event`),
        rows(client, EventSchema.typeName),
      ]);
      expect(kinds.map((value) => value.length)).toEqual([1, 1, 1, 1]);
      expect(kinds.flat().every((row) => row.bytes instanceof Uint8Array)).toBe(true);

      for (let version = 2; version <= 129; version += 1)
        await handle.states.append(entityRecord(`state-${String(version)}`, version));
      await handle.states.trim("task", 1);
      await expect(handle.states.backward("task", 2)).resolves.toHaveLength(1);

      const disabled = factory.createEntityStorage(
        entityInput({ name: unique("disabled"), multitenant: false }, false),
      );
      await expect(disabled.states.append(entityRecord("state", 1))).rejects.toThrow("disabled");
      disabled.close();
      handle.close();
      await expect(handle.current.read("task")).rejects.toThrow("closed");
    } finally {
      handle.close();
      await Promise.all([
        deleteKind(client, StringValueSchema.typeName),
        deleteKind(client, `${StringValueSchema.typeName}_EntityRecord`),
        deleteKind(client, `${StringValueSchema.typeName}_Event`),
        deleteKind(client, EventSchema.typeName),
      ]);
    }
  }, 30_000);

  it("reports corrupt physical payloads without leaking provider details", async () => {
    const client = datastore();
    const context = { name: unique("corrupt"), multitenant: false } as const;
    const kind = unique("CorruptRows");
    const records = DatastoreStorageFactory.newBuilder()
      .setClient(client)
      .organizeRecords(StringValueSchema, { kind })
      .build()
      .createRecordStorage(context, stringSpec());
    try {
      await records.write(message("bad"));
      const [stored] = await rows(client, kind);
      if (stored?.key === undefined) throw new Error("Expected emulator row.");
      const { key, ...data } = stored;
      await client.save({
        key,
        data: { ...data, bytes: Buffer.from([255]) },
      });
      await expect(records.read("bad")).rejects.toThrow("cannot be decoded");
    } finally {
      await deleteKind(client, kind);
    }
  });
});

function datastore(): Datastore {
  return new Datastore({ projectId });
}

function stringSpec(): RecordSpec<string, ReturnType<typeof message>> {
  return new RecordSpec({
    sourceType: StringValueSchema,
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: [
      new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      new RecordColumn("initial", ColumnTypes.scalar(ScalarType.STRING), (record) =>
        record.value.slice(0, 1),
      ),
    ],
  });
}

function message(value: string) {
  return create(StringValueSchema, { value });
}

function entityInput(
  context: StorageContext,
  histories: boolean,
): EntityStorageInput<string, ReturnType<typeof message>> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: pack,
      unpack: (id) =>
        id.typeUrl.endsWith(StringValueSchema.typeName)
          ? fromBinary(StringValueSchema, id.value).value
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec<string, EntityRecord>({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("EntityRecord.entityId is required.");
        return fromBinary(StringValueSchema, record.entityId.value).value;
      },
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    ...(histories ? { stateHistory: true, eventHistory: true } : {}),
  };
}

function pack(value: string) {
  return create(AnySchema, {
    typeUrl: `type.spine.io/${StringValueSchema.typeName}`,
    value: toBinary(StringValueSchema, message(value)),
  });
}

function entityRecord(value: string, version: number) {
  return create(EntityRecordSchema, {
    entityId: pack("task"),
    state: pack(value),
    version: { number: version, timestamp: create(TimestampSchema, { seconds: BigInt(version) }) },
  });
}

function entityEvent(id: string, version: number) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: pack("task"),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: { number: version },
    },
  });
}

function unique(part: string): string {
  return `T0135${part}${String(Date.now())}${Math.random().toString(36).slice(2)}`;
}

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

async function rows(client: Datastore, kind: string, namespace?: string): Promise<PhysicalRow[]> {
  const query =
    namespace === undefined ? client.createQuery(kind) : client.createQuery(namespace, kind);
  const [result] = await client.runQuery(query);
  return result.map((value) => physicalRow(value, client.KEY));
}

async function deleteKind(client: Datastore, kind: string, namespace?: string): Promise<void> {
  const found = await rows(client, kind, namespace);
  const keys = found.map((row) => row.key).filter((key) => key !== undefined);
  if (keys.length > 0) await client.delete(keys);
}

interface PhysicalRow {
  bytes?: unknown;
  key?: unknown;
  [key: string]: unknown;
}

function physicalRow(value: unknown, key: symbol): PhysicalRow {
  if (typeof value !== "object" || value === null) throw new Error("Expected Datastore entity.");
  const source = value as Record<PropertyKey, unknown>;
  const row: PhysicalRow = {};
  for (const [name, property] of Object.entries(source)) row[name] = property;
  row.key = source[key];
  return row;
}
