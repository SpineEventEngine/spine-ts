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
    const records = await this.query(query);
    return records.map((record) => this.#recordSpec.cloneId(this.#recordSpec.idValueIn(record)));
  }

  /** Query records by IDs, columns, sorting, limits, and optional masks. */
  async query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const records = await this.queryRecords(query);

    return records.map((record) =>
      RecordMask.apply(this.#recordSpec.cloneRecord(record), query.mask),
    );
  }

  /** Write one record, replacing any previous value with the same ID. */
  async write(record: R): Promise<void> {
    this.requireOpen();
    await this.writeRecord(this.#recordSpec.materialize(record));
  }

  /** Write records in order, failing before persistence if any materialization step fails. */
  async writeAll(records: Iterable<R>): Promise<void> {
    this.requireOpen();
    const materializedRecords = [...records].map((record) => this.#recordSpec.materialize(record));
    await this.writeAllRecords(materializedRecords);
  }

  protected abstract deleteRecord(id: I): Promise<boolean>;
  protected abstract queryRecords(query: RecordQuery<I>): Promise<readonly R[]>;
  protected abstract readRecord(id: I): Promise<R | undefined>;
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
