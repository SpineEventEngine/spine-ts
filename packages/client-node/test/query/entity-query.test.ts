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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { UInt32ValueSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
  OrderBy_Direction,
  QuerySchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { EntityColumn, EntityQuery } from "../../src/index.js";
import { GeneratedEntityColumns } from "../../src/codegen/index.js";
import {
  FixtureStatus,
  ProjectionStateSchema,
  ScalarProjectionStateSchema,
} from "../../test-fixtures/entity-column-fixtures.js";

const columns = EntityColumn.register(
  ProjectionStateSchema,
  GeneratedEntityColumns.define(ProjectionStateSchema, {
    title: { field: ProjectionStateSchema.field.title, comparison: "ordering" as const },
    priority: { field: ProjectionStateSchema.field.priority, comparison: "ordering" as const },
    status: { field: ProjectionStateSchema.field.status, comparison: "equality" as const },
    dueAt: { field: ProjectionStateSchema.field.dueAt, comparison: "ordering" as const },
    owner: { field: ProjectionStateSchema.field.owner, comparison: "equality" as const },
    fingerprint: {
      field: ProjectionStateSchema.field.fingerprint,
      comparison: "equality" as const,
    },
    active: { field: ProjectionStateSchema.field.active, comparison: "equality" as const },
    sequence: { field: ProjectionStateSchema.field.sequence, comparison: "ordering" as const },
  }),
);
const context = create(ActorContextSchema, {
  actor: create(UserIdSchema, { value: "query-user" }),
});
const { eq, gt } = EntityQuery;
const scalarColumns = EntityColumn.register(
  ScalarProjectionStateSchema,
  GeneratedEntityColumns.define(ScalarProjectionStateSchema, {
    doubleValue: {
      field: ScalarProjectionStateSchema.field.doubleValue,
      comparison: "ordering" as const,
    },
    floatValue: {
      field: ScalarProjectionStateSchema.field.floatValue,
      comparison: "ordering" as const,
    },
    uint64Value: {
      field: ScalarProjectionStateSchema.field.uint64Value,
      comparison: "ordering" as const,
    },
    fixed64Value: {
      field: ScalarProjectionStateSchema.field.fixed64Value,
      comparison: "ordering" as const,
    },
    uint32Value: {
      field: ScalarProjectionStateSchema.field.uint32Value,
      comparison: "ordering" as const,
    },
    fixed32Value: {
      field: ScalarProjectionStateSchema.field.fixed32Value,
      comparison: "ordering" as const,
    },
    sfixed64Value: {
      field: ScalarProjectionStateSchema.field.sfixed64Value,
      comparison: "ordering" as const,
    },
    sint64Value: {
      field: ScalarProjectionStateSchema.field.sint64Value,
      comparison: "ordering" as const,
    },
  }),
);

describe("EntityQuery", () => {
  it("compiles IDs, nested predicates, masks, repeated ordering, and a limit", () => {
    const query = EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
      .byId("task-1", "task-2")
      .where(
        EntityQuery.all(
          EntityQuery.ge(columns.priority, 2),
          EntityQuery.either(
            EntityQuery.eq(columns.status, FixtureStatus.OPEN),
            EntityQuery.lt(columns.title, "Z"),
          ),
        ),
      )
      .mask("id", "title", "priority")
      .orderBy(columns.priority, "desc")
      .orderBy(columns.title, "asc")
      .limit(10)
      .build();

    const roundTripped = fromBinary(QuerySchema, toBinary(QuerySchema, query));
    const filters = roundTripped.target?.criterion;

    expect(roundTripped.target?.type).toBe(
      "type.googleapis.com/spine_ts.client.test.ProjectionState",
    );
    expect(filters?.case).toBe("filters");
    if (filters?.case !== "filters") throw new Error("Expected query filters.");
    expect(filters.value.idFilter?.id).toHaveLength(2);
    expect(filters.value.filter).toHaveLength(1);
    expect(filters.value.filter[0]?.operator).toBe(CompositeFilter_CompositeOperator.ALL);
    expect(filters.value.filter[0]?.filter[0]?.operator).toBe(Filter_Operator.GREATER_OR_EQUAL);
    expect(filters.value.filter[0]?.compositeFilter[0]?.operator).toBe(
      CompositeFilter_CompositeOperator.EITHER,
    );
    expect(roundTripped.format?.fieldMask?.paths).toEqual(["id", "title", "priority"]);
    expect(roundTripped.format?.orderBy).toEqual([
      expect.objectContaining({ column: "priority", direction: OrderBy_Direction.DESCENDING }),
      expect.objectContaining({ column: "title", direction: OrderBy_Direction.ASCENDING }),
    ]);
    expect(roundTripped.format?.limit).toBe(10);
  });

  it("supports every frozen comparison operator with typed values", () => {
    const predicates = [
      EntityQuery.eq(columns.title, "A"),
      EntityQuery.gt(columns.priority, 1),
      EntityQuery.lt(columns.priority, 4),
      EntityQuery.ge(columns.priority, 2),
      EntityQuery.le(columns.priority, 3),
    ];

    expect(predicates.map((predicate) => predicate.operator)).toEqual([
      "equal",
      "greaterThan",
      "lessThan",
      "greaterOrEqual",
      "lessOrEqual",
    ]);
  });

  it("compile-covers the documented ID and complete comparison-helper surface", () => {
    const documented = EntityQuery.select({
      schema: ProjectionStateSchema,
      columns,
      context,
    })
      .byId("task-1", "task-2")
      .where(
        EntityQuery.all(
          EntityQuery.eq(columns.active, false),
          EntityQuery.gt(columns.priority, 0),
          EntityQuery.lt(columns.priority, 100),
          EntityQuery.ge(columns.priority, 1),
          EntityQuery.le(columns.priority, 20),
        ),
      )
      .build();

    expect(documented.target?.criterion.case).toBe("filters");
  });

  it("rejects invalid runtime limits and authored masks before wire compilation", () => {
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).limit(1).build(),
    ).toThrow("Entity query limit requires ordering.");
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
        .mask("missing" as "title")
        .build(),
    ).toThrow('Entity query mask path "missing" is not a state field.');
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).limit(0),
    ).toThrow("positive integer");
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).limit(1.5),
    ).toThrow("positive integer");
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).byId(),
    ).toThrow("must not be empty");
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).byId(undefined),
    ).toThrow("must not be empty");
  });

  it("packs descriptor and system column value families", () => {
    const query = EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
      .where(
        EntityQuery.all(
          EntityQuery.eq(columns.active, false),
          EntityQuery.eq(columns.fingerprint, new Uint8Array([1, 2])),
          EntityQuery.eq(columns.status, FixtureStatus.CLOSED),
          EntityQuery.eq(columns.sequence, 4n),
          EntityQuery.gt(columns.dueAt, create(TimestampSchema, { seconds: 2n })),
          EntityQuery.eq(columns.version, create(VersionSchema, { number: 3 })),
          EntityQuery.eq(columns.archived, false),
          EntityQuery.eq(columns.deleted, false),
        ),
      )
      .mask("title")
      .build();

    expect(query.target?.criterion.case).toBe("filters");
    expect(query.format?.fieldMask?.paths).toEqual(["title"]);
    if (query.target?.criterion.case !== "filters") throw new Error("Expected filters.");
    expect(query.target.criterion.value.filter[0]?.filter).toHaveLength(8);
  });

  it("emits minimal include-all, ID-only, predicate-only, and order-only shapes", () => {
    const includeAll = EntityQuery.select({
      schema: ProjectionStateSchema,
      columns,
      context,
    }).build();
    const idOnly = EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
      .byId("task-1")
      .build();
    const predicateOnly = EntityQuery.select({
      schema: ProjectionStateSchema,
      columns,
      context,
    })
      .where(EntityQuery.eq(columns.title, "A"))
      .build();
    const orderOnly = EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
      .orderBy(columns.title)
      .build();

    expect(includeAll.target?.criterion.case).toBe("includeAll");
    expect(includeAll.format).toBeUndefined();
    expect(idOnly.target?.criterion.case).toBe("filters");
    expect(predicateOnly.target?.criterion.case).toBe("filters");
    expect(orderOnly.format?.fieldMask).toBeUndefined();
    expect(orderOnly.format?.limit).toBe(0);
    expect(orderOnly.format?.orderBy[0]?.direction).toBe(OrderBy_Direction.ASCENDING);
  });

  it("packs every frozen numeric scalar family", () => {
    const query = EntityQuery.select({
      schema: ScalarProjectionStateSchema,
      columns: scalarColumns,
      context,
    })
      .where(
        EntityQuery.all(
          EntityQuery.eq(scalarColumns.doubleValue, 1.5),
          EntityQuery.eq(scalarColumns.floatValue, 2.5),
          EntityQuery.eq(scalarColumns.uint64Value, 3n),
          EntityQuery.eq(scalarColumns.fixed64Value, 4n),
          EntityQuery.eq(scalarColumns.uint32Value, 5),
          EntityQuery.eq(scalarColumns.fixed32Value, 4_294_967_295),
          EntityQuery.eq(scalarColumns.sfixed64Value, 7n),
          EntityQuery.eq(scalarColumns.sint64Value, 8n),
        ),
      )
      .build();

    if (query.target?.criterion.case !== "filters") throw new Error("Expected filters.");
    expect(query.target.criterion.value.filter[0]?.filter).toHaveLength(8);
    const fixed32 = query.target.criterion.value.filter[0]?.filter.find(
      (filter) => filter.fieldPath?.fieldName[0] === "fixed32_value",
    );
    expect(fixed32?.value?.typeUrl).toBe("type.googleapis.com/google.protobuf.UInt32Value");
    expect(
      fixed32?.value === undefined
        ? undefined
        : fromBinary(UInt32ValueSchema, fixed32.value.value).value,
    ).toBe(4_294_967_295);
  });

  it("rejects cyclic, over-depth, and over-wide authored predicate graphs", () => {
    const leaf = eq(columns.title, "A");
    const cyclic: { kind: "all"; predicates: unknown[] } = { kind: "all", predicates: [] };
    cyclic.predicates.push(cyclic);
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
        .where(cyclic as never)
        .build(),
    ).toThrow("must not contain cycles");

    let deep: unknown = leaf;
    for (let depth = 0; depth < 66; depth += 1) {
      deep = { kind: "all", predicates: [deep] };
    }
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
        .where(deep as never)
        .build(),
    ).toThrow("maximum depth 64");

    const wide = { kind: "all", predicates: new Array(10_001).fill(leaf) };
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
        .where(wide as never)
        .build(),
    ).toThrow("maximum node count 10000");
  });

  it("rejects more than 10000 distinct top-level predicates before build", () => {
    const builder = EntityQuery.select({ schema: ProjectionStateSchema, columns, context });
    for (let index = 0; index < 10_000; index += 1) {
      builder.where(eq(columns.title, `Task ${String(index)}`));
    }

    expect(() => builder.where(eq(columns.title, "Overflow"))).toThrow("maximum node count 10000");
  });

  it("rejects malformed authored predicate shapes before wire allocation", () => {
    const malformed: readonly [unknown, string][] = [
      [null, "must be an object"],
      [{ kind: "comparison" }, "comparison column is required"],
      [{ kind: "unknown" }, "predicate kind must be recognized"],
      [{ kind: "all", predicates: "not-an-array" }, "predicates must be an array"],
      [{ kind: "either", predicates: [] }, "EITHER predicate must not be empty"],
      [{ kind: "all", predicates: Array(1) }, "predicate entries must be defined"],
    ];

    for (const [predicate, expected] of malformed) {
      expect(() =>
        EntityQuery.select({ schema: ProjectionStateSchema, columns, context })
          .where(predicate as never)
          .build(),
      ).toThrow(expected);
    }
  });

  it("rejects an ID filter when the target descriptor has no ID field", () => {
    const schemaWithoutFields = {
      ...ProjectionStateSchema,
      fields: [],
    } as unknown as typeof ProjectionStateSchema;

    expect(() =>
      EntityQuery.select({ schema: schemaWithoutFields, columns: columns as never, context })
        .byId("task-1")
        .build(),
    ).toThrow("target has no ID field");
  });

  it("rejects forged values, predicates, and foreign column collections at runtime", () => {
    expect(() => eq(columns.priority, Number.NaN)).toThrow("wrong type");
    expect(() => eq(columns.active, "true" as never)).toThrow("wrong type");
    expect(() => eq(columns.fingerprint, "bytes" as never)).toThrow("wrong type");
    expect(() => eq(columns.dueAt, { $typeName: "wrong.Type" } as never)).toThrow("wrong type");
    expect(() => gt(columns.status as never, FixtureStatus.OPEN as never)).toThrow(
      "does not support",
    );

    const valid = eq(columns.title, "A");
    const forged = { ...valid, operator: "unknown" } as never;
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).where(forged).build(),
    ).toThrow("not recognized");

    const { title: omitted, ...withoutTitle } = columns;
    void omitted;
    expect(() =>
      EntityQuery.select({ schema: ProjectionStateSchema, columns: withoutTitle, context })
        .where(valid as never)
        .build(),
    ).toThrow("does not belong");
  });

  it("keeps deferred targets and invalid value/operator pairs out of the public type surface", () => {
    const compileAssertions = (): void => {
      // @ts-expect-error enum columns do not support ordering.
      gt(columns.status, FixtureStatus.OPEN);
      // @ts-expect-error numeric columns reject string values.
      eq(columns.priority, "high");
      // @ts-expect-error masks accept only state field names.
      EntityQuery.select({ schema: ProjectionStateSchema, columns, context }).mask("missing");
      const builder = EntityQuery.select({ schema: ProjectionStateSchema, columns, context });
      // @ts-expect-error equality-only enum columns cannot be used for ordering.
      builder.orderBy(columns.status);
      // @ts-expect-error predicates from a different Projection cannot enter this builder.
      builder.where(eq(scalarColumns.doubleValue, 1));
    };
    void compileAssertions;
  });
});
