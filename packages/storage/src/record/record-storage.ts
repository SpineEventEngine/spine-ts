import type { Message } from "@bufbuild/protobuf";

import { RecordMask } from "./record-mask.js";
import { RecordQuery } from "./record-query.js";
import type { RecordReadOptions } from "./record-query.js";
import type { RecordSpec } from "./record-spec.js";
import type { Storage, StorageContext } from "../storage/storage.js";

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

  /** Delete one stored record by actual storage slot ID. */
  async delete(id: I): Promise<boolean> {
    this.requireOpen();
    return this.deleteRecord(this.#recordSpec.cloneId(id));
  }

  /** Read one record by actual storage slot ID, optionally applying a simple field mask. */
  async read(id: I, options: RecordReadOptions = {}): Promise<R | undefined> {
    this.requireOpen();
    const record = await this.readRecord(this.#recordSpec.cloneId(id));

    return record === undefined
      ? undefined
      : RecordMask.apply(this.#recordSpec.cloneRecord(record), options.mask);
  }

  /**
   * Read matching logical record identifiers derived from stored record bodies
   * in deterministic query order.
   */
  async index(query: RecordQuery<I> = {}): Promise<readonly I[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      this.#recordSpec.cloneId(this.#recordSpec.idValueIn(entry.record)),
    );
  }

  /**
   * Query records by actual storage slot IDs, columns, sorting, limits, and
   * optional masks.
   *
   * `RecordQuery.ids`, when present, filters storage slot IDs rather than
   * logical IDs derived from record bodies.
   */
  async query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      RecordMask.apply(this.#recordSpec.cloneRecord(entry.record), query.mask),
    );
  }

  /**
   * Query stored records together with the actual storage slot IDs they
   * currently occupy.
   *
   * `RecordQuery.ids`, when present, filters those storage slot IDs rather
   * than logical IDs derived from record bodies.
   */
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
   * applied. The `id` argument names an actual storage slot, not a logical ID
   * derived from a record body. Adapters that cannot guarantee this behavior
   * are not valid for delivery leasing or deduplication.
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
  /**
   * Query stored records together with their actual storage slot IDs.
   *
   * Implementations must return `RecordEntry.id` as the concrete storage slot
   * identifier for the row or document that currently stores the record.
   * `RecordStorage.index()` derives logical record identifiers from
   * `RecordEntry.record`, so adapters must not substitute logical IDs into
   * `RecordEntry.id` here.
   */
  protected abstract queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]>;
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

/**
 * One queried storage row or document.
 *
 * `id` is the actual storage slot identifier. `record` is the stored record
 * value whose logical identifier may differ and is derived through
 * `RecordSpec.idValueIn(...)`.
 */
export interface RecordEntry<I, R extends Message> {
  readonly id: I;
  readonly record: R;
}
