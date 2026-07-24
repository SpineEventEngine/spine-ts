import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Version } from "@spine-event-engine/proto";

import {
  AggregateStateSchema,
  FixtureStatus,
  InvalidMapStateSchema,
  InvalidOneofStateSchema,
  InvalidRepeatedStateSchema,
  ProcessManagerStateSchema,
  ProjectionStateSchema,
  type Owner,
} from "../../test-fixtures/projection-column-fixtures.js";
import {
  ProjectionColumn,
  type ProjectionColumnOperator,
  type ProjectionColumnValue,
  type ProjectionEqualityOperator,
  type ProjectionOrderingOperator,
} from "../../src/index.js";
import { defineGeneratedProjectionColumns } from "../../src/codegen/index.js";
import { classifyProjectionField } from "../../codegen/projection-field-classification.mjs";

const definition = defineGeneratedProjectionColumns(ProjectionStateSchema, {
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
});

describe("ProjectionColumn", () => {
  it("prevents descriptor mutation before and after registration", () => {
    const field = definition.entries.title.field;
    const originalLocalName = field.localName;
    const changedBeforeRegistration = Reflect.set(field, "localName", "tampered");
    if (changedBeforeRegistration) Reflect.set(field, "localName", originalLocalName);

    expect(changedBeforeRegistration).toBe(false);
    expect(Object.isFrozen(field)).toBe(true);

    const columns = ProjectionColumn.register(ProjectionStateSchema, definition);
    const originalName = field.name;
    const changedAfterRegistration = Reflect.set(field, "name", "tampered");
    if (changedAfterRegistration) Reflect.set(field, "name", originalName);

    expect(changedAfterRegistration).toBe(false);
    expect(columns.title).toMatchObject({ name: originalName, localName: originalLocalName });
    expect(columns.title.descriptor).toBe(field);
  });

  it("prevents nested descriptor metadata mutation before and after registration", () => {
    const ownerMessage = definition.entries.owner.field.message;
    if (ownerMessage === undefined) throw new Error("Owner fixture must be message-valued.");
    const originalTypeName = ownerMessage.typeName;
    const changedBeforeRegistration = Reflect.set(ownerMessage, "typeName", "tampered.Owner");
    if (changedBeforeRegistration) Reflect.set(ownerMessage, "typeName", originalTypeName);

    expect(changedBeforeRegistration).toBe(false);
    expect(Object.isFrozen(ownerMessage)).toBe(true);

    const columns = ProjectionColumn.register(ProjectionStateSchema, definition);
    const options = definition.entries.title.field.proto.options;
    if (options === undefined) throw new Error("Title fixture must declare field options.");
    const originalDeprecated = options.deprecated;
    const changedAfterRegistration = Reflect.set(options, "deprecated", !originalDeprecated);
    if (changedAfterRegistration) Reflect.set(options, "deprecated", originalDeprecated);

    expect(changedAfterRegistration).toBe(false);
    expect(Object.isFrozen(options)).toBe(true);
    expect(columns.owner).toMatchObject({
      messageType: originalTypeName,
      comparison: "equality",
    });
  });

  it("copies and deeply freezes generated definition entries", () => {
    const title = {
      field: ProjectionStateSchema.field.title,
      comparison: "ordering" as const,
    };
    const generated = defineGeneratedProjectionColumns(ProjectionStateSchema, { title });

    expect(generated.entries.title).not.toBe(title);
    expect(Object.isFrozen(generated.entries)).toBe(true);
    expect(Object.isFrozen(generated.entries.title)).toBe(true);
    expect(() => {
      Object.assign(generated.entries.title, { comparison: "equality" });
    }).toThrow(TypeError);
    Object.assign(title, { comparison: "equality" });
    expect(generated.entries.title.comparison).toBe("ordering");
  });

  it("registers declared and system columns with matching runtime metadata", () => {
    const columns = ProjectionColumn.register(ProjectionStateSchema, definition);

    expect(Object.keys(columns)).toEqual([
      "title",
      "priority",
      "status",
      "dueAt",
      "owner",
      "fingerprint",
      "active",
      "sequence",
      "version",
      "archived",
      "deleted",
    ]);
    expect(columns.title).toMatchObject({
      name: "title",
      localName: "title",
      source: "declared",
      valueKind: "string",
      comparison: "ordering",
      operators: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
    });
    expect(columns.status).toMatchObject({
      name: "status",
      valueKind: "enum",
      comparison: "equality",
      operators: ["equal"],
    });
    expect(columns.dueAt).toMatchObject({
      name: "due_at",
      localName: "dueAt",
      valueKind: "message",
      messageType: "google.protobuf.Timestamp",
      comparison: "ordering",
    });
    expect(columns.owner).toMatchObject({
      valueKind: "message",
      messageType: "spine_ts.client.test.Owner",
      comparison: "equality",
    });
    expect(columns.fingerprint.valueKind).toBe("bytes");
    expect(columns.active.valueKind).toBe("boolean");
    expect(columns.sequence.valueKind).toBe("bigint");
    expect(columns.version).toMatchObject({
      name: "version",
      source: "system",
      valueKind: "message",
      messageType: "spine.core.Version",
      comparison: "ordering",
    });
    expect(columns.archived).toMatchObject({
      name: "archived",
      source: "system",
      valueKind: "boolean",
      comparison: "equality",
    });
    expect(columns.deleted).toMatchObject({
      name: "deleted",
      source: "system",
      valueKind: "boolean",
      comparison: "equality",
    });
    expect(columns.title.schema).toBe(ProjectionStateSchema);
    expect(columns.title.descriptor).toBe(ProjectionStateSchema.field.title);
    expect(columns.version.descriptor).toBeUndefined();
  });

  it("keeps metadata immutable and column identities stable by schema", () => {
    const first = ProjectionColumn.register(ProjectionStateSchema, definition);
    const second = ProjectionColumn.register(ProjectionStateSchema, definition);
    const equivalent = ProjectionColumn.register(
      ProjectionStateSchema,
      defineGeneratedProjectionColumns(ProjectionStateSchema, { ...definition.entries }),
    );

    expect(first).toBe(second);
    expect(equivalent).toBe(first);
    expect(second.title).toBe(first.title);
    expect(second.version).toBe(first.version);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.title)).toBe(true);
    expect(Object.isFrozen(first.title.operators)).toBe(true);
  });

  it("preserves declared value and operator types for generated metadata", () => {
    const columns = ProjectionColumn.register(ProjectionStateSchema, definition);
    type TitleValue = ProjectionColumnValue<typeof columns.title>;
    type PriorityValue = ProjectionColumnValue<typeof columns.priority>;
    type StatusValue = ProjectionColumnValue<typeof columns.status>;
    type DueValue = ProjectionColumnValue<typeof columns.dueAt>;
    type OwnerValue = ProjectionColumnValue<typeof columns.owner>;
    type SequenceValue = ProjectionColumnValue<typeof columns.sequence>;

    expectTypeOf<TitleValue>().toEqualTypeOf<string>();
    expectTypeOf<PriorityValue>().toEqualTypeOf<number>();
    expectTypeOf<StatusValue>().toEqualTypeOf<FixtureStatus>();
    expectTypeOf<DueValue>().toEqualTypeOf<Timestamp | undefined>();
    expectTypeOf<OwnerValue>().toEqualTypeOf<Owner | undefined>();
    expectTypeOf<SequenceValue>().toEqualTypeOf<bigint>();
    expectTypeOf<ProjectionColumnValue<typeof columns.version>>().toEqualTypeOf<Version>();
    expectTypeOf<ProjectionColumnValue<typeof columns.archived>>().toEqualTypeOf<boolean>();
    expectTypeOf<
      ProjectionColumnOperator<typeof columns.title>
    >().toEqualTypeOf<ProjectionOrderingOperator>();
    expectTypeOf<
      ProjectionColumnOperator<typeof columns.status>
    >().toEqualTypeOf<ProjectionEqualityOperator>();
    expectTypeOf<
      ProjectionColumnOperator<typeof columns.version>
    >().toEqualTypeOf<ProjectionOrderingOperator>();

    compare(columns.priority, "greaterThan", 10);
    compare(columns.status, "equal", FixtureStatus.OPEN);
    compare(columns.sequence, "greaterOrEqual", 10n);
    // @ts-expect-error enum columns do not support ordering operators.
    compare(columns.status, "greaterThan", FixtureStatus.OPEN);
    // @ts-expect-error numeric columns reject string comparison values.
    compare(columns.priority, "equal", "high");
    // @ts-expect-error generated metadata exposes only annotated and system columns.
    void columns.id;
    // @ts-expect-error unannotated schema fields are not generated columns.
    void columns.note;
    const compileTimeAssertions = (): void => {
      ProjectionColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored unannotated fields are not generated definitions.
        note: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
      });
      ProjectionColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored unknown fields are not generated definitions.
        unknown: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
      });
      ProjectionColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored mismatched field metadata is not a generated definition.
        title: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
      });
      // @ts-expect-error arbitrary columns cannot be constructed by consumers.
      void new ProjectionColumn();
    };
    void compileTimeAssertions;
  });

  it("uses the shared descriptor classifier for runtime column metadata", () => {
    const columns = ProjectionColumn.register(ProjectionStateSchema, definition);
    for (const [localName, entry] of Object.entries(definition.entries)) {
      const classified = classifyProjectionField(entry.field);
      expect(classified.supported).toBe(true);
      if (!classified.supported) continue;
      expect(columns[localName as keyof typeof columns]).toMatchObject({
        comparison: classified.comparison,
        valueKind: classified.valueKind,
        messageType: classified.messageType,
      });
    }
  });

  it("rejects incomplete, mismatched, and incorrectly classified definitions", () => {
    expect(() =>
      ProjectionColumn.register(
        ProjectionStateSchema,
        defineGeneratedProjectionColumns(ProjectionStateSchema, {
          ...definition.entries,
          title: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/definition key "title" must reference field "title"/);
    expect(() =>
      ProjectionColumn.register(
        ProjectionStateSchema,
        defineGeneratedProjectionColumns(ProjectionStateSchema, {
          ...definition.entries,
          status: { field: ProjectionStateSchema.field.status, comparison: "ordering" },
        }),
      ),
    ).toThrow(/column "status" requires equality comparison metadata/);
    const { owner: _owner, ...missingOwner } = definition.entries;
    void _owner;
    expect(() =>
      ProjectionColumn.register(
        ProjectionStateSchema,
        defineGeneratedProjectionColumns(ProjectionStateSchema, missingOwner),
      ),
    ).toThrow(/missing annotated field "owner"/);
    expect(() =>
      ProjectionColumn.register(
        ProjectionStateSchema,
        defineGeneratedProjectionColumns(ProjectionStateSchema, {
          ...definition.entries,
          note: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/field "note" is not marked \(column\)/);
    expect(() =>
      ProjectionColumn.register(
        ProjectionStateSchema,
        defineGeneratedProjectionColumns(ProjectionStateSchema, {
          ...definition.entries,
          version: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
        } as never),
      ),
    ).toThrow(/cannot replace system column "version"/);
  });

  it("rejects repeated, map, and oneof columns before query or storage work", () => {
    expect(() =>
      ProjectionColumn.register(
        InvalidRepeatedStateSchema,
        // @ts-expect-error repeated descriptors cannot be generated Projection columns.
        defineGeneratedProjectionColumns(InvalidRepeatedStateSchema, {
          tags: { field: InvalidRepeatedStateSchema.field.tags, comparison: "equality" },
        }),
      ),
    ).toThrow(/column "tags" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      ProjectionColumn.register(
        InvalidMapStateSchema,
        // @ts-expect-error map descriptors cannot be generated Projection columns.
        defineGeneratedProjectionColumns(InvalidMapStateSchema, {
          labels: { field: InvalidMapStateSchema.field.labels, comparison: "equality" },
        }),
      ),
    ).toThrow(/column "labels" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      ProjectionColumn.register(
        InvalidOneofStateSchema,
        // @ts-expect-error oneof descriptors cannot be generated Projection columns.
        defineGeneratedProjectionColumns(InvalidOneofStateSchema, {
          label: { field: InvalidOneofStateSchema.field.label, comparison: "ordering" },
        }),
      ),
    ).toThrow(/column "label" cannot belong to a oneof/);
  });

  it("rejects Aggregate and Process Manager schemas from the Projection-only model", () => {
    expect(() =>
      ProjectionColumn.register(
        AggregateStateSchema,
        defineGeneratedProjectionColumns(AggregateStateSchema, {
          title: { field: AggregateStateSchema.field.title, comparison: "ordering" },
        }),
      ),
    ).toThrow(/schema "spine_ts\.client\.test\.AggregateState" must declare Projection kind/);
    expect(() =>
      ProjectionColumn.register(
        ProcessManagerStateSchema,
        defineGeneratedProjectionColumns(ProcessManagerStateSchema, {
          title: { field: ProcessManagerStateSchema.field.title, comparison: "ordering" },
        }),
      ),
    ).toThrow(/schema "spine_ts\.client\.test\.ProcessManagerState" must declare Projection kind/);
  });
});

function compare<Column extends ProjectionColumn>(
  column: Column,
  operator: ProjectionColumnOperator<Column>,
  value: ProjectionColumnValue<Column>,
): void {
  void column;
  void operator;
  void value;
}
