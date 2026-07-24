import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import type {
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

/** Datastore implementation bundle for the provider-only entity-history SPI. */
export class DatastoreEntityStorage<I, S extends Message> {
  readonly current: EntityRecordStorage<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly #codec: EntityCodec<I, S>;

  constructor(input: EntityStorageInput<I, S>, client: Datastore) {
    const codec = new EntityCodec(input, client, new OperationGate());
    this.#codec = codec;
    this.current = new CurrentStorage(codec);
    this.events = new EventHistory(codec);
    this.states = new StateHistory(codec);
  }

  close(): void {
    this.#codec.close();
  }

  isOpen(): boolean {
    return this.#codec.isOpen();
  }
}

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
    boundedText(input.layout, "layout");
    boundedText(input.id.fingerprint, "ID codec fingerprint");
    const tenant = input.context.multitenant
      ? `tenant:${requiredTenant(input.context.name, input.context.tenantId)}`
      : "single-tenant";
    this.scope = tuple(input.context.name, tenant, input.storageKey);
    this.#gate = gate;
    this.#fingerprint = JSON.stringify({
      columns: input.columns.map((column) => [column.name, column.valueType]),
      layout: input.layout,
      id: input.id.fingerprint,
      state: input.stateSchema.typeName,
    });
    boundedText(this.#fingerprint, "durable fingerprint");
  }
  key(kind: "metadata" | "current" | "event", id: string): ReturnType<Datastore["key"]> {
    const fixedKind = fixedKinds[kind];
    if (kind === "metadata") return this.namedKey(fixedKind, hex(this.scope));
    if (kind === "event") return this.namedKey(fixedKind, hex(tuple(this.scope, id)));
    return this.childKey(id, fixedKind, "current");
  }
  entityKey(id: string): ReturnType<Datastore["key"]> {
    return this.namedKey(fixedKinds.entity, hex(tuple(this.scope, id)));
  }
  childKey(id: string, kind: string, name: string): ReturnType<Datastore["key"]> {
    return this.keyForPath([fixedKinds.entity, hex(tuple(this.scope, id)), kind, name]);
  }
  stateKey(id: string, itemVersion: bigint): ReturnType<Datastore["key"]> {
    return this.childKey(id, fixedKinds.state, signedAscending(itemVersion));
  }
  stateOrderKey(id: string, itemVersion: bigint, time: Timestamp): ReturnType<Datastore["key"]> {
    return this.childKey(
      id,
      fixedKinds.stateOrder,
      `${signedAscending(itemVersion)}.${timeAscending(time)}`,
    );
  }
  stateCutKey(id: string, itemVersion: bigint, time: Timestamp): ReturnType<Datastore["key"]> {
    return this.namedKey(
      fixedKinds.stateCut,
      `${hex(this.scope)}.${timeAscending(time)}.${hex(id)}.${signedAscending(itemVersion)}`,
    );
  }
  eventOrderKey(
    id: string,
    itemVersion: bigint,
    time: Timestamp,
    event: string,
  ): ReturnType<Datastore["key"]> {
    return this.childKey(
      id,
      fixedKinds.eventOrder,
      `${signedDescending(itemVersion)}.${timeDescending(time)}.${descendingHex(event)}`,
    );
  }
  eventOrderLowerBound(id: string, itemVersion: bigint): ReturnType<Datastore["key"]> {
    return this.childKey(id, fixedKinds.eventOrder, `${signedDescending(itemVersion)}g`);
  }
  eventCutKey(
    id: string,
    itemVersion: bigint,
    time: Timestamp,
    event: string,
  ): ReturnType<Datastore["key"]> {
    return this.namedKey(
      fixedKinds.eventCut,
      `${hex(this.scope)}.${timeAscending(time)}.${hex(id)}.${signedAscending(itemVersion)}.${hex(event)}`,
    );
  }
  markerQuery(kind: "stateOrder" | "eventOrder", id: string): ReturnType<Datastore["createQuery"]> {
    const fixedKind = fixedKinds[kind];
    const query = this.input.context.multitenant
      ? this.client.createQuery(
          requiredTenant(this.input.context.name, this.input.context.tenantId),
          fixedKind,
        )
      : this.client.createQuery(fixedKind);
    return query.hasAncestor(this.entityKey(id));
  }
  cutQuery(kind: "stateCut" | "eventCut"): ReturnType<Datastore["createQuery"]> {
    const fixedKind = fixedKinds[kind];
    return this.input.context.multitenant
      ? this.client.createQuery(
          requiredTenant(this.input.context.name, this.input.context.tenantId),
          fixedKind,
        )
      : this.client.createQuery(fixedKind);
  }
  currentQuery(): ReturnType<Datastore["createQuery"]> {
    const kind = fixedKinds.current;
    return this.input.context.multitenant
      ? this.client.createQuery(
          requiredTenant(this.input.context.name, this.input.context.tenantId),
          kind,
        )
      : this.client.createQuery(kind);
  }
  cutLowerBound(kind: "stateCut" | "eventCut"): ReturnType<Datastore["key"]> {
    return this.namedKey(fixedKinds[kind], hex(this.scope));
  }
  cutTimeBound(kind: "stateCut" | "eventCut", time: Timestamp): ReturnType<Datastore["key"]> {
    return this.namedKey(fixedKinds[kind], `${hex(this.scope)}.${timeAscending(time)}.`);
  }
  id(id: I): string {
    return indexedToken(this.input.id.key(id));
  }
  cloneId(id: I): I {
    return this.input.id.clone(id);
  }
  state(value: S): Uint8Array {
    return toBinary(this.input.stateSchema, value);
  }
  decodeState(value: unknown): S {
    return fromBinary(this.input.stateSchema, bytes(value));
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
        const existing = first(await transaction.get(key));
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
        const reopened = first(await this.client.get(key));
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
        ? { namespace: requiredTenant(this.input.context.name, this.input.context.tenantId) }
        : {}),
    });
  }
}

class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I, S> {
  constructor(private readonly codec: EntityCodec<I, S>) {}
  async read(id: I): Promise<EntityRecord<I, S> | undefined> {
    const key = this.codec.key("current", this.codec.id(id));
    return this.codec.run(async () => {
      const row = first(
        await this.codec.client.get(key, {
          wrapNumbers: true,
        }),
      );
      if (row === undefined) return undefined;
      return Object.freeze({
        id: this.codec.cloneId(id),
        state: Object.freeze(this.codec.decodeState(row[payload])),
        version: integer(row[version]),
        archived: row[archived] === true,
        deleted: row[deleted] === true,
      });
    });
  }
  async write(record: EntityRecord<I, S>): Promise<void> {
    providerInteger(record.version);
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
          [version]: providerInteger(record.version),
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
      const rows = entities(await this.codec.client.runQuery(query, { wrapNumbers: true }));
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
              version: integer(row[version]),
              archived: row[archived] === true,
              deleted: row[deleted] === true,
            }),
            columns: new Map<string, unknown>([
              ...this.codec.input.columns.map(
                (column) => [column.name, column.valueIn(state)] as const,
              ),
              ["version", integer(row[version])],
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
    const data = row(
      "state",
      record.entityId,
      this.codec,
      record.version,
      record.createdAt,
      this.codec.state(record.state),
    );
    await this.codec.run(() =>
      appendState(this.codec, id, key, orderKey, cutKey, record.version, record.createdAt, data),
    );
  }
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]> {
    requireDepth(depth);
    if (startingFromVersion !== undefined) providerInteger(startingFromVersion);
    const id = this.codec.id(entityId);
    return this.codec.run(async () => {
      const markers = await stateMarkers(this.codec, id, depth, startingFromVersion);
      const rows = await stateRows(this.codec, id, markers);
      return Object.freeze(
        rows.map((value) =>
          Object.freeze({
            entityId: this.codec.cloneId(entityId),
            state: Object.freeze(this.codec.decodeState(value[payload])),
            version: integer(value[version]),
            createdAt: Object.freeze(
              create(TimestampSchema, {
                seconds: integer(value[createdSeconds]),
                nanos: Number(integer(value[createdNanos])),
              }),
            ),
          }),
        ),
      );
    });
  }
  async stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    validateTimestamp(time);
    const id = this.codec.id(entityId);
    return this.codec.run(async () => {
      const query = this.codec
        .markerQuery("stateOrder", id)
        .filter(stateAt, ">=", timeDescending(time))
        .order(stateAt)
        .limit(1);
      const marker = entities(await this.codec.client.runQuery(query, { wrapNumbers: true }))[0];
      if (marker === undefined) return undefined;
      const row = await stateRow(this.codec, id, marker);
      return Object.freeze(this.codec.decodeState(row[payload]));
    });
  }
  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    if (!Number.isSafeInteger(keepMostRecent) || keepMostRecent < 0)
      throw new Error("State-history trim count must be a non-negative safe integer.");
    const id = this.codec.id(entityId);
    await this.codec.run(() => trimStates(this.codec, id, keepMostRecent));
  }
  async truncate(olderThan: Timestamp): Promise<void> {
    validateTimestamp(olderThan);
    await this.codec.run(() => truncateHistory(this.codec, "state", olderThan));
  }
}

class EventHistory<I, S extends Message> implements EntityEventHistoryPort<I> {
  constructor(private readonly codec: EntityCodec<I, S>) {}
  async append(record: EntityEventHistoryRecord<I>): Promise<void> {
    providerInteger(record.producerVersion);
    validateTimestamp(record.createdAt);
    const id = record.event.id?.value;
    if (id === undefined || id.trim().length === 0)
      throw new Error("Event history requires an event ID.");
    const entityId = this.codec.id(record.entityId);
    indexedToken(id);
    const key = this.codec.key("event", id);
    const orderKey = this.codec.eventOrderKey(
      entityId,
      record.producerVersion,
      record.createdAt,
      id,
    );
    const cutKey = this.codec.eventCutKey(entityId, record.producerVersion, record.createdAt, id);
    const data = {
      ...row(
        "event",
        record.entityId,
        this.codec,
        record.producerVersion,
        record.createdAt,
        toBinary(EventSchema, record.event),
      ),
      [eventId]: id,
    };
    await this.codec.run(() => appendEvent(this.codec, entityId, key, orderKey, cutKey, data));
  }
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly Event[]> {
    requireDepth(depth);
    if (startingFromVersion !== undefined) providerInteger(startingFromVersion);
    const id = this.codec.id(entityId);
    const rows = await this.codec.run(async () => {
      const markers = await eventMarkers(this.codec, id, depth, startingFromVersion);
      return eventRows(this.codec, markers);
    });
    return Object.freeze(
      rows.map((value) =>
        Object.freeze(clone(EventSchema, fromBinary(EventSchema, bytes(value[payload])))),
      ),
    );
  }
  async truncate(olderThan: Timestamp): Promise<void> {
    validateTimestamp(olderThan);
    await this.codec.run(() => truncateHistory(this.codec, "event", olderThan));
  }
}

async function appendState<I, S extends Message>(
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
      const root = first(await transaction.get(rootKey));
      const existing = first(await transaction.get(key));
      if (existing !== undefined) {
        if (!same(existing, data)) throw new Error("State-history retry has divergent content.");
        await transaction.rollback();
        return;
      }
      const current = entityRoot(root, codec.scope, id);
      const next = nextEntityRoot(current, 1);
      if (root === undefined) transaction.insert({ key: rootKey, data: next });
      else transaction.save({ key: rootKey, data: next });
      transaction.insert({ key, data, excludeFromIndexes: [payload] });
      transaction.insert({
        key: orderKey,
        data: {
          [stateBackward]: stateOrderToken(itemVersion, time, true),
          [stateAt]: stateOrderToken(itemVersion, time, false),
          [stateReference]: signedAscending(itemVersion),
          [stateRevision]: providerInteger(integer(next.revision)),
        },
      });
      transaction.insert({
        key: cutKey,
        data: { [createdSeconds]: providerInteger(time.seconds), [createdNanos]: time.nanos },
      });
      await transaction.commit();
      return;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
      const durable = first(await codec.client.get(key));
      if (durable !== undefined && same(durable, data)) return;
      throw error;
    }
  }
  throw new Error("Datastore entity state append retry limit was reached.");
}

async function appendEvent<I, S extends Message>(
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
      const existing = first(await transaction.get(key));
      const root = first(await transaction.get(rootKey));
      if (existing !== undefined) {
        if (!same(existing, data)) throw new Error("Event-history retry has divergent content.");
        await transaction.rollback();
        return;
      }
      const current = entityRoot(root, codec.scope, id);
      const next = nextEntityRoot(current, 0);
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
      const durable = first(await codec.client.get(key));
      if (durable !== undefined && same(durable, data)) return;
      throw error;
    }
  }
  throw new Error("Datastore entity event append retry limit was reached.");
}

function entityRoot(
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
  integer(value.stateCount);
  integer(value.revision);
  return value;
}
function nextEntityRoot(value: Record<string, unknown>, states: number): Record<string, unknown> {
  return {
    ...value,
    stateCount: providerInteger(integer(value.stateCount) + BigInt(states)),
    revision: providerInteger(integer(value.revision) + 1n),
  };
}

function row<I, S extends Message>(
  kind: "state" | "event",
  id: I,
  codec: EntityCodec<I, S>,
  itemVersion: bigint,
  time: Timestamp,
  content: Uint8Array,
): Record<string, unknown> {
  validateTimestamp(time);
  return {
    [historyKind]: kind,
    [entity]: codec.id(id),
    [version]: providerInteger(itemVersion),
    [createdSeconds]: providerInteger(time.seconds),
    [createdNanos]: time.nanos,
    [payload]: Buffer.from(content),
  };
}
async function stateMarkers<I, S extends Message>(
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
    if (before !== undefined) query.filter(stateBackward, ">", `${signedDescending(before)}g`);
    if (cursor !== undefined) query.start(cursor);
    const response = await codec.client.runQuery(query, { wrapNumbers: true });
    const page = entities(response);
    markers.push(...page);
    if (markers.length === depth || queryInfo(response).moreResults === Datastore.NO_MORE_RESULTS)
      break;
    const next = queryInfo(response).endCursor;
    if (next === undefined)
      throw new Error("Datastore state marker query did not return a cursor.");
    cursor = next;
  }
  return markers;
}
async function stateRows<I, S extends Message>(
  codec: EntityCodec<I, S>,
  id: string,
  markers: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const marker of markers) rows.push(await stateRow(codec, id, marker));
  return rows;
}
async function stateRow<I, S extends Message>(
  codec: EntityCodec<I, S>,
  id: string,
  marker: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const reference = marker[stateReference];
  if (typeof reference !== "string" || !/^[0-9a-f]{16}$/.test(reference))
    throw new Error("Datastore state marker has an invalid state identity reference.");
  const row = first(await codec.client.get(codec.stateKey(id, signedFromAscending(reference))));
  if (row === undefined)
    throw new Error("Datastore state marker references a missing state identity.");
  return row;
}
async function eventMarkers<I, S extends Message>(
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
    if (before !== undefined) query.filter("__key__", ">", codec.eventOrderLowerBound(id, before));
    if (cursor !== undefined) query.start(cursor);
    const response = await codec.client.runQuery(query, { wrapNumbers: true });
    const page = entities(response);
    markers.push(...page);
    if (markers.length === depth || queryInfo(response).moreResults === Datastore.NO_MORE_RESULTS)
      break;
    const next = queryInfo(response).endCursor;
    if (next === undefined)
      throw new Error("Datastore event marker query did not return a cursor.");
    cursor = next;
  }
  return markers;
}
async function eventRows<I, S extends Message>(
  codec: EntityCodec<I, S>,
  markers: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const marker of markers) {
    const id = marker[eventId];
    if (typeof id !== "string" || id.trim().length === 0)
      throw new Error("Datastore event marker has an invalid event identity reference.");
    const row = first(await codec.client.get(codec.key("event", id)));
    if (row === undefined)
      throw new Error("Datastore event marker references a missing event identity.");
    rows.push(row);
  }
  return rows;
}
async function trimStates<I, S extends Message>(
  codec: EntityCodec<I, S>,
  id: string,
  keep: number,
): Promise<void> {
  const plan = await stateTrimPlan(codec, id, keep);
  if (plan === undefined) return;
  codec.requireOpen();
  while (plan.remaining > 0n) {
    const chunk = await retainStateChunk(codec, id, plan);
    plan.remaining -= BigInt(chunk.removed);
    plan.after = chunk.after;
    if (chunk.scanned === 0) return;
    codec.requireOpen();
  }
}
interface StateTrimPlan {
  readonly revision: bigint;
  remaining: bigint;
  after: ReturnType<Datastore["key"]> | undefined;
}
async function stateTrimPlan<I, S extends Message>(
  codec: EntityCodec<I, S>,
  id: string,
  keep: number,
): Promise<StateTrimPlan | undefined> {
  const rootKey = codec.entityKey(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = codec.client.transaction();
    try {
      await transaction.run();
      const root = first(await transaction.get(rootKey));
      if (root === undefined || integer(root.stateCount) <= BigInt(keep)) {
        await transaction.rollback();
        return undefined;
      }
      const marker = entities(
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
      stateMarkerRevision(marker);
      const remaining = integer(root.stateCount) - BigInt(keep);
      await transaction.rollback();
      return { revision: integer(root.revision), remaining, after: undefined };
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Datastore state trim planning retry limit was reached.");
}
async function retainStateChunk<I, S extends Message>(
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
      const root = first(await transaction.get(rootKey));
      if (root === undefined) {
        await transaction.rollback();
        return { removed: 0, scanned: 0, after: plan.after };
      }
      integer(root.stateCount);
      const limit = Math.min(8, Number(plan.remaining));
      const query = codec
        .markerQuery("stateOrder", id)
        .order("__key__")
        .select(["__key__", stateRevision])
        .limit(limit);
      if (plan.after !== undefined) query.filter("__key__", ">", plan.after);
      const markers = entities(await transaction.runQuery(query));
      let removed = 0;
      for (const marker of markers) {
        const info = stateMarker(marker, codec.client);
        if (stateMarkerRevision(marker) > plan.revision) continue;
        const stateKey = codec.stateKey(id, info.version);
        if (first(await transaction.get(stateKey)) !== undefined) {
          transaction.delete(stateKey);
          removed += 1;
        }
        transaction.delete(keyOf(marker, codec.client));
        transaction.delete(codec.stateCutKey(id, info.version, info.time));
      }
      if (removed > 0) transaction.save({ key: rootKey, data: nextEntityRoot(root, -removed) });
      await transaction.commit();
      const last = markers.at(-1);
      return {
        removed,
        scanned: markers.length,
        after: last === undefined ? plan.after : keyOf(last, codec.client),
      };
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Datastore state trim retry limit was reached.");
}
async function truncateHistory<I, S extends Message>(
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
  const high = entities(await codec.client.runQuery(highQuery))[0];
  if (high === undefined) return;
  const highKey = keyOf(high, codec.client);
  let after = codec.cutLowerBound(cutKind);
  for (;;) {
    const query = codec
      .cutQuery(cutKind)
      .filter("__key__", ">", after)
      .filter("__key__", "<=", highKey)
      .order("__key__")
      .select("__key__")
      .limit(8);
    const cuts = entities(await codec.client.runQuery(query));
    if (cuts.length === 0) return;
    await truncateChunk(codec, kind, cuts);
    const last = cuts.at(-1);
    if (last === undefined) return;
    after = keyOf(last, codec.client);
    codec.requireOpen();
  }
}
async function truncateChunk<I, S extends Message>(
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
        const info = cutMarker(cut, codec.client, kind);
        const event = kind === "event" ? eventCutId(info) : "";
        const identity =
          kind === "state" ? codec.stateKey(info.id, info.version) : codec.key("event", event);
        const row = first(await transaction.get(identity));
        transaction.delete(identity);
        transaction.delete(
          kind === "state"
            ? codec.stateOrderKey(info.id, info.version, info.time)
            : codec.eventOrderKey(info.id, info.version, info.time, event),
        );
        transaction.delete(keyOf(cut, codec.client));
        if (row === undefined) continue;
        const rootKey = codec.entityKey(info.id);
        const current = roots.get(info.id) ?? {
          key: rootKey,
          row: entityRoot(first(await transaction.get(rootKey)), codec.scope, info.id),
          states: 0,
        };
        current.states += kind === "state" ? 1 : 0;
        roots.set(info.id, current);
      }
      for (const root of roots.values())
        transaction.save({ key: root.key, data: nextEntityRoot(root.row, -root.states) });
      await transaction.commit();
      return;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if ((error as { code?: unknown }).code === 10 && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Datastore history truncate retry limit was reached.");
}
function stateMarker(
  value: Record<string, unknown>,
  client: Datastore,
): { version: bigint; time: Timestamp } {
  const name = keyOf(value, client).path.at(-1);
  if (typeof name !== "string") throw new Error("Datastore state marker has an invalid key.");
  const [versionToken, secondsToken, nanosToken] = name.split(".");
  if (versionToken === undefined || secondsToken === undefined || nanosToken === undefined)
    throw new Error("Datastore state marker has an invalid key.");
  return {
    version: signedFromAscending(versionToken),
    time: {
      seconds: signedFromAscending(secondsToken),
      nanos: Number.parseInt(nanosToken, 16),
    } as Timestamp,
  };
}
function stateMarkerRevision(value: Record<string, unknown>): bigint {
  if (value[stateRevision] === undefined)
    throw new Error("Datastore state marker has no causal revision.");
  return integer(value[stateRevision]);
}
function cutMarker(
  value: Record<string, unknown>,
  client: Datastore,
  kind: "state" | "event",
): { id: string; version: bigint; time: Timestamp; event?: string } {
  const name = keyOf(value, client).path.at(-1);
  if (typeof name !== "string") throw new Error("Datastore history cut marker has an invalid key.");
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
    version: signedFromAscending(versionToken),
    time: {
      seconds: signedFromAscending(secondsToken),
      nanos: Number.parseInt(nanosToken, 16),
    } as Timestamp,
    ...(event === undefined ? {} : { event }),
  };
}
function eventCutId(value: { readonly event?: string }): string {
  if (value.event === undefined) throw new Error("Datastore event cut marker has an invalid key.");
  return value.event;
}
function keyOf(value: Record<string, unknown>, client: Datastore): ReturnType<Datastore["key"]> {
  const key = (value as unknown as Record<symbol, unknown>)[client.KEY];
  if (key === undefined) throw new Error("Datastore marker query did not return a key.");
  return key as ReturnType<Datastore["key"]>;
}
function first(result: unknown): Record<string, unknown> | undefined {
  const value = Array.isArray(result) ? (result as readonly unknown[])[0] : undefined;
  return value === undefined ? undefined : (value as Record<string, unknown>);
}
function entities(result: unknown): Record<string, unknown>[] {
  const value = Array.isArray(result) ? (result as readonly unknown[])[0] : [];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
function queryInfo(result: unknown): { endCursor?: string | Buffer; moreResults?: string } {
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
}
function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("Datastore entity cannot be decoded.");
  return value;
}
function providerInteger(value: bigint): unknown {
  if (value < minimumInt64 || value > maximumInt64)
    throw new Error("Datastore entity history requires an exact signed 64-bit integer.");
  return Datastore.int(value.toString());
}
function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "object" && value !== null && Datastore.isInt(value))
    return BigInt(value.value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error("Datastore entity has an invalid bigint history value.");
}
function same(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}
function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array)
    return Buffer.from(left).equals(Buffer.from(right));
  if (isInteger(left) && isInteger(right)) return integer(left) === integer(right);
  return left === right;
}
function isInteger(value: unknown): boolean {
  return (
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "object" && value !== null && Datastore.isInt(value))
  );
}
function requireDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth <= 0)
    throw new Error("History depth must be a positive safe integer.");
}
function requiredTenant(name: string, tenant: string | undefined): string {
  if (tenant === undefined || tenant.trim().length === 0)
    throw new Error(`Multitenant storage "${name}" requires context.tenantId.`);
  return tenant;
}
function validateTimestamp(value: Timestamp): void {
  providerInteger(value.seconds);
  if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999_999_999)
    throw new Error("Datastore entity history requires a valid timestamp.");
}
function tuple(...values: readonly string[]): string {
  return values.map((value) => `${String(Buffer.byteLength(value, "utf8"))}:${value}`).join(":");
}
function hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}
function indexedToken(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 1_500)
    throw new Error(
      "Datastore entity history indexed token exceeds the 1,500-byte provider limit.",
    );
  return value;
}
function boundedText(value: string, label: string): void {
  if (Buffer.byteLength(value, "utf8") > 1_500)
    throw new Error(`Datastore entity history ${label} exceeds the 1,500-byte provider limit.`);
}
function signedAscending(value: bigint): string {
  providerInteger(value);
  return (value + (1n << 63n)).toString(16).padStart(16, "0");
}
function signedDescending(value: bigint): string {
  return complementHex(signedAscending(value));
}
function signedFromAscending(value: string): bigint {
  return BigInt(`0x${value}`) - (1n << 63n);
}
function timeAscending(value: Timestamp): string {
  validateTimestamp(value);
  return `${signedAscending(value.seconds)}.${value.nanos.toString(16).padStart(8, "0")}`;
}
function timeDescending(value: Timestamp): string {
  return complementHex(timeAscending(value).replace(".", ""));
}
function descendingHex(value: string): string {
  return `${complementHex(hex(indexedToken(value)))}g`;
}
function stateOrderToken(version: bigint, time: Timestamp, backward: boolean): string {
  const stateKey = signedAscending(version);
  return backward
    ? `${signedDescending(version)}.${timeDescending(time)}.${descendingHex(stateKey)}`
    : `${timeDescending(time)}.${signedDescending(version)}.${descendingHex(stateKey)}`;
}
function complementHex(value: string): string {
  return value.replace(/[0-9a-f]/g, (digit) => (15 - Number.parseInt(digit, 16)).toString(16));
}

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
