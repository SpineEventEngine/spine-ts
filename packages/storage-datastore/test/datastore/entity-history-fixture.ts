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
import { Datastore } from "@google-cloud/datastore";

export interface HistoryKey {
  readonly namespace?: string;
  readonly path: readonly string[];
}

interface StoredEntity {
  readonly data: Record<string, unknown>;
  revision: number;
}

/**
 * One shared in-memory Datastore backend; clients deliberately do not share locks.
 */
export class HistoryDatastoreBackend {
  readonly entities = new Map<string, StoredEntity>();
  readonly revisions = new Map<string, number>();
  failCommitAppliedOnce = false;
  failTransactionRead: Error | undefined;
  failTransactionCommit: Error | undefined;
  failRollback: Error | undefined;
  abortedTransactions = 0;
  rollbacks = 0;
  deleteCalls = 0;
  failDeleteAt: number | undefined;
  heldDelete: Deferred<void> | undefined;
  malformedQueryAt: number | undefined;
  maxTransactionGroups = 0;

  client(): HistoryDatastoreClient {
    return new HistoryDatastoreClient(this);
  }
}

/**
 * Focused fake for entity-history tests, including optimistic entity-group transactions.
 */
export class HistoryDatastoreClient {
  readonly KEY = Symbol("key");
  getCalls = 0;
  saveCalls = 0;
  deleteCalls = 0;
  queryCalls = 0;
  readonly queryLimits: number[] = [];
  readonly queries: HistoryQuery[] = [];
  transactionCalls = 0;

  constructor(readonly backend: HistoryDatastoreBackend) {}

  key(input: { readonly namespace?: string; readonly path: readonly string[] }): HistoryKey {
    return input.namespace === undefined
      ? { path: [...input.path] }
      : { namespace: input.namespace, path: [...input.path] };
  }

  get(key: HistoryKey): Promise<[Record<string | symbol, unknown> | undefined]> {
    this.getCalls += 1;
    return Promise.resolve([this.entity(key)]);
  }

  save(input: { readonly key: HistoryKey; readonly data: Record<string, unknown> }): Promise<[]> {
    this.saveCalls += 1;
    this.put(input.key, input.data);
    return Promise.resolve([]);
  }

  delete(key: HistoryKey | readonly HistoryKey[]): Promise<[]> {
    this.deleteCalls += 1;
    this.backend.deleteCalls += 1;
    if (this.backend.deleteCalls === this.backend.failDeleteAt)
      return Promise.reject(new Error("delete group failed"));
    const keys: readonly HistoryKey[] = Array.isArray(key) ? key : [key];
    const complete = (): [] => {
      for (const value of keys) this.remove(value);
      return [];
    };
    const held = this.backend.heldDelete;
    this.backend.heldDelete = undefined;
    return held === undefined ? Promise.resolve(complete()) : held.promise.then(complete);
  }

  createQuery(_namespaceOrKind?: string, kind?: string): HistoryQuery {
    return new HistoryQuery(kind ?? _namespaceOrKind);
  }

  runQuery(query: HistoryQuery): Promise<[Record<string | symbol, unknown>[], QueryInfo]> {
    this.queryCalls += 1;
    this.queries.push(query);
    if (query.limitValue !== undefined) this.queryLimits.push(query.limitValue);
    if (this.queryCalls === this.backend.malformedQueryAt)
      return Promise.resolve([
        [],
        { endCursor: Buffer.alloc(0), moreResults: "MORE_RESULTS_AFTER_LIMIT" },
      ]);
    const all = [...this.backend.entities.entries()]
      .map(([serialized, stored]) => {
        const key = parseKey(serialized);
        return { key, [this.KEY]: key, ...stored.data };
      })
      .filter((row) => query.kind === undefined || row.key.path.includes(query.kind))
      .filter((row) => query.matches(row, this.KEY))
      .sort((left, right) => query.compare(left, right, this.KEY));
    let offset = query.offsetValue ?? 0;
    if (query.cursor !== undefined) {
      const cursor: Buffer | string = query.cursor;
      offset = all.findIndex((row) => query.after(row, cursor, this.KEY));
    }
    const page = all.slice(
      offset,
      query.limitValue === undefined ? undefined : offset + query.limitValue,
    );
    const next = offset + page.length;
    const last = page.at(-1);
    return Promise.resolve([
      page.map((row) => ({ ...row, [this.KEY]: row.key })),
      {
        endCursor: last === undefined ? Buffer.alloc(0) : query.cursorFor(last, this.KEY),
        moreResults: next < all.length ? "MORE_RESULTS_AFTER_LIMIT" : "NO_MORE_RESULTS",
      },
    ]);
  }

  transaction(): HistoryTransaction {
    this.transactionCalls += 1;
    return new HistoryTransaction(this);
  }

  entity(key: HistoryKey): Record<string | symbol, unknown> | undefined {
    const row = this.backend.entities.get(keyString(key));
    return row === undefined ? undefined : { ...row.data, [this.KEY]: key };
  }

  put(key: HistoryKey, data: Record<string, unknown>): void {
    const serialized = keyString(key);
    const revision = (this.backend.revisions.get(groupKey(key)) ?? 0) + 1;
    this.backend.revisions.set(groupKey(key), revision);
    this.backend.entities.set(serialized, { data: { ...data }, revision });
  }

  remove(key: HistoryKey): void {
    this.backend.entities.delete(keyString(key));
    this.backend.revisions.set(groupKey(key), (this.backend.revisions.get(groupKey(key)) ?? 0) + 1);
  }
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export class HistoryTransaction {
  readonly #observed = new Map<string, number>();
  readonly #writes: { key: HistoryKey; data: Record<string, unknown>; insert: boolean }[] = [];
  readonly #deletes: HistoryKey[] = [];
  #running = false;

  constructor(private readonly client: HistoryDatastoreClient) {}

  run(): Promise<[]> {
    this.#running = true;
    return Promise.resolve([]);
  }

  get(key: HistoryKey): Promise<[Record<string | symbol, unknown> | undefined]> {
    if (this.client.backend.failTransactionRead !== undefined)
      return Promise.reject(this.client.backend.failTransactionRead);
    this.observe(key);
    return Promise.resolve([this.client.entity(key)]);
  }

  async runQuery(query: HistoryQuery): Promise<[Record<string | symbol, unknown>[], QueryInfo]> {
    const result = await this.client.runQuery(query);
    for (const entity of result[0]) this.observe(entity[this.client.KEY] as HistoryKey);
    return result;
  }

  save(input: { readonly key: HistoryKey; readonly data: Record<string, unknown> }): void {
    this.#writes.push({ ...input, insert: false });
  }

  insert(input: { readonly key: HistoryKey; readonly data: Record<string, unknown> }): void {
    this.#writes.push({ ...input, insert: true });
  }

  delete(key: HistoryKey | readonly HistoryKey[]): void {
    const keys: readonly HistoryKey[] = Array.isArray(key) ? key : [key];
    this.#deletes.push(...keys);
  }

  async commit(): Promise<[]> {
    if (!this.#running) throw new Error("Transaction was not started.");
    if (this.client.backend.abortedTransactions > 0) {
      this.client.backend.abortedTransactions -= 1;
      throw Object.assign(new Error("transaction aborted"), { code: 10 });
    }
    if (this.client.backend.failTransactionCommit !== undefined)
      throw this.client.backend.failTransactionCommit;
    for (const [group, version] of this.#observed)
      if ((this.client.backend.revisions.get(group) ?? 0) !== version) {
        const error = Object.assign(new Error("transaction aborted"), { code: 10 });
        throw error;
      }
    this.client.backend.maxTransactionGroups = Math.max(
      this.client.backend.maxTransactionGroups,
      new Set([...this.#writes.map((write) => groupKey(write.key)), ...this.#deletes.map(groupKey)])
        .size,
    );
    if (this.#deletes.length > 0) {
      this.client.backend.deleteCalls += 1;
      if (this.client.backend.deleteCalls === this.client.backend.failDeleteAt)
        throw new Error("delete group failed");
      const held = this.client.backend.heldDelete;
      this.client.backend.heldDelete = undefined;
      if (held !== undefined) await held.promise;
    }
    for (const write of this.#writes) {
      if (write.insert && this.client.entity(write.key) !== undefined)
        throw Object.assign(new Error("already exists"), { code: 6 });
      this.client.put(write.key, write.data);
    }
    for (const key of this.#deletes) this.client.remove(key);
    if (this.client.backend.failCommitAppliedOnce) {
      this.client.backend.failCommitAppliedOnce = false;
      throw new Error("commit applied before connection closed");
    }
    return [];
  }

  rollback(): Promise<[]> {
    this.client.backend.rollbacks += 1;
    if (this.client.backend.failRollback !== undefined)
      return Promise.reject(this.client.backend.failRollback);
    return Promise.resolve([]);
  }

  private observe(key: HistoryKey): void {
    const group = groupKey(key);
    this.#observed.set(group, this.client.backend.revisions.get(group) ?? 0);
  }
}

export class HistoryQuery {
  readonly filters: unknown[] = [];
  readonly orders: unknown[][] = [];
  limitValue: number | undefined;
  cursor: Buffer | string | undefined;
  offsetValue: number | undefined;
  projection: readonly string[] | undefined;
  ancestor: HistoryKey | undefined;

  constructor(readonly kind: string | undefined) {}
  filter(...input: unknown[]): this {
    this.filters.push(propertyFilter(input));
    return this;
  }
  order(...input: unknown[]): this {
    this.orders.push(input);
    return this;
  }
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }
  start(value: Buffer | string): this {
    this.cursor = value;
    return this;
  }
  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }
  select(...properties: string[]): this {
    this.projection = properties;
    return this;
  }
  hasAncestor(key: HistoryKey): this {
    this.ancestor = key;
    return this;
  }
  matches(row: Record<string | symbol, unknown>, keySymbol: symbol): boolean {
    const key = row[keySymbol] as HistoryKey;
    if (
      this.ancestor !== undefined &&
      !this.ancestor.path.every((part, index) => key.path[index] === part)
    )
      return false;
    return this.filters.every((filter) => matchesFilter(filter, row, keySymbol));
  }
  compare(
    left: Record<string | symbol, unknown>,
    right: Record<string | symbol, unknown>,
    keySymbol: symbol,
  ): number {
    for (const [column, options] of this.orders) {
      const value = compare(
        column === "__key__" ? left[keySymbol] : left[String(column)],
        column === "__key__" ? right[keySymbol] : right[String(column)],
      );
      if (value !== 0)
        return (options as { descending?: boolean } | undefined)?.descending ? -value : value;
    }
    return compare(left.key, right.key);
  }

  cursorFor(row: Record<string | symbol, unknown>, keySymbol: symbol): Buffer {
    return Buffer.from(
      JSON.stringify(
        this.orders.map(([column]) =>
          column === "__key__"
            ? { key: keyString(row[keySymbol] as HistoryKey) }
            : row[String(column)],
        ),
      ),
    );
  }

  after(
    row: Record<string | symbol, unknown>,
    cursor: Buffer | string,
    keySymbol: symbol,
  ): boolean {
    const values = JSON.parse(cursor.toString()) as unknown[];
    for (let index = 0; index < this.orders.length; index += 1) {
      const [column, options] = this.orders[index] ?? [];
      const encoded = values[index];
      const expected =
        typeof encoded === "object" && encoded !== null && "key" in encoded
          ? parseKey(String(Reflect.get(encoded, "key")))
          : encoded;
      const actual = column === "__key__" ? row[keySymbol] : row[String(column)];
      const comparison = compare(actual, expected);
      if (comparison !== 0)
        return (options as { descending?: boolean } | undefined)?.descending
          ? comparison < 0
          : comparison > 0;
    }
    return false;
  }
}
function propertyFilter(input: readonly unknown[]): unknown {
  const [first] = input;
  if (typeof first !== "object" || first === null) return [...input];
  const value = first as Record<string, unknown>;
  return typeof value.name === "string" && typeof value.op === "string"
    ? [value.name, value.op, value.val]
    : value;
}
function matchesFilter(
  filter: unknown,
  row: Record<string | symbol, unknown>,
  keySymbol: symbol,
): boolean {
  if (Array.isArray(filter)) {
    const [column, operator, expected] = filter as unknown[];
    const actual = column === "__key__" ? row[keySymbol] : row[String(column)];
    const comparison = compare(actual, expected);
    return operator === "="
      ? comparison === 0
      : operator === "<"
        ? comparison < 0
        : operator === "<="
          ? comparison <= 0
          : operator === ">"
            ? comparison > 0
            : operator === ">="
              ? comparison >= 0
              : false;
  }
  if (typeof filter !== "object" || filter === null) return false;
  const value = filter as { name?: unknown; op?: unknown; val?: unknown; filters?: unknown[] };
  if (typeof value.name === "string" && typeof value.op === "string")
    return matchesFilter([value.name, value.op, value.val], row, keySymbol);
  if (!Array.isArray(value.filters) || typeof value.op !== "string") return false;
  const results = value.filters.map((nested) => matchesFilter(nested, row, keySymbol));
  return value.op === "AND" ? results.every(Boolean) : value.op === "OR" && results.some(Boolean);
}

export interface QueryInfo {
  readonly endCursor: Buffer;
  readonly moreResults: string;
}
function groupKey(key: HistoryKey): string {
  return JSON.stringify([key.namespace, key.path.slice(0, 2)]);
}
function keyString(key: HistoryKey): string {
  return JSON.stringify([key.namespace, key.path]);
}
function parseKey(serialized: string): HistoryKey {
  const [namespace, path] = JSON.parse(serialized) as [string | undefined, string[]];
  return namespace === undefined ? { path } : { namespace, path };
}
function compare(left: unknown, right: unknown): number {
  if (typeof left === "object" && left !== null && Datastore.isInt(left)) left = BigInt(left.value);
  if (typeof right === "object" && right !== null && Datastore.isInt(right))
    right = BigInt(right.value);
  if (left instanceof Date && right instanceof Date) {
    const milliseconds = left.getTime() - right.getTime();
    if (milliseconds !== 0) return milliseconds < 0 ? -1 : 1;
    const nanos = left.getMilliseconds() - right.getMilliseconds();
    return nanos < 0 ? -1 : nanos > 0 ? 1 : 0;
  }
  if (
    typeof left === "object" &&
    left !== null &&
    "path" in left &&
    typeof right === "object" &&
    right !== null &&
    "path" in right
  )
    return compareKey(left as HistoryKey, right as HistoryKey);
  if (typeof left === "bigint" && typeof right === "bigint")
    return left === right ? 0 : left < right ? -1 : 1;
  if (typeof left === "string" && typeof right === "string")
    return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
  return String(left).localeCompare(String(right));
}
function compareKey(left: HistoryKey, right: HistoryKey): number {
  const namespace = Buffer.from(left.namespace ?? "", "utf8").compare(
    Buffer.from(right.namespace ?? "", "utf8"),
  );
  if (namespace !== 0) return namespace;
  for (let index = 0; index < Math.min(left.path.length, right.path.length); index += 1) {
    const value = Buffer.from(left.path[index] ?? "", "utf8").compare(
      Buffer.from(right.path[index] ?? "", "utf8"),
    );
    if (value !== 0) return value;
  }
  return left.path.length - right.path.length;
}
