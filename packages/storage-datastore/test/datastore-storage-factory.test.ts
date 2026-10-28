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

import { create, ScalarType } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { ColumnTypes, RecordColumn, RecordSpec, StorageGroup } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { TenantIdSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ProjectStateSchema } from "../../core/test-fixtures/generated/project_states_pb.js";
import { ProjectIdSchema } from "../../server/test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import { AnyPacker } from "@spine-event-engine/core";
import { scope } from "../../storage/test/entity/agent-history-fixtures.js";

import { DatastoreQueryLimitError, DatastoreStorageFactory } from "../src/index.js";

describe("DatastoreStorageFactory", () => {
  it("checks the exact shared namespace metadata key without creating application records", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();

    await Promise.all([factory.checkConnection(), factory.checkConnection()]);

    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toMatchObject({
      namespace: "",
      kind: "__namespace__",
      projection: "__key__",
    });
    expect(client.keys).toEqual([{ namespace: "", path: ["__namespace__", 1] }]);
    expect(client.filters).toEqual([
      {
        op: "AND",
        filters: [
          { name: "__key__", op: ">=", val: client.keys[0] },
          { name: "__key__", op: "<=", val: client.keys[0] },
        ],
      },
    ]);
    expect(client.writes).toBe(0);
    await factory.close();
    expect(client.closed).toBe(false);
  });

  it("rejects selected custom records without preparation before invoking their creator", async () => {
    let creators = 0;
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(new MetadataClient() as never)
      .useRecordStorage(StringValueSchema, () => {
        creators++;
        return {} as never;
      })
      .build();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });

    await expect(
      StoragePreparations.for(factory).prepareRecord(
        { name: "test", multitenant: false },
        spec,
        undefined,
        "check",
      ),
    ).rejects.toThrow("preparation");
    expect(creators).toBe(0);
  });

  it("coalesces equivalent native declarations and rejects an incompatible physical kind", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const prepare = StoragePreparations.for(factory);
    const context = { name: "test", multitenant: false } as const;
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const other = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: () => 1,
    });

    await Promise.all([
      prepare.prepareRecord(context, first, undefined, "check"),
      prepare.prepareRecord(context, first, undefined, "create"),
    ]);
    expect(client.queries).toHaveLength(1);
    await expect(prepare.prepareRecord(context, other, undefined, "check")).rejects.toThrow(
      "incompatible",
    );
    expect(client.queries).toHaveLength(1);
  });

  it("shares physical compatibility declarations with ordinary native handles", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const context = { name: "test", multitenant: false } as const;
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const other = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: () => 1,
    });
    factory.createRecordStorage(context, first);

    await expect(
      StoragePreparations.for(factory).prepareRecord(context, other, undefined, "check"),
    ).rejects.toThrow("incompatible");
    expect(client.queries).toHaveLength(0);
    expect(() => factory.createRecordStorage(context, other)).toThrow("incompatible");
  });

  it("drains admitted checks before closing and retries a failed metadata read", async () => {
    const client = new MetadataClient();
    client.fail = true;
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    await expect(factory.checkConnection()).rejects.toThrow("metadata read failed");
    client.fail = false;
    let release!: () => void;
    client.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = factory.checkConnection();
    const closing = factory.close();
    await expect(factory.checkConnection()).rejects.toThrow("closed");
    release();
    await expect(admitted).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(client.queries).toHaveLength(2);
    expect(client.closed).toBe(false);
  });

  it("keeps a preparation failure on the operation rather than factory cleanup", async () => {
    const client = new MetadataClient();
    client.fail = true;
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });

    await expect(
      StoragePreparations.for(factory).prepareRecord(
        { name: "test", multitenant: false },
        spec,
        undefined,
        "check",
      ),
    ).rejects.toThrow("metadata read failed");
    await expect(factory.close()).resolves.toBeUndefined();
  });

  it("retries a failed native family check on the same factory", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const preparation = StoragePreparations.for(factory);
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    client.fail = true;
    await expect(
      preparation.prepareRecord({ name: "test", multitenant: false }, spec, undefined, "check"),
    ).rejects.toThrow("metadata read failed");
    client.fail = false;

    await expect(
      preparation.prepareRecord({ name: "test", multitenant: false }, spec, undefined, "create"),
    ).resolves.toBeUndefined();
    expect(client.queries).toHaveLength(2);
  });

  it("keeps a live native declaration after a failed metadata probe", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const context = { name: "test", multitenant: false } as const;
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const incompatible = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: () => 1,
    });
    factory.createRecordStorage(context, first);
    client.fail = true;
    await expect(
      StoragePreparations.for(factory).prepareRecord(context, first, undefined, "check"),
    ).rejects.toThrow("metadata read failed");
    expect(() => factory.createRecordStorage(context, incompatible)).toThrow("incompatible");
    client.fail = false;
    await expect(
      StoragePreparations.for(factory).prepareRecord(context, first, undefined, "check"),
    ).resolves.toBeUndefined();
  });

  it("records the same namespace mapping used by a native handle", async () => {
    const client = new RecordingClient();
    let conversions = 0;
    const tenantId = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setNamespaceConverter({
        toNamespace: () => `Vtenant-a-${String(++conversions)}`,
        fromNamespace: () => tenantId,
      })
      .build();
    const context = { name: "test", multitenant: true, tenantId } as const;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = factory.createRecordStorage(context, spec);
    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(conversions).toBe(1);
    expect(client.saved[0]?.key).toMatchObject({ namespace: "Vtenant-a-1" });
  });

  it("keeps a handle declared while its matching preparation is pending", async () => {
    const client = new MetadataClient();
    let rejectProbe!: (error: Error) => void;
    client.gate = new Promise<void>((_resolve, reject) => {
      rejectProbe = reject;
    });
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const context = { name: "test", multitenant: false } as const;
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const incompatible = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: () => 1,
    });
    const pending = StoragePreparations.for(factory).prepareRecord(
      context,
      first,
      undefined,
      "check",
    );
    await Promise.resolve();
    expect(client.queries).toHaveLength(1);
    factory.createRecordStorage(context, first);
    rejectProbe(new Error("metadata read failed"));

    await expect(pending).rejects.toThrow("metadata read failed");
    expect(() => factory.createRecordStorage(context, incompatible)).toThrow("incompatible");
  });

  it("uses the selected custom preparation without constructing a record handle", async () => {
    const client = new MetadataClient();
    const calls: string[] = [];
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useRecordStorage(
        StringValueSchema,
        () => {
          calls.push("creator");
          return {} as never;
        },
        (_context, _spec, received, mode) => {
          expect(received).toBe(client);
          calls.push(mode);
          return Promise.resolve();
        },
      )
      .build();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });

    await StoragePreparations.for(factory).prepareRecord(
      { name: "test", multitenant: false },
      spec,
      undefined,
      "check",
    );
    expect(calls).toEqual(["check"]);
    expect(client.queries).toHaveLength(0);
  });

  it("prepares current Entity, enabled histories, and surviving Agent audit declarations", async () => {
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const input = projectPreparationInput();
    const preparation = StoragePreparations.for(factory);

    await preparation.prepareEntity(input, "check");
    await preparation.prepareAgentHistory(scope, "create");
    expect(client.queries).toHaveLength(5);
    await preparation.prepareEntity(input, "create");
    expect(client.queries).toHaveLength(5);
    expect(client.writes).toBe(0);
  });

  it("selects exact custom preparation and rejects a custom Entity without its callback", async () => {
    const calls: string[] = [];
    const client = new MetadataClient();
    const builder = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useRecordStorage(
        StringValueSchema,
        () => {
          calls.push("fallback creator");
          return {} as never;
        },
        () => {
          calls.push("fallback preparation");
          return Promise.resolve();
        },
      )
      .useRecordStorage(
        BoolValueSchema,
        StringValueSchema,
        () => {
          calls.push("exact creator");
          return {} as never;
        },
        () => {
          calls.push("exact preparation");
          return Promise.resolve();
        },
      )
      .useEntityStorage(ProjectStateSchema, () => {
        calls.push("Entity creator");
        return {} as never;
      });
    const factory = builder.build();
    const preparation = StoragePreparations.for(factory);
    const spec = new RecordSpec({
      sourceType: BoolValueSchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });

    await preparation.prepareRecord({ name: "test", multitenant: false }, spec, undefined, "check");
    await preparation.prepareRecord(
      { name: "test", multitenant: false },
      spec,
      new StorageGroup("other"),
      "create",
    );
    await expect(preparation.prepareEntity(projectPreparationInput(), "create")).rejects.toThrow(
      "Custom Datastore Entity preparation is required",
    );
    expect(calls).toEqual(["exact preparation", "fallback preparation"]);
    expect(client.queries).toHaveLength(0);
  });

  it("passes the coherent Entity declaration to its custom callback without invoking creator", async () => {
    const calls: string[] = [];
    const client = new MetadataClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useEntityStorage(
        ProjectStateSchema,
        () => {
          calls.push("creator");
          return {} as never;
        },
        (input, received, mode) => {
          expect(input.stateSchema).toBe(ProjectStateSchema);
          expect(received).toBe(client);
          calls.push(mode);
          return Promise.resolve();
        },
      )
      .build();

    await StoragePreparations.for(factory).prepareEntity(projectPreparationInput(), "check");
    expect(calls).toEqual(["check"]);
    expect(client.queries).toHaveLength(0);
  });

  it("drains an admitted custom callback and fences subsequent preparation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(new MetadataClient() as never)
      .useEntityStorage(
        ProjectStateSchema,
        () => {
          calls.push("creator");
          return {} as never;
        },
        () => {
          calls.push("prepare");
          return gate;
        },
      )
      .build();
    const preparation = StoragePreparations.for(factory);
    const admitted = preparation.prepareEntity(projectPreparationInput(), "check");
    const closing = factory.close();

    await expect(preparation.prepareEntity(projectPreparationInput(), "create")).rejects.toThrow(
      "closed",
    );
    release();
    await expect(admitted).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(calls).toEqual(["prepare"]);
  });
  it("requires a caller-owned client before synchronous build", () => {
    expect(() => DatastoreStorageFactory.newBuilder().build()).toThrow("requires a client");
    expect(
      DatastoreStorageFactory.newBuilder()
        .setClient({} as never)
        .build()
        .isOpen(),
    ).toBe(true);
  });

  it("uses the last record-only creator and supplies the fixed scan bound", () => {
    const calls: number[] = [];
    const first = () => {
      throw new Error("first creator must be replaced");
    };
    const second = (_context: unknown, _spec: unknown, _client: unknown, limit: number) => {
      calls.push(limit);
      return { close: () => undefined, isOpen: () => true };
    };
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(StringValueSchema, first as never)
      .useRecordStorage(StringValueSchema, second as never)
      .build();

    factory.createRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    expect(calls).toEqual([1_000]);
  });

  it("writes one flat record with scope, bytes, and declared native columns", async () => {
    const client = new RecordingClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const storage = factory.createRecordStorage(
      { name: "tasks", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>(
            "value",
            ColumnTypes.scalar(ScalarType.STRING),
            (record) => record.value,
          ),
        ],
      }),
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(client.saved).toHaveLength(1);
    const [saved] = client.saved;
    if (saved === undefined) throw new Error("Expected a saved Datastore row.");
    expect(Object.keys(saved.data).sort()).toEqual(["bytes", "value"]);
    expect(saved.key.path[0]).toBe("google.protobuf.StringValue");
    expect(saved.data.value).toBe("one");
  });

  it("uses a 1,001-row sentinel for finite reconciliation", async () => {
    const client = new QueryClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const storage = factory.createRecordStorage(
      { name: "tasks", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await expect(storage.query()).rejects.toEqual(new DatastoreQueryLimitError(1_000));
    expect(client.query.filters).toEqual([]);
    expect(client.query.limitValue).toBe(1_001);
  });

  it("selects one coherent custom Entity handle", () => {
    const client = {};
    const commits = {
      close: () => Promise.resolve(),
      closeIdle: () => undefined,
      commit: () => Promise.resolve(),
    };
    const handle = {
      current: {},
      states: {},
      events: {},
      commits,
      isOpen: () => true,
      close: () => Promise.resolve(),
      closeIdle: () => undefined,
    };
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useEntityStorage(StringValueSchema, (input, received) => {
        expect(input.sourceType).toBe(StringValueSchema);
        expect(received).toBe(client);
        return handle as never;
      })
      .build();

    expect(factory.createEntityStorage({ sourceType: StringValueSchema } as never).commits).toBe(
      commits,
    );
  });

  it("prefers exact record layouts over record-only layouts and snapshots the builder", async () => {
    const client = new RecordingClient();
    const builder = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .organizeRecords(StringValueSchema, { kind: "record-only" })
      .organizeRecords(BoolValueSchema, StringValueSchema, { kind: "exact" });
    const factory = builder.build();
    builder.organizeRecords(BoolValueSchema, StringValueSchema, { kind: "later" });
    const storage = factory.createRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: BoolValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await storage.write(create(StringValueSchema, { value: "one" }));
    expect(client.saved[0]?.key.path[0]).toBe("exact");
  });

  it("uses the grouped record kind by default and rejects blank configured kinds", async () => {
    const client = new RecordingClient();
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build()
      .createRecordStorage(
        { name: "test", multitenant: false },
        new RecordSpec<string, StringValue>({
          sourceType: StringValueSchema,
          recordType: StringValueSchema,
          idKind: "string",
          extractId: (record) => record.value,
        }),
        new StorageGroup("history"),
      );

    await storage.write(create(StringValueSchema, { value: "one" }));
    expect(client.saved[0]?.key.path[0]).toBe("history_StringValue");
    expect(() =>
      DatastoreStorageFactory.newBuilder()
        .setClient(client as never)
        .organizeRecords(StringValueSchema, { kind: " " }),
    ).toThrow("non-blank");
  });

  it("prefers exact custom record creators over record-only creators", () => {
    const calls: string[] = [];
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(StringValueSchema, () => {
        calls.push("record-only");
        return { close: () => undefined, isOpen: () => true } as never;
      })
      .useRecordStorage(BoolValueSchema, StringValueSchema, () => {
        calls.push("exact");
        return { close: () => undefined, isOpen: () => true } as never;
      })
      .build();

    factory.createRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: BoolValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    expect(calls).toEqual(["exact"]);
  });

  it("resolves grouped layouts by the storage group rather than the record source", async () => {
    const client = new RecordingClient();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .organizeRecords(BoolValueSchema, StringValueSchema, { kind: "unrelated-source" })
      .organizeRecords(TimestampSchema, StringValueSchema, { kind: "group-exact" })
      .build();
    const storage = factory.createRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: BoolValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
      new StorageGroup(TimestampSchema.typeName),
    );

    await storage.write(create(StringValueSchema, { value: "one" }));
    expect(client.saved[0]?.key.path[0]).toBe("group-exact");
  });

  it("rejects distinct registrations that claim the same custom kind", () => {
    expect(() =>
      DatastoreStorageFactory.newBuilder()
        .setClient({} as never)
        .organizeRecords(StringValueSchema, { kind: "shared" })
        .organizeRecords(BoolValueSchema, StringValueSchema, { kind: "shared" })
        .build(),
    ).toThrow("same custom kind");
  });
});

function projectPreparationInput() {
  return {
    context: { name: "Projects", multitenant: false } as const,
    id: {
      clone: (id: string) => id,
      key: (id: string) => id,
      pack: (id: string) => AnyPacker.pack(ProjectIdSchema, create(ProjectIdSchema, { value: id })),
      unpack: (id: NonNullable<EntityRecord["entityId"]>) =>
        AnyPacker.tryUnpack(id, ProjectIdSchema)?.value,
    },
    columns: [],
    recordSpec: new RecordSpec<string, EntityRecord>({
      sourceType: ProjectStateSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("Entity ID is required.");
        return AnyPacker.unpack(record.entityId, ProjectIdSchema).value;
      },
    }),
    sourceType: ProjectStateSchema,
    stateSchema: ProjectStateSchema,
    stateHistory: true,
    eventHistory: true,
  };
}

class RecordingClient {
  readonly saved: { key: { path: readonly [string, string] }; data: Record<string, unknown> }[] =
    [];
  readonly KEY = Symbol("key");
  key(value: { path: readonly [string, string] }): { path: readonly [string, string] } {
    return value;
  }
  save(value: {
    key: { path: readonly [string, string] };
    data: Record<string, unknown>;
  }): Promise<void> {
    this.saved.push(value);
    return Promise.resolve();
  }
}

class QueryClient extends RecordingClient {
  readonly query = new Query();
  createQuery(): Query {
    return this.query;
  }
  runQuery(): Promise<[unknown[]]> {
    return Promise.resolve([Array.from({ length: 1_001 }, () => ({}))]);
  }
}

class Query {
  readonly filters: { name: string; op: string; value: unknown }[] = [];
  limitValue: number | undefined;
  filter(
    name: string | { name: string; op: string; val: unknown },
    op?: string,
    value?: unknown,
  ): this {
    if (typeof name === "object") {
      this.filters.push({ name: name.name, op: name.op, value: name.val });
      return this;
    }
    if (op === undefined) throw new Error("Query filter requires an operator.");
    this.filters.push({ name, op, value });
    return this;
  }
  order(): this {
    return this;
  }
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }
}

class MetadataClient {
  readonly queries: unknown[] = [];
  readonly keys: unknown[] = [];
  readonly filters: unknown[] = [];
  writes = 0;
  closed = false;
  fail = false;
  gate: Promise<void> | undefined;
  readonly namespace = "";
  key(value: unknown): unknown {
    this.keys.push(value);
    return value;
  }
  createQuery(namespace: string, kind: string): object {
    const query = {
      namespace,
      kind,
      projection: "",
      select: (projection: string) => {
        query.projection = projection;
        return {
          ...query,
          filter: (filter: unknown) => {
            this.filters.push(filter);
            return query;
          },
        };
      },
    };
    this.queries.push(query);
    return query;
  }
  async runQuery(): Promise<[unknown[]]> {
    if (this.fail) throw new Error("metadata read failed");
    await this.gate;
    return [[]];
  }
}
