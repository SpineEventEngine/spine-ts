import { create, ScalarType } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { ColumnTypes, RecordColumn, RecordSpec, StorageGroup } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreQueryLimitError, DatastoreStorageFactory } from "../src/index.js";

describe("DatastoreStorageFactory", () => {
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
    const commits = { close: () => undefined, commit: () => Promise.resolve("committed" as const) };
    const handle = {
      current: {},
      states: {},
      events: {},
      commits,
      isOpen: () => true,
      close: () => undefined,
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
