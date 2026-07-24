import { StringValueSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
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
} from "../../test-fixtures/entity-column-fixtures.js";
import {
  EntityColumn,
  type EntityColumnOperator,
  type EntityColumnValue,
  type EntityEqualityOperator,
  type EntityOrderingOperator,
} from "../../src/index.js";
import { defineGeneratedEntityColumns } from "../../src/codegen/index.js";
import { classifyEntityField } from "../../codegen/entity-field-classification.mjs";

const definition = defineGeneratedEntityColumns(ProjectionStateSchema, {
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

describe("EntityColumn", () => {
  it("prevents descriptor mutation before and after registration", () => {
    const field = definition.entries.title.field;
    const originalLocalName = field.localName;
    const changedBeforeRegistration = Reflect.set(field, "localName", "tampered");
    if (changedBeforeRegistration) Reflect.set(field, "localName", originalLocalName);

    expect(changedBeforeRegistration).toBe(false);
    expect(Object.isFrozen(field)).toBe(true);

    const columns = EntityColumn.register(ProjectionStateSchema, definition);
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

    const columns = EntityColumn.register(ProjectionStateSchema, definition);
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
    const generated = defineGeneratedEntityColumns(ProjectionStateSchema, { title });

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
    const columns = EntityColumn.register(ProjectionStateSchema, definition);

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
    const first = EntityColumn.register(ProjectionStateSchema, definition);
    const second = EntityColumn.register(ProjectionStateSchema, definition);
    const equivalent = EntityColumn.register(
      ProjectionStateSchema,
      defineGeneratedEntityColumns(ProjectionStateSchema, { ...definition.entries }),
    );

    expect(first).toBe(second);
    expect(equivalent).toBe(first);
    expect(second.title).toBe(first.title);
    expect(second.version).toBe(first.version);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.title)).toBe(true);
    expect(Object.isFrozen(first.title.operators)).toBe(true);
  });

  it("rejects direct construction and revalidates uncaptured runtime definitions", () => {
    expect(() => {
      Reflect.construct(EntityColumn, []);
    }).toThrow("Entity columns can only be constructed during registration.");

    const columns = EntityColumn.register(ProjectionStateSchema, definition);
    const uncaptured = { entries: definition.entries } as never;
    expect(EntityColumn.register(ProjectionStateSchema, uncaptured)).toBe(columns);

    expect(() =>
      EntityColumn.register(StringValueSchema, { entries: {} } as never),
    ).toThrow('Entity column schema "google.protobuf.StringValue" must declare Entity kind.');
  });

  it("preserves declared value and operator types for generated metadata", () => {
    const columns = EntityColumn.register(ProjectionStateSchema, definition);
    type TitleValue = EntityColumnValue<typeof columns.title>;
    type PriorityValue = EntityColumnValue<typeof columns.priority>;
    type StatusValue = EntityColumnValue<typeof columns.status>;
    type DueValue = EntityColumnValue<typeof columns.dueAt>;
    type OwnerValue = EntityColumnValue<typeof columns.owner>;
    type SequenceValue = EntityColumnValue<typeof columns.sequence>;

    expectTypeOf<TitleValue>().toEqualTypeOf<string>();
    expectTypeOf<PriorityValue>().toEqualTypeOf<number>();
    expectTypeOf<StatusValue>().toEqualTypeOf<FixtureStatus>();
    expectTypeOf<DueValue>().toEqualTypeOf<Timestamp | undefined>();
    expectTypeOf<OwnerValue>().toEqualTypeOf<Owner | undefined>();
    expectTypeOf<SequenceValue>().toEqualTypeOf<bigint>();
    expectTypeOf<EntityColumnValue<typeof columns.version>>().toEqualTypeOf<Version>();
    expectTypeOf<EntityColumnValue<typeof columns.archived>>().toEqualTypeOf<boolean>();
    expectTypeOf<
      EntityColumnOperator<typeof columns.title>
    >().toEqualTypeOf<EntityOrderingOperator>();
    expectTypeOf<
      EntityColumnOperator<typeof columns.status>
    >().toEqualTypeOf<EntityEqualityOperator>();
    expectTypeOf<
      EntityColumnOperator<typeof columns.version>
    >().toEqualTypeOf<EntityOrderingOperator>();

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
      EntityColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored unannotated fields are not generated definitions.
        note: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
      });
      EntityColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored unknown fields are not generated definitions.
        unknown: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
      });
      EntityColumn.register(ProjectionStateSchema, {
        // @ts-expect-error application-authored mismatched field metadata is not a generated definition.
        title: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
      });
      // @ts-expect-error arbitrary columns cannot be constructed by consumers.
      void new EntityColumn();
    };
    void compileTimeAssertions;
  });

  it("uses the shared descriptor classifier for runtime column metadata", () => {
    const columns = EntityColumn.register(ProjectionStateSchema, definition);
    for (const [localName, entry] of Object.entries(definition.entries)) {
      const classified = classifyEntityField(entry.field);
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
      EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, {
          ...definition.entries,
          title: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/definition key "title" must reference field "title"/);
    expect(() =>
      EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, {
          ...definition.entries,
          status: { field: ProjectionStateSchema.field.status, comparison: "ordering" },
        }),
      ),
    ).toThrow(/column "status" requires equality comparison metadata/);
    const { owner: _owner, ...missingOwner } = definition.entries;
    void _owner;
    expect(() =>
      EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, missingOwner),
      ),
    ).toThrow(/missing annotated field "owner"/);
    expect(() =>
      EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, {
          ...definition.entries,
          note: { field: ProjectionStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/field "note" is not marked \(column\)/);
    expect(() =>
      EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, {
          ...definition.entries,
          version: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
        } as never),
      ),
    ).toThrow(/cannot replace system column "version"/);
  });

  it("rejects repeated, map, and oneof columns before query or storage work", () => {
    expect(() =>
      EntityColumn.register(
        InvalidRepeatedStateSchema,
        // @ts-expect-error repeated descriptors cannot be generated Entity columns.
        defineGeneratedEntityColumns(InvalidRepeatedStateSchema, {
          tags: { field: InvalidRepeatedStateSchema.field.tags, comparison: "equality" },
        }),
      ),
    ).toThrow(/column "tags" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      EntityColumn.register(
        InvalidMapStateSchema,
        // @ts-expect-error map descriptors cannot be generated Entity columns.
        defineGeneratedEntityColumns(InvalidMapStateSchema, {
          labels: { field: InvalidMapStateSchema.field.labels, comparison: "equality" },
        }),
      ),
    ).toThrow(/column "labels" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      EntityColumn.register(
        InvalidOneofStateSchema,
        // @ts-expect-error oneof descriptors cannot be generated Entity columns.
        defineGeneratedEntityColumns(InvalidOneofStateSchema, {
          label: { field: InvalidOneofStateSchema.field.label, comparison: "ordering" },
        }),
      ),
    ).toThrow(/column "label" cannot belong to a oneof/);
  });

  it("registers declared columns for Aggregate and Process Manager schemas", () => {
    const aggregate = EntityColumn.register(
      AggregateStateSchema,
      defineGeneratedEntityColumns(AggregateStateSchema, {
        title: { field: AggregateStateSchema.field.title, comparison: "ordering" },
      }),
    );
    const processManager = EntityColumn.register(
      ProcessManagerStateSchema,
      defineGeneratedEntityColumns(ProcessManagerStateSchema, {
        title: { field: ProcessManagerStateSchema.field.title, comparison: "ordering" },
      }),
    );
    expect(aggregate.title.name).toBe("title");
    expect(processManager.title.name).toBe("title");
  });
});

function compare<Column extends EntityColumn>(
  column: Column,
  operator: EntityColumnOperator<Column>,
  value: EntityColumnValue<Column>,
): void {
  void column;
  void operator;
  void value;
}
