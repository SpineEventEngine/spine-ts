import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
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
    expect(client.lastQuery?.filters).toMatchObject([
      { name: "_scope", op: "=" },
      { name: "initial", op: "=" },
    ]);
    expect(client.lastQuery?.orders).toEqual([
      { field: "value", descending: true },
      { field: "__key__", descending: false },
    ]);
    expect((await records.queryEntries())[0]?.id).toBe("alpha");
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
      { name: "_scope", op: "=" },
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

  it("keeps either predicates and oversized ID sets on the finite reconciliation path", async () => {
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
    ).resolves.toMatchObject([{ value: "alpha" }, { value: "charlie" }]);
    expect(client.lastQuery?.filters).toHaveLength(1);
    expect(client.lastQuery?.filters[0]?.name).toBe("_scope");

    await records.queryPlan({
      predicate: {
        kind: "ids",
        ids: Array.from({ length: 31 }, (_, index) => `id-${String(index)}`),
      },
    });
    expect(client.lastQuery?.filters).toHaveLength(1);
    expect(client.lastQuery?.filters[0]?.name).toBe("_scope");
  });

  it("keeps multi-column and wrongly ordered inequalities on the finite reconciliation path", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    await records.writeAll(["alpha", "bravo", "charlie"].map(message));

    await records.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "value", operator: "greaterThan", value: "alpha" },
          { kind: "comparison", column: "initial", operator: "lessThan", value: "z" },
        ],
      },
    });
    expect(client.lastQuery?.filters).toHaveLength(1);

    await records.queryPlan({
      predicate: {
        kind: "comparison",
        column: "value",
        operator: "greaterThan",
        value: "alpha",
      },
      order: [{ column: "initial", direction: "asc" }],
    });
    expect(client.lastQuery?.filters).toHaveLength(1);
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
      { name: "_scope", op: "=" },
      { name: "__key__", op: "=" },
      { name: "value", op: ">=", value: "bravo" },
    ]);
  });

  it("rejects corrupted payloads and oversized composite IDs before provider writes", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    client.insertCorrupt(records, "bad");

    await expect(records.read("bad")).rejects.toThrow("cannot be decoded");
    const complex = new DatastoreRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec<readonly string[], StringValue>({
        sourceType: StringValueSchema,
        recordType: StringValueSchema,
        idKind: "parts",
        extractId: (record) => [record.value],
      }),
      client as never,
      1_000,
    );
    await expect(complex.write(message("x".repeat(1_600)))).rejects.toThrow("1,500");
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
        columns: [new RecordColumn("amount", () => 1n << 63n, "bigint")],
      }),
      client as never,
      1_000,
    );

    await expect(records.write(message("one"))).rejects.toThrow("exact signed 64-bit");
    expect(client.batches).toEqual([]);
  });

  it("round-trips every supported indexed value through writes and normalized queries", async () => {
    const values = new Map<string, unknown>([
      ["null", null],
      ["false", false],
      ["true", true],
      ["minus-zero", -0],
      ["finite", 1.5],
      ["minimum", -(1n << 63n)],
      ["maximum", (1n << 63n) - 1n],
      ["unicode", "\uE000\u{10000}"],
      ["bytes", new Uint8Array([0, 127, 255])],
      ["array", ["one", 2, true]],
      ["object", { first: 1, second: "two" }],
      ["timestamp", create(TimestampSchema, { seconds: 3n, nanos: 4 })],
    ]);
    const records = valueStorage(new FlatDatastore(), values);
    await records.writeAll([...values.keys()].map(message));

    for (const [label, value] of values) {
      await expect(
        records.queryPlan({
          predicate: { kind: "comparison", column: "value", operator: "equal", value },
        }),
      ).resolves.toMatchObject([{ value: label }]);
    }

    const ordered = await records.query({ sort: [{ field: "value", direction: "asc" }] });
    expect(ordered).toHaveLength(values.size);
    expect(ordered.map((record) => record.value)).not.toEqual([...values.keys()]);
  });

  it("normalizes plain-object insertion order for indexed equality", async () => {
    const first = { first: 1, second: "two" };
    const second = { second: "two", first: 1 };
    const records = valueStorage(
      new FlatDatastore(),
      new Map<string, unknown>([
        ["first", first],
        ["second", second],
      ]),
    );
    await records.writeAll([message("first"), message("second")]);

    await expect(
      records.queryPlan({
        predicate: { kind: "comparison", column: "value", operator: "equal", value: first },
      }),
    ).resolves.toMatchObject([{ value: "first" }, { value: "second" }]);
  });

  it("round-trips supported canonical storage identifiers", async () => {
    const ids: readonly unknown[] = [
      undefined,
      null,
      false,
      true,
      -0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -(1n << 63n),
      (1n << 63n) - 1n,
      "\uE000\u{10000}",
      new Uint8Array([0, 127, 255]),
      ["one", 2, true],
      { first: 1, second: "two" },
      create(TimestampSchema, { seconds: 3n, nanos: 4 }),
    ];
    const records = canonicalIdStorage(new FlatDatastore(), ids);
    await records.writeAll(ids.map((_, index) => message(`record-${String(index)}`)));

    for (const [index, id] of ids.entries()) {
      await expect(records.read(id)).resolves.toMatchObject({ value: `record-${String(index)}` });
    }
    expect(await records.queryEntries()).toHaveLength(ids.length);
  });

  it("orders canonical identifiers across kinds and within compound values", async () => {
    const ids: readonly unknown[] = [
      undefined,
      null,
      true,
      false,
      Number.NaN,
      1,
      -1,
      2n,
      -2n,
      "beta",
      "alpha",
      new Uint8Array([0, 1]),
      new Uint8Array([0]),
      [1, 2],
      [1],
      { value: 2 },
      { value: 1 },
    ];
    const records = canonicalIdStorage(new FlatDatastore(), ids);
    await records.writeAll(ids.map((_, index) => message(`record-${String(index)}`)));

    const sorted = await records.query({ sort: [{ field: "id", direction: "asc" }] });
    expect(sorted.map((record) => record.value)).toEqual([
      "record-14",
      "record-13",
      "record-8",
      "record-7",
      "record-3",
      "record-2",
      "record-12",
      "record-11",
      "record-1",
      "record-6",
      "record-5",
      "record-4",
      "record-16",
      "record-15",
      "record-10",
      "record-9",
      "record-0",
    ]);
  });

  it("rejects cyclic record identifiers before provider activity", async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const client = new FlatDatastore();
    const records = canonicalIdStorage(client, [cyclic]);

    await expect(records.write(message("record-0"))).rejects.toThrow();
    expect(client.batches).toEqual([]);
  });

  it("keeps undefined columns out of the physical entity", async () => {
    const client = new FlatDatastore();
    const records = valueStorage(client, new Map([["missing", undefined]]));

    await records.write(message("missing"));
    expect(client.lastData?.value).toBeUndefined();
    await expect(records.read("missing")).resolves.toMatchObject({ value: "missing" });
  });

  it("rejects non-finite and cyclic indexed values", async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const unsupported = [Number.NaN, Number.POSITIVE_INFINITY, cyclic] as const;

    for (const value of unsupported) {
      const records = valueStorage(new FlatDatastore(), new Map([["bad", value]]));
      await expect(records.write(message("bad"))).rejects.toThrow();
    }
  });

  it("rejects malformed tagged storage identifiers returned by Datastore", async () => {
    const client = new FlatDatastore();
    const records = storage(client);
    client.insertMalformedIdentifier(records, "bad");

    await expect(records.queryEntries()).rejects.toThrow("no valid Spine record identifier");
  });

  it("rejects malformed canonical identifier payloads returned by Datastore", async () => {
    const malformed = [
      "not-json",
      "[]",
      '["undefined",0]',
      '["null",0]',
      '["boolean",0]',
      '["number",0]',
      '["number","01"]',
      '["string",0]',
      '["bigint",0]',
      '["bytes",[256]]',
      '["bytes",[0,-1]]',
      '["bytes",[0,1.5]]',
      '["bigint","01"]',
      '["object",["a"]]',
      '["object",["a",["string","a"]],["a",["string","a"]]]',
      '["object",["z",["string","z"]],["a",["string","a"]]]',
      '["object",["a",["unknown"]]]',
      '["unknown"]',
    ];

    for (const encoded of malformed) {
      const client = new FlatDatastore();
      const records = storage(client);
      client.insertTaggedIdentifier(records, "bad", encoded);
      await expect(records.queryEntries()).rejects.toThrow("no valid Spine record identifier");
    }
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
        new RecordColumn("value", (record) => record.value, "string"),
        new RecordColumn("initial", (record) => record.value.slice(0, 1), "string"),
      ],
    }),
    client as never,
    1_000,
  );
}

function valueStorage(
  client: FlatDatastore,
  values: ReadonlyMap<string, unknown>,
): DatastoreRecordStorage<string, StringValue> {
  return new DatastoreRecordStorage(
    { name: "values", multitenant: false },
    new RecordSpec<string, StringValue>({
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [new RecordColumn("value", (record) => values.get(record.value), "canonical-value")],
    }),
    client as never,
    1_000,
  );
}

function canonicalIdStorage(
  client: FlatDatastore,
  ids: readonly unknown[],
): DatastoreRecordStorage<unknown, StringValue> {
  return new DatastoreRecordStorage(
    { name: "identifiers", multitenant: false },
    new RecordSpec<unknown, StringValue>({
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idKind: "canonical",
      extractId: (record) => ids[Number(record.value.slice("record-".length))],
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

  insertMalformedIdentifier(
    records: DatastoreRecordStorage<string, StringValue>,
    id: string,
  ): void {
    const prepared = records.transactionEntity(message(id));
    const key = { path: [prepared.key.path[0], "not-canonical"] as const };
    this.#rows.set(this.#name(key), {
      [this.KEY]: key,
      bytes: prepared.data.bytes,
      _scope: prepared.data._scope,
    });
  }

  insertTaggedIdentifier(
    records: DatastoreRecordStorage<string, StringValue>,
    id: string,
    encoded: string,
  ): void {
    const prepared = records.transactionEntity(message(id));
    const original = String(prepared.key.path[1]);
    const scope = original.slice(0, original.lastIndexOf("\u0000") + 1);
    const key = { path: [String(prepared.key.path[0]), `${scope}${encoded}`] as const };
    this.#rows.set(this.#name(key), {
      [this.KEY]: key,
      bytes: prepared.data.bytes,
      _scope: prepared.data._scope,
    });
  }

  #save(row: SaveRow): void {
    this.lastData = row.data;
    this.#rows.set(this.#name(row.key), { ...row.data, [this.KEY]: row.key });
  }

  #row(key: Key): Entity | undefined {
    const entity = this.#rows.get(this.#name(key));
    return entity === undefined ? undefined : { ...entity };
  }

  #name(key: Key): string {
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
