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
import { GeneratedEntityColumns, GeneratedEntityQueries } from "../../src/codegen/index.js";
import {
  ProjectStatus,
  ProjectOverviewStateSchema,
  ProjectOverviewWithMetricsStateSchema,
} from "../../test-fixtures/entity-column-fixtures.js";
import { ProjectLeadSchema } from "../../test-fixtures/generated/project_states_pb.js";

const columns = EntityColumn.register(
  ProjectOverviewStateSchema,
  GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
    title: { field: ProjectOverviewStateSchema.field.title, comparison: "ordering" as const },
    priority: { field: ProjectOverviewStateSchema.field.priority, comparison: "ordering" as const },
    status: { field: ProjectOverviewStateSchema.field.status, comparison: "equality" as const },
    dueAt: { field: ProjectOverviewStateSchema.field.dueAt, comparison: "ordering" as const },
    owner: { field: ProjectOverviewStateSchema.field.owner, comparison: "equality" as const },
    fingerprint: {
      field: ProjectOverviewStateSchema.field.fingerprint,
      comparison: "equality" as const,
    },
    active: { field: ProjectOverviewStateSchema.field.active, comparison: "equality" as const },
    sequence: { field: ProjectOverviewStateSchema.field.sequence, comparison: "ordering" as const },
  }),
);
const context = create(ActorContextSchema, {
  actor: create(UserIdSchema, { value: "query-user" }),
});
const { eq, gt } = EntityQuery;
const scalarColumns = EntityColumn.register(
  ProjectOverviewWithMetricsStateSchema,
  GeneratedEntityColumns.define(ProjectOverviewWithMetricsStateSchema, {
    doubleValue: {
      field: ProjectOverviewWithMetricsStateSchema.field.doubleValue,
      comparison: "ordering" as const,
    },
    floatValue: {
      field: ProjectOverviewWithMetricsStateSchema.field.floatValue,
      comparison: "ordering" as const,
    },
    uint64Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.uint64Value,
      comparison: "ordering" as const,
    },
    fixed64Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.fixed64Value,
      comparison: "ordering" as const,
    },
    uint32Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.uint32Value,
      comparison: "ordering" as const,
    },
    fixed32Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.fixed32Value,
      comparison: "ordering" as const,
    },
    sfixed64Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.sfixed64Value,
      comparison: "ordering" as const,
    },
    sint64Value: {
      field: ProjectOverviewWithMetricsStateSchema.field.sint64Value,
      comparison: "ordering" as const,
    },
  }),
);
const selectedColumns: Pick<typeof columns, "priority" | "status"> = columns;

describe("EntityQuery", () => {
  it("builds nested generated-style conditions with typed ordered and lifecycle columns", () => {
    const generated = GeneratedEntityQueries.define({
      schema: ProjectOverviewStateSchema,
      columns,
      idField: "id",
      accessors: {
        title: "title",
        priority: "priority",
        status: "status",
        archived: "archived",
        version: "version",
      },
    });
    const query = generated
      .create()
      .title()
      .is("Open")
      .either(
        (branch) => branch.priority().isGreaterThan(2).status().is(ProjectStatus.OPEN),
        (branch) => branch.archived().is(false),
      )
      .version()
      .isAtLeast(create(VersionSchema, { number: 2 }))
      .orderBy("priority", "desc")
      .limit(4)
      .build();

    expect(query.buildPlan()).toMatchObject({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "title", operator: "equal", value: "Open" },
          { kind: "either" },
          { kind: "comparison", column: "version", operator: "greaterOrEqual" },
        ],
      },
      order: [{ column: "priority", direction: "desc" }],
      limit: 4,
    });
    const builder = generated.create();
    const status = builder.status();
    expect(status).toBeDefined();
    type StatusCannotOrder = "isGreaterThan" extends keyof typeof status ? false : true;
    type MissingAccessor = "missing" extends keyof typeof builder ? false : true;
    const statusCannotOrder: StatusCannotOrder = true;
    const missingAccessor: MissingAccessor = true;
    expect([statusCannotOrder, missingAccessor]).toEqual([true, true]);
  });

  it("keeps either branches synchronous and limited to conditions", () => {
    const generated = GeneratedEntityQueries.define({
      schema: ProjectOverviewStateSchema,
      columns,
      idField: "id",
      accessors: { title: "title", priority: "priority" },
    });
    const query = generated
      .create()
      .byId("task-1")
      .either(
        (branch) =>
          branch
            .title()
            .is("Open")
            .either(
              (nested) => nested.priority().isAtLeast(2),
              (nested) => {
                nested.title().is("Pending");
              },
            ),
        (branch) => {
          branch.priority().isAtMost(5);
        },
      )
      .orderBy("priority")
      .limit(3)
      .build();
    expect(query.buildPlan()).toMatchObject({
      predicate: { kind: "all", predicates: [{ kind: "ids" }, { kind: "either" }] },
      order: [{ column: "priority", direction: "asc" }],
      limit: 3,
    });
    expect(() =>
      generated.create().either(
        (branch) => {
          (branch as unknown as { byId(id: string): void }).byId("task-2");
        },
        (branch) => branch.title().is("Open"),
      ),
    ).toThrow(/branch.*byId/u);
    for (const operation of ["orderBy", "limit", "build"] as const) {
      expect(() =>
        generated.create().either(
          (branch) => {
            const afterComparison = branch.title().is("Open") as unknown as Record<
              string,
              (...args: never[]) => unknown
            >;
            afterComparison[operation]?.("priority" as never);
          },
          (branch) => branch.title().is("Pending"),
        ),
      ).toThrow(new RegExp(`branch.*${operation}`, "u"));
    }
    expect(() =>
      generated.create().either(
        (async () => {
          await Promise.resolve();
        }) as never,
        (branch) => branch.title().is("Open"),
      ),
    ).toThrow(/synchronous/u);
    const checkBranchTypes = () => {
      generated.create().either(
        (branch) => {
          const conditions = branch.title().is("Open");
          expect(conditions).toBeDefined();
          type BranchOnly =
            Extract<keyof typeof conditions, "byId" | "orderBy" | "limit" | "build"> extends never
              ? true
              : false;
          const branchOnly: BranchOnly = true;
          expect(branchOnly).toBe(true);
        },
        (branch) => branch.title().is("Pending"),
      );
      generated.create().either(
        // @ts-expect-error Async branches cannot finish after query construction.
        async (branch) => {
          await Promise.resolve();
          branch.title().is("Open");
        },
        (branch) => branch.title().is("Pending"),
      );
    };
    expect(checkBranchTypes).toBeDefined();
  });

  it("rejects malformed dynamic generated accessors and empty OR branches", () => {
    expect(() =>
      GeneratedEntityQueries.define({
        schema: ProjectOverviewStateSchema,
        columns,
        idField: "id",
        accessors: { build: "title" } as never,
      }).create(),
    ).toThrow(/accessor "build" is invalid/u);
    expect(() =>
      GeneratedEntityQueries.define({
        schema: ProjectOverviewStateSchema,
        columns,
        idField: "id",
        accessors: { title: "missing" } as never,
      }).create(),
    ).toThrow(/accessor "title" is invalid/u);
    const generated = GeneratedEntityQueries.define({
      schema: ProjectOverviewStateSchema,
      columns,
      idField: "id",
      accessors: { title: "title" },
    });
    expect(() => generated.create().either((branch) => branch.title().is("Open"))).toThrow(
      /requires two branches/u,
    );
    expect(() =>
      generated.create().either(
        () => undefined,
        (branch) => branch.title().is("Open"),
      ),
    ).toThrow(/branch has no conditions/u);
  });

  it("builds an independent context-free description for later execution", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const owner = create(ProjectLeadSchema, { value: "first" });
    const dueAt = create(TimestampSchema, { seconds: 12n });
    const draft = EntityQuery.describe({
      schema: ProjectOverviewStateSchema,
      columns,
      idField: "id",
    })
      .byId(...Array.from({ length: 1_201 }, (_, index) => `task-${String(index)}`))
      .where(EntityQuery.eq(columns.fingerprint, bytes))
      .where(EntityQuery.eq(columns.owner, owner))
      .where(EntityQuery.ge(columns.dueAt, dueAt))
      .orderBy(columns.priority)
      .limit(5);
    const built = draft.build();
    bytes[0] = 9;
    owner.value = "later";
    dueAt.seconds = 99n;
    draft.where(EntityQuery.eq(columns.title, "Later"));

    expect(built.build().context).toBeUndefined();
    expect(built.build().target?.criterion.case).toBe("filters");
    const plan = built.buildPlan();
    expect(plan.predicate?.kind).toBe("all");
    if (plan.predicate?.kind !== "all") throw new Error("Expected combined predicates.");
    expect(plan.predicate.predicates[0]).toMatchObject({ kind: "ids" });
    expect(
      plan.predicate.predicates[0]?.kind === "ids" ? plan.predicate.predicates[0].ids : [],
    ).toHaveLength(1_201);
    expect(plan.predicate.predicates[1]).toEqual({
      kind: "comparison",
      column: "fingerprint",
      operator: "equal",
      value: new Uint8Array([1, 2, 3]),
    });
    expect(plan.predicate.predicates[2]).toMatchObject({
      kind: "comparison",
      column: "owner",
      value: { value: "first" },
    });
    expect(plan.predicate.predicates[3]).toMatchObject({
      kind: "comparison",
      column: "due_at",
      value: { seconds: 12n },
    });
    expect(built.buildPlan()).toEqual(plan);
    if (plan.predicate.predicates[1]?.kind === "comparison") {
      (plan.predicate.predicates[1].value as Uint8Array)[0] = 8;
    }
    expect(built.buildPlan().predicate).not.toEqual(plan.predicate);
  });

  it("compiles the shared DSL to a storage-neutral execution plan", () => {
    const plan = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
      .byId("task-1")
      .where(EntityQuery.eq(columns.title, "Awaiting"))
      .orderBy(columns.priority, "desc")
      .limit(10)
      .buildPlan();

    expect(plan).toEqual({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "ids", ids: ["task-1"] },
          { kind: "comparison", column: "title", operator: "equal", value: "Awaiting" },
        ],
      },
      order: [{ column: "priority", direction: "desc" }],
      limit: 10,
    });
  });

  it("compiles IDs, nested predicates, repeated ordering, and a limit", () => {
    const query = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
      .byId("task-1", "task-2")
      .where(
        EntityQuery.all(
          EntityQuery.ge(columns.priority, 2),
          EntityQuery.either(
            EntityQuery.eq(columns.status, ProjectStatus.OPEN),
            EntityQuery.lt(columns.title, "Z"),
          ),
        ),
      )
      .orderBy(columns.priority, "desc")
      .orderBy(columns.title, "asc")
      .limit(10)
      .build();

    const roundTripped = fromBinary(QuerySchema, toBinary(QuerySchema, query));
    const filters = roundTripped.target?.criterion;

    expect(roundTripped.target?.type).toBe(
      "type.googleapis.com/spine_ts.client.test.ProjectOverviewState",
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
    expect(roundTripped.format?.fieldMask).toBeUndefined();
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
      schema: ProjectOverviewStateSchema,
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

  it("rejects invalid runtime limits before wire compilation", () => {
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context }).limit(1).build(),
    ).toThrow("Entity query limit requires ordering.");
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context }).limit(0),
    ).toThrow("positive integer");
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context }).limit(1.5),
    ).toThrow("positive integer");
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context }).byId(),
    ).toThrow("must not be empty");
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context }).byId(
        undefined as never,
      ),
    ).toThrow("must not be empty");
  });

  it("types ID filters from the selected Entity state", () => {
    const query = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context });
    query.byId("task-1");
    // @ts-expect-error A number is not the selected ProjectOverviewState string identifier.
    query.byId(1);
    // @ts-expect-error A generated message is not the selected ProjectOverviewState string identifier.
    query.byId(create(TimestampSchema));
  });

  it("packs descriptor and system column value families", () => {
    const query = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
      .where(
        EntityQuery.all(
          EntityQuery.eq(columns.active, false),
          EntityQuery.eq(columns.fingerprint, new Uint8Array([1, 2])),
          EntityQuery.eq(columns.status, ProjectStatus.CLOSED),
          EntityQuery.eq(columns.sequence, 4n),
          EntityQuery.gt(columns.dueAt, create(TimestampSchema, { seconds: 2n })),
          EntityQuery.eq(columns.version, create(VersionSchema, { number: 3 })),
          EntityQuery.eq(columns.archived, false),
          EntityQuery.eq(columns.deleted, false),
        ),
      )
      .build();

    expect(query.target?.criterion.case).toBe("filters");
    expect(query.format?.fieldMask).toBeUndefined();
    if (query.target?.criterion.case !== "filters") throw new Error("Expected filters.");
    expect(query.target.criterion.value.filter[0]?.filter).toHaveLength(8);
  });

  it("emits minimal include-all, ID-only, predicate-only, and order-only shapes", () => {
    const includeAll = EntityQuery.select({
      schema: ProjectOverviewStateSchema,
      columns,
      context,
    }).build();
    const idOnly = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
      .byId("task-1")
      .build();
    const predicateOnly = EntityQuery.select({
      schema: ProjectOverviewStateSchema,
      columns,
      context,
    })
      .where(EntityQuery.eq(columns.title, "A"))
      .build();
    const orderOnly = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
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
      schema: ProjectOverviewWithMetricsStateSchema,
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
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
        .where(cyclic as never)
        .buildPlan(),
    ).toThrow("must not contain cycles");

    let deep: unknown = leaf;
    for (let depth = 0; depth < 66; depth += 1) {
      deep = { kind: "all", predicates: [deep] };
    }
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
        .where(deep as never)
        .buildPlan(),
    ).toThrow("maximum depth 64");

    const wide = { kind: "all", predicates: new Array(10_001).fill(leaf) };
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
        .where(wide as never)
        .buildPlan(),
    ).toThrow("maximum node count 10000");
  });

  it("rejects more than 10000 distinct top-level predicates before build", () => {
    const builder = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context });
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
        EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
          .where(predicate as never)
          .build(),
      ).toThrow(expected);
    }
  });

  it("rejects an ID filter when the target descriptor has no ID field", () => {
    const schemaWithoutFields = {
      ...ProjectOverviewStateSchema,
      fields: [],
    } as unknown as typeof ProjectOverviewStateSchema;

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
    expect(() => gt(columns.status as never, ProjectStatus.OPEN as never)).toThrow(
      "does not support",
    );

    const valid = eq(columns.title, "A");
    const forged = { ...valid, operator: "unknown" } as never;
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context })
        .where(forged)
        .build(),
    ).toThrow("not recognized");

    const { title: omitted, ...withoutTitle } = columns;
    void omitted;
    expect(() =>
      EntityQuery.select({ schema: ProjectOverviewStateSchema, columns: withoutTitle, context })
        .where(valid as never)
        .build(),
    ).toThrow("does not belong");
  });

  it("keeps deferred targets and invalid value/operator pairs out of the public type surface", () => {
    const compileAssertions = (): void => {
      // @ts-expect-error enum columns do not support ordering.
      gt(columns.status, ProjectStatus.OPEN);
      // @ts-expect-error numeric columns reject string values.
      eq(columns.priority, "high");
      const builder = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context });
      // @ts-expect-error equality-only enum columns cannot be used for ordering.
      builder.orderBy(columns.status);
      // @ts-expect-error predicates from a different Projection cannot enter this builder.
      builder.where(eq(scalarColumns.doubleValue, 1));
      const selectedBuilder = EntityQuery.select({
        schema: ProjectOverviewStateSchema,
        columns: selectedColumns,
        context,
      });
      selectedBuilder.orderBy(selectedColumns.priority);
      // @ts-expect-error selected equality-only columns cannot be used for ordering.
      selectedBuilder.orderBy(selectedColumns.status);
      // @ts-expect-error foreign-schema columns cannot be used for ordering.
      selectedBuilder.orderBy(scalarColumns.doubleValue);
      // @ts-expect-error same-schema columns omitted from the selected collection cannot be ordered.
      selectedBuilder.orderBy(columns.title);
    };
    void compileAssertions;
  });

  it("offers no field-selection method on the authored builder", () => {
    const builder = EntityQuery.select({ schema: ProjectOverviewStateSchema, columns, context });
    expect("mask" in builder).toBe(false);
  });
});
