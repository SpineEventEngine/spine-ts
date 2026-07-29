import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import type { Message } from "@bufbuild/protobuf";

import type { EntityEventHistoryPort, EntityStateHistoryPort } from "./entity-history-storage.js";
import type { EntityRecordStorage } from "./entity-record.js";
import type { EntityStorageInput } from "../memory/in-memory-entity-history.js";
import { RecordColumn } from "../record/record-column.js";

/** Adapter-neutral bundle used by storage adapters to run entity-history conformance. */
export interface EntityStorageConformance<I, S extends Message> {
  /** Provides latest-state record storage. */
  readonly current: EntityRecordStorage<I, S>;
  /** Provides retained entity event history. */
  readonly events: EntityEventHistoryPort<I>;
  /** Provides retained entity state history. */
  readonly states: EntityStateHistoryPort<I, S>;
  /** Closes the provider handle when it owns closeable resources. */
  close?(): void;
}

/** Provider factory accepted by the reusable entity history conformance runner. */
export interface EntityHistoryConformanceAdapter {
  /**
   * Creates storage for one entity-history conformance scope.
   *
   * @param input - Specifies the scope and entity storage metadata.
   * @returns Returns the created conformance storage bundle.
   */
  readonly create: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;
  /**
   * Creates a handle for the same durable scope after a provider handle has been closed.
   *
   * @param input - Specifies the original scope and entity storage metadata.
   * @returns Returns the reopened conformance storage bundle.
   */
  readonly reopen: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;
}

/** Runs reusable entity-history provider conformance checks. */
export const EntityHistoryConformance: Readonly<{
  checkCurrentQueries(adapter: EntityHistoryConformanceAdapter): Promise<void>;
  check(adapter: EntityHistoryConformanceAdapter): Promise<void>;
}> = Object.freeze({
  /**
   * Checks the reusable latest-state query contract shared by entity providers.
   *
   * @param adapter - Supplies the provider under conformance test.
   */
  async checkCurrentQueries(adapter: EntityHistoryConformanceAdapter): Promise<void> {
    await EntityHistoryFixture.prepareCurrentQueries(adapter);
  },

  /**
   * Checks framework-agnostic entity-history behavior through ordinary assertions.
   *
   * @param adapter - Supplies the provider under conformance test.
   */
  async check(adapter: EntityHistoryConformanceAdapter): Promise<void> {
    const storage = await EntityHistoryFixture.prepareCurrentQueries(adapter);

    for (let version = 1; version <= 120; version++) {
      await storage.states.append({
        entityId: "task",
        state: create(StringValueSchema, { value: String(version) }),
        version: BigInt(version),
        createdAt: create(TimestampSchema, { seconds: BigInt(version), nanos: 0 }),
      });
    }
    const shortHistory = await storage.states.backward("task", 2);
    ConformanceAssertions.assert(
      shortHistory[0]?.state.value === "120" && shortHistory[1]?.state.value === "119",
      "state history must be newest-first",
    );
    ConformanceAssertions.assert(
      (await storage.states.backward("task", 200, 120n)).length === 119,
      "state continuation must be exclusive",
    );
    const latestState = shortHistory[0];
    ConformanceAssertions.assert(
      latestState.version === 120n,
      "state history must retain the exact version",
    );
    ConformanceAssertions.assert(
      latestState.createdAt.seconds === 120n && latestState.createdAt.nanos === 0,
      "state history must retain the exact timestamp",
    );
    const repeatedHistory = await storage.states.backward("task", 2);
    const repeatedLatest = repeatedHistory[0];
    ConformanceAssertions.assert(
      repeatedLatest !== undefined,
      "state history repeat read must return the latest record",
    );
    ConformanceAssertions.assert(
      latestState !== repeatedLatest &&
        latestState.state !== repeatedLatest.state &&
        latestState.createdAt !== repeatedLatest.createdAt,
      "state history reads must return independently cloned records",
    );
    ConformanceAssertions.assert(
      (await storage.states.stateAt("task", create(TimestampSchema, { seconds: 120n, nanos: 0 })))
        ?.value === "120",
      "stateAt must return the latest matching state",
    );

    for (const id of ["a", "z", "b"]) {
      await storage.events.append({
        entityId: "task",
        event: create(EventSchema, { id: create(EventIdSchema, { value: id }) }),
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n, nanos: 0 }),
      });
    }
    const events = await storage.events.backward("task", 2);
    ConformanceAssertions.assert(
      events[0]?.id?.value === "z" && events[1]?.id?.value === "b",
      "event ties must use canonical ID order",
    );
  },
});

/** Prepares the shared latest-state fixture used by provider conformance checks. */
const EntityHistoryFixture = {
  /** Prepares and verifies a latest-state query fixture. */
  async prepareCurrentQueries(
    adapter: EntityHistoryConformanceAdapter,
  ): Promise<EntityStorageConformance<string, StringValue>> {
    const input: EntityStorageInput<string, StringValue> = {
      context: { name: "EntityHistoryConformance", multitenant: false },
      id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
      extractId: (state) => state.value,
      columns: [new RecordColumn<StringValue, string>("value", (state) => state.value, "string")],
      layout: "entity-v1",
      stateSchema: StringValueSchema,
      storageKey: "conformance.Task:current",
    };
    const storage = adapter.create(input);
    const current = create(StringValueSchema, { value: "task" });
    await storage.current.write({
      id: "task",
      state: current,
      version: 3n,
      archived: false,
      deleted: false,
    });
    current.value = "mutated";
    const currentRecord = await storage.current.read("task");
    ConformanceAssertions.assert(
      currentRecord?.state.value === "task",
      "current record must be cloned",
    );
    ConformanceAssertions.assert(
      currentRecord.version === 3n,
      "current record version must be retained",
    );

    await storage.current.write({
      id: "z",
      state: create(StringValueSchema, { value: "z" }),
      version: 4n,
      archived: true,
      deleted: false,
    });
    await storage.current.write({
      id: "a",
      state: create(StringValueSchema, { value: "a" }),
      version: 2n,
      archived: false,
      deleted: false,
    });
    await storage.current.write({
      id: "deleted",
      state: create(StringValueSchema, { value: "deleted" }),
      version: 9n,
      archived: false,
      deleted: true,
    });
    const currentQuery = await storage.current.query({
      predicate: { kind: "comparison", column: "archived", operator: "equal", value: false },
      order: [{ column: "value", direction: "desc" }],
      limit: 2,
    });
    ConformanceAssertions.assert(
      currentQuery.map((entry) => entry.id).join(",") === "task,a",
      "current query must filter lifecycle columns, order declared columns, and exclude tombstones",
    );
    const versionQuery = await storage.current.query({
      predicate: { kind: "comparison", column: "version", operator: "greaterOrEqual", value: 3n },
      order: [{ column: "version", direction: "asc" }],
    });
    ConformanceAssertions.assert(
      versionQuery.map((entry) => entry.id).join(",") === "task,z",
      "current query must filter and order by version",
    );
    await storage.current.write({
      id: "sentinel",
      state: create(StringValueSchema, { value: "sentinel" }),
      version: 1n,
      archived: false,
      deleted: false,
    });
    await ConformanceAssertions.assertRejects(
      () => storage.current.query({ candidateLimit: 3 }),
      "current query must reject candidate-limit sentinel overflow",
    );
    await ConformanceAssertions.assertRejects(
      () =>
        storage.current.write({
          id: "physical-key",
          state: create(StringValueSchema, { value: "state-id" }),
          version: 1n,
          archived: false,
          deleted: false,
        }),
      "current writes must reject a physical key that disagrees with extracted state ID",
    );
    storage.close?.();
    const reopened = adapter.reopen(input);
    const reopenedQuery = await reopened.current.query({
      predicate: { kind: "ids", ids: ["task"] },
    });
    ConformanceAssertions.assert(
      reopenedQuery[0]?.id === "task",
      "current query must survive close and reopen",
    );
    await ConformanceAssertions.assertRejects(
      () =>
        adapter
          .reopen({
            ...input,
            id: { ...input.id, fingerprint: "incompatible-string" },
          })
          .current.query({}),
      "current query must reject an incompatible descriptor fingerprint",
    );
    return reopened;
  },
};

/** Performs assertion operations for entity-history conformance checks. */
const ConformanceAssertions: {
  assert(condition: unknown, message: string): asserts condition;
  assertRejects(operation: () => Promise<unknown>, message: string): Promise<void>;
} = {
  /** Requires a conformance condition to hold. */
  assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Entity storage conformance failed: ${message}`);
  },

  /** Requires an asynchronous operation to reject. */
  async assertRejects(operation: () => Promise<unknown>, message: string): Promise<void> {
    try {
      await operation();
    } catch {
      return;
    }
    throw new Error(`Entity storage conformance failed: ${message}`);
  },
};
