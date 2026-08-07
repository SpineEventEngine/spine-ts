import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { Message } from "@bufbuild/protobuf";

import type { EntityEventHistoryPort, EntityStateHistoryPort } from "./entity-history-storage.js";
import type { EntityRecordStorage } from "./entity-record.js";
import type { EntityStorageInput } from "../memory/in-memory-entity-history.js";
import { RecordColumn } from "../record/record-column.js";

/**
 * Adapter-neutral bundle used by storage adapters to run entity-history conformance.
 */
export interface EntityStorageConformance<I, S extends Message> {
  // prettier-ignore

  /**
   * Provides latest-state record storage.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Provides retained entity event history.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Provides retained entity state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Closes the provider handle when it owns closeable resources.
   */
  close?(): void;
}

/**
 * Provider factory accepted by the reusable entity history conformance runner.
 */
export interface EntityHistoryConformanceAdapter {
  // prettier-ignore

  /**
   * Creates storage for one entity-history conformance scope.
   *
   * @param input Specifies the scope and entity storage metadata.
   * @returns Returns the created conformance storage bundle.
   */
  readonly create: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;

  /**
   * Creates a handle for the same durable scope after a provider handle has been closed.
   *
   * @param input Specifies the original scope and entity storage metadata.
   * @returns Returns the reopened conformance storage bundle.
   */
  readonly reopen: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;
}

/**
 * Runs reusable entity-history provider conformance checks.
 */
export const EntityHistoryConformance: Readonly<{
  checkCurrentQueries(adapter: EntityHistoryConformanceAdapter): Promise<void>;
  check(adapter: EntityHistoryConformanceAdapter): Promise<void>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Checks the reusable latest-state query contract shared by entity providers.
   *
   * @param adapter Supplies the provider under conformance test.
   */
  async checkCurrentQueries(adapter: EntityHistoryConformanceAdapter): Promise<void> {
    await EntityHistoryFixture.prepareCurrentQueries(adapter);
  },

  /**
   * Checks framework-agnostic entity-history behavior through ordinary assertions.
   *
   * @param adapter Supplies the provider under conformance test.
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

/**
 * Prepares the shared latest-state fixture used by provider conformance checks.
 */
const EntityHistoryFixture = {
  // prettier-ignore

  /**
   * Prepares and verifies a latest-state query fixture.
   */
  async prepareCurrentQueries(
    adapter: EntityHistoryConformanceAdapter,
  ): Promise<EntityStorageConformance<string, StringValue>> {
    const input: EntityStorageInput<string, StringValue> = {
      context: { name: "EntityHistoryConformance", multitenant: false },
      id: { clone: (id) => id, key: (id) => id, unpack: EntityHistoryFixture.unpackId },
      columns: [
        new RecordColumn<EntityRecord, string>(
          "value",
          (record) => EntityHistoryFixture.state(record).value,
          "string",
        ),
        new RecordColumn<EntityRecord, boolean>(
          "archived",
          (record) => record.lifecycleFlags?.archived ?? false,
          "boolean",
        ),
        new RecordColumn<EntityRecord, number>(
          "version",
          (record) => record.version?.number ?? 0,
          "number",
        ),
      ],
      sourceType: StringValueSchema,
      stateSchema: StringValueSchema,
    };
    const storage = adapter.create(input);
    const current = EntityHistoryFixture.current("task", "task", 3);
    await storage.current.write(current);
    current.state!.value[0] = 0;
    const currentRecord = await storage.current.read("task");
    ConformanceAssertions.assert(
      EntityHistoryFixture.state(currentRecord!).value === "task",
      "current record must be cloned",
    );
    ConformanceAssertions.assert(
      currentRecord?.version?.number === 3,
      "current record version must be retained",
    );

    await storage.current.write(EntityHistoryFixture.current("z", "z", 4, true));
    await storage.current.write(EntityHistoryFixture.current("a", "a", 2));
    await storage.current.write(EntityHistoryFixture.current("deleted", "deleted", 9, false, true));
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
      predicate: { kind: "comparison", column: "version", operator: "greaterOrEqual", value: 3 },
      order: [{ column: "version", direction: "asc" }],
    });
    ConformanceAssertions.assert(
      versionQuery.map((entry) => entry.id).join(",") === "task,z",
      "current query must filter and order by version",
    );
    await storage.current.write(EntityHistoryFixture.current("sentinel", "sentinel", 1));
    await ConformanceAssertions.assertRejects(
      () => storage.current.query({ candidateLimit: 3 }),
      "current query must reject candidate-limit sentinel overflow",
    );
    await ConformanceAssertions.assertRejects(
      () =>
        storage.current.write(create(EntityRecordSchema, { entityId: create(AnySchema) })),
      "current writes must reject an EntityRecord ID that cannot be unpacked",
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
    return reopened;
  },

  current(
    id: string,
    value: string,
    version: number,
    archived = false,
    deleted = false,
  ): EntityRecord {
    return create(EntityRecordSchema, {
      entityId: EntityHistoryFixture.pack(
        StringValueSchema,
        create(StringValueSchema, { value: id }),
      ),
      lifecycleFlags: { archived, deleted },
      state: EntityHistoryFixture.pack(StringValueSchema, create(StringValueSchema, { value })),
      version: { number: version },
    });
  },

  pack(schema: typeof StringValueSchema, message: StringValue) {
    return create(AnySchema, {
      typeUrl: `type.spine.io/${schema.typeName}`,
      value: toBinary(schema, message),
    });
  },

  unpackId(id: NonNullable<EntityRecord["entityId"]>): string | undefined {
    return id.typeUrl === "type.spine.io/google.protobuf.StringValue"
      ? fromBinary(StringValueSchema, id.value).value
      : undefined;
  },

  state(record: EntityRecord): StringValue {
    if (record.state?.typeUrl !== "type.spine.io/google.protobuf.StringValue")
      throw new Error("Invalid state.");
    return fromBinary(StringValueSchema, record.state.value);
  },
};

/**
 * Performs assertion operations for entity-history conformance checks.
 */
const ConformanceAssertions: {
  assert(condition: unknown, message: string): asserts condition;
  assertRejects(operation: () => Promise<unknown>, message: string): Promise<void>;
} = {
  // prettier-ignore

  /**
   * Requires a conformance condition to hold.
   */
  assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Entity storage conformance failed: ${message}`);
  },

  /**
   * Requires an asynchronous operation to reject.
   */
  async assertRejects(operation: () => Promise<unknown>, message: string): Promise<void> {
    try {
      await operation();
    } catch {
      return;
    }
    throw new Error(`Entity storage conformance failed: ${message}`);
  },
};
