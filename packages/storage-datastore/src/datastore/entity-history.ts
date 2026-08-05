import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityRecord,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import {
  StorageQueryEvaluator,
  StorageQueryPolicy,
  type NormalizedQueryPlan,
} from "@spine-event-engine/storage";

import { CanonicalValue } from "./value-codec.js";

const payload = "$spine.payload";
const entity = "$spine.entity";
const version = "$spine.version";
const createdSeconds = "$spine.created.seconds";
const createdNanos = "$spine.created.nanos";
const archived = "$spine.archived";
const deleted = "$spine.deleted";
const historyKind = "$spine.history.kind";
const scopeProperty = "$spine.scope";
const eventId = "$spine.event.id";
const stateBackward = "$spineBackward";
const stateAt = "$spineStateAt";
const stateReference = "$spineStateRef";
const stateRevision = "$spineStateRevision";
const fixedKinds = {
  metadata: "$SpineEntityScope",
  entity: "$SpineEntity",
  current: "$SpineEntityCurrent",
  state: "$SpineEntityState",
  stateOrder: "$SpineEntityStateOrder",
  stateCut: "$SpineEntityStateCut",
  event: "$SpineEntityEvent",
  eventOrder: "$SpineEntityEventOrder",
  eventCut: "$SpineEntityEventCut",
} as const;
const historyPageSize = 128;
const minimumInt64 = -(1n << 63n);
const maximumInt64 = (1n << 63n) - 1n;

/**
 * Datastore implementation bundle for the provider-only entity-history SPI.
 */
export class DatastoreEntityStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Stores the current durable entity record.
   */
  readonly current: EntityRecordStorage<I, S>;

  /**
   * Stores immutable event-history records.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Stores immutable state-history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;
  readonly #codec: EntityCodec<I, S>;

  /**
   * Creates one independently closeable entity-history provider handle.
   *
   * @param input The frozen framework storage input for this durable entity scope.
   * @param client The caller-owned Datastore client used for provider operations.
   */
  constructor(input: EntityStorageInput<I, S>, client: Datastore) {
    const codec = new EntityCodec(input, client, new OperationGate());
    this.#codec = codec;
    this.current = new CurrentStorage(codec);
    this.events = new EventHistory(codec);
    this.states = new StateHistory(codec);
  }

  /**
   * Closes this handle without closing the caller-owned Datastore client.
   */
  close(): void {
    this.#codec.close();
  }

  /**
   * Returns whether this handle accepts new operations.
   *
   * @returns `true` while the handle is open.
   */
  isOpen(): boolean {
    return this.#codec.isOpen();
  }
}

const DatastoreValues: Readonly<{
  bytes(value: unknown): Uint8Array;
  providerInteger(value: bigint): unknown;
  integer(value: unknown): bigint;
  same(a: Record<string, unknown>, b: Record<string, unknown>): boolean;
  sameValue(left: unknown, right: unknown): boolean;
  isInteger(value: unknown): boolean;
  indexedToken(value: string): string;
  boundedText(value: string, label: string): void;
}> = Object.freeze({
  bytes(value: unknown): Uint8Array {
    if (!(value instanceof Uint8Array)) throw new Error("Datastore entity cannot be decoded.");
    return value;
  },
  providerInteger(value: bigint): unknown {
    if (value < minimumInt64 || value > maximumInt64)
      throw new Error("Datastore entity history requires an exact signed 64-bit integer.");
    return Datastore.int(value.toString());
  },
  integer(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "object" && value !== null && Datastore.isInt(value))
      return BigInt(value.value);
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    throw new Error("Datastore entity has an invalid bigint history value.");
  },
  same(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => DatastoreValues.sameValue(a[key], b[key]))
    );
  },
  sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof Uint8Array && right instanceof Uint8Array)
      return Buffer.from(left).equals(Buffer.from(right));
    if (DatastoreValues.isInteger(left) && DatastoreValues.isInteger(right))
      return DatastoreValues.integer(left) === DatastoreValues.integer(right);
    return left === right;
  },
  isInteger(value: unknown): boolean {
    return (
      typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "object" && value !== null && Datastore.isInt(value))
    );
  },
  indexedToken(value: string): string {
    if (Buffer.byteLength(value, "utf8") > 1_500)
      throw new Error(
        "Datastore entity history indexed token exceeds the 1,500-byte provider limit.",
      );
    return value;
  },
  boundedText(value: string, label: string): void {
    if (Buffer.byteLength(value, "utf8") > 1_500)
      throw new Error(`Datastore entity history ${label} exceeds the 1,500-byte provider limit.`);
  },
});

const DatastoreResults: Readonly<{
  first(result: unknown): Record<string, unknown> | undefined;
  entities(result: unknown): Record<string, unknown>[];
  queryInfo(result: unknown): { endCursor?: string | Buffer; moreResults?: string };
  keyOf(value: Record<string, unknown>, client: Datastore): ReturnType<Datastore["key"]>;
}> = Object.freeze({
  first(result: unknown): Record<string, unknown> | undefined {
    const value = Array.isArray(result) ? (result as readonly unknown[])[0] : undefined;
    return value === undefined ? undefined : (value as Record<string, unknown>);
  },
  entities(result: unknown): Record<string, unknown>[] {
    const value = Array.isArray(result) ? (result as readonly unknown[])[0] : [];
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  },
  queryInfo(result: unknown): { endCursor?: string | Buffer; moreResults?: string } {
    const value = Array.isArray(result) ? (result as readonly unknown[])[1] : undefined;
    if (typeof value !== "object" || value === null)
      throw new Error("Datastore history query did not return paging information.");
    const info = value as { endCursor?: unknown; moreResults?: unknown };
    if (
      info.endCursor !== undefined &&
      typeof info.endCursor !== "string" &&
      !Buffer.isBuffer(info.endCursor)
    )
      throw new Error("Datastore history query returned an invalid continuation cursor.");
    if (info.moreResults !== undefined && typeof info.moreResults !== "string")
      throw new Error("Datastore history query returned an invalid continuation state.");
    return info as { endCursor?: string | Buffer; moreResults?: string };
  },
  keyOf(value: Record<string, unknown>, client: Datastore): ReturnType<Datastore["key"]> {
    const key = (value as unknown as Record<symbol, unknown>)[client.KEY];
    if (key === undefined) throw new Error("Datastore marker query did not return a key.");
    return key as ReturnType<Datastore["key"]>;
  },
});

const HistoryInputs: Readonly<{
  requireDepth(depth: number): void;
  requiredTenant(name: string, tenant: string | undefined): string;
  validateTimestamp(value: Timestamp): void;
}> = Object.freeze({
  requireDepth(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth <= 0)
      throw new Error("History depth must be a positive safe integer.");
  },
  requiredTenant(name: string, tenant: string | undefined): string {
    if (tenant === undefined || tenant.trim().length === 0)
      throw new Error(`Multitenant storage "${name}" requires context.tenantId.`);
    return tenant;
  },
  validateTimestamp(value: Timestamp): void {
    DatastoreValues.providerInteger(value.seconds);
    if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999_999_999)
      throw new Error("Datastore entity history requires a valid timestamp.");
  },
});

const HistoryKeys: Readonly<{
  tuple(...values: readonly string[]): string;
  hex(value: string): string;
  signedAscending(value: bigint): string;
  signedDescending(value: bigint): string;
  signedFromAscending(value: string): bigint;
  timeAscending(value: Timestamp): string;
  timeDescending(value: Timestamp): string;
  descendingHex(value: string): string;
  stateOrderToken(version: bigint, time: Timestamp, backward: boolean): string;
  complementHex(value: string): string;
}> = Object.freeze({
  tuple(...values: readonly string[]): string {
    return values.map((value) => `${String(Buffer.byteLength(value, "utf8"))}:${value}`).join(":");
  },
  hex(value: string): string {
    return Buffer.from(value, "utf8").toString("hex");
  },
  signedAscending(value: bigint): string {
    DatastoreValues.providerInteger(value);
    return (value + (1n << 63n)).toString(16).padStart(16, "0");
  },
  signedDescending(value: bigint): string {
    return HistoryKeys.complementHex(HistoryKeys.signedAscending(value));
  },
  signedFromAscending(value: string): bigint {
    return BigInt(`0x${value}`) - (1n << 63n);
  },
  timeAscending(value: Timestamp): string {
    HistoryInputs.validateTimestamp(value);
    return `${HistoryKeys.signedAscending(value.seconds)}.${value.nanos.toString(16).padStart(8, "0")}`;
  },
  timeDescending(value: Timestamp): string {
    return HistoryKeys.complementHex(HistoryKeys.timeAscending(value).replace(".", ""));
  },
  descendingHex(value: string): string {
    return `${HistoryKeys.complementHex(HistoryKeys.hex(DatastoreValues.indexedToken(value)))}g`;
  },
  stateOrderToken(version: bigint, time: Timestamp, backward: boolean): string {
    const stateKey = HistoryKeys.signedAscending(version);
    const descendingVersion = HistoryKeys.signedDescending(version);
    const descendingTime = HistoryKeys.timeDescending(time);
    const descendingState = HistoryKeys.descendingHex(stateKey);
    return backward
      ? `${descendingVersion}.${descendingTime}.${descendingState}`
      : `${descendingTime}.${descendingVersion}.${descendingState}`;
  },
  complementHex(value: string): string {
    return value.replace(/[0-9a-f]/g, (digit) => (15 - Number.parseInt(digit, 16)).toString(16));
  },
});

class EntityCodec<I, S extends Message> {
  readonly scope: string;
  readonly #fingerprint: string;
  readonly #gate: OperationGate;
  #binding: Promise<void> | undefined;
  constructor(
    readonly input: EntityStorageInput<I, S>,
    readonly client: Datastore,
    gate: OperationGate,
  ) {
    if (input.layout.trim().length === 0 || input.id.fingerprint.trim().length === 0) {
      throw new Error("Entity storage requires non-blank layout and ID codec fingerprints.");
    }
    DatastoreValues.boundedText(input.layout, "layout");
    DatastoreValues.boundedText(input.id.fingerprint, "ID codec fingerprint");
    const tenant = input.context.multitenant
      ? `tenant:${HistoryInputs.requiredTenant(input.context.name, input.context.tenantId)}`
      : "single-tenant";
    this.scope = HistoryKeys.tuple(input.context.name, tenant, input.storageKey);
    this.#gate = gate;
    this.#fingerprint = JSON.stringify({
      columns: input.columns.map((column) => [column.name, column.valueType]),
      layout: input.layout,
      id: input.id.fingerprint,
      state: input.stateSchema.typeName,
    });
    DatastoreValues.boundedText(this.#fingerprint, "durable fingerprint");
  }
  key(kind: "metadata" | "current" | "event", id: string): ReturnType<Datastore["key"]> {
    const fixedKind = fixedKinds[kind];
    if (kind === "metadata") return this.namedKey(fixedKind, HistoryKeys.hex(this.scope));
    if (kind === "event")
      return this.namedKey(fixedKind, HistoryKeys.hex(HistoryKeys.tuple(this.scope, id)));
    return this.childKey(id, fixedKind, "current");
  }
  entityKey(id: string): ReturnType<Datastore["key"]> {
    return this.namedKey(fixedKinds.entity, HistoryKeys.hex(HistoryKeys.tuple(this.scope, id)));
  }
  childKey(id: string, kind: string, name: string): ReturnType<Datastore["key"]> {
    return this.keyForPath([
      fixedKinds.entity,
      HistoryKeys.hex(HistoryKeys.tuple(this.scope, id)),
      kind,
      name,
    ]);
  }
  stateKey(id: string, itemVersion: bigint): ReturnType<Datastore["key"]> {
    return this.childKey(id, fixedKinds.state, HistoryKeys.signedAscending(itemVersion));
  }
  stateOrderKey(id: string, itemVersion: bigint, time: Timestamp): ReturnType<Datastore["key"]> {
    return this.childKey(
      id,
      fixedKinds.stateOrder,
      `${HistoryKeys.signedAscending(itemVersion)}.${HistoryKeys.timeAscending(time)}`,
    );
  }
  stateCutKey(id: string, itemVersion: bigint, time: Timestamp): ReturnType<Datastore["key"]> {
    const stateIdentity = HistoryKeys.signedAscending(itemVersion);
    const name = [
      HistoryKeys.hex(this.scope),
      HistoryKeys.timeAscending(time),
      HistoryKeys.hex(id),
      stateIdentity,
    ].join(".");
    return this.namedKey(fixedKinds.stateCut, name);
  }
  eventOrderKey(
    id: string,
    itemVersion: bigint,
    time: Timestamp,
    event: string,
  ): ReturnType<Datastore["key"]> {
    const order = [
      HistoryKeys.signedDescending(itemVersion),
      HistoryKeys.timeDescending(time),
      HistoryKeys.descendingHex(event),
    ].join(".");
    return this.childKey(id, fixedKinds.eventOrder, order);
  }
  eventOrderLowerBound(id: string, itemVersion: bigint): ReturnType<Datastore["key"]> {
    return this.childKey(
      id,
      fixedKinds.eventOrder,
      `${HistoryKeys.signedDescending(itemVersion)}g`,
    );
  }
  eventCutKey(
    id: string,
    itemVersion: bigint,
    time: Timestamp,
    event: string,
  ): ReturnType<Datastore["key"]> {
    const name = [
      HistoryKeys.hex(this.scope),
      HistoryKeys.timeAscending(time),
      HistoryKeys.hex(id),
      HistoryKeys.signedAscending(itemVersion),
      HistoryKeys.hex(event),
    ].join(".");
    return this.namedKey(fixedKinds.eventCut, name);
  }
  markerQuery(kind: "stateOrder" | "eventOrder", id: string): ReturnType<Datastore["createQuery"]> {
    const fixedKind = fixedKinds[kind];
    const query = this.input.context.multitenant
      ? this.client.createQuery(
          HistoryInputs.requiredTenant(this.input.context.name, this.input.context.tenantId),
          fixedKind,
        )
      : this.client.createQuery(fixedKind);
    return query.hasAncestor(this.entityKey(id));
  }
  cutQuery(kind: "stateCut" | "eventCut"): ReturnType<Datastore["createQuery"]> {
    const fixedKind = fixedKinds[kind];
    return this.input.context.multitenant
      ? this.client.createQuery(
          HistoryInputs.requiredTenant(this.input.context.name, this.input.context.tenantId),
          fixedKind,
        )
      : this.client.createQuery(fixedKind);
  }
  currentQuery(): ReturnType<Datastore["createQuery"]> {
    const kind = fixedKinds.current;
    return this.input.context.multitenant
      ? this.client.createQuery(
          HistoryInputs.requiredTenant(this.input.context.name, this.input.context.tenantId),
          kind,
        )
      : this.client.createQuery(kind);
  }
  cutLowerBound(kind: "stateCut" | "eventCut"): ReturnType<Datastore["key"]> {
    return this.namedKey(fixedKinds[kind], HistoryKeys.hex(this.scope));
  }
  cutTimeBound(kind: "stateCut" | "eventCut", time: Timestamp): ReturnType<Datastore["key"]> {
    return this.namedKey(
      fixedKinds[kind],
      `${HistoryKeys.hex(this.scope)}.${HistoryKeys.timeAscending(time)}.`,
    );
  }
  id(id: I): string {
    return DatastoreValues.indexedToken(this.input.id.key(id));
  }
  cloneId(id: I): I {
    return this.input.id.clone(id);
  }
  state(value: S): Uint8Array {
    return toBinary(this.input.stateSchema, value);
  }
  decodeState(value: unknown): S {
    return fromBinary(this.input.stateSchema, DatastoreValues.bytes(value));
  }
  ensureBound(): Promise<void> {
    if (this.#binding === undefined) {
      const binding = this.bind();
      this.#binding = binding;
      void binding.catch(() => {
        if (this.#binding === binding) this.#binding = undefined;
      });
    }
    return this.#binding;
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.#gate.run(async () => {
      await this.ensureBound();
      return operation();
    });
  }
  close(): void {
    this.#gate.close();
  }
  isOpen(): boolean {
    return this.#gate.isOpen();
  }
  requireOpen(): void {
    this.#gate.requireOpen();
  }
  private async bind(): Promise<void> {
    const key = this.key("metadata", "binding");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = this.client.transaction();
      try {
        await transaction.run();
        const existing = DatastoreResults.first(await transaction.get(key));
        if (existing !== undefined) {
          if (existing.fingerprint !== this.#fingerprint)
            throw new Error("Datastore entity storage has an incompatible durable binding.");
          await transaction.rollback();
          return;
        }
        transaction.insert({
          key,
          data: { fingerprint: this.#fingerprint },
          excludeFromIndexes: ["fingerprint"],
        });
        await transaction.commit();
        return;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        // A commit acknowledgement may be lost. Re-open once and accept only
        // the exact durable fingerprint, never a divergent first binding.
        const reopened = DatastoreResults.first(await this.client.get(key));
        if (reopened?.fingerprint === this.#fingerprint) return;
        throw error;
      }
    }
    throw new Error("Datastore entity binding retry limit was reached.");
  }
  private namedKey(kind: string, name: string): ReturnType<Datastore["key"]> {
    return this.keyForPath([kind, name]);
  }
  private keyForPath(path: readonly string[]): ReturnType<Datastore["key"]> {
    if (Buffer.byteLength(path.join("/"), "utf8") > 6 * 1024)
      throw new Error("Datastore entity history key exceeds the 6 KiB provider limit.");
    return this.client.key({
      path: [...path],
      ...(this.input.context.multitenant
        ? {
            namespace: HistoryInputs.requiredTenant(
              this.input.context.name,
              this.input.context.tenantId,
            ),
          }
        : {}),
    });
  }
}

class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I, S> {
  constructor(private readonly codec: EntityCodec<I, S>) {}
  async read(id: I): Promise<EntityRecord<I, S> | undefined> {
    const key = this.codec.key("current", this.codec.id(id));
    return this.codec.run(async () => {
      const row = DatastoreResults.first(
        await this.codec.client.get(key, {
          wrapNumbers: true,
        }),
      );
      if (row === undefined) return undefined;
      return Object.freeze({
        id: this.codec.cloneId(id),
        state: Object.freeze(this.codec.decodeState(row[payload])),
        version: DatastoreValues.integer(row[version]),
        archived: row[archived] === true,
        deleted: row[deleted] === true,
      });
    });
  }
  async write(record: EntityRecord<I, S>): Promise<void> {
    DatastoreValues.providerInteger(record.version);
    const id = this.codec.id(record.id);
    if (id !== this.codec.id(this.codec.input.extractId(record.state))) {
      throw new Error("Entity current record ID does not match its state ID.");
    }
    const key = this.codec.key("current", id);
    await this.codec.run(() =>
      this.codec.client.save({
        key,
        data: {
          [scopeProperty]: this.codec.scope,
          [entity]: id,
          [historyKind]: "current",
          [payload]: Buffer.from(this.codec.state(record.state)),
          [version]: DatastoreValues.providerInteger(record.version),
          [archived]: record.archived,
          [deleted]: record.deleted,
        },
        excludeFromIndexes: [payload],
      }),
    );
  }
  async query(plan: NormalizedQueryPlan<I>) {
    StorageQueryPolicy.validate(plan, {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    });
    const candidateLimit = plan.candidateLimit ?? 10_000;
    return this.codec.run(async () => {
      const query = this.codec
        .currentQuery()
        .filter(scopeProperty, "=", this.codec.scope)
        .filter(historyKind, "=", "current")
        .filter(deleted, "=", false)
        .limit(candidateLimit + 1);
      const rows = DatastoreResults.entities(
        await this.codec.client.runQuery(query, { wrapNumbers: true }),
      );
      if (rows.length > candidateLimit) {
        throw new Error(`Storage query exceeded the candidate limit of ${String(candidateLimit)}.`);
      }
      return StorageQueryEvaluator.evaluate(
        rows.map((row) => {
          const state = this.codec.decodeState(row[payload]);
          const id = this.codec.cloneId(this.codec.input.extractId(state));
          const expected = this.codec.id(id);
          if (row[entity] !== expected)
            throw new Error("Entity current record ID does not match its state ID.");
          return {
            id,
            record: Object.freeze({
              id: this.codec.cloneId(id),
              state: Object.freeze(state),
              version: DatastoreValues.integer(row[version]),
              archived: row[archived] === true,
              deleted: row[deleted] === true,
            }),
            columns: new Map<string, unknown>([
              ...this.codec.input.columns.map(
                (column) => [column.name, column.valueIn(state)] as const,
              ),
              ["version", DatastoreValues.integer(row[version])],
              ["archived", row[archived] === true],
              ["deleted", row[deleted] === true],
            ]),
          };
        }),
        plan,
      );
    });
  }
  close(): void {
    this.codec.close();
  }
  isOpen(): boolean {
    return this.codec.isOpen();
  }
}

class StateHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  constructor(private readonly codec: EntityCodec<I, S>) {}
  async append(record: EntityStateHistoryRecord<I, S>): Promise<void> {
    const id = this.codec.id(record.entityId);
    const key = this.codec.stateKey(id, record.version);
    const orderKey = this.codec.stateOrderKey(id, record.version, record.createdAt);
    const cutKey = this.codec.stateCutKey(id, record.version, record.createdAt);
    const data = HistoryRows.row(
      "state",
      record.entityId,
      this.codec,
      record.version,
      record.createdAt,
      this.codec.state(record.state),
    );
    await this.codec.run(() =>
      HistoryWrites.append(
        this.codec,
        id,
        key,
        orderKey,
        cutKey,
        record.version,
        record.createdAt,
        data,
      ),
    );
  }
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]> {
    HistoryInputs.requireDepth(depth);
    if (startingFromVersion !== undefined) DatastoreValues.providerInteger(startingFromVersion);
    const id = this.codec.id(entityId);
    return this.codec.run(async () => {
      const markers = await HistoryQueries.stateMarkers(this.codec, id, depth, startingFromVersion);
      const rows = await HistoryQueries.stateRows(this.codec, id, markers);
      return Object.freeze(
        rows.map((value) =>
          Object.freeze({
            entityId: this.codec.cloneId(entityId),
            state: Object.freeze(this.codec.decodeState(value[payload])),
            version: DatastoreValues.integer(value[version]),
            createdAt: Object.freeze(
              create(TimestampSchema, {
                seconds: DatastoreValues.integer(value[createdSeconds]),
                nanos: Number(DatastoreValues.integer(value[createdNanos])),
              }),
            ),
          }),
        ),
      );
    });
  }
  async stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    HistoryInputs.validateTimestamp(time);
    const id = this.codec.id(entityId);
    return this.codec.run(async () => {
      const query = this.codec
        .markerQuery("stateOrder", id)
        .filter(stateAt, ">=", HistoryKeys.timeDescending(time))
        .order(stateAt)
        .limit(1);
      const marker = DatastoreResults.entities(
        await this.codec.client.runQuery(query, { wrapNumbers: true }),
      )[0];
      if (marker === undefined) return undefined;
      const row = await HistoryQueries.stateRow(this.codec, id, marker);
      return Object.freeze(this.codec.decodeState(row[payload]));
    });
  }
  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    if (!Number.isSafeInteger(keepMostRecent) || keepMostRecent < 0)
      throw new Error("State-history trim count must be a non-negative safe integer.");
    const id = this.codec.id(entityId);
    await this.codec.run(() => HistoryRetention.trimStates(this.codec, id, keepMostRecent));
  }
  async truncate(olderThan: Timestamp): Promise<void> {
    HistoryInputs.validateTimestamp(olderThan);
    await this.codec.run(() => HistoryRetention.truncate(this.codec, "state", olderThan));
  }
}

class EventHistory<I, S extends Message> implements EntityEventHistoryPort<I> {
  constructor(private readonly codec: EntityCodec<I, S>) {}
  async append(record: EntityEventHistoryRecord<I>): Promise<void> {
    DatastoreValues.providerInteger(record.producerVersion);
    HistoryInputs.validateTimestamp(record.createdAt);
    const id = record.event.id?.value;
    if (id === undefined || id.trim().length === 0)
      throw new Error("Event history requires an event ID.");
    const entityId = this.codec.id(record.entityId);
    DatastoreValues.indexedToken(id);
    const key = this.codec.key("event", id);
    const orderKey = this.codec.eventOrderKey(
      entityId,
      record.producerVersion,
      record.createdAt,
      id,
    );
    const cutKey = this.codec.eventCutKey(entityId, record.producerVersion, record.createdAt, id);
    const data = {
      ...HistoryRows.row(
        "event",
        record.entityId,
        this.codec,
        record.producerVersion,
        record.createdAt,
        toBinary(EventSchema, record.event),
      ),
      [eventId]: id,
    };
    await this.codec.run(() =>
      HistoryWrites.appendEvent(this.codec, entityId, key, orderKey, cutKey, data),
    );
  }
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly Event[]> {
    HistoryInputs.requireDepth(depth);
    if (startingFromVersion !== undefined) DatastoreValues.providerInteger(startingFromVersion);
    const id = this.codec.id(entityId);
    const rows = await this.codec.run(async () => {
      const markers = await HistoryQueries.eventMarkers(this.codec, id, depth, startingFromVersion);
      return HistoryQueries.eventRows(this.codec, markers);
    });
    return Object.freeze(
      rows.map((value) =>
        Object.freeze(
          clone(EventSchema, fromBinary(EventSchema, DatastoreValues.bytes(value[payload]))),
        ),
      ),
    );
  }
  async truncate(olderThan: Timestamp): Promise<void> {
    HistoryInputs.validateTimestamp(olderThan);
    await this.codec.run(() => HistoryRetention.truncate(this.codec, "event", olderThan));
  }
}

/**
 * Commits one Entity mutation through a single Datastore transaction.
 *
 * This provider-internal handle deliberately shares the entity-history codec,
 * so the current row and retained history remain visible to normal handles.
 */
export class DatastoreEntityCommitStorage<I, S extends Message> implements EntityCommitStorage {
  readonly #codec: EntityCodec<I, S>;

  /**
   * Creates a commit handle for one Entity storage layout.
   *
   * @param input Defines the Entity storage layout.
   * @param client Provides the caller-owned Datastore client.
   */
  constructor(input: EntityStorageInput<I, S>, client: Datastore) {
    this.#codec = new EntityCodec(input, client, new OperationGate());
  }

  /**
   * Applies a complete Entity mutation, or returns its prior durable result.
   *
   * @param input Defines the Entity, history, and framework-event mutation.
   * @returns The committed, replayed, or conflict outcome.
   */
  async commit<T, U extends Message>(input: EntityCommitInput<T, U>): Promise<EntityCommitResult> {
    this.#codec.requireOpen();
    this.#requireCompatible(input);
    const compatible = input as unknown as EntityCommitInput<I, S>;
    this.#preflight(compatible);
    return this.#codec.run(() => this.#attempt(compatible));
  }

  /** Closes this handle without closing sibling handles or the injected client. */
  close(): void {
    this.#codec.close();
  }

  #requireCompatible<T, U extends Message>(input: EntityCommitInput<T, U>): void {
    const expected = this.#codec.input;
    if (
      input.context.name !== expected.context.name ||
      input.context.multitenant !== expected.context.multitenant ||
      input.context.tenantId !== expected.context.tenantId ||
      input.entity.storageKey !== expected.storageKey
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  #preflight(input: EntityCommitInput<I, S>): void {
    const eventIds = (input.events ?? []).map((event) => event.id?.value);
    if (eventIds.some((id) => id === undefined || id.trim().length === 0))
      throw new Error("Entity commit requires delivery events with non-empty IDs.");
    if (new Set(eventIds).size !== eventIds.length)
      throw new Error("Entity commit requires unique delivery-event IDs.");
    if (1 + eventIds.length > 25)
      throw new Error("Datastore entity commit exceeds the 25 entity-group limit.");
    const bytes = [
      this.#codec.state(input.next.state),
      ...(input.states ?? []).map((row) => this.#codec.state(row.state)),
      ...(input.diagnostics ?? []).map((row) => toBinary(EventSchema, row.event)),
      ...(input.events ?? []).map((event) => toBinary(EventSchema, event)),
    ].reduce((total, value) => total + value.byteLength, 0);
    // The provider limit includes keys and indexes. Reserve headroom for those
    // deterministic rows rather than starting a transaction that cannot commit.
    if (bytes > 9 * 1024 * 1024)
      throw new Error("Datastore entity commit exceeds the 10 MiB mutation limit.");
  }

  async #attempt(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    const digest = DatastoreCommitValues.digest(input, this.#codec);
    const id = this.#codec.id(input.entityId);
    const receiptKey = this.#codec.childKey(id, "$SpineEntityCommit", input.id);
    const currentKey = this.#codec.key("current", id);
    const canonical = (input.events ?? []).map((event) =>
      DatastoreCommitValues.delivery(this.#codec, event),
    );
    const reads = [receiptKey, currentKey, ...canonical.map((item) => item.key)];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = this.#codec.client.transaction();
      try {
        await transaction.run();
        const rows = await Promise.all(
          reads.map((key) => transaction.get(key, { wrapNumbers: true })),
        );
        const receipt = DatastoreResults.first(rows[0]);
        if (receipt !== undefined) {
          if (receipt.digest !== digest)
            throw new Error("Entity commit ID was reused with different content.");
          await transaction.rollback();
          return "replayed";
        }
        const current = DatastoreCommitValues.current(
          this.#codec,
          input.entityId,
          DatastoreResults.first(rows[1]),
        );
        if (!DatastoreCommitValues.sameCurrent(current, input.expected, this.#codec)) {
          await transaction.rollback();
          return "conflict";
        }
        if (rows.slice(2).some((row) => DatastoreResults.first(row) !== undefined))
          throw new Error("Entity commit requires unique delivery-event IDs.");

        const rootKey = this.#codec.entityKey(id);
        const root = DatastoreResults.first(await transaction.get(rootKey, { wrapNumbers: true }));
        let nextRoot = HistoryRows.entityRoot(root, this.#codec.scope, id);
        const currentData = DatastoreCommitValues.currentRow(this.#codec, input.next);
        transaction.save({ key: currentKey, data: currentData, excludeFromIndexes: [payload] });

        for (const state of input.states ?? []) {
          const stateId = this.#codec.id(state.entityId);
          if (stateId !== id)
            throw new Error("Entity commit state history belongs to another Entity.");
          const key = this.#codec.stateKey(id, state.version);
          const stateRow = HistoryRows.row(
            "state",
            state.entityId,
            this.#codec,
            state.version,
            state.createdAt,
            this.#codec.state(state.state),
          );
          const existing = DatastoreResults.first(
            await transaction.get(key, { wrapNumbers: true }),
          );
          if (existing !== undefined && !DatastoreValues.same(existing, stateRow))
            throw new Error("State-history retry has divergent content.");
          if (existing === undefined) {
            nextRoot = HistoryRows.nextEntityRoot(nextRoot, 1);
            transaction.insert({ key, data: stateRow, excludeFromIndexes: [payload] });
            transaction.insert({
              key: this.#codec.stateOrderKey(id, state.version, state.createdAt),
              data: {
                [stateBackward]: HistoryKeys.stateOrderToken(state.version, state.createdAt, true),
                [stateAt]: HistoryKeys.stateOrderToken(state.version, state.createdAt, false),
                [stateReference]: HistoryKeys.signedAscending(state.version),
                [stateRevision]: DatastoreValues.providerInteger(
                  DatastoreValues.integer(nextRoot.revision),
                ),
              },
            });
            transaction.insert({
              key: this.#codec.stateCutKey(id, state.version, state.createdAt),
              data: {
                [createdSeconds]: DatastoreValues.providerInteger(state.createdAt.seconds),
                [createdNanos]: state.createdAt.nanos,
              },
            });
          }
        }
        for (const diagnostic of input.diagnostics ?? []) {
          const diagnosticId = this.#codec.id(diagnostic.entityId);
          if (diagnosticId !== id)
            throw new Error("Entity commit event history belongs to another Entity.");
          const eventIdentity = diagnostic.event.id?.value;
          if (eventIdentity === undefined || eventIdentity.trim().length === 0)
            throw new Error("Event history requires an event ID.");
          const key = this.#codec.key("event", eventIdentity);
          const row = {
            ...HistoryRows.row(
              "event",
              diagnostic.entityId,
              this.#codec,
              diagnostic.producerVersion,
              diagnostic.createdAt,
              toBinary(EventSchema, diagnostic.event),
            ),
            [eventId]: eventIdentity,
          };
          const existing = DatastoreResults.first(
            await transaction.get(key, { wrapNumbers: true }),
          );
          if (existing !== undefined && !DatastoreValues.same(existing, row))
            throw new Error("Event-history retry has divergent content.");
          if (existing === undefined) {
            nextRoot = HistoryRows.nextEntityRoot(nextRoot, 0);
            transaction.insert({ key, data: row, excludeFromIndexes: [payload] });
            transaction.insert({
              key: this.#codec.eventOrderKey(
                id,
                diagnostic.producerVersion,
                diagnostic.createdAt,
                eventIdentity,
              ),
              data: { [eventId]: eventIdentity },
            });
            transaction.insert({
              key: this.#codec.eventCutKey(
                id,
                diagnostic.producerVersion,
                diagnostic.createdAt,
                eventIdentity,
              ),
              data: {
                [createdSeconds]: DatastoreValues.providerInteger(diagnostic.createdAt.seconds),
                [createdNanos]: diagnostic.createdAt.nanos,
              },
            });
          }
        }
        if (root === undefined) transaction.insert({ key: rootKey, data: nextRoot });
        else if (nextRoot !== root) transaction.save({ key: rootKey, data: nextRoot });
        for (const event of canonical) transaction.insert(event);
        transaction.insert({ key: receiptKey, data: { digest }, excludeFromIndexes: ["digest"] });
        await transaction.commit();
        return "committed";
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        const receipt = DatastoreResults.first(
          await this.#codec.client.get(receiptKey, { wrapNumbers: true }),
        );
        if (receipt?.digest === digest) return "replayed";
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Datastore entity commit retry limit was reached.");
  }
}

const DatastoreCommitValues = Object.freeze({
  delivery<I, S extends Message>(codec: EntityCodec<I, S>, event: Event) {
    const id = event.id?.value as string;
    const key = codec.client.key({
      path: [
        `${codec.input.context.name}:${EventSchema.typeName}`,
        CanonicalValue.encode(event.id),
      ],
      ...(codec.input.context.multitenant
        ? {
            namespace: HistoryInputs.requiredTenant(
              codec.input.context.name,
              codec.input.context.tenantId,
            ),
          }
        : {}),
    });
    const data: Record<string, unknown> = {
      "$spine.id": CanonicalValue.encode(event.id),
      [payload]: Buffer.from(toBinary(EventSchema, event, { writeUnknownFields: false })),
      "$spine.column.timestamp": DatastoreValues.providerInteger(
        event.context?.timestamp?.seconds ?? 0n,
      ),
      "$spine.columnType.timestamp": "bigint",
      "$spine.column.typeUrl": event.message?.typeUrl,
    };
    return { key, data, excludeFromIndexes: [payload, "$spine.columnType.timestamp"] };
  },
  current<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: I,
    row: Record<string, unknown> | undefined,
  ): EntityRecord<I, S> | undefined {
    if (row === undefined) return undefined;
    return Object.freeze({
      id: codec.cloneId(id),
      state: codec.decodeState(row[payload]),
      version: DatastoreValues.integer(row[version]),
      archived: row[archived] === true,
      deleted: row[deleted] === true,
    });
  },
  currentRow<I, S extends Message>(
    codec: EntityCodec<I, S>,
    record: EntityRecord<I, S>,
  ): Record<string, unknown> {
    const id = codec.id(record.id);
    if (id !== codec.id(codec.input.extractId(record.state)))
      throw new Error("Entity current record ID does not match its state ID.");
    return {
      [scopeProperty]: codec.scope,
      [entity]: id,
      [historyKind]: "current",
      [payload]: Buffer.from(codec.state(record.state)),
      [version]: DatastoreValues.providerInteger(record.version),
      [archived]: record.archived,
      [deleted]: record.deleted,
    };
  },
  sameCurrent<I, S extends Message>(
    actual: EntityRecord<I, S> | undefined,
    expected: EntityRecord<I, S> | undefined,
    codec: EntityCodec<I, S>,
  ): boolean {
    if (actual === undefined || expected === undefined) return actual === expected;
    return (
      actual.version === expected.version &&
      actual.archived === expected.archived &&
      actual.deleted === expected.deleted &&
      Buffer.from(codec.state(actual.state)).equals(Buffer.from(codec.state(expected.state)))
    );
  },
  digest<I, S extends Message>(input: EntityCommitInput<I, S>, codec: EntityCodec<I, S>): string {
    const bytes = (value: Uint8Array) => Buffer.from(value).toString("hex");
    const record = (value: EntityRecord<I, S> | undefined) =>
      value === undefined
        ? undefined
        : {
            state: bytes(codec.state(value.state)),
            version: value.version.toString(),
            archived: value.archived,
            deleted: value.deleted,
          };
    return JSON.stringify({
      id: input.id,
      entity: codec.id(input.entityId),
      expected: record(input.expected),
      next: record(input.next),
      states: (input.states ?? []).map((state) => [
        codec.id(state.entityId),
        bytes(codec.state(state.state)),
        state.version.toString(),
        state.createdAt.seconds.toString(),
        state.createdAt.nanos,
      ]),
      diagnostics: (input.diagnostics ?? []).map((event) => [
        codec.id(event.entityId),
        bytes(toBinary(EventSchema, event.event)),
        event.producerVersion.toString(),
        event.createdAt.seconds.toString(),
        event.createdAt.nanos,
      ]),
      events: (input.events ?? []).map((event) => bytes(toBinary(EventSchema, event))),
    });
  },
});

const HistoryWrites = Object.freeze({
  async append<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    key: ReturnType<Datastore["key"]>,
    orderKey: ReturnType<Datastore["key"]>,
    cutKey: ReturnType<Datastore["key"]>,
    itemVersion: bigint,
    time: Timestamp,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rootKey = codec.entityKey(id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = codec.client.transaction();
      try {
        await transaction.run();
        const root = DatastoreResults.first(await transaction.get(rootKey));
        const existing = DatastoreResults.first(await transaction.get(key));
        if (existing !== undefined) {
          if (!DatastoreValues.same(existing, data))
            throw new Error("State-history retry has divergent content.");
          await transaction.rollback();
          return;
        }
        const current = HistoryRows.entityRoot(root, codec.scope, id);
        const next = HistoryRows.nextEntityRoot(current, 1);
        if (root === undefined) transaction.insert({ key: rootKey, data: next });
        else transaction.save({ key: rootKey, data: next });
        transaction.insert({ key, data, excludeFromIndexes: [payload] });
        transaction.insert({
          key: orderKey,
          data: {
            [stateBackward]: HistoryKeys.stateOrderToken(itemVersion, time, true),
            [stateAt]: HistoryKeys.stateOrderToken(itemVersion, time, false),
            [stateReference]: HistoryKeys.signedAscending(itemVersion),
            [stateRevision]: DatastoreValues.providerInteger(
              DatastoreValues.integer(next.revision),
            ),
          },
        });
        transaction.insert({
          key: cutKey,
          data: {
            [createdSeconds]: DatastoreValues.providerInteger(time.seconds),
            [createdNanos]: time.nanos,
          },
        });
        await transaction.commit();
        return;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        const durable = DatastoreResults.first(await codec.client.get(key));
        if (durable !== undefined && DatastoreValues.same(durable, data)) return;
        throw error;
      }
    }
    throw new Error("Datastore entity state append retry limit was reached.");
  },

  async appendEvent<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    key: ReturnType<Datastore["key"]>,
    orderKey: ReturnType<Datastore["key"]>,
    cutKey: ReturnType<Datastore["key"]>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rootKey = codec.entityKey(id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = codec.client.transaction();
      try {
        await transaction.run();
        const existing = DatastoreResults.first(await transaction.get(key));
        const root = DatastoreResults.first(await transaction.get(rootKey));
        if (existing !== undefined) {
          if (!DatastoreValues.same(existing, data))
            throw new Error("Event-history retry has divergent content.");
          await transaction.rollback();
          return;
        }
        const current = HistoryRows.entityRoot(root, codec.scope, id);
        const next = HistoryRows.nextEntityRoot(current, 0);
        if (root === undefined) transaction.insert({ key: rootKey, data: next });
        else transaction.save({ key: rootKey, data: next });
        transaction.insert({ key, data, excludeFromIndexes: [payload] });
        transaction.insert({ key: orderKey, data: { [eventId]: data[eventId] } });
        transaction.insert({
          key: cutKey,
          data: { [createdSeconds]: data[createdSeconds], [createdNanos]: data[createdNanos] },
        });
        await transaction.commit();
        return;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        const durable = DatastoreResults.first(await codec.client.get(key));
        if (durable !== undefined && DatastoreValues.same(durable, data)) return;
        throw error;
      }
    }
    throw new Error("Datastore entity event append retry limit was reached.");
  },
});

const HistoryRows = Object.freeze({
  entityRoot(
    value: Record<string, unknown> | undefined,
    scope: string,
    id: string,
  ): Record<string, unknown> {
    if (value === undefined)
      return {
        scope,
        [entity]: id,
        stateCount: Datastore.int("0"),
        revision: Datastore.int("0"),
      };
    if (value.scope !== scope || value[entity] !== id)
      throw new Error("Datastore entity root has incompatible durable identity.");
    DatastoreValues.integer(value.stateCount);
    DatastoreValues.integer(value.revision);
    return value;
  },
  nextEntityRoot(value: Record<string, unknown>, states: number): Record<string, unknown> {
    return {
      ...value,
      stateCount: DatastoreValues.providerInteger(
        DatastoreValues.integer(value.stateCount) + BigInt(states),
      ),
      revision: DatastoreValues.providerInteger(DatastoreValues.integer(value.revision) + 1n),
    };
  },

  row<I, S extends Message>(
    kind: "state" | "event",
    id: I,
    codec: EntityCodec<I, S>,
    itemVersion: bigint,
    time: Timestamp,
    content: Uint8Array,
  ): Record<string, unknown> {
    HistoryInputs.validateTimestamp(time);
    return {
      [historyKind]: kind,
      [entity]: codec.id(id),
      [version]: DatastoreValues.providerInteger(itemVersion),
      [createdSeconds]: DatastoreValues.providerInteger(time.seconds),
      [createdNanos]: time.nanos,
      [payload]: Buffer.from(content),
    };
  },
});
const HistoryQueries = Object.freeze({
  async stateMarkers<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    depth: number,
    before?: bigint,
  ): Promise<Record<string, unknown>[]> {
    const markers: Record<string, unknown>[] = [];
    let cursor: string | Buffer | undefined;
    while (markers.length < depth) {
      const query = codec
        .markerQuery("stateOrder", id)
        .order(stateBackward)
        .limit(Math.min(historyPageSize, depth - markers.length));
      if (before !== undefined)
        query.filter(stateBackward, ">", `${HistoryKeys.signedDescending(before)}g`);
      if (cursor !== undefined) query.start(cursor);
      const response = await codec.client.runQuery(query, { wrapNumbers: true });
      const page = DatastoreResults.entities(response);
      markers.push(...page);
      if (
        markers.length === depth ||
        DatastoreResults.queryInfo(response).moreResults === Datastore.NO_MORE_RESULTS
      )
        break;
      const next = DatastoreResults.queryInfo(response).endCursor;
      if (next === undefined)
        throw new Error("Datastore state marker query did not return a cursor.");
      cursor = next;
    }
    return markers;
  },
  async stateRows<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    markers: readonly Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const marker of markers) rows.push(await HistoryQueries.stateRow(codec, id, marker));
    return rows;
  },
  async stateRow<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    marker: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const reference = marker[stateReference];
    if (typeof reference !== "string" || !/^[0-9a-f]{16}$/.test(reference))
      throw new Error("Datastore state marker has an invalid state identity reference.");
    const row = DatastoreResults.first(
      await codec.client.get(codec.stateKey(id, HistoryKeys.signedFromAscending(reference))),
    );
    if (row === undefined)
      throw new Error("Datastore state marker references a missing state identity.");
    return row;
  },
  async eventMarkers<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    depth: number,
    before?: bigint,
  ): Promise<Record<string, unknown>[]> {
    const markers: Record<string, unknown>[] = [];
    let cursor: string | Buffer | undefined;
    while (markers.length < depth) {
      const query = codec
        .markerQuery("eventOrder", id)
        .order("__key__")
        .limit(Math.min(historyPageSize, depth - markers.length));
      if (before !== undefined)
        query.filter("__key__", ">", codec.eventOrderLowerBound(id, before));
      if (cursor !== undefined) query.start(cursor);
      const response = await codec.client.runQuery(query, { wrapNumbers: true });
      const page = DatastoreResults.entities(response);
      markers.push(...page);
      if (
        markers.length === depth ||
        DatastoreResults.queryInfo(response).moreResults === Datastore.NO_MORE_RESULTS
      )
        break;
      const next = DatastoreResults.queryInfo(response).endCursor;
      if (next === undefined)
        throw new Error("Datastore event marker query did not return a cursor.");
      cursor = next;
    }
    return markers;
  },
  async eventRows<I, S extends Message>(
    codec: EntityCodec<I, S>,
    markers: readonly Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const marker of markers) {
      const id = marker[eventId];
      if (typeof id !== "string" || id.trim().length === 0)
        throw new Error("Datastore event marker has an invalid event identity reference.");
      const row = DatastoreResults.first(await codec.client.get(codec.key("event", id)));
      if (row === undefined)
        throw new Error("Datastore event marker references a missing event identity.");
      rows.push(row);
    }
    return rows;
  },
});
interface StateTrimPlan {
  readonly revision: bigint;
  remaining: bigint;
  after: ReturnType<Datastore["key"]> | undefined;
}

const HistoryRetention = Object.freeze({
  async trimStates<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    keep: number,
  ): Promise<void> {
    const plan = await HistoryRetention.stateTrimPlan(codec, id, keep);
    if (plan === undefined) return;
    codec.requireOpen();
    while (plan.remaining > 0n) {
      const chunk = await HistoryRetention.retainStateChunk(codec, id, plan);
      plan.remaining -= BigInt(chunk.removed);
      plan.after = chunk.after;
      if (chunk.scanned === 0) return;
      codec.requireOpen();
    }
  },
  async stateTrimPlan<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    keep: number,
  ): Promise<StateTrimPlan | undefined> {
    const rootKey = codec.entityKey(id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = codec.client.transaction();
      try {
        await transaction.run();
        const root = DatastoreResults.first(await transaction.get(rootKey));
        if (root === undefined || DatastoreValues.integer(root.stateCount) <= BigInt(keep)) {
          await transaction.rollback();
          return undefined;
        }
        const marker = DatastoreResults.entities(
          await transaction.runQuery(
            codec
              .markerQuery("stateOrder", id)
              .order("__key__")
              .select(["__key__", stateRevision])
              .limit(1),
          ),
        )[0];
        if (marker === undefined)
          throw new Error("Datastore entity root has state retention without an order marker.");
        HistoryMarkers.stateRevision(marker);
        const remaining = DatastoreValues.integer(root.stateCount) - BigInt(keep);
        await transaction.rollback();
        return { revision: DatastoreValues.integer(root.revision), remaining, after: undefined };
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Datastore state trim planning retry limit was reached.");
  },
  async retainStateChunk<I, S extends Message>(
    codec: EntityCodec<I, S>,
    id: string,
    plan: StateTrimPlan,
  ): Promise<{
    readonly removed: number;
    readonly scanned: number;
    readonly after: ReturnType<Datastore["key"]> | undefined;
  }> {
    const rootKey = codec.entityKey(id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = codec.client.transaction();
      try {
        await transaction.run();
        const root = DatastoreResults.first(await transaction.get(rootKey));
        if (root === undefined) {
          await transaction.rollback();
          return { removed: 0, scanned: 0, after: plan.after };
        }
        DatastoreValues.integer(root.stateCount);
        const limit = Math.min(8, Number(plan.remaining));
        const query = codec
          .markerQuery("stateOrder", id)
          .order("__key__")
          .select(["__key__", stateRevision])
          .limit(limit);
        if (plan.after !== undefined) query.filter("__key__", ">", plan.after);
        const markers = DatastoreResults.entities(await transaction.runQuery(query));
        let removed = 0;
        for (const marker of markers) {
          const info = HistoryMarkers.state(marker, codec.client);
          if (HistoryMarkers.stateRevision(marker) > plan.revision) continue;
          const stateKey = codec.stateKey(id, info.version);
          if (DatastoreResults.first(await transaction.get(stateKey)) !== undefined) {
            transaction.delete(stateKey);
            removed += 1;
          }
          transaction.delete(DatastoreResults.keyOf(marker, codec.client));
          transaction.delete(codec.stateCutKey(id, info.version, info.time));
        }
        if (removed > 0)
          transaction.save({ key: rootKey, data: HistoryRows.nextEntityRoot(root, -removed) });
        await transaction.commit();
        const last = markers.at(-1);
        return {
          removed,
          scanned: markers.length,
          after: last === undefined ? plan.after : DatastoreResults.keyOf(last, codec.client),
        };
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Datastore state trim retry limit was reached.");
  },
  async truncate<I, S extends Message>(
    codec: EntityCodec<I, S>,
    kind: "state" | "event",
    boundary: Timestamp,
  ): Promise<void> {
    const cutKind = kind === "state" ? "stateCut" : "eventCut";
    const highQuery = codec
      .cutQuery(cutKind)
      .filter("__key__", ">", codec.cutLowerBound(cutKind))
      .filter("__key__", "<", codec.cutTimeBound(cutKind, boundary))
      .order("__key__", { descending: true })
      .select("__key__")
      .limit(1);
    const high = DatastoreResults.entities(await codec.client.runQuery(highQuery))[0];
    if (high === undefined) return;
    const highKey = DatastoreResults.keyOf(high, codec.client);
    let after = codec.cutLowerBound(cutKind);
    for (;;) {
      const query = codec
        .cutQuery(cutKind)
        .filter("__key__", ">", after)
        .filter("__key__", "<=", highKey)
        .order("__key__")
        .select("__key__")
        .limit(8);
      const cuts = DatastoreResults.entities(await codec.client.runQuery(query));
      if (cuts.length === 0) return;
      await HistoryRetention.truncateChunk(codec, kind, cuts);
      const last = cuts.at(-1);
      if (last === undefined) return;
      after = DatastoreResults.keyOf(last, codec.client);
      codec.requireOpen();
    }
  },
  async truncateChunk<I, S extends Message>(
    codec: EntityCodec<I, S>,
    kind: "state" | "event",
    cuts: readonly Record<string, unknown>[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = codec.client.transaction();
      try {
        await transaction.run();
        const roots = new Map<
          string,
          { key: ReturnType<Datastore["key"]>; row: Record<string, unknown>; states: number }
        >();
        for (const cut of cuts) {
          const info = HistoryMarkers.cut(cut, codec.client, kind);
          const event = kind === "event" ? HistoryMarkers.eventId(info) : "";
          const identity =
            kind === "state" ? codec.stateKey(info.id, info.version) : codec.key("event", event);
          const row = DatastoreResults.first(await transaction.get(identity));
          transaction.delete(identity);
          transaction.delete(
            kind === "state"
              ? codec.stateOrderKey(info.id, info.version, info.time)
              : codec.eventOrderKey(info.id, info.version, info.time, event),
          );
          transaction.delete(DatastoreResults.keyOf(cut, codec.client));
          if (row === undefined) continue;
          const rootKey = codec.entityKey(info.id);
          const current = roots.get(info.id) ?? {
            key: rootKey,
            row: HistoryRows.entityRoot(
              DatastoreResults.first(await transaction.get(rootKey)),
              codec.scope,
              info.id,
            ),
            states: 0,
          };
          current.states += kind === "state" ? 1 : 0;
          roots.set(info.id, current);
        }
        for (const root of roots.values())
          transaction.save({
            key: root.key,
            data: HistoryRows.nextEntityRoot(root.row, -root.states),
          });
        await transaction.commit();
        return;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("Datastore history truncate retry limit was reached.");
  },
});
const HistoryMarkers = Object.freeze({
  state(value: Record<string, unknown>, client: Datastore): { version: bigint; time: Timestamp } {
    const name = DatastoreResults.keyOf(value, client).path.at(-1);
    if (typeof name !== "string") throw new Error("Datastore state marker has an invalid key.");
    const [versionToken, secondsToken, nanosToken] = name.split(".");
    if (versionToken === undefined || secondsToken === undefined || nanosToken === undefined)
      throw new Error("Datastore state marker has an invalid key.");
    return {
      version: HistoryKeys.signedFromAscending(versionToken),
      time: {
        seconds: HistoryKeys.signedFromAscending(secondsToken),
        nanos: Number.parseInt(nanosToken, 16),
      } as Timestamp,
    };
  },
  stateRevision(value: Record<string, unknown>): bigint {
    if (value[stateRevision] === undefined)
      throw new Error("Datastore state marker has no causal revision.");
    return DatastoreValues.integer(value[stateRevision]);
  },
  cut(
    value: Record<string, unknown>,
    client: Datastore,
    kind: "state" | "event",
  ): { id: string; version: bigint; time: Timestamp; event?: string } {
    const name = DatastoreResults.keyOf(value, client).path.at(-1);
    if (typeof name !== "string")
      throw new Error("Datastore history cut marker has an invalid key.");
    const [, secondsToken, nanosToken, idToken, versionToken, eventToken] = name.split(".");
    if (
      secondsToken === undefined ||
      nanosToken === undefined ||
      idToken === undefined ||
      versionToken === undefined
    )
      throw new Error("Datastore history cut marker has an invalid key.");
    const event =
      eventToken === undefined ? undefined : Buffer.from(eventToken, "hex").toString("utf8");
    if (kind === "event" && event === undefined)
      throw new Error("Datastore event cut marker has an invalid key.");
    return {
      id: Buffer.from(idToken, "hex").toString("utf8"),
      version: HistoryKeys.signedFromAscending(versionToken),
      time: {
        seconds: HistoryKeys.signedFromAscending(secondsToken),
        nanos: Number.parseInt(nanosToken, 16),
      } as Timestamp,
      ...(event === undefined ? {} : { event }),
    };
  },
  eventId(value: { readonly event?: string }): string {
    if (value.event === undefined)
      throw new Error("Datastore event cut marker has an invalid key.");
    return value.event;
  },
});
class OperationGate {
  #open = true;
  #tail: Promise<void> = Promise.resolve();

  isOpen(): boolean {
    return this.#open;
  }
  close(): void {
    this.#open = false;
  }
  requireOpen(): void {
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(async () => {
      this.requireOpen();
      return operation();
    });
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
