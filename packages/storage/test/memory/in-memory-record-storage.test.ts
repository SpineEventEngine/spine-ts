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

import { create, ScalarType, type Message } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { InMemoryRecordStorage } from "../../src/memory/in-memory-record-storage.js";
import { TenantRecords } from "../../src/memory/tenant-records.js";
import { ColumnTypes } from "../../src/record/column-type.js";
import { RecordColumn } from "../../src/record/record-column.js";
import type { RecordQuery } from "../../src/record/record-query.js";
import { RecordSpec } from "../../src/record/record-spec.js";
import { RecordStorage, type RecordEntry } from "../../src/record/record-storage.js";
import type { NormalizedQueryPlan } from "../../src/query/query-policy.js";
import { assertQueryProviderConformance } from "../query/query-provider-conformance.js";
import type { StorageContext } from "../../src/storage/storage.js";

describe("InMemoryRecordStorage", () => {
  it("keeps a tenant slice's compare-and-set and continued ordering atomic", () => {
    const spec = createSpec();
    const records = new TenantRecords<EventId, Event>();
    const first = spec.materialize(createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n));
    const second = spec.materialize(createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n));

    records.writeAll([first, second]);

    expect(records.compareAndSet(first.id, undefined, second)).toBe(false);
    expect(records.compareAndSet(first.id, first, undefined)).toBe(true);
    expect(
      records.queryEntries(spec, {
        sort: [{ field: "timestamp", direction: "asc" }],
        after: {
          values: [{ field: "timestamp", value: 1n }],
          id: first.id,
        },
      }),
    ).toMatchObject([{ id: { value: "event-2" } }]);
  });

  it("stops public tenant-record path traversal at primitive and null values", () => {
    const spec = createSpec();
    const records = new TenantRecords<EventId, Event>();
    const primitive = spec.materialize(
      createEvent("event-primitive", "type.spine.io/tasks.TaskCreated", 1n),
    );
    const nullable = spec.materialize(
      createEvent("event-null", "type.spine.io/tasks.TaskCreated", 2n),
    );

    records.write(primitive);
    records.write({
      ...nullable,
      record: { ...nullable.record, message: null } as unknown as Event,
    });

    expect(
      records.queryEntries(spec, {
        filters: [
          { column: "id", value: primitive.id },
          { column: "context.timestamp.seconds.unreachable", value: undefined },
        ],
      }),
    ).toMatchObject([{ id: { value: "event-primitive" } }]);
    expect(
      records.queryEntries(spec, {
        filters: [{ column: "message.typeUrl", value: undefined }],
      }),
    ).toMatchObject([{ id: { value: "event-null" } }]);
  });

  it("conforms to the shared normalized query provider fixture", async () => {
    const storage = new ObservedInMemoryStorage(
      { name: "QueryConformance", multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>(
            "group",
            ColumnTypes.scalar(ScalarType.STRING),
            (record) => record.value.slice(0, 1),
          ),
        ],
      }),
    );

    await assertQueryProviderConformance({
      name: "in-memory",
      storage,
      providerCalls: () => storage.queryPlanCalls,
    });
  });
  it("reads back cloned protobuf records and applies simple masks", async () => {
    const storage = createStorage();
    const event = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 3n);

    await storage.write(event);
    if (event.message === undefined) {
      throw new Error("Expected test event message.");
    }
    event.message.typeUrl = "type.spine.io/tasks.MutatedOutside";

    const masked = await storage.read(create(EventIdSchema, { value: "event-1" }), {
      mask: ["id", "context.timestamp"],
    });
    const stored = await storage.read(create(EventIdSchema, { value: "event-1" }));

    expect(masked).toMatchObject({
      id: { value: "event-1" },
      context: { timestamp: { seconds: 3n } },
    });
    expect(masked?.$typeName).toBe(EventSchema.typeName);
    expect(masked?.message).toBeUndefined();
    expect(stored?.message?.typeUrl).toBe("type.spine.io/tasks.TaskCreated");
  });

  it("ignores blank mask paths while applying requested fields", async () => {
    const storage = createStorage();

    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated", 3n));

    const masked = await storage.read(create(EventIdSchema, { value: "event-1" }), {
      mask: [" ", "id", "\t"],
    });

    expect(masked).toEqual(
      create(EventSchema, { id: create(EventIdSchema, { value: "event-1" }) }),
    );
  });

  it("filters, sorts, and limits by record ids and columns deterministically", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 3n),
    ]);

    const ids = await storage.index({
      filters: [{ column: "typeUrl", value: "type.spine.io/tasks.TaskClosed" }],
      sort: [{ field: "timestamp", direction: "desc" }],
      limit: 1,
    });
    const records = await storage.query({
      ids: [
        create(EventIdSchema, { value: "event-2" }),
        create(EventIdSchema, { value: "event-1" }),
      ],
      sort: [{ field: "id", direction: "asc" }],
    });

    expect(ids).toMatchObject([{ value: "event-3" }]);
    expect(records.map((record) => record.id?.value)).toEqual(["event-1", "event-2"]);
  });

  it("executes the complete normalized query plan before applying masks", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 3n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
    ]);

    const records = await storage.queryPlan({
      predicate: {
        kind: "either",
        predicates: [
          { kind: "comparison", column: "timestamp", operator: "lessThan", value: 2n },
          { kind: "comparison", column: "timestamp", operator: "greaterOrEqual", value: 3n },
        ],
      },
      order: [{ column: "timestamp", direction: "desc" }],
      limit: 2,
      mask: { paths: ["id"] },
    });

    expect(records.map((record) => record.id?.value)).toEqual(["event-3", "event-1"]);
    expect(records.every((record) => record.message === undefined)).toBe(true);
  });

  it("rejects normalized plans before materializing beyond their candidate budget", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-2", "type.spine.io/tasks.TaskCreated", 2n),
      createEvent("event-3", "type.spine.io/tasks.TaskCreated", 3n),
    ]);

    await expect(storage.queryPlan({ candidateLimit: 2 })).rejects.toThrow(
      "Storage query exceeded the candidate limit of 2",
    );
  });

  it("orders before limiting and retains candidate overflow protection", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-2", "type.spine.io/tasks.TaskCreated", 2n),
    ]);

    await expect(
      storage.queryPlan({
        candidateLimit: 2,
        order: [{ column: "timestamp", direction: "desc" }],
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: { value: "event-2" } }]);
    await expect(
      storage.queryPlan({
        candidateLimit: 1,
        order: [{ column: "timestamp", direction: "desc" }],
        limit: 1,
      }),
    ).rejects.toThrow("candidate limit of 1");
  });

  it("applies query offsets after sorting and before limits", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 3n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-4", "type.spine.io/tasks.TaskClosed", 4n),
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
    ]);

    const page = await storage.query({
      sort: [{ field: "timestamp", direction: "asc" }],
      offset: 1,
      limit: 2,
    });

    expect(page.map((record) => record.id?.value)).toEqual(["event-2", "event-3"]);
  });

  it("retains only the requested continued window while selecting tied records", async () => {
    const storage = createStorage();
    await storage.writeAll(
      Array.from({ length: 128 }, (_, index) =>
        createEvent(
          `event-${String(index).padStart(3, "0")}`,
          "type.spine.io/tasks.TaskClosed",
          1n,
        ),
      ),
    );

    const originalSort = Array.prototype.sort;
    Array.prototype.sort = function boundedSelectionSort<T>(
      this: T[],
      _compareFn?: (left: T, right: T) => number,
    ): T[] {
      void _compareFn;
      if (this.length > 4) {
        throw new Error("A finite query must not sort every matching record.");
      }
      return this;
    };
    try {
      const page = await storage.query({
        sort: [{ field: "timestamp", direction: "asc" }],
        after: {
          values: [{ field: "timestamp", value: 1n }],
          id: create(EventIdSchema, { value: "event-016" }),
        },
        offset: 2,
        limit: 2,
      });

      expect(page.map((record) => record.id?.value)).toEqual(["event-019", "event-020"]);
    } finally {
      Array.prototype.sort = originalSort;
    }
  });

  it("continues after an ordered row key before offsets, limits, and masks", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 2n),
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
      createEvent("event-4", "type.spine.io/tasks.TaskCreated", 3n),
      createEvent("event-5", "type.spine.io/tasks.TaskClosed", 4n),
    ]);

    const page = await storage.query({
      filters: [{ column: "typeUrl", value: "type.spine.io/tasks.TaskClosed" }],
      sort: [{ field: "timestamp", direction: "asc" }],
      after: {
        values: [{ field: "timestamp", value: 2n }],
        id: create(EventIdSchema, { value: "event-2" }),
      },
      offset: 1,
      limit: 1,
      mask: ["id"],
    });

    expect(page).toHaveLength(1);
    expect(page[0]?.id?.value).toBe("event-5");
    expect(page[0]?.message).toBeUndefined();
  });

  it("uses canonical UTF-8 record IDs for tied ordering and continuation windows", async () => {
    const storage = createStorage();
    await storage.writeAll(
      ["\uE000", "\u{10000}", "\u{10001}"].map((id) =>
        createEvent(id, "type.spine.io/tasks.TaskClosed", 1n),
      ),
    );

    const page = await storage.query({
      sort: [
        { field: "timestamp", direction: "asc" },
        { field: "id", direction: "asc" },
      ],
      after: {
        values: [
          { field: "timestamp", value: 1n },
          { field: "id", value: create(EventIdSchema, { value: "\uE000" }) },
        ],
        id: create(EventIdSchema, { value: "\uE000" }),
      },
      limit: 2,
    });

    expect(page.map((record) => record.id?.value)).toEqual(["\u{10000}", "\u{10001}"]);
  });

  it("continues descending pages after the ordered row key", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 3n),
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
    ]);

    await expect(
      storage.index({
        sort: [{ field: "timestamp", direction: "desc" }],
        after: {
          values: [{ field: "timestamp", value: 3n }],
          id: create(EventIdSchema, { value: "event-3" }),
        },
      }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-1" }]);
  });

  it("rejects continuations with the wrong number of ordered values", async () => {
    const storage = createStorage();
    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n));

    await expect(
      storage.query({
        sort: [{ field: "timestamp", direction: "asc" }],
        after: {
          values: [],
          id: create(EventIdSchema, { value: "event-1" }),
        },
      }),
    ).rejects.toThrow(/continuation must match the sort order/i);
  });

  it("rejects sparse continuation sort entries", async () => {
    const storage = createStorage();
    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n));
    const malformed = {
      sort: [undefined],
      after: {
        values: [{ field: undefined, value: 1n }],
        id: create(EventIdSchema, { value: "event-1" }),
      },
    };

    await expect(
      storage.index(malformed as unknown as Parameters<typeof storage.index>[0]),
    ).rejects.toThrow(/continuation sort order is invalid/i);
  });

  it("rejects continuations without a matching sort order", async () => {
    const storage = createStorage();
    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n));

    await expect(
      storage.query({
        after: {
          values: [{ field: "timestamp", value: 1n }],
          id: create(EventIdSchema, { value: "event-1" }),
        },
      }),
    ).rejects.toThrow(/continuation must match the sort order/i);
  });

  it("rejects continuations with mismatched ordered fields", async () => {
    const storage = createStorage();
    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n));

    await expect(
      storage.query({
        sort: [{ field: "timestamp", direction: "asc" }],
        after: {
          values: [{ field: "context.timestamp", value: 1n }],
          id: create(EventIdSchema, { value: "event-1" }),
        },
      }),
    ).rejects.toThrow(/continuation must match the sort order/i);
  });

  it("keeps keyset continuation scoped to the active tenant slice", async () => {
    let currentTenantId = tenant("tenant-a");
    const storage = createStorage({
      name: "Tasks",
      multitenant: true,
      get tenantId() {
        return currentTenantId;
      },
    });

    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n),
      createEvent("event-a", "type.spine.io/tasks.TaskClosed", 2n),
    ]);
    currentTenantId = tenant("tenant-b");
    await storage.writeAll([
      createEvent("event-1", "type.spine.io/tasks.TaskClosed", 1n),
      createEvent("event-b", "type.spine.io/tasks.TaskClosed", 2n),
    ]);

    const query = {
      sort: [{ field: "timestamp", direction: "asc" as const }],
      after: {
        values: [{ field: "timestamp", value: 1n }],
        id: create(EventIdSchema, { value: "event-1" }),
      },
    } as Parameters<typeof storage.query>[0];

    await expect(storage.query(query)).resolves.toMatchObject([{ id: { value: "event-b" } }]);
    currentTenantId = tenant("tenant-a");
    await expect(storage.query(query)).resolves.toMatchObject([{ id: { value: "event-a" } }]);
  });

  it("sorts numeric and bigint values numerically for multi-digit values", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-10", "type.spine.io/tasks.TaskClosed", 10n, 10),
      createEvent("event-2", "type.spine.io/tasks.TaskCreated", 2n, 2),
    ]);

    const bigintOrder = await storage.index({
      sort: [{ field: "timestamp", direction: "asc" }],
    });
    const numberOrder = await storage.index({
      sort: [{ field: "nanos", direction: "asc" }],
    });

    expect(bigintOrder.map((id) => id.value)).toEqual(["event-2", "event-10"]);
    expect(numberOrder.map((id) => id.value)).toEqual(["event-2", "event-10"]);
  });

  it("breaks equal numeric sort keys with stable record IDs", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-b", "type.spine.io/tasks.TaskClosed", 1n, 7),
      createEvent("event-a", "type.spine.io/tasks.TaskClosed", 2n, 7),
    ]);

    await expect(
      storage.index({ sort: [{ field: "nanos", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-a" }, { value: "event-b" }]);
  });

  it("matches any value in an array-valued column filter", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-created", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-updated", "type.spine.io/tasks.TaskUpdated", 2n),
      createEvent("event-closed", "type.spine.io/tasks.TaskClosed", 3n),
    ]);

    await expect(
      storage.index({
        filters: [
          {
            column: "typeUrl",
            value: ["type.spine.io/tasks.TaskCreated", "type.spine.io/tasks.TaskClosed"],
          },
        ],
        sort: [{ field: "id", direction: "asc" }],
      }),
    ).resolves.toMatchObject([{ value: "event-closed" }, { value: "event-created" }]);
  });

  it("sorts mixed value kinds deterministically", async () => {
    const storage = createLookupStorage({
      "event-array": [],
      "event-bigint": 0n,
      "event-boolean": false,
      "event-bytes": new Uint8Array([]),
      "event-null": null,
      "event-number": 0,
      "event-object": {},
      "event-string": "",
      "event-undefined": undefined,
    });

    await storage.writeAll(
      createLookupEvents([
        "event-object",
        "event-number",
        "event-bigint",
        "event-null",
        "event-string",
        "event-array",
        "event-boolean",
        "event-undefined",
        "event-bytes",
      ]),
    );

    const ids = await storage.index({
      sort: [{ field: "value", direction: "asc" }],
    });

    expect(ids.map((id) => id.value)).toEqual([
      "event-array",
      "event-bigint",
      "event-boolean",
      "event-bytes",
      "event-null",
      "event-number",
      "event-object",
      "event-string",
      "event-undefined",
    ]);
  });

  it("rejects uncloneable runtime column values", async () => {
    const storage = createLookupStorage({
      "event-function": () => "uncloneable",
    });

    await expect(storage.writeAll(createLookupEvents(["event-function"]))).rejects.toThrow(
      /value could not be cloned/i,
    );
  });

  it("sorts booleans, strings, bytes, arrays, objects, nulls, undefined, and NaN deterministically", async () => {
    const booleanStorage = createLookupStorage({
      "event-true": true,
      "event-false": false,
    });
    await booleanStorage.writeAll(createLookupEvents(["event-true", "event-false"]));
    await expect(
      booleanStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-false" }, { value: "event-true" }]);

    const stringStorage = createLookupStorage({
      "event-b": "b",
      "event-a": "a",
    });
    await stringStorage.writeAll(createLookupEvents(["event-b", "event-a"]));
    await expect(
      stringStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-a" }, { value: "event-b" }]);

    const bytesStorage = createLookupStorage({
      "event-10": new Uint8Array([10]),
      "event-2": new Uint8Array([2]),
    });
    await bytesStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      bytesStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const arrayStorage = createLookupStorage({
      "event-10": [10],
      "event-2": [2],
    });
    await arrayStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      arrayStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const objectStorage = createLookupStorage({
      "event-10": { rank: 10 },
      "event-2": { rank: 2 },
    });
    await objectStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      objectStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const undefinedStorage = createLookupStorage({
      "event-2": undefined,
      "event-1": undefined,
    });
    await undefinedStorage.writeAll(createLookupEvents(["event-2", "event-1"]));
    await expect(
      undefinedStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-1" }, { value: "event-2" }]);

    const nullStorage = createLookupStorage({
      "event-2": null,
      "event-1": null,
    });
    await nullStorage.writeAll(createLookupEvents(["event-2", "event-1"]));
    await expect(
      nullStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-1" }, { value: "event-2" }]);

    const nanStorage = createLookupStorage({
      "event-nan-2": Number.NaN,
      "event-2": 2,
      "event-nan-1": Number.NaN,
    });
    await nanStorage.writeAll(createLookupEvents(["event-nan-2", "event-2", "event-nan-1"]));
    await expect(
      nanStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([
      { value: "event-2" },
      { value: "event-nan-1" },
      { value: "event-nan-2" },
    ]);
  });

  it("orders distinct booleans after tied boolean values", async () => {
    const storage = createLookupStorage({
      "event-false-b": false,
      "event-true": true,
      "event-false-a": false,
    });

    await storage.writeAll(createLookupEvents(["event-false-b", "event-true", "event-false-a"]));

    await expect(
      storage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([
      { value: "event-false-a" },
      { value: "event-false-b" },
      { value: "event-true" },
    ]);
  });

  it("orders list lengths and object key boundaries deterministically", async () => {
    const lists = createLookupStorage({
      "event-short": [1],
      "event-long": [1, 0],
    });
    await lists.writeAll(createLookupEvents(["event-long", "event-short"]));
    await expect(
      lists.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-short" }, { value: "event-long" }]);

    const objects = createLookupStorage({
      "event-a-copy": { a: 1 },
      "event-b": { b: 1 },
      "event-a": { a: 1 },
    });
    await objects.writeAll(createLookupEvents(["event-a-copy", "event-b", "event-a"]));
    await expect(
      objects.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([
      { value: "event-a" },
      { value: "event-a-copy" },
      { value: "event-b" },
    ]);
  });

  it("treats nested paths beyond scalar and absent values as undefined", async () => {
    const storage = createStorage();
    await storage.writeAll([
      createEvent("event-primitive", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-absent", "type.spine.io/tasks.TaskCreated", 2n),
    ]);

    await expect(
      storage.index({
        filters: [
          { column: "context.timestamp.seconds.unreachable", value: undefined },
          { column: "notAField.unreachable", value: undefined },
        ],
        sort: [{ field: "id", direction: "asc" }],
      }),
    ).resolves.toMatchObject([{ value: "event-absent" }, { value: "event-primitive" }]);
  });

  it("treats collision-prone object keys as ordinary record values", async () => {
    const storage = createLookupStorage({
      "event-b": collisionProneObject("b"),
      "event-a": collisionProneObject("a"),
    });

    await storage.writeAll(createLookupEvents(["event-b", "event-a"]));

    await expect(
      storage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-a" }, { value: "event-b" }]);
    await expect(
      storage.index({
        filters: [{ column: "value", value: collisionProneObject("a") }],
      }),
    ).resolves.toMatchObject([{ value: "event-a" }]);
  });

  it("keeps tied sort keys stable before applying the limit", async () => {
    const first = createStorage();
    const second = createStorage();
    const records = [
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 5n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 5n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 5n),
    ];

    await first.writeAll(records);
    await second.writeAll([...records].reverse());

    const query = {
      sort: [{ field: "timestamp", direction: "desc" as const }],
      limit: 2,
    };

    const firstIds = await first.index(query);
    const secondIds = await second.index(query);

    expect(firstIds.map((id) => id.value)).toEqual(["event-1", "event-2"]);
    expect(secondIds.map((id) => id.value)).toEqual(["event-1", "event-2"]);
  });

  it("keeps multitenant slices separate inside one storage", async () => {
    let currentTenantId = tenant("tenant-a");
    const storage = createStorage({
      name: "Tasks",
      multitenant: true,
      get tenantId() {
        return currentTenantId;
      },
    });

    await storage.write(createEvent("event-a", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = tenant("tenant-b");
    await storage.write(createEvent("event-b", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = tenant("tenant-a");

    await expect(storage.query()).resolves.toMatchObject([{ id: { value: "event-a" } }]);
    currentTenantId = tenant("tenant-b");
    await expect(storage.query()).resolves.toMatchObject([{ id: { value: "event-b" } }]);
  });

  it("rejects invalid limits, missing tenant IDs, and post-close operations", async () => {
    const storage = createStorage();

    await expect(storage.query({ limit: 0 })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: Number.NaN })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: Number.POSITIVE_INFINITY })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: 1.5 })).rejects.toThrow(/positive/);
    await expect(storage.query({ offset: -1 })).rejects.toThrow(/non-negative/);
    await expect(storage.query({ offset: Number.NaN })).rejects.toThrow(/non-negative/);
    await expect(storage.query({ offset: Number.POSITIVE_INFINITY })).rejects.toThrow(
      /non-negative/,
    );
    await expect(storage.query({ offset: 1.5 })).rejects.toThrow(/non-negative/);

    const multitenant = createStorage({ name: "Tasks", multitenant: true } as never);
    await expect(multitenant.query()).rejects.toThrow(
      'Multitenant storage "Tasks" requires context.tenantId.',
    );

    storage.close();
    expect(storage.isOpen()).toBe(false);
    await expect(storage.read(create(EventIdSchema, { value: "event-1" }))).rejects.toThrow(
      /closed/,
    );
  });

  it("keeps local single-tenant rows and rejects invalid local multitenant contexts on use", async () => {
    const singleTenant = new InMemoryRecordStorage(
      { name: "Local", multitenant: false },
      createSpec(),
    );
    await singleTenant.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n));
    await expect(
      singleTenant.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toMatchObject({
      id: { value: "event-1" },
    });

    for (const [tenantId, error] of [
      [undefined, 'Multitenant storage "Local" requires context.tenantId.'],
      [tenant(""), "Multitenant storage requires a non-empty TenantId."],
    ] as const) {
      const context = {
        name: "Local",
        multitenant: true,
        ...(tenantId === undefined ? {} : { tenantId }),
      };
      const storage = new InMemoryRecordStorage(context as never, createSpec());
      await expect(storage.query()).rejects.toThrow(error);
    }
  });

  it("does not persist earlier records when later materialization fails", async () => {
    const storage = new InMemoryRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        recordType: EventSchema,
        idSchema: EventIdSchema,
        extractId: (event) => {
          if (event.id?.value === "event-2") {
            throw new Error("Second record rejected.");
          }

          if (event.id === undefined) {
            throw new Error("Expected test event ID.");
          }

          return event.id;
        },
        columns: [
          new RecordColumn<Event>(
            "typeUrl",
            ColumnTypes.scalar(ScalarType.STRING),
            (event) => event.message?.typeUrl,
          ),
        ],
      }),
    );

    await expect(
      storage.writeAll([
        createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
        createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
      ]),
    ).rejects.toThrow(/Second record rejected/);
    await expect(storage.query()).resolves.toEqual([]);
  });

  it("supports compare-and-set for create, replace, and delete by record id", async () => {
    const storage = createStorage();
    const created = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const replaced = createEvent("event-1", "type.spine.io/tasks.TaskUpdated", 2n);
    const createdId = created.id;
    const replacedId = replaced.id;

    if (createdId === undefined || replacedId === undefined) {
      throw new Error("Expected compare-and-set test event IDs.");
    }

    await expect(storage.compareAndSet(createdId, undefined, created)).resolves.toBe(true);
    await expect(
      storage.compareAndSet(
        createdId,
        undefined,
        createEvent("event-1", "type.spine.io/tasks.TaskClosed", 3n),
      ),
    ).resolves.toBe(false);
    await expect(storage.compareAndSet(createdId, created, replaced)).resolves.toBe(true);
    await expect(
      storage.compareAndSet(
        createdId,
        created,
        createEvent("event-1", "type.spine.io/tasks.TaskClosed", 4n),
      ),
    ).resolves.toBe(false);
    await expect(storage.compareAndSet(replacedId, replaced, undefined)).resolves.toBe(true);
    await expect(storage.read(createdId)).resolves.toBeUndefined();
  });

  it("reports query entry ids from the actual storage slot", async () => {
    const storage = createStorage();
    const stored = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const copiedId = create(EventIdSchema, { value: "event-copy" });

    await storage.compareAndSet(copiedId, undefined, stored);

    await expect(storage.queryEntries()).resolves.toMatchObject([
      {
        id: { value: "event-copy" },
        record: { id: { value: "event-1" } },
      },
    ]);
  });

  it("filters copied query entries by the actual storage slot id", async () => {
    const storage = createStorage();
    const stored = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const copiedId = create(EventIdSchema, { value: "event-copy" });

    await storage.compareAndSet(copiedId, undefined, stored);

    await expect(storage.queryEntries({ ids: [copiedId] })).resolves.toMatchObject([
      {
        id: { value: "event-copy" },
        record: { id: { value: "event-1" } },
      },
    ]);
  });

  it("continues copied storage slots by query entry id when sort keys tie", async () => {
    const storage = createStorage();
    const copiedId = create(EventIdSchema, { value: "event-1-copy" });

    await storage.compareAndSet(
      copiedId,
      undefined,
      createEvent("event-z", "type.spine.io/tasks.TaskCreated", 1n),
    );
    await storage.write(createEvent("event-2", "type.spine.io/tasks.TaskClosed", 1n));

    const page1 = await storage.queryEntries({
      sort: [{ field: "timestamp", direction: "asc" }],
      limit: 1,
    });
    const page2 = await storage.queryEntries({
      sort: [{ field: "timestamp", direction: "asc" }],
      after: {
        values: [{ field: "timestamp", value: 1n }],
        id: page1[0]?.id ?? copiedId,
      },
      limit: 1,
    });

    expect(page1).toMatchObject([
      {
        id: { value: "event-1-copy" },
        record: { id: { value: "event-z" } },
      },
    ]);
    expect(page2).toMatchObject([
      {
        id: { value: "event-2" },
        record: { id: { value: "event-2" } },
      },
    ]);
  });

  it("keeps record index ids aligned with logical record ids instead of storage slots", async () => {
    const storage = createStorage();
    const stored = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const copiedId = create(EventIdSchema, { value: "event-copy" });

    await storage.compareAndSet(copiedId, undefined, stored);

    await expect(storage.index()).resolves.toMatchObject([{ value: "event-1" }]);
  });

  it("uses query-entry adapters as the single query hook", async () => {
    const storage = new QueryEntriesStorage({ name: "Tasks", multitenant: false }, createSpec(), [
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
    ]);

    await expect(storage.query()).resolves.toMatchObject([{ id: { value: "event-1" } }]);
    await expect(storage.index()).resolves.toMatchObject([{ value: "event-1" }]);
  });

  it("fails closed for nonempty normalized plans when a provider has no plan executor", async () => {
    const storage = new QueryEntriesStorage({ name: "Tasks", multitenant: false }, createSpec(), [
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
    ]);

    await expect(
      storage.queryPlan({
        predicate: { kind: "ids", ids: [create(EventIdSchema, { value: "event-1" })] },
      }),
    ).rejects.toThrow("must implement normalized query-plan execution");
    expect(storage.queries).toEqual([]);
  });

  it("bounds an empty normalized plan by its explicit candidate budget before provider access", async () => {
    const storage = new QueryEntriesStorage({ name: "Tasks", multitenant: false }, createSpec(), [
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
    ]);

    await expect(storage.queryPlan({ candidateLimit: 2 })).resolves.toMatchObject([
      { id: { value: "event-1" } },
    ]);
    expect(storage.queries).toEqual([{ limit: 3 }]);
  });

  it("uses the 10,001 default fetch sentinel for an empty base normalized plan", async () => {
    const storage = new QueryEntriesStorage({ name: "Tasks", multitenant: false }, createSpec(), [
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
    ]);

    await storage.queryPlan({});

    expect(storage.queries).toEqual([{ limit: 10_001 }]);
  });

  it("uses the 10,001 default fetch sentinel for an empty in-memory normalized plan", async () => {
    const records = new ObservingTenantRecords<EventId, Event>();
    const storage = new InMemoryRecordStorage(
      { name: "Tasks", multitenant: false },
      createSpec(),
      () => records,
    );
    await storage.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n));

    await storage.queryPlan({});

    expect(records.queries).toEqual([{ limit: 10_001 }]);
  });
});

class ObservedInMemoryStorage extends InMemoryRecordStorage<string, StringValue> {
  queryPlanCalls = 0;

  protected override queryPlanRecordEntries(
    plan: NormalizedQueryPlan<string>,
  ): Promise<readonly RecordEntry<string, StringValue>[]> {
    this.queryPlanCalls += 1;
    return super.queryPlanRecordEntries(plan);
  }
}

function createStorage(
  context: StorageContext = {
    name: "Tasks",
    multitenant: false,
  },
) {
  return new InMemoryRecordStorage(context, createSpec());
}

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function createLookupEvents(ids: readonly string[]) {
  return ids.map((id) => createEvent(id, `type.spine.io/tasks.${id}`, 0n));
}

function createLookupStorage(values: Record<string, unknown>) {
  return new InMemoryRecordStorage(
    { name: "Tasks", multitenant: false },
    new RecordSpec({
      recordType: EventSchema,
      idSchema: EventIdSchema,
      extractId: (event) => {
        if (event.id === undefined) {
          throw new Error("Expected event.id.");
        }

        return event.id;
      },
      columns: [
        new RecordColumn<Event>(
          "value",
          ColumnTypes.scalar(ScalarType.STRING),
          (event) => values[event.id?.value ?? "missing"],
        ),
      ],
    }),
  );
}

function collisionProneObject(value: string) {
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of ["__proto__", "constructor", "prototype", "bigint", "bytes"]) {
    Object.defineProperty(record, key, {
      value: `${key}:${value}`,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return record;
}

class QueryEntriesStorage extends RecordStorage<EventId, Event> {
  readonly #records: readonly Event[];
  readonly queries: RecordQuery<EventId>[] = [];

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<EventId, Event>,
    records: readonly Event[],
  ) {
    super(context, recordSpec);
    this.#records = records;
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(
    query: RecordQuery<EventId>,
  ): Promise<readonly { id: EventId; record: Event }[]> {
    this.queries.push(query);
    return Promise.resolve(
      this.#records.map((record) => ({
        id: this.recordSpec.idValueIn(record),
        record,
      })),
    );
  }

  protected readRecord(): Promise<Event | undefined> {
    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class ObservingTenantRecords<I, R extends Message> extends TenantRecords<I, R> {
  readonly queries: RecordQuery<I>[] = [];

  override queryEntries(
    spec: RecordSpec<I, R>,
    query: RecordQuery<I>,
  ): readonly RecordEntry<I, R>[] {
    this.queries.push(query);
    return super.queryEntries(spec, query);
  }
}

function createSpec() {
  return new RecordSpec({
    recordType: EventSchema,
    idSchema: EventIdSchema,
    extractId: (event) => {
      if (event.id === undefined) {
        throw new Error("Expected event.id.");
      }

      return event.id;
    },
    columns: [
      new RecordColumn<Event>(
        "typeUrl",
        ColumnTypes.scalar(ScalarType.STRING),
        (event) => event.message?.typeUrl,
      ),
      new RecordColumn<Event>(
        "timestamp",
        ColumnTypes.scalar(ScalarType.INT64),
        (event) => event.context?.timestamp?.seconds ?? 0n,
      ),
      new RecordColumn<Event>(
        "nanos",
        ColumnTypes.scalar(ScalarType.INT32),
        (event) => event.context?.timestamp?.nanos ?? 0,
      ),
    ],
  });
}

function createEvent(id: string, typeUrl: string, seconds: bigint, nanos = 0) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, {
      typeUrl,
      value: new Uint8Array([1, 2, 3]),
    }),
    context: {
      timestamp: create(TimestampSchema, { seconds, nanos }),
    },
  });
}
