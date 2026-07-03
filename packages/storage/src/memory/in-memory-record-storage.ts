import type { Message } from "@bufbuild/protobuf";

import type { RecordEntry } from "../record/record-storage.js";
import type { RecordQuery } from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import { TenantRecords } from "./tenant-records.js";

/** In-memory record storage with per-tenant slices when the context is multitenant. */
export class InMemoryRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #tenantRecords: Map<string, TenantRecords<I, R>>;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    tenantRecords: Map<string, TenantRecords<I, R>> = new Map<string, TenantRecords<I, R>>(),
  ) {
    super(context, recordSpec);
    this.#tenantRecords = tenantRecords;
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return Promise.resolve(this.records().delete(id));
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return Promise.resolve(this.records().compareAndSet(id, expected, next));
  }

  protected queryRecords(query: RecordQuery<I>): Promise<readonly R[]> {
    return Promise.resolve(this.records().query(this.recordSpec, query));
  }

  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    return Promise.resolve(this.records().queryEntries(this.recordSpec, query));
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return Promise.resolve(this.records().read(id));
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    this.records().writeAll(records);
    return Promise.resolve();
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    this.records().write(record);
    return Promise.resolve();
  }

  private records(): TenantRecords<I, R> {
    const tenantKey = this.tenantKey();
    let records = this.#tenantRecords.get(tenantKey);

    if (records === undefined) {
      records = new TenantRecords<I, R>();
      this.#tenantRecords.set(tenantKey, records);
    }

    return records;
  }

  private tenantKey(): string {
    if (!this.context.multitenant) {
      return JSON.stringify({
        name: this.context.name,
        multitenant: false,
      });
    }

    const { tenantId } = this.context;

    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new Error(`Multitenant storage "${this.context.name}" requires context.tenantId.`);
    }

    return JSON.stringify({
      name: this.context.name,
      multitenant: true,
      tenantId,
    });
  }
}
