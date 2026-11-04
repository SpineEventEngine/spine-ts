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

import { clone, create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import {
  TenantIdSchema,
  TenantSchema,
  type Tenant,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  defaultQueryCandidateLimit,
  RecordSpec,
  type RecordContinuation,
  type RecordEntry,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
  type StorageGroup,
} from "@spine-event-engine/storage";
import {
  StoragePreparations,
  TenantBoundary,
  TenantCatalogReads,
} from "@spine-event-engine/storage/provider";

import type {
  TenantIndex,
  TenantIndexCursor,
  TenantIndexPage,
  TenantIndexRead,
} from "./tenant-index.js";

/**
 * Storage-backed tenant registration directory independent of application storage routing.
 */
export class PersistentTenantIndex implements TenantIndex {
  readonly #storage: RecordStorage<TenantId, Tenant>;

  readonly #clock: () => Timestamp;

  readonly #identity = {};

  #active = 0;

  #closed = false;

  #drained: (() => void) | undefined;

  #closeAttempt: Promise<void> | undefined;

  /**
   * Binds an independently closeable record handle and a trusted clock.
   *
   * @param storage Independently closeable registration handle.
   * @param clock Supplies trusted registration time.
   */
  private constructor(storage: RecordStorage<TenantId, Tenant>, clock: () => Timestamp) {
    this.#storage = storage;
    this.#clock = clock;
  }

  /**
   * Opens an independent record handle and prepares the selected family by default.
   *
   * @param options Supplies the factory, group, preparation policy and clock.
   * @returns A directory after default preparation, or an unprepared directory when skipped.
   */
  static async create(options: PersistentTenantIndexOptions): Promise<PersistentTenantIndex> {
    const storage = options.storageFactory.createRecordStorage(context, spec, options.group, {
      prepareOnAccess: false,
    });
    try {
      if (!storage.atomicCompareAndSet)
        throw new Error("PersistentTenantIndex requires atomic compare-and-set storage.");
      if (options.createMissingStructures !== false)
        await StoragePreparations.for(options.storageFactory).prepareRecord(
          context,
          spec,
          options.group,
          "create",
        );
      return new PersistentTenantIndex(storage, options.clock ?? Time.currentTime);
    } catch (error) {
      storage.close();
      throw error;
    }
  }

  /**
   * Checks current registration by its complete primary key.
   *
   * @param tenantId Complete tenant identity.
   * @returns Whether the registration exists.
   */
  contains(tenantId: TenantId): Promise<boolean> {
    return this.#run(
      async () => (await this.#storage.read(TenantIds.copy(tenantId))) !== undefined,
    );
  }

  /**
   * Registers a complete tenant identity once across compatible handles.
   *
   * @param tenantId Complete tenant identity.
   * @returns Completion when the registration is durable.
   */
  keep(tenantId: TenantId): Promise<void> {
    return this.#run(async () => {
      const id = TenantIds.copy(tenantId);
      await this.#storage.compareAndSet(
        id,
        undefined,
        create(TenantSchema, {
          id,
          whenCreated: clone(TimestampSchema, this.#clock()),
        }),
      );
    });
  }

  /**
   * Reads a finite page by provider keyset continuation.
   *
   * @param request Finite count, cancellation and optional continuation.
   * @returns Detached identities and a continuation when more rows exist.
   */
  page(request: TenantIndexRead): Promise<TenantIndexPage> {
    return this.#run(() => this.#page(request));
  }

  /**
   * Returns every currently registered tenant in provider-sized batches.
   *
   * @returns Detached complete tenant identities.
   */
  all(): Promise<readonly TenantId[]> {
    return this.#run(async () => {
      const ids: TenantId[] = [];
      const signal = new AbortController().signal;
      let after: TenantIndexCursor | undefined;
      do {
        const page = await this.#page({
          count: defaultQueryCandidateLimit,
          signal,
          ...(after === undefined ? {} : { after }),
        });
        ids.push(...page.ids);
        after = page.after;
      } while (after !== undefined);
      return ids;
    });
  }

  /**
   * Closes this handle after fencing new calls and draining admitted operations.
   *
   * @returns The repeatable close result.
   */
  close(): Promise<void> {
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    this.#closed = true;
    this.#closeAttempt = (async () => {
      if (this.#active > 0)
        await new Promise<void>((resolve) => {
          this.#drained = resolve;
        });
      this.#storage.close();
    })();
    return this.#closeAttempt;
  }

  /**
   * Reads one page and probes for a following row without materializing the directory.
   *
   * @param request Finite count and optional continuation.
   * @returns Detached IDs and a continuation when another row exists.
   */
  async #page(request: TenantIndexRead): Promise<TenantIndexPage> {
    TenantCatalogReads.require(request);
    const after = this.#continuation(request.after);
    const rows = await this.#storage.queryEntries({
      sort,
      limit: request.count,
      ...(after && { after }),
    });
    request.signal.throwIfAborted();
    const last = rows.at(-1);
    if (last === undefined) return { ids: [], hasMore: false };
    const next = this.#after(last);
    const more =
      rows.length === request.count &&
      (await this.#storage.queryEntries({ sort, limit: 1, after: next })).length > 0;
    request.signal.throwIfAborted();
    return {
      ids: rows.map((row) => TenantIds.copy(TenantIds.required(row.record.id))),
      ...(more ? { after: new TenantCursor(this.#identity, next) } : {}),
      hasMore: more,
    };
  }

  /**
   * Accepts only a continuation issued by this index instance.
   *
   * @param cursor Opaque continuation to validate.
   * @returns Its detached provider key, if present.
   */
  #continuation(cursor: TenantIndexCursor | undefined): RecordContinuation<TenantId> | undefined {
    if (cursor === undefined) return undefined;
    if (!(cursor instanceof TenantCursor))
      throw new TypeError("TenantIndex continuation is invalid.");
    return cursor.read(this.#identity);
  }

  /**
   * Captures a complete primary-key continuation.
   *
   * @param row Last row delivered to the caller.
   * @returns Complete provider key for the following page.
   */
  #after(row: RecordEntry<TenantId, Tenant>): RecordContinuation<TenantId> {
    const id = TenantIds.copy(row.id);
    return { values: [{ field: "id", value: id }], id };
  }

  /**
   * Admits a call synchronously and releases it after completion.
   *
   * @param work Operation on the record handle.
   * @returns Its result after the call leaves the active set.
   * @typeParam T Result of the admitted operation.
   */
  #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("PersistentTenantIndex is closed."));
    this.#active += 1;
    return Promise.resolve()
      .then(work)
      .finally(() => {
        this.#active -= 1;
        if (this.#active === 0) this.#drained?.();
      });
  }
}

/**
 * Settings for a storage-backed application tenant directory.
 */
export interface PersistentTenantIndexOptions {
  /**
   * Factory supplying one durable record family.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Physical group separating tenant registrations from other records.
   */
  readonly group: StorageGroup;

  /**
   * Creates and checks supported structures before return; defaults to true.
   */
  readonly createMissingStructures?: boolean;

  /**
   * Returns trusted registration time; defaults to the framework UTC clock.
   *
   * @returns UTC time of a new registration.
   */
  readonly clock?: () => Timestamp;
}

/**
 * Opaque keyset continuation accepted only by the issuing index instance.
 */
class TenantCursor implements TenantIndexCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #after: RecordContinuation<TenantId>;

  /**
   * Captures the issuing instance and provider key.
   *
   * @param identity Index identity for cursor admission.
   * @param after Last delivered provider key.
   */
  constructor(identity: object, after: RecordContinuation<TenantId>) {
    this.#identity = identity;
    this.#after = after;
    Object.freeze(this);
  }

  /**
   * Returns the detached key after validating the issuing instance.
   *
   * @param identity Expected index identity.
   * @returns Complete key for the following page.
   */
  read(identity: object): RecordContinuation<TenantId> {
    if (identity !== this.#identity) throw new TypeError("TenantIndex continuation is invalid.");
    const id = TenantIds.copy(this.#after.id);
    return { values: [{ field: "id", value: id }], id };
  }
}

/**
 * Validates and detaches tenant IDs stored in the registration directory.
 */
const TenantIds = Object.freeze({
  /**
   * Copies a complete identity after domain validation.
   *
   * @param id Candidate complete tenant identity.
   * @returns Detached valid identity.
   */
  copy(id: TenantId): TenantId {
    return clone(TenantIdSchema, TenantBoundary.from(id).tenantId);
  },

  /**
   * Returns the ID required in a stored registration.
   *
   * @param id Stored identity, if present.
   * @returns Its complete identity.
   */
  required(id: TenantId | undefined): TenantId {
    if (id === undefined) throw new Error("Stored tenant registration has no ID.");
    return id;
  },
});

const context: StorageContext = { name: "__SYSTEM_TENANTS__", multitenant: false };
const sort = [{ field: "id" }] as const;
const spec = new RecordSpec<TenantId, Tenant>({
  recordType: TenantSchema,
  idSchema: TenantIdSchema,
  extractId: (record) => TenantIds.required(record.id),
});
