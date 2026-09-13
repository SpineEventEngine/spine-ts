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

import { StringValueSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Version } from "@spine-event-engine/proto";

import {
  ProjectStateSchema,
  ProjectStatus,
  ProjectOverviewWithLabelCatalogStateSchema,
  ProjectOverviewWithDisplayLabelStateSchema,
  ProjectOverviewWithTagsStateSchema,
  ProjectWorkflowStateSchema,
  ProjectOverviewStateSchema,
  type ProjectLead,
} from "../../test-fixtures/entity-column-fixtures.js";
import {
  EntityColumn,
  type EntityColumnOperator,
  type EntityColumnValue,
  type EntityEqualityOperator,
  type EntityOrderingOperator,
} from "../../src/index.js";
import { GeneratedEntityColumns } from "../../src/codegen/index.js";
import { EntityFieldClassification } from "../../src/query/entity-field-classification.js";

const { classify: classifyEntityField } = EntityFieldClassification;

const definition = GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
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
});

describe("EntityColumn", () => {
  it("prevents descriptor mutation before and after registration", () => {
    const field = definition.entries.title.field;
    const originalLocalName = field.localName;
    const changedBeforeRegistration = Reflect.set(field, "localName", "tampered");
    if (changedBeforeRegistration) Reflect.set(field, "localName", originalLocalName);

    expect(changedBeforeRegistration).toBe(false);
    expect(Object.isFrozen(field)).toBe(true);

    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);
    const originalName = field.name;
    const changedAfterRegistration = Reflect.set(field, "name", "tampered");
    if (changedAfterRegistration) Reflect.set(field, "name", originalName);

    expect(changedAfterRegistration).toBe(false);
    expect(columns.title).toMatchObject({ name: originalName, localName: originalLocalName });
    expect(columns.title.descriptor).toBe(field);
  });

  it("prevents nested descriptor metadata mutation before and after registration", () => {
    const ownerMessage = definition.entries.owner.field.message;
    if (ownerMessage === undefined) throw new Error("ProjectLead fixture must be message-valued.");
    const originalTypeName = ownerMessage.typeName;
    const changedBeforeRegistration = Reflect.set(ownerMessage, "typeName", "tampered.ProjectLead");
    if (changedBeforeRegistration) Reflect.set(ownerMessage, "typeName", originalTypeName);

    expect(changedBeforeRegistration).toBe(false);
    expect(Object.isFrozen(ownerMessage)).toBe(true);

    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);
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
      field: ProjectOverviewStateSchema.field.title,
      comparison: "ordering" as const,
    };
    const generated = GeneratedEntityColumns.define(ProjectOverviewStateSchema, { title });

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
    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);

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
      messageType: "spine_ts.client.test.ProjectLead",
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
    expect(columns.title.schema).toBe(ProjectOverviewStateSchema);
    expect(columns.title.descriptor).toBe(ProjectOverviewStateSchema.field.title);
    expect(columns.version.descriptor).toBeUndefined();
  });

  it("keeps metadata immutable and column identities stable by schema", () => {
    const first = EntityColumn.register(ProjectOverviewStateSchema, definition);
    const second = EntityColumn.register(ProjectOverviewStateSchema, definition);
    const equivalent = EntityColumn.register(
      ProjectOverviewStateSchema,
      GeneratedEntityColumns.define(ProjectOverviewStateSchema, { ...definition.entries }),
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

    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);
    const uncaptured = { entries: definition.entries } as never;
    expect(EntityColumn.register(ProjectOverviewStateSchema, uncaptured)).toBe(columns);

    expect(() => EntityColumn.register(StringValueSchema, { entries: {} } as never)).toThrow(
      'Entity column schema "google.protobuf.StringValue" must declare Entity kind.',
    );
  });

  it("preserves declared value and operator types for generated metadata", () => {
    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);
    type TitleValue = EntityColumnValue<typeof columns.title>;
    type PriorityValue = EntityColumnValue<typeof columns.priority>;
    type StatusValue = EntityColumnValue<typeof columns.status>;
    type DueValue = EntityColumnValue<typeof columns.dueAt>;
    type ProjectLeadValue = EntityColumnValue<typeof columns.owner>;
    type SequenceValue = EntityColumnValue<typeof columns.sequence>;

    expectTypeOf<TitleValue>().toEqualTypeOf<string>();
    expectTypeOf<PriorityValue>().toEqualTypeOf<number>();
    expectTypeOf<StatusValue>().toEqualTypeOf<ProjectStatus>();
    expectTypeOf<DueValue>().toEqualTypeOf<Timestamp | undefined>();
    expectTypeOf<ProjectLeadValue>().toEqualTypeOf<ProjectLead | undefined>();
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
    compare(columns.status, "equal", ProjectStatus.OPEN);
    compare(columns.sequence, "greaterOrEqual", 10n);
    // @ts-expect-error enum columns do not support ordering operators.
    compare(columns.status, "greaterThan", ProjectStatus.OPEN);
    // @ts-expect-error numeric columns reject string comparison values.
    compare(columns.priority, "equal", "high");
    // @ts-expect-error generated metadata exposes only annotated and system columns.
    void columns.id;
    // @ts-expect-error unannotated schema fields are not generated columns.
    void columns.note;
    const compileTimeAssertions = (): void => {
      EntityColumn.register(ProjectOverviewStateSchema, {
        // @ts-expect-error application-authored unannotated fields are not generated definitions.
        note: { field: ProjectOverviewStateSchema.field.note, comparison: "ordering" },
      });
      EntityColumn.register(ProjectOverviewStateSchema, {
        // @ts-expect-error application-authored unknown fields are not generated definitions.
        unknown: { field: ProjectOverviewStateSchema.field.title, comparison: "ordering" },
      });
      EntityColumn.register(ProjectOverviewStateSchema, {
        // @ts-expect-error application-authored mismatched field metadata is not a generated definition.
        title: { field: ProjectOverviewStateSchema.field.note, comparison: "ordering" },
      });
      // @ts-expect-error arbitrary columns cannot be constructed by consumers.
      void new EntityColumn();
    };
    void compileTimeAssertions;
  });

  it("uses the shared descriptor classifier for runtime column metadata", () => {
    const columns = EntityColumn.register(ProjectOverviewStateSchema, definition);
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

  it("recognizes 64-bit fields configured for string representation", () => {
    const stringLong = {
      ...ProjectOverviewStateSchema.field.sequence,
      longAsString: true,
    };

    expect(classifyEntityField(stringLong)).toMatchObject({
      supported: true,
      valueKind: "string",
      comparison: "ordering",
    });
  });

  it("rejects incomplete, mismatched, and incorrectly classified definitions", () => {
    expect(() =>
      EntityColumn.register(
        ProjectOverviewStateSchema,
        GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
          ...definition.entries,
          title: { field: ProjectOverviewStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/definition key "title" must reference field "title"/);
    expect(() =>
      EntityColumn.register(
        ProjectOverviewStateSchema,
        GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
          ...definition.entries,
          status: { field: ProjectOverviewStateSchema.field.status, comparison: "ordering" },
        }),
      ),
    ).toThrow(/column "status" requires equality comparison metadata/);
    const { owner: _owner, ...missingProjectLead } = definition.entries;
    void _owner;
    expect(() =>
      EntityColumn.register(
        ProjectOverviewStateSchema,
        GeneratedEntityColumns.define(ProjectOverviewStateSchema, missingProjectLead),
      ),
    ).toThrow(/missing annotated field "owner"/);
    expect(() =>
      EntityColumn.register(
        ProjectOverviewStateSchema,
        GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
          ...definition.entries,
          note: { field: ProjectOverviewStateSchema.field.note, comparison: "ordering" },
        }),
      ),
    ).toThrow(/field "note" is not marked \(column\)/);
    expect(() =>
      EntityColumn.register(
        ProjectOverviewStateSchema,
        GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
          ...definition.entries,
          version: { field: ProjectOverviewStateSchema.field.title, comparison: "ordering" },
        } as never),
      ),
    ).toThrow(/cannot replace system column "version"/);
  });

  it("rejects repeated, map, and oneof columns before query or storage work", () => {
    expect(() =>
      EntityColumn.register(
        ProjectOverviewWithTagsStateSchema,
        // @ts-expect-error repeated descriptors cannot be generated Entity columns.
        GeneratedEntityColumns.define(ProjectOverviewWithTagsStateSchema, {
          tags: { field: ProjectOverviewWithTagsStateSchema.field.tags, comparison: "equality" },
        }),
      ),
    ).toThrow(/column "tags" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      EntityColumn.register(
        ProjectOverviewWithLabelCatalogStateSchema,
        // @ts-expect-error map descriptors cannot be generated Entity columns.
        GeneratedEntityColumns.define(ProjectOverviewWithLabelCatalogStateSchema, {
          labels: {
            field: ProjectOverviewWithLabelCatalogStateSchema.field.labels,
            comparison: "equality",
          },
        }),
      ),
    ).toThrow(/column "labels" must be singular; repeated and map fields are unsupported/);
    expect(() =>
      EntityColumn.register(
        ProjectOverviewWithDisplayLabelStateSchema,
        // @ts-expect-error oneof descriptors cannot be generated Entity columns.
        GeneratedEntityColumns.define(ProjectOverviewWithDisplayLabelStateSchema, {
          label: {
            field: ProjectOverviewWithDisplayLabelStateSchema.field.label,
            comparison: "ordering",
          },
        }),
      ),
    ).toThrow(/column "label" cannot belong to a oneof/);
  });

  it("registers declared columns for Aggregate and Process Manager schemas", () => {
    const aggregate = EntityColumn.register(
      ProjectStateSchema,
      GeneratedEntityColumns.define(ProjectStateSchema, {
        title: { field: ProjectStateSchema.field.title, comparison: "ordering" },
      }),
    );
    const processManager = EntityColumn.register(
      ProjectWorkflowStateSchema,
      GeneratedEntityColumns.define(ProjectWorkflowStateSchema, {
        title: { field: ProjectWorkflowStateSchema.field.title, comparison: "ordering" },
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
