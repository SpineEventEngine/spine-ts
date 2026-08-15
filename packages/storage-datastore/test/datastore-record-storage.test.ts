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
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { StringifierRegistry } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreRecordStorage } from "../src/datastore/record-storage.js";

describe("DatastoreRecordStorage", () => {
  it("writes, reads, deletes, and batches flat records", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    await records.write(create(StringValueSchema, { value: "one" }));
    await records.writeAll([
      create(StringValueSchema, { value: "two" }),
      create(StringValueSchema, { value: "three" }),
    ]);

    expect((await records.read("one"))?.value).toBe("one");
    expect(await records.delete("two")).toBe(true);
    expect(await records.delete("two")).toBe(false);
    expect((await records.query()).map((record) => record.value)).toEqual(["one", "three"]);
    expect(client.batches).toEqual([1, 2]);
  });

  it("splits bulk writes at the Datastore 500-mutation boundary", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    await records.writeAll(
      Array.from({ length: 501 }, (_, index) => message(`record-${String(index)}`)),
    );

    expect(client.batches).toEqual([500, 1]);
  });

  it("applies atomic create, replace, delete, and collision checks", async () => {
    const records = storage(new FlatDatastore());
    const one = create(StringValueSchema, { value: "one" });
    const replaced = create(StringValueSchema, { value: "one" });

    await expect(records.compareAndSet("one", undefined, one)).resolves.toBe(true);
    await expect(records.compareAndSet("one", undefined, one)).resolves.toBe(false);
    await expect(records.compareAndSet("one", one, replaced)).resolves.toBe(true);
    await expect(records.compareAndSet("one", one, undefined)).resolves.toBe(true);
    await expect(records.compareAndSet("one", one, undefined)).resolves.toBe(false);
  });

  it("retries ABORTED conditional mutations at most three times", async () => {
    const client = new FlatDatastore();
    client.abortCommits = 3;
    const records = storage(client);

    await expect(
      records.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow("Datastore transaction failed");
    expect(client.transactions).toBe(3);
  });

  it("redacts credential-bearing Datastore transaction errors", async () => {
    const client = new FlatDatastore();
    client.commitError = new Error("credential token exposed");
    const records = storage(client);

    await expect(
      records.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow("Datastore transaction failed");
  });

  it("redacts key-bearing compare-and-set provider errors", async () => {
    const client = new FlatDatastore();
    client.commitError = new Error("ABORTED key=tenant/private-record");
    const records = storage(client);

    await expect(records.compareAndSet("one", undefined, message("one"))).rejects.toThrow(
      "Datastore transaction failed",
    );
    await expect(records.compareAndSet("one", undefined, message("one"))).rejects.not.toThrow(
      "private-record",
    );
  });

  it("rejects invalid internal provider page bounds before provider work", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    await expect(records.queryProviderPage({ limit: 0 })).rejects.toThrow("positive integer");
    await expect(records.queryProviderPage({ limit: 129 })).rejects.toThrow("no greater than 128");
    await expect(records.queryProviderPage({ limit: 1.5 })).rejects.toThrow("positive integer");
  });

  it("rejects malformed explicit provider continuations before querying", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    await expect(
      records.queryProviderPage({
        limit: 1,
        cursor: { values: ["unexpected"], key: "key" },
      }),
    ).rejects.toThrow("continuation is malformed");
    await expect(
      records.queryProviderPage({
        limit: 1,
        cursor: { values: [], key: undefined },
      }),
    ).rejects.toThrow("continuation is malformed");
  });

  it("filters and orders declared columns while keeping storage IDs as Datastore keys", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["beta", "alpha", "bravo"].map(message));

    const values = await records.query({
      filters: [{ column: "initial", value: "b" }],
      sort: [{ field: "value", direction: "desc" }],
    });

    expect(values.map((record) => record.value)).toEqual(["bravo", "beta"]);
    expect(client.lastQuery?.filters).toMatchObject([{ name: "initial", op: "=" }]);
    expect(client.lastQuery?.orders).toEqual([
      { field: "value", descending: true },
      { field: "__key__", descending: false },
    ]);
    expect((await records.queryEntries())[0]?.id).toBe("alpha");
  });

  it("uses the same custom stringifier for a stored column and its query operand", async () => {
    const client = new FlatDatastore();
    const stringifiers = new StringifierRegistry();
    stringifiers.register(UserIdSchema, {
      toString: (id) => `user:${id.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice(5) }),
    });
    const owner = create(UserIdSchema, { value: "ada" });
    const records = new DatastoreRecordStorage(
      { name: "messages", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
        columns: [new RecordColumn("owner", ColumnTypes.message(UserIdSchema), () => owner)],
      }),
      client as never,
      1_000,
      undefined,
      undefined,
      undefined,
      stringifiers,
    );

    await records.write(message("one"));
    await records.query({ filters: [{ column: "owner", value: owner }] });

    expect(client.lastData?.owner).toBe("user:ada");
    expect(client.lastQuery?.filters).toMatchObject([
      { name: "owner", op: "=", value: "user:ada" },
    ]);
  });

  it("pushes direct ID lists, ID filters, and keyset pages to Datastore", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await records.query({
      ids: ["alpha", "charlie"],
      filters: [{ column: "id", value: ["alpha", "charlie"] }],
      sort: [{ field: "id", direction: "asc" }],
    });
    expect(client.lastQuery?.filters).toMatchObject([
      { name: "__key__", op: "IN" },
      { name: "__key__", op: "IN" },
    ]);

    await records.query({
      sort: [{ field: "id", direction: "asc" }],
      after: { values: [{ field: "id", value: "alpha" }], id: "alpha" },
      limit: 1,
    });
    expect(client.lastQuery?.limitValue).toBe(1);
    expect(client.lastQuery?.filters.at(-1)).toMatchObject({ name: "__key__", op: ">" });
  });

  it("applies offset, limits, and continued windows after local reconciliation", async () => {
    const records = storage(new FlatDatastore());
    await records.writeAll(["delta", "alpha", "charlie", "bravo"].map(message));

    await expect(
      records.query({ sort: [{ field: "value", direction: "asc" }], offset: 1, limit: 2 }),
    ).resolves.toMatchObject([{ value: "bravo" }, { value: "charlie" }]);
    await expect(
      records.query({
        sort: [{ field: "value", direction: "asc" }],
        after: { values: [{ field: "value", value: "bravo" }], id: "bravo" },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ value: "charlie" }]);
  });

  it("rejects disjunctions and oversized ID sets before an unfiltered provider read", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await expect(
      records.queryPlan({
        predicate: {
          kind: "either",
          predicates: [
            { kind: "comparison", column: "initial", operator: "equal", value: "a" },
            { kind: "comparison", column: "initial", operator: "equal", value: "c" },
          ],
        },
        order: [{ column: "value", direction: "asc" }],
      }),
    ).rejects.toThrow("EITHER");
    expect(client.lastQuery).toBeUndefined();

    await expect(
      records.queryPlan({
        predicate: {
          kind: "ids",
          ids: Array.from({ length: 31 }, (_, index) => `id-${String(index)}`),
        },
      }),
    ).rejects.toThrow("illegal predicate");
    expect(client.lastQuery).toBeUndefined();
  });

  it("rejects illegal inequalities and ordering before an unfiltered provider read", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await expect(
      records.queryPlan({
        predicate: {
          kind: "all",
          predicates: [
            { kind: "comparison", column: "value", operator: "greaterThan", value: "alpha" },
            { kind: "comparison", column: "initial", operator: "lessThan", value: "z" },
          ],
        },
      }),
    ).rejects.toThrow("inequality");
    expect(client.lastQuery).toBeUndefined();

    await expect(
      records.queryPlan({
        predicate: {
          kind: "comparison",
          column: "value",
          operator: "greaterThan",
          value: "alpha",
        },
        order: [{ column: "initial", direction: "asc" }],
      }),
    ).rejects.toThrow("inequality");
    expect(client.lastQuery).toBeUndefined();
  });

  it("uses a direct provider limit only for an unconstrained record query", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo"].map(message));

    await records.query({ limit: 1 });
    expect(client.lastQuery?.limitValue).toBe(1);
  });

  it("pushes one legal ID predicate and ordered inequality to Datastore", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await records.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "ids", ids: ["bravo"] },
          { kind: "comparison", column: "value", operator: "greaterOrEqual", value: "bravo" },
        ],
      },
      order: [{ column: "value", direction: "asc" }],
    });

    expect(client.lastQuery?.filters).toMatchObject([
      { name: "__key__", op: "=" },
      { name: "value", op: ">=", value: "bravo" },
    ]);
  });

  it("uses the smaller exact plan limit for a normalized provider fetch", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await records.queryPlan({
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
      candidateLimit: 500,
    });

    expect(client.lastQuery?.limitValue).toBe(1);
  });

  it("rejects an undeclared normalized order column before provider access", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    await expect(
      records.queryPlan({ order: [{ column: "missing", direction: "asc" }] }),
    ).rejects.toThrow("not declared");
    expect(client.lastQuery).toBeUndefined();
  });

  it("rejects corrupted payloads and oversized supported IDs before provider writes", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    client.insertCorrupt(records, "bad");

    await expect(records.read("bad")).rejects.toThrow("cannot be decoded");
    await expect(records.write(message("x".repeat(1_501)))).rejects.toThrow("1,500");
    expect(client.batches).toEqual([]);
  });

  it("rejects indexed bigint values outside Datastore's signed 64-bit range", async () => {
    const client = new FlatDatastore();
    const records = new DatastoreRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn("amount", ColumnTypes.scalar(ScalarType.INT64), () => 1n << 63n),
        ],
      }),
      client as never,
      1_000,
    );

    await expect(records.write(message("one"))).rejects.toThrow();
    expect(client.batches).toEqual([]);
  });

  it("stores an absent declared column as native Datastore null", async () => {
    const client = new FlatDatastore();
    const records = new DatastoreRecordStorage(
      { name: "values", multitenant: false },
      new RecordSpec<string, StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn("optional", ColumnTypes.scalar(ScalarType.STRING), () => undefined),
        ],
      }),
      client as never,
      1_000,
    );

    await records.write(message("missing"));
    expect(client.lastData?.optional).toBeNull();
    await expect(records.read("missing")).resolves.toMatchObject({ value: "missing" });
  });

  it("rejects operations after the public storage handle closes", async () => {
    const records = storage(new FlatDatastore());
    records.close();

    await expect(records.read("one")).rejects.toThrow("RecordStorage is closed");
    await expect(records.write(message("one"))).rejects.toThrow("RecordStorage is closed");
  });

  it("rejects invalid Datastore read and query response shapes", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    client.readResponse = null;
    await expect(records.read("one")).rejects.toThrow("invalid entity response");

    client.readResponse = undefined;
    client.queryResponse = null;
    await expect(records.query()).rejects.toThrow("invalid query response");

    client.queryResponse = [[null]];
    await expect(records.query()).rejects.toThrow("invalid entity response");
  });

  it("redacts ordinary provider errors at every public storage boundary", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    const operation = new Error("provider secret details");

    for (const invoke of [
      () => records.read("one"),
      () => records.query(),
      () => records.write(message("one")),
      () => records.writeAll([message("one"), message("two")]),
      () => records.delete("one"),
    ]) {
      client.providerError = operation;
      await expect(invoke()).rejects.toThrow("Datastore provider operation failed");
      client.providerError = undefined;
    }
  });

  it("fails closed for malformed provider page continuation metadata", async () => {
    const client = new FlatDatastore();
    const records = storage(client);

    for (const moreResults of ["UNKNOWN", undefined, "MORE_RESULTS_AFTER_LIMIT"]) {
      client.queryResponse = [
        [],
        { moreResults, ...(moreResults === "MORE_RESULTS_AFTER_LIMIT" ? {} : { endCursor: "x" }) },
      ];
      await expect(records.queryProviderPage({ limit: 1 })).rejects.toThrow(
        "invalid query response",
      );
    }
  });
});

function message(value: string): StringValue {
  return create(StringValueSchema, { value });
}

function storage(client: FlatDatastore): DatastoreRecordStorage<string, StringValue> {
  return new DatastoreRecordStorage(
    { name: "test", multitenant: false },
    new RecordSpec<string, StringValue>({
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
    }),
    client as never,
    1_000,
  );
}

interface Key {
  readonly path: readonly [string, string];
}

interface Entity {
  readonly [property: string]: unknown;
  readonly [property: symbol]: unknown;
}

interface SaveRow {
  readonly key: Key;
  readonly data: Record<string, unknown>;
}

class FlatDatastore {
  readonly KEY = Symbol("key");
  readonly #rows = new Map<string, Entity>();
  readonly batches: number[] = [];
  lastData: Record<string, unknown> | undefined;
  readResponse: unknown = undefined;
  queryResponse: unknown = undefined;
  providerError: Error | undefined;
  transactions = 0;
  abortCommits = 0;
  commitError: Error | undefined;
  lastQuery: FlatQuery | undefined;

  key(value: Key): Key {
    return value;
  }

  save(value: SaveRow | readonly SaveRow[]): Promise<void> {
    if (this.providerError !== undefined) return Promise.reject(this.providerError);
    const rows = isSaveRows(value) ? value : [value];
    this.batches.push(rows.length);
    for (const row of rows) {
      this.#save(row);
    }
    return Promise.resolve();
  }

  get(key: Key): Promise<readonly [Entity | undefined]> {
    if (this.providerError !== undefined) return Promise.reject(this.providerError);
    if (this.readResponse !== undefined) return Promise.resolve(this.readResponse as never);
    return Promise.resolve([this.#row(key)]);
  }

  delete(key: Key): Promise<void> {
    if (this.providerError !== undefined) return Promise.reject(this.providerError);
    this.#rows.delete(this.#name(key));
    return Promise.resolve();
  }

  createQuery(): FlatQuery {
    const query = new FlatQuery();
    this.lastQuery = query;
    return query;
  }

  runQuery(query: FlatQuery): Promise<readonly [readonly Entity[]]> {
    void query;
    if (this.providerError !== undefined) return Promise.reject(this.providerError);
    if (this.queryResponse !== undefined) return Promise.resolve(this.queryResponse as never);
    return Promise.resolve([[...this.#rows.values()].map((entity) => ({ ...entity }))]);
  }

  transaction(): FlatTransaction {
    this.transactions += 1;
    return new FlatTransaction(this);
  }

  apply(row: SaveRow | Key): void {
    if ("data" in row) this.#save(row);
    else this.#rows.delete(this.#name(row));
  }

  insertCorrupt(records: DatastoreRecordStorage<string, StringValue>, id: string): void {
    const prepared = records.transactionEntity(message(id));
    this.#rows.set(this.#name(prepared.key), { [this.KEY]: prepared.key, bytes: "broken" });
  }

  #save(row: SaveRow): void {
    this.lastData = row.data;
    this.#rows.set(this.#name(row.key), { ...row.data, [this.KEY]: row.key });
  }

  #row(key: Key): Entity | undefined {
    const entity = this.#rows.get(this.#name(key));
    return entity === undefined ? undefined : { ...entity };
  }

  #name(key: { readonly path: readonly unknown[] }): string {
    return key.path.join("/");
  }
}

class FlatTransaction {
  #mutation: SaveRow | Key | undefined;

  constructor(private readonly client: FlatDatastore) {}
  run(): Promise<void> {
    return Promise.resolve();
  }
  get(key: Key): Promise<readonly [Entity | undefined]> {
    return this.client.get(key);
  }
  save(row: SaveRow): void {
    this.#mutation = row;
  }
  delete(key: Key): void {
    this.#mutation = key;
  }
  commit(): Promise<void> {
    if (this.client.commitError !== undefined) return Promise.reject(this.client.commitError);
    if (this.client.abortCommits > 0) {
      this.client.abortCommits -= 1;
      const error = Object.assign(new Error("ABORTED"), { code: 10 });
      return Promise.reject(error);
    }
    if (this.#mutation !== undefined) this.client.apply(this.#mutation);
    return Promise.resolve();
  }
  rollback(): Promise<void> {
    return Promise.resolve();
  }
}

function isSaveRows(value: SaveRow | readonly SaveRow[]): value is readonly SaveRow[] {
  return Array.isArray(value);
}

class FlatQuery {
  readonly filters: { name: string; op: string; value: unknown }[] = [];
  readonly orders: { field: string; descending: boolean }[] = [];
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
  order(field: string, options?: { descending?: boolean }): this {
    this.orders.push({ field, descending: options?.descending ?? false });
    return this;
  }
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }
}
