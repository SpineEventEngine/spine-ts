import type { Message } from "@bufbuild/protobuf";

import { RecordMask } from "./record-mask.js";
import { RecordQuery } from "./record-query.js";
import type { RecordReadOptions } from "./record-query.js";
import type { RecordSpec } from "./record-spec.js";
import type { Storage, StorageContext } from "../storage/storage.js";

/** One queried record together with the storage slot ID it came from. */
export interface RecordEntry<I, R extends Message> {
  readonly id: I;
  readonly record: R;
}

/** Common record-oriented storage contract for identified Protobuf messages. */
export abstract class RecordStorage<I, R extends Message> implements Storage {
  readonly #context: StorageContext;
  #open = true;
  readonly #recordSpec: RecordSpec<I, R>;

  constructor(context: StorageContext, recordSpec: RecordSpec<I, R>) {
    this.#context = context;
    this.#recordSpec = recordSpec;
  }

  /** Context that scopes this storage and its tenant slices. */
  protected get context(): StorageContext {
    return this.#context;
  }

  /** Declarative record specification for this storage. */
  get recordSpec(): RecordSpec<I, R> {
    return this.#recordSpec;
  }

  /** Close this record storage. Future operations fail. */
  close(): void {
    this.#open = false;
  }

  /** Whether this record storage still accepts operations. */
  isOpen(): boolean {
    return this.#open;
  }

  /** Delete one stored record by ID. */
  async delete(id: I): Promise<boolean> {
    this.requireOpen();
    return this.deleteRecord(this.#recordSpec.cloneId(id));
  }

  /** Read one record by ID, optionally applying a simple field mask. */
  async read(id: I, options: RecordReadOptions = {}): Promise<R | undefined> {
    this.requireOpen();
    const record = await this.readRecord(this.#recordSpec.cloneId(id));

    return record === undefined
      ? undefined
      : RecordMask.apply(this.#recordSpec.cloneRecord(record), options.mask);
  }

  /** Read matching record identifiers in deterministic query order. */
  async index(query: RecordQuery<I> = {}): Promise<readonly I[]> {
    const entries = await this.queryEntries(query);
    return entries.map((entry) => entry.id);
  }

  /** Query records by IDs, columns, sorting, limits, and optional masks. */
  async query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    const entries = await this.queryEntries(query);
    return entries.map((entry) => entry.record);
  }

  /** Query records together with the storage slot IDs they currently occupy. */
  async queryEntries(query: RecordQuery<I> = {}): Promise<readonly RecordEntry<I, R>[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      Object.freeze({
        id: this.#recordSpec.cloneId(entry.id),
        record: RecordMask.apply(this.#recordSpec.cloneRecord(entry.record), query.mask),
      }),
    );
  }

  /** Write one record, replacing any previous value with the same ID. */
  async write(record: R): Promise<void> {
    this.requireOpen();
    await this.writeRecord(this.#recordSpec.materialize(record));
  }

  /**
   * Compare the current stored record for one ID with an expected value and
   * write or delete only when they still match.
   *
   * Implementations must apply this atomically across independently opened
   * storage handles that share the same logical backing store. Passing
   * `undefined` as `next` performs a conditional delete. A `false` result means
   * the current stored value did not match `expected`, so no mutation was
   * applied. Adapters that cannot guarantee this behavior are not valid for
   * delivery leasing or deduplication.
   */
  async compareAndSet(id: I, expected: R | undefined, next: R | undefined): Promise<boolean> {
    this.requireOpen();
    return this.compareAndSetRecord(
      this.#recordSpec.cloneId(id),
      expected === undefined ? undefined : this.#recordSpec.materialize(expected),
      next === undefined ? undefined : this.#recordSpec.materialize(next),
    );
  }

  /** Write records in order, failing before persistence if any materialization step fails. */
  async writeAll(records: Iterable<R>): Promise<void> {
    this.requireOpen();
    const materializedRecords = [...records].map((record) => this.#recordSpec.materialize(record));
    await this.writeAllRecords(materializedRecords);
  }

  protected abstract deleteRecord(id: I): Promise<boolean>;
  protected async queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    const records = await this.queryRecords(query);

    return records.map((record) => ({
      id: this.#recordSpec.cloneId(this.#recordSpec.idValueIn(record)),
      record,
    }));
  }
  protected abstract queryRecords(query: RecordQuery<I>): Promise<readonly R[]>;
  protected abstract readRecord(id: I): Promise<R | undefined>;
  protected abstract compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean>;
  protected abstract writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void>;
  protected abstract writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void>;

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("RecordStorage is closed.");
    }
  }
}
