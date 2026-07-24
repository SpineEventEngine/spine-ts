import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import type { Message } from "@bufbuild/protobuf";

import type { EntityEventHistoryPort, EntityStateHistoryPort } from "./entity-history-storage.js";
import type { EntityRecordStorage } from "./entity-record.js";
import type { EntityStorageInput } from "../memory/in-memory-entity-history.js";

/** Adapter-neutral bundle used by storage adapters to run entity-history conformance. */
export interface EntityStorageConformance<I, S extends Message> {
  readonly current: EntityRecordStorage<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly states: EntityStateHistoryPort<I, S>;
}

/** Provider factory accepted by the reusable entity history conformance runner. */
export interface EntityHistoryConformanceAdapter {
  readonly create: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;
}

/**
 * Runs framework-agnostic provider behavior checks without a test-framework dependency.
 * Providers call this from their own test runner and receive ordinary thrown assertions.
 */
export async function assertEntityHistoryConformance(
  adapter: EntityHistoryConformanceAdapter,
): Promise<void> {
  const storage = adapter.create({
    context: { name: "EntityHistoryConformance", multitenant: false },
    id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
    layout: "entity-v1",
    stateSchema: StringValueSchema,
    storageKey: "conformance.Task:current",
  });
  const current = create(StringValueSchema, { value: "current" });
  await storage.current.write({
    id: "task",
    state: current,
    version: 3n,
    archived: false,
    deleted: false,
  });
  current.value = "mutated";
  const currentRecord = await storage.current.read("task");
  assert(currentRecord?.state.value === "current", "current record must be cloned");
  assert(currentRecord.version === 3n, "current record version must be retained");

  for (let version = 1; version <= 120; version++) {
    await storage.states.append({
      entityId: "task",
      state: create(StringValueSchema, { value: String(version) }),
      version: BigInt(version),
      createdAt: create(TimestampSchema, { seconds: BigInt(version), nanos: 0 }),
    });
  }
  const shortHistory = await storage.states.backward("task", 2);
  assert(
    shortHistory[0]?.state.value === "120" && shortHistory[1]?.state.value === "119",
    "state history must be newest-first",
  );
  assert(
    (await storage.states.backward("task", 200, 120n)).length === 119,
    "state continuation must be exclusive",
  );
  const latestState = shortHistory[0];
  assert(latestState.version === 120n, "state history must retain the exact version");
  assert(
    latestState.createdAt.seconds === 120n && latestState.createdAt.nanos === 0,
    "state history must retain the exact timestamp",
  );
  const repeatedHistory = await storage.states.backward("task", 2);
  const repeatedLatest = repeatedHistory[0];
  assert(repeatedLatest !== undefined, "state history repeat read must return the latest record");
  assert(
    latestState !== repeatedLatest &&
      latestState.state !== repeatedLatest.state &&
      latestState.createdAt !== repeatedLatest.createdAt,
    "state history reads must return independently cloned records",
  );
  assert(
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
  assert(
    events[0]?.id?.value === "z" && events[1]?.id?.value === "b",
    "event ties must use canonical ID order",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Entity storage conformance failed: ${message}`);
}
