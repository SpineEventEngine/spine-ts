import { clone, toBinary, type Message } from "@bufbuild/protobuf";
import { EventSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { eventStoreRecordSpec } from "../event/event-store.js";
import type { EntityRecord } from "../entity/entity-record.js";
import type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
} from "../internal/entity-commit.js";
import { StorageScopes } from "../storage/canonical-scope.js";
import type { EntityStorageInput } from "./in-memory-entity-history.js";
import {
  InMemoryEntityStorage,
  MemoryEntityStorageFactory,
  type EntityBackend,
} from "./in-memory-entity-history.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { TenantRecords } from "./tenant-records.js";
import type { Event, EventId } from "@spine-event-engine/proto";

const commitHost = globalThis as typeof globalThis & {
  structuredClone<Value>(value: Value): Value;
};

/**
 * Implements provider-owned Entity commits for one shared in-memory backend.
 */
export class MemoryEntityCommitStorage implements EntityCommitStorage {
  readonly #backend: InMemoryStorageBackend;
  readonly #entities: MemoryEntityStorageFactory;
  readonly #events: TenantRecords<EventId, Event>;
  readonly #input: EntityStorageInput<unknown, Message>;
  #open = true;

  /**
   * Creates a commit handle bound to one Entity source type.
   *
   * @param backend Selects the shared in-memory backend.
   * @param entities Opens the matching Entity storage maps.
   * @param events Supplies the matching framework EventStore records.
   * @param input Defines the Entity storage source type.
   */
  constructor(
    backend: InMemoryStorageBackend,
    entities: MemoryEntityStorageFactory,
    events: TenantRecords<EventId, Event>,
    input: EntityStorageInput<unknown, Message>,
  ) {
    this.#backend = backend;
    this.#entities = entities;
    this.#events = events;
    this.#input = input;
  }

  /**
   * Applies one fully preflighted in-memory Entity commit.
   *
   * @param input Defines the current record, retained histories, and delivery events.
   * @returns The durable in-memory commit outcome.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    this.#requireOpen();
    this.#requireCompatible(input);
    return InMemoryCommitLocks.run(this.#backend, this.#scope(input), () => this.#commit(input));
  }

  /**
   * Closes this commit handle without closing sibling handles.
   */
  close(): void {
    this.#open = false;
  }

  async #commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    const receipts = InMemoryStorageBackend.bind(
      this.#backend,
      "entity",
      `${this.#scope(input)}:receipts`,
      () => new Map<string, string>(),
    );
    const digest = InMemoryCommitValues.digest(input);
    const receiptKey = `${input.id}\u0000${input.entity.id.key(input.entityId)}`;
    const prior = receipts.get(receiptKey);
    if (prior !== undefined) {
      if (prior !== digest) throw new Error("Entity commit ID was reused with different content.");
      return "replayed";
    }

    const live = this.#entities.backend(input.entity);
    const stagedBackend: EntityBackend = {
      current: commitHost.structuredClone(live.current),
      events: commitHost.structuredClone(live.events),
      states: commitHost.structuredClone(live.states),
      stateQueue: live.stateQueue,
    };
    const entity = new InMemoryEntityStorage(input.entity, stagedBackend);
    const stagedEvents = new TenantRecords<EventId, Event>();
    stagedEvents.replace(this.#events.snapshot());
    try {
      const current = await entity.current.read(input.entityId);
      if (!InMemoryCommitValues.sameCurrent(current, input.expected)) {
        return "conflict";
      }
      const delivery = [...(input.events ?? [])].map((event) =>
        clone(eventStoreRecordSpec.recordType, event),
      );
      const materialized = delivery.map((event) => eventStoreRecordSpec.materialize(event));
      const ids = materialized.map((record) => record.id);
      if (
        new Set(ids.map((id) => id.value)).size !== ids.length ||
        ids.some((id) => stagedEvents.read(id) !== undefined)
      ) {
        throw new Error("Entity commit requires unique delivery-event IDs.");
      }

      await entity.current.write(input.next);
      for (const state of input.states ?? []) await entity.states.append(state);
      for (const diagnostic of input.diagnostics ?? []) await entity.events.append(diagnostic);
      stagedEvents.writeAll(materialized);
      InMemoryCommitValues.replace(live.current, stagedBackend.current);
      InMemoryCommitValues.replace(live.states, stagedBackend.states);
      InMemoryCommitValues.replace(live.events, stagedBackend.events);
      this.#events.replace(stagedEvents.snapshot());
      receipts.set(receiptKey, digest);
      return "committed";
    } finally {
      entity.close();
    }
  }

  #scope<I, S extends Message>(input: EntityCommitInput<I, S>): string {
    return StorageScopes.canonical(input.context, `${input.entity.sourceType.typeName}:commit`);
  }

  #requireCompatible<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (
      this.#scope(input) !==
      StorageScopes.canonical(this.#input.context, `${this.#input.sourceType.typeName}:commit`)
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  #requireOpen(): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
  }
}

const InMemoryCommitLocks = Object.freeze({
  queues: new WeakMap<InMemoryStorageBackend, Map<string, Promise<void>>>(),

  async run<T>(backend: InMemoryStorageBackend, scope: string, work: () => Promise<T>): Promise<T> {
    const queues = this.queues.get(backend) ?? new Map<string, Promise<void>>();
    this.queues.set(backend, queues);
    const prior = queues.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    queues.set(scope, tail);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (queues.get(scope) === tail) queues.delete(scope);
    }
  },
});

const InMemoryCommitValues = Object.freeze({
  digest<I, S extends Message>(input: EntityCommitInput<I, S>): string {
    return JSON.stringify({
      context: input.context,
      id: input.id,
      entityId: input.entity.id.key(input.entityId),
      expected: InMemoryCommitValues.record(input.expected),
      next: InMemoryCommitValues.record(input.next),
      states: (input.states ?? []).map((state) => ({
        entityId: input.entity.id.key(state.entityId),
        state: InMemoryCommitValues.hex(toBinary(input.entity.stateSchema, state.state)),
        version: state.version.toString(),
        createdAt: InMemoryCommitValues.time(state.createdAt),
      })),
      diagnostics: (input.diagnostics ?? []).map((event) => ({
        entityId: input.entity.id.key(event.entityId),
        event: InMemoryCommitValues.hex(toBinary(EventSchema, event.event)),
        producerVersion: event.producerVersion.toString(),
        createdAt: InMemoryCommitValues.time(event.createdAt),
      })),
      events: (input.events ?? []).map((event) =>
        InMemoryCommitValues.hex(toBinary(EventSchema, event)),
      ),
    });
  },

  record(record: EntityRecord | undefined): string | undefined {
    return record === undefined
      ? undefined
      : InMemoryCommitValues.hex(toBinary(EntityRecordSchema, record));
  },

  time(value: { readonly seconds: bigint; readonly nanos: number }): readonly [string, number] {
    return [value.seconds.toString(), value.nanos];
  },

  sameCurrent(actual: EntityRecord | undefined, expected: EntityRecord | undefined): boolean {
    if (actual === undefined || expected === undefined) return actual === expected;
    return InMemoryCommitValues.equal(
      toBinary(EntityRecordSchema, actual),
      toBinary(EntityRecordSchema, expected),
    );
  },

  hex(bytes: Uint8Array): string {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  },

  equal(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  },

  replace<K, V>(target: Map<K, V>, source: Map<K, V>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  },
});
