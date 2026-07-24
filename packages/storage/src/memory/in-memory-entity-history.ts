import { clone, toBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventSchema } from "@spine-event-engine/proto";

import type {
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
} from "../entity/entity-history-storage.js";
import type { EntityRecord, EntityRecordStorage } from "../entity/entity-record.js";
import type { StorageContext } from "../storage/storage.js";
import { canonicalStorageScope } from "../storage/canonical-scope.js";
import { bindInMemoryBackendScope, InMemoryStorageBackend } from "./in-memory-storage-backend.js";

/** Shared in-memory entity-storage factory for adapter conformance. */
export class InMemoryEntityStorageFactory {
  readonly #backend: InMemoryStorageBackend;

  /** Create a factory with a fresh backend, or deliberately share `backend`. */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    this.#backend = backend;
  }

  create<I, S extends Message>(input: EntityStorageInput<I, S>): InMemoryEntityStorage<I, S> {
    const scope = canonicalStorageScope(input.context, input.storageKey);
    const fingerprint = entityFingerprint(input);
    const backend = bindInMemoryBackendScope(
      this.#backend,
      scope,
      fingerprint,
      () =>
        ({
          current: new Map<string, unknown>(),
          events: new Map<string, unknown>(),
          stateQueue: new KeyedSerialQueue(),
          states: new Map<string, unknown>(),
        }) satisfies EntityBackend,
    );
    return new InMemoryEntityStorage(input, backend);
  }
}

/** One scoped in-memory current/state/event storage handle. */
export class InMemoryEntityStorage<I, S extends Message> {
  readonly current: InMemoryEntityRecordStorage<I, S>;
  readonly events: InMemoryEntityEventHistory<I>;
  readonly states: InMemoryEntityHistory<I, S>;

  constructor(input: EntityStorageInput<I, S>, backend: EntityBackend) {
    this.current = new InMemoryEntityRecordStorage({
      idKey: input.id.key,
      idClone: input.id.clone,
      stateSchema: input.stateSchema,
      records: backend.current as unknown as Map<string, EntityRecord<I, S>>,
    });
    this.events = new InMemoryEntityEventHistory({
      idKey: input.id.key,
      idClone: input.id.clone,
      records: backend.events as unknown as Map<string, EntityEventHistoryRecord<I>>,
    });
    this.states = new InMemoryEntityHistory({
      idKey: input.id.key,
      idClone: input.id.clone,
      stateSchema: input.stateSchema,
      records: backend.states as unknown as Map<string, EntityStateHistoryRecord<I, S>>,
      queue: backend.stateQueue,
    });
  }
}

export interface EntityStorageInput<I, S extends Message> {
  readonly context: StorageContext;
  readonly id: EntityIdCodec<I>;
  readonly layout: string;
  readonly stateSchema: GenMessage<S>;
  readonly storageKey: string;
}

/** Internal provider ID canonicalization and clone contract. */
export interface EntityIdCodec<I> {
  readonly clone: (id: I) => I;
  /** Stable, validated compatibility identity for this ID representation. */
  readonly fingerprint: string;
  readonly key: (id: I) => string;
}

interface EntityBackend {
  readonly current: Map<string, unknown>;
  readonly events: Map<string, unknown>;
  readonly stateQueue: KeyedSerialQueue;
  readonly states: Map<string, unknown>;
}

function entityFingerprint<I, S extends Message>(input: EntityStorageInput<I, S>): string {
  if (input.layout.trim().length === 0 || input.id.fingerprint.trim().length === 0) {
    throw new Error("Entity storage requires non-blank layout and ID codec fingerprints.");
  }
  return JSON.stringify({
    id: input.id.fingerprint,
    layout: input.layout,
    state: input.stateSchema.typeName,
  });
}

/** In-memory latest-state storage used by all entity families. */
export class InMemoryEntityRecordStorage<I, S extends Message> implements EntityRecordStorage<
  I,
  S
> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #records: Map<string, EntityRecord<I, S>>;
  readonly #stateSchema: GenMessage<S>;

  constructor(input: {
    readonly stateSchema: GenMessage<S>;
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly records?: Map<string, EntityRecord<I, S>>;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? cloneId;
    this.#stateSchema = input.stateSchema;
    this.#records = input.records ?? new Map<string, EntityRecord<I, S>>();
  }

  read(id: I): Promise<EntityRecord<I, S> | undefined> {
    return Promise.resolve().then(() => {
      const record = this.#records.get(this.#idKey(id));
      return record === undefined
        ? undefined
        : copyEntityRecord(record, this.#stateSchema, this.#idClone);
    });
  }

  write(record: EntityRecord<I, S>): Promise<void> {
    return Promise.resolve().then(() => {
      this.#records.set(
        this.#idKey(record.id),
        copyEntityRecord(record, this.#stateSchema, this.#idClone),
      );
    });
  }
}

/** In-memory immutable diagnostic event-history adapter. */
export class InMemoryEntityEventHistory<I> implements EntityEventHistoryPort<I> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #maintenance: InMemoryMaintenance | undefined;
  readonly #records: Map<string, EntityEventHistoryRecord<I>>;
  #open = true;

  constructor(input: {
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly maintenance?: InMemoryMaintenance;
    readonly records?: Map<string, EntityEventHistoryRecord<I>>;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? cloneId;
    this.#maintenance = input.maintenance;
    requireBatchSize(input.maintenance?.batchSize);
    this.#records = input.records ?? new Map<string, EntityEventHistoryRecord<I>>();
  }

  append(record: EntityEventHistoryRecord<I>): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      const id = record.event.id?.value;
      if (id === undefined || id.trim().length === 0) {
        throw new Error("Event history requires an event ID.");
      }
      const stored = this.#records.get(id);
      if (stored !== undefined && !sameEventRecord(stored, record, this.#idKey)) {
        throw new Error("Event-history retry has divergent content.");
      }
      if (stored === undefined) {
        this.#records.set(id, {
          ...record,
          entityId: this.#idClone(record.entityId),
          event: clone(EventSchema, record.event),
          createdAt: { ...record.createdAt },
        });
      }
    });
  }

  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      requireDepth(depth);
      return Object.freeze(
        [...this.#records.values()]
          .filter((record) => this.#idKey(record.entityId) === this.#idKey(entityId))
          .filter(
            (record) =>
              startingFromVersion === undefined || record.producerVersion < startingFromVersion,
          )
          .sort(
            (left, right) =>
              Number(right.producerVersion - left.producerVersion) ||
              compareTime(right.createdAt, left.createdAt) ||
              compareCanonicalBytes(eventId(right), eventId(left)),
          )
          .slice(0, depth)
          .map((record) => Object.freeze(clone(EventSchema, record.event))),
      );
    });
  }

  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    const upperBound = lastMatchingKey(
      this.#records,
      (record) => compareTime(record.createdAt, olderThan) < 0,
    );
    let after: string | undefined;
    while (this.#open) {
      const selected = selectKeys(
        this.#records,
        after,
        this.batchSize(),
        (record, key) =>
          (upperBound === undefined || compareCanonicalBytes(key, upperBound) <= 0) &&
          compareTime(record.createdAt, olderThan) < 0,
      );
      if (selected.length === 0) return;
      for (const key of selected) this.#records.delete(key);
      after = selected.at(-1);
      await this.#maintenance?.onChunk?.();
      this.requireOpen();
    }
  }

  close(): void {
    this.#open = false;
  }
  isOpen(): boolean {
    return this.#open;
  }
  private requireOpen(): void {
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }
  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
  }
}

/** In-memory immutable, versioned state-history adapter. */
export class InMemoryEntityHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #records: Map<string, EntityStateHistoryRecord<I, S>>;
  readonly #stateSchema: GenMessage<S>;
  readonly #queue: KeyedSerialQueue;
  #open = true;
  readonly #maintenance: InMemoryMaintenance | undefined;

  constructor(input: {
    readonly stateSchema: GenMessage<S>;
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly records?: Map<string, EntityStateHistoryRecord<I, S>>;
    readonly maintenance?: InMemoryMaintenance;
    readonly queue?: KeyedSerialQueue;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? cloneId;
    this.#stateSchema = input.stateSchema;
    this.#records = input.records ?? new Map<string, EntityStateHistoryRecord<I, S>>();
    this.#maintenance = input.maintenance;
    requireBatchSize(input.maintenance?.batchSize);
    this.#queue = input.queue ?? new KeyedSerialQueue();
  }

  async append(record: EntityStateHistoryRecord<I, S>): Promise<void> {
    this.requireOpen();
    await this.#queue.run(this.#idKey(record.entityId), () =>
      Promise.resolve().then(() => {
        this.requireOpen();
        const key = this.key(record.entityId, record.version);
        const stored = this.#records.get(key);
        if (stored !== undefined && !sameRecord(stored, record, this.#stateSchema)) {
          throw new Error("State-history retry has divergent content.");
        }
        if (stored === undefined) {
          this.#records.set(key, copyRecord(record, this.#stateSchema, this.#idClone));
        }
      }),
    );
  }

  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly S[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      requireDepth(depth);
      return Object.freeze(
        this.recordsFor(entityId, startingFromVersion)
          .slice(0, depth)
          .map((record) => Object.freeze(clone(this.#stateSchema, record.state))),
      );
    });
  }

  stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      const selected = this.recordsFor(entityId)
        .filter((record) => compareTime(record.createdAt, time) <= 0)
        .sort(compareStateAtRecord)[0];
      return selected === undefined
        ? undefined
        : Object.freeze(clone(this.#stateSchema, selected.state));
    });
  }

  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    this.requireOpen();
    if (!Number.isSafeInteger(keepMostRecent) || keepMostRecent < 0) {
      throw new Error("State-history trim count must be a non-negative safe integer.");
    }
    await this.#queue.run(this.#idKey(entityId), async () => {
      this.requireOpen();
      const entityKey = this.#idKey(entityId);
      let deletionsRemaining = 0;
      for (const record of this.#records.values()) {
        if (this.#idKey(record.entityId) === entityKey) deletionsRemaining++;
      }
      deletionsRemaining = Math.max(0, deletionsRemaining - keepMostRecent);
      await this.afterSelection();
      this.requireOpen();
      while (this.#open && deletionsRemaining > 0) {
        const selected = selectOldestStateKeys(
          this.#records,
          entityKey,
          Math.min(this.batchSize(), deletionsRemaining),
          this.#idKey,
        );
        if (selected.length === 0) return;
        for (const key of selected) this.#records.delete(key);
        deletionsRemaining -= selected.length;
        await this.afterMaintenanceChunk();
      }
    });
  }

  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    const upperBound = lastMatchingKey(
      this.#records,
      (record) => compareTime(record.createdAt, olderThan) < 0,
    );
    await this.afterSelection();
    this.requireOpen();
    let after: string | undefined;
    while (this.#open) {
      const selected = selectKeys(
        this.#records,
        after,
        this.batchSize(),
        (record, key) =>
          (upperBound === undefined || compareCanonicalBytes(key, upperBound) <= 0) &&
          compareTime(record.createdAt, olderThan) < 0,
      );
      if (selected.length === 0) return;
      for (const key of selected) this.#records.delete(key);
      after = selected.at(-1);
      await this.afterMaintenanceChunk();
    }
  }

  close(): void {
    this.#open = false;
  }

  isOpen(): boolean {
    return this.#open;
  }

  private key(entityId: I, version: bigint): string {
    return `${this.#idKey(entityId)}:${String(version)}`;
  }

  private recordsFor(entityId: I, startingFromVersion?: bigint): EntityStateHistoryRecord<I, S>[] {
    const id = this.#idKey(entityId);
    return [...this.#records.values()]
      .filter((record) => this.#idKey(record.entityId) === id)
      .filter((record) => startingFromVersion === undefined || record.version < startingFromVersion)
      .sort(compareRecord);
  }

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("Entity history storage is closed.");
    }
  }
  private async afterSelection(): Promise<void> {
    await this.#maintenance?.afterSelection?.();
  }

  private async afterMaintenanceChunk(): Promise<void> {
    await this.#maintenance?.onChunk?.();
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }

  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
  }
}

/** Adapter-internal deterministic maintenance test seam; not a storage API. */
export interface InMemoryMaintenance {
  readonly afterSelection?: () => void | Promise<void>;
  readonly onChunk?: () => void | Promise<void>;
  /** Test-only override for deterministic in-memory maintenance chunking. */
  readonly batchSize?: number;
}

/** Async FIFO mutexes shared by all history handles for one in-memory backend. */
class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key);
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(key, tail);
    if (previous !== undefined) await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

function compareRecord<I, S extends Message>(
  left: EntityStateHistoryRecord<I, S>,
  right: EntityStateHistoryRecord<I, S>,
): number {
  return Number(right.version - left.version) || compareTime(right.createdAt, left.createdAt);
}

function compareStateAtRecord<I, S extends Message>(
  left: EntityStateHistoryRecord<I, S>,
  right: EntityStateHistoryRecord<I, S>,
): number {
  return compareTime(right.createdAt, left.createdAt) || Number(right.version - left.version);
}

function compareTime(left: Timestamp, right: Timestamp): number {
  return Number(left.seconds - right.seconds) || left.nanos - right.nanos;
}

function copyRecord<I, S extends Message>(
  record: EntityStateHistoryRecord<I, S>,
  schema: GenMessage<S>,
  idClone: (id: I) => I,
): EntityStateHistoryRecord<I, S> {
  return {
    ...record,
    entityId: idClone(record.entityId),
    state: clone(schema, record.state),
    createdAt: { ...record.createdAt },
  };
}

function copyEntityRecord<I, S extends Message>(
  record: EntityRecord<I, S>,
  schema: GenMessage<S>,
  idClone: (id: I) => I,
): EntityRecord<I, S> {
  return { ...record, id: idClone(record.id), state: clone(schema, record.state) };
}

function cloneId<I>(id: I): I {
  return structuredClone(id);
}

function sameRecord<I, S extends Message>(
  left: EntityStateHistoryRecord<I, S>,
  right: EntityStateHistoryRecord<I, S>,
  schema: GenMessage<S>,
): boolean {
  return (
    left.version === right.version &&
    compareTime(left.createdAt, right.createdAt) === 0 &&
    bytesEqual(toBinary(schema, left.state), toBinary(schema, right.state))
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameEventRecord<I>(
  left: EntityEventHistoryRecord<I>,
  right: EntityEventHistoryRecord<I>,
  idKey: (id: I) => string,
): boolean {
  return (
    idKey(left.entityId) === idKey(right.entityId) &&
    left.producerVersion === right.producerVersion &&
    compareTime(left.createdAt, right.createdAt) === 0 &&
    bytesEqual(toBinary(EventSchema, left.event), toBinary(EventSchema, right.event))
  );
}

function eventId<I>(record: EntityEventHistoryRecord<I>): string {
  return record.event.id?.value ?? "";
}

function requireDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth <= 0) {
    throw new Error("History depth must be a positive safe integer.");
  }
}

function requireBatchSize(batchSize: number | undefined): void {
  if (batchSize !== undefined && (!Number.isSafeInteger(batchSize) || batchSize <= 0)) {
    throw new Error("In-memory maintenance batch size must be a positive safe integer.");
  }
}

const MAINTENANCE_BATCH_SIZE = 128;

function selectKeys<T>(
  records: ReadonlyMap<string, T>,
  after: string | undefined,
  batchSize: number,
  matches: (value: T, key: string) => boolean,
): string[] {
  const selected: string[] = [];
  let cursor = after;
  while (selected.length < batchSize) {
    let next: string | undefined;
    for (const [key, value] of records) {
      if (
        (cursor === undefined || compareCanonicalBytes(key, cursor) > 0) &&
        matches(value, key) &&
        (next === undefined || compareCanonicalBytes(key, next) < 0)
      ) {
        next = key;
      }
    }
    if (next === undefined) return selected;
    selected.push(next);
    cursor = next;
  }
  return selected;
}

function lastMatchingKey<T>(
  records: ReadonlyMap<string, T>,
  matches: (value: T) => boolean,
): string | undefined {
  let last: string | undefined;
  for (const [key, value] of records) {
    if (matches(value) && (last === undefined || compareCanonicalBytes(key, last) > 0)) last = key;
  }
  return last;
}

function selectOldestStateKeys<I, S extends Message>(
  records: ReadonlyMap<string, EntityStateHistoryRecord<I, S>>,
  entityKey: string,
  limit: number,
  idKey: (id: I) => string,
): string[] {
  const selected: [string, EntityStateHistoryRecord<I, S>][] = [];
  for (const entry of records) {
    if (idKey(entry[1].entityId) !== entityKey) continue;
    selected.push(entry);
    selected.sort(compareOldestStateEntry);
    if (selected.length > limit) selected.pop();
  }
  return selected.map(([key]) => key);
}

function compareOldestStateEntry<I, S extends Message>(
  [leftKey, left]: [string, EntityStateHistoryRecord<I, S>],
  [rightKey, right]: [string, EntityStateHistoryRecord<I, S>],
): number {
  return (
    Number(left.version - right.version) ||
    compareTime(left.createdAt, right.createdAt) ||
    compareCanonicalBytes(leftKey, rightKey)
  );
}

function compareCanonicalBytes(left: string, right: string): number {
  const leftBytes = utf8Bytes(left);
  const rightBytes = utf8Bytes(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index++;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

declare function structuredClone<T>(value: T): T;
