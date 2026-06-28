/** Version expectation used for optimistic writes. */
export type ExpectedStorageVersion = number | "absent" | "any";

/** Stable string key for a framework storage record. */
export type StorageRecordKey = string;

/** Record categories owned by the storage package. */
export type StorageRecordKind =
  | "entity"
  | "aggregate-event"
  | "aggregate-snapshot"
  | "projection"
  | "delivery"
  | "tenant-index"
  | "diagnostic";

/** Describes whether a storage adapter survives process restarts. */
export interface StorageDurability {
  /** Whether data is durable after process restart. */
  readonly durable: boolean;
  /** Human-readable durability scope for documentation and diagnostics. */
  readonly description: string;
}

/** Versioned storage record returned by record stores. */
export interface StorageRecord<
  Payload = unknown,
  Kind extends StorageRecordKind = StorageRecordKind,
> {
  /** Stable record key inside the store. */
  readonly key: StorageRecordKey;
  /** Storage category for future repository/projection/delivery seams. */
  readonly recordKind: Kind;
  /** Caller-owned payload snapshot. */
  readonly payload: Payload;
  /** Monotonic per-record version, beginning at `1`. */
  readonly version: number;
  /** Monotonic adapter-local sequence used for deterministic scans. */
  readonly revision: number;
}

/** Input for conditional record writes. */
export interface PutStorageRecordInput<Payload = unknown> {
  /** Stable record key inside the store. */
  readonly key: StorageRecordKey;
  /** Payload snapshot to store. */
  readonly payload: Payload;
  /** Optimistic concurrency expectation. Defaults to `"any"`. */
  readonly expectedVersion?: ExpectedStorageVersion;
}

/** Input for conditional record deletion. */
export interface DeleteStorageRecordInput {
  /** Stable record key inside the store. */
  readonly key: StorageRecordKey;
  /** Optimistic concurrency expectation. Defaults to `"any"`. */
  readonly expectedVersion?: ExpectedStorageVersion;
}

/** Async write-side record store used for entity-like framework records. */
export interface WriteSideRecordStore<Kind extends StorageRecordKind = StorageRecordKind> {
  /** Reads a single write-side record snapshot. */
  get<Payload = unknown>(key: StorageRecordKey): Promise<StorageRecord<Payload, Kind> | undefined>;
  /** Conditionally writes a write-side record. */
  put<Payload = unknown>(
    input: PutStorageRecordInput<Payload>,
  ): Promise<StorageRecord<Payload, Kind>>;
  /** Conditionally deletes a write-side record. */
  delete(input: DeleteStorageRecordInput): Promise<boolean>;
  /** Scans write-side records in deterministic revision order. */
  scan<Payload = unknown>(): Promise<readonly StorageRecord<Payload, Kind>[]>;
}

/** Async read-side record store used for projection/query-model records. */
export interface ReadSideRecordStore<Kind extends StorageRecordKind = StorageRecordKind> {
  /** Reads a single read-side record snapshot. */
  get<Payload = unknown>(key: StorageRecordKey): Promise<StorageRecord<Payload, Kind> | undefined>;
  /** Conditionally writes a read-side record. */
  put<Payload = unknown>(
    input: PutStorageRecordInput<Payload>,
  ): Promise<StorageRecord<Payload, Kind>>;
  /** Conditionally deletes a read-side record. */
  delete(input: DeleteStorageRecordInput): Promise<boolean>;
  /** Scans read-side records in deterministic revision order. */
  scan<Payload = unknown>(): Promise<readonly StorageRecord<Payload, Kind>[]>;
}

/** Entity state record for future write-side repositories. */
export type EntityRecord<Payload = unknown> = StorageRecord<Payload, "entity">;

/** Aggregate snapshot record for future event-sourced repositories. */
export type AggregateSnapshotRecord<Payload = unknown> = StorageRecord<
  Payload,
  "aggregate-snapshot"
>;

/** Read-side projection record for future stands/query models. */
export type ProjectionRecord<Payload = unknown> = StorageRecord<Payload, "projection">;

/** Delivery record for future inbox/outbox retry state. */
export type DeliveryRecord<Payload = unknown> = StorageRecord<Payload, "delivery">;

/** Event stream record appended to an aggregate history. */
export interface AggregateEventRecord<Payload = unknown> {
  /** Aggregate stream identifier. */
  readonly streamId: string;
  /** Event payload snapshot. */
  readonly payload: Payload;
  /** Monotonic version within the aggregate stream, beginning at `1`. */
  readonly streamVersion: number;
  /** Monotonic adapter/store-wide position, beginning at `1`. */
  readonly globalPosition: number;
}

/** Input for appending aggregate events. */
export interface AppendAggregateEventsInput<Payload = unknown> {
  /** Aggregate stream identifier. */
  readonly streamId: string;
  /** Expected current stream version before append. */
  readonly expectedVersion: number | "any";
  /** Event payload snapshots to append in order. */
  readonly events: readonly Payload[];
}

/** Async aggregate event history store. */
export interface AggregateEventStore {
  /** Appends events to one aggregate stream with optimistic concurrency. */
  append<Payload = unknown>(
    input: AppendAggregateEventsInput<Payload>,
  ): Promise<readonly AggregateEventRecord<Payload>[]>;
  /** Reads an aggregate stream in stream-version order. */
  readStream<Payload = unknown>(
    streamId: string,
  ): Promise<readonly AggregateEventRecord<Payload>[]>;
  /** Scans all aggregate events in global append order. */
  scan<Payload = unknown>(): Promise<readonly AggregateEventRecord<Payload>[]>;
}

/** Async tenant index store for future multi-tenant runtime discovery. */
export interface TenantIndexStore {
  /** Adds a tenant ID idempotently. */
  add(tenantId: string): Promise<void>;
  /** Lists tenant IDs in deterministic lexical order. */
  list(): Promise<readonly string[]>;
}

/** Diagnostic severity stored without payload bytes or secret values. */
export type DiagnosticSeverity = "debug" | "info" | "warn" | "error";

/** Input for diagnostic records. */
export interface AppendDiagnosticInput {
  /** Short safe diagnostic message. */
  readonly message: string;
  /** Severity for filtering and future observability adapters. */
  readonly severity: DiagnosticSeverity;
  /** Optional safe, structured labels. Do not include credentials or payload contents. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** Diagnostic record for framework health and audit trails. */
export interface DiagnosticRecord extends AppendDiagnosticInput {
  /** Deterministic adapter-local diagnostic ID. */
  readonly id: string;
  /** Monotonic adapter-local diagnostic sequence. */
  readonly sequence: number;
}

/** Async diagnostic store. */
export interface DiagnosticRecordStore {
  /** Appends a safe diagnostic record. */
  append(input: AppendDiagnosticInput): Promise<DiagnosticRecord>;
  /** Reads diagnostics in append order. */
  read(): Promise<readonly DiagnosticRecord[]>;
}

/** Storage adapter surface split by future write-side/read-side consumers. */
export interface StorageAdapter {
  /** Durability characteristics of this adapter. */
  readonly durability: StorageDurability;
  /** Write-side entity state records. */
  readonly writeEntities: WriteSideRecordStore<"entity">;
  /** Write-side aggregate event histories. */
  readonly aggregateEvents: AggregateEventStore;
  /** Write-side aggregate snapshots. */
  readonly aggregateSnapshots: WriteSideRecordStore<"aggregate-snapshot">;
  /** Read-side projection/query-model records. */
  readonly readProjections: ReadSideRecordStore<"projection">;
  /** Write-side delivery retry records. */
  readonly deliveryRecords: WriteSideRecordStore<"delivery">;
  /** Tenant index records. */
  readonly tenantIndex: TenantIndexStore;
  /** Safe framework diagnostics. */
  readonly diagnostics: DiagnosticRecordStore;
}

/** Error thrown when optimistic storage version checks fail. */
export class StorageVersionConflictError extends Error {
  /** Record or stream key that failed the check. */
  readonly key: string;
  /** Current version found in storage. */
  readonly actualVersion: number;
  /** Version expected by the caller. */
  readonly expectedVersion: ExpectedStorageVersion | number;

  constructor(input: {
    readonly key: string;
    readonly actualVersion: number;
    readonly expectedVersion: ExpectedStorageVersion | number;
  }) {
    super(
      `Storage version conflict for "${input.key}": expected ${String(
        input.expectedVersion,
      )}, actual ${String(input.actualVersion)}.`,
    );
    this.name = "StorageVersionConflictError";
    this.key = input.key;
    this.actualVersion = input.actualVersion;
    this.expectedVersion = input.expectedVersion;
  }
}

/** Creates an isolated, non-durable in-memory storage adapter. */
export function createInMemoryStorageAdapter(): InMemoryStorageAdapter {
  return new InMemoryStorageAdapter();
}

/** In-memory adapter intended only for tests and local development. */
export class InMemoryStorageAdapter implements StorageAdapter {
  readonly durability: StorageDurability = {
    durable: false,
    description: "In-memory storage is process-local and not durable across restarts.",
  };

  readonly writeEntities: WriteSideRecordStore<"entity"> = new InMemoryRecordStore("entity", () =>
    this.nextRevision(),
  );
  readonly aggregateEvents: AggregateEventStore = new InMemoryAggregateEventStore();
  readonly aggregateSnapshots: WriteSideRecordStore<"aggregate-snapshot"> = new InMemoryRecordStore(
    "aggregate-snapshot",
    () => this.nextRevision(),
  );
  readonly readProjections: ReadSideRecordStore<"projection"> = new InMemoryRecordStore(
    "projection",
    () => this.nextRevision(),
  );
  readonly deliveryRecords: WriteSideRecordStore<"delivery"> = new InMemoryRecordStore(
    "delivery",
    () => this.nextRevision(),
  );
  readonly tenantIndex: TenantIndexStore = new InMemoryTenantIndexStore();
  readonly diagnostics: DiagnosticRecordStore = new InMemoryDiagnosticRecordStore();

  #revision = 0;

  private nextRevision(): number {
    this.#revision += 1;
    return this.#revision;
  }
}

class InMemoryRecordStore<Kind extends StorageRecordKind>
  implements WriteSideRecordStore<Kind>, ReadSideRecordStore<Kind>
{
  readonly #records = new Map<StorageRecordKey, StorageRecord<unknown, Kind>>();

  constructor(
    private readonly recordKind: Kind,
    private readonly nextRevision: () => number,
  ) {}

  get<Payload = unknown>(key: StorageRecordKey): Promise<StorageRecord<Payload, Kind> | undefined> {
    return asyncResult(() => {
      const record = this.#records.get(key);
      return record === undefined
        ? undefined
        : (cloneValue(record) as StorageRecord<Payload, Kind>);
    });
  }

  put<Payload = unknown>(
    input: PutStorageRecordInput<Payload>,
  ): Promise<StorageRecord<Payload, Kind>> {
    return asyncResult(() => {
      const current = this.#records.get(input.key);
      assertExpectedVersion(input.key, current?.version ?? 0, input.expectedVersion ?? "any");

      const record: StorageRecord<Payload, Kind> = {
        key: input.key,
        recordKind: this.recordKind,
        payload: cloneValue(input.payload),
        version: (current?.version ?? 0) + 1,
        revision: this.nextRevision(),
      };
      this.#records.set(input.key, cloneValue(record));
      return cloneValue(record);
    });
  }

  delete(input: DeleteStorageRecordInput): Promise<boolean> {
    return asyncResult(() => {
      const current = this.#records.get(input.key);
      assertExpectedVersion(input.key, current?.version ?? 0, input.expectedVersion ?? "any");
      return this.#records.delete(input.key);
    });
  }

  scan<Payload = unknown>(): Promise<readonly StorageRecord<Payload, Kind>[]> {
    return asyncResult(() =>
      [...this.#records.values()]
        .sort((left, right) => left.revision - right.revision)
        .map((record) => cloneValue(record) as StorageRecord<Payload, Kind>),
    );
  }
}

class InMemoryAggregateEventStore implements AggregateEventStore {
  readonly #streams = new Map<string, readonly AggregateEventRecord[]>();
  #globalPosition = 0;

  append<Payload = unknown>(
    input: AppendAggregateEventsInput<Payload>,
  ): Promise<readonly AggregateEventRecord<Payload>[]> {
    return asyncResult(() => {
      const current = this.#streams.get(input.streamId) ?? [];
      assertExpectedVersion(input.streamId, current.length, input.expectedVersion);

      const appended: AggregateEventRecord<Payload>[] = [];
      for (const event of input.events) {
        this.#globalPosition += 1;
        appended.push({
          streamId: input.streamId,
          payload: cloneValue(event),
          streamVersion: current.length + appended.length + 1,
          globalPosition: this.#globalPosition,
        });
      }

      this.#streams.set(input.streamId, [
        ...current,
        ...appended.map((event) => cloneValue(event)),
      ]);
      return appended.map((event) => cloneValue(event));
    });
  }

  readStream<Payload = unknown>(
    streamId: string,
  ): Promise<readonly AggregateEventRecord<Payload>[]> {
    return asyncResult(() =>
      (this.#streams.get(streamId) ?? []).map(
        (event) => cloneValue(event) as AggregateEventRecord<Payload>,
      ),
    );
  }

  scan<Payload = unknown>(): Promise<readonly AggregateEventRecord<Payload>[]> {
    return asyncResult(() =>
      [...this.#streams.values()]
        .flat()
        .sort((left, right) => left.globalPosition - right.globalPosition)
        .map((event) => cloneValue(event) as AggregateEventRecord<Payload>),
    );
  }
}

class InMemoryTenantIndexStore implements TenantIndexStore {
  readonly #tenants = new Set<string>();

  add(tenantId: string): Promise<void> {
    return asyncResult(() => {
      this.#tenants.add(tenantId);
    });
  }

  list(): Promise<readonly string[]> {
    return asyncResult(() => [...this.#tenants].sort());
  }
}

class InMemoryDiagnosticRecordStore implements DiagnosticRecordStore {
  readonly #records: DiagnosticRecord[] = [];
  #sequence = 0;

  append(input: AppendDiagnosticInput): Promise<DiagnosticRecord> {
    return asyncResult(() => {
      this.#sequence += 1;
      const record: DiagnosticRecord = {
        id: `diagnostic-${String(this.#sequence)}`,
        sequence: this.#sequence,
        message: input.message,
        severity: input.severity,
        ...(input.attributes === undefined ? {} : { attributes: cloneValue(input.attributes) }),
      };
      this.#records.push(cloneValue(record));
      return cloneValue(record);
    });
  }

  read(): Promise<readonly DiagnosticRecord[]> {
    return asyncResult(() => this.#records.map((record) => cloneValue(record)));
  }
}

function assertExpectedVersion(
  key: string,
  actualVersion: number,
  expectedVersion: ExpectedStorageVersion | number,
): void {
  if (expectedVersion === "any") {
    return;
  }

  const matches =
    expectedVersion === "absent" ? actualVersion === 0 : actualVersion === expectedVersion;

  if (!matches) {
    throw new StorageVersionConflictError({ key, actualVersion, expectedVersion });
  }
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const clonedItems: unknown[] = value.map((item: unknown) => cloneValue(item));
    return clonedItems as T;
  }

  const source = value as Readonly<Record<string, unknown>>;
  const cloned: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(source)) {
    cloned[key] = cloneValue(nestedValue);
  }
  return cloned as T;
}

function asyncResult<T>(operation: () => T): Promise<T> {
  return Promise.resolve().then(operation);
}
