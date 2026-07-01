import type { Message } from "@bufbuild/protobuf";

import { applyMask } from "./record-mask.js";
import type { RecordQuery, RecordReadOptions } from "./record-query.js";
import { validateQuery } from "./record-query.js";
import type { RecordSpec } from "./record-spec.js";
import type { Storage, StorageContext } from "../storage/storage.js";
import { StorageObject } from "../storage/storage-object.js";

/** Common record-oriented storage contract for identified Protobuf messages. */
export abstract class RecordStorage<I, R extends Message> extends StorageObject implements Storage {
  readonly #context: StorageContext;
  readonly #recordSpec: RecordSpec<I, R>;

  constructor(context: StorageContext, recordSpec: RecordSpec<I, R>) {
    super();
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

  /** Delete one stored record by ID. */
  async delete(id: I): Promise<boolean> {
    this.requireOpen("RecordStorage");
    return this.deleteRecord(this.#recordSpec.cloneId(id));
  }

  /** Read one record by ID, optionally applying a simple field mask. */
  async read(id: I, options: RecordReadOptions = {}): Promise<R | undefined> {
    this.requireOpen("RecordStorage");
    const record = await this.readRecord(this.#recordSpec.cloneId(id));

    return record === undefined
      ? undefined
      : applyMask(this.#recordSpec.cloneRecord(record), options.mask);
  }

  /** Read matching record identifiers in deterministic query order. */
  async index(query: RecordQuery<I> = {}): Promise<readonly I[]> {
    const records = await this.query(query);
    return records.map((record) => this.#recordSpec.cloneId(this.#recordSpec.idValueIn(record)));
  }

  /** Query records by IDs, columns, sorting, limits, and optional masks. */
  async query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    this.requireOpen("RecordStorage");
    validateQuery(query);
    const records = await this.queryRecords(query);

    return records.map((record) => applyMask(this.#recordSpec.cloneRecord(record), query.mask));
  }

  /** Write one record, replacing any previous value with the same ID. */
  async write(record: R): Promise<void> {
    this.requireOpen("RecordStorage");
    await this.writeRecord(this.#recordSpec.cloneRecord(record));
  }

  /** Write records in order, failing before persistence if any clone step fails. */
  async writeAll(records: Iterable<R>): Promise<void> {
    this.requireOpen("RecordStorage");
    const clonedRecords = [...records].map((record) => this.#recordSpec.cloneRecord(record));
    await this.writeAllRecords(clonedRecords);
  }

  protected abstract deleteRecord(id: I): Promise<boolean>;
  protected abstract queryRecords(query: RecordQuery<I>): Promise<readonly R[]>;
  protected abstract readRecord(id: I): Promise<R | undefined>;
  protected abstract writeAllRecords(records: readonly R[]): Promise<void>;
  protected abstract writeRecord(record: R): Promise<void>;
}
