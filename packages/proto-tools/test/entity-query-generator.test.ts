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

import type { Schema } from "@bufbuild/protoplugin";
import { describe, expect, it } from "vitest";
// prettier-ignore
import {
  file_entity_metadata_project_states,
} from "../../server/test-fixtures/generated/entity-metadata/project_states_pb.js";
// prettier-ignore
import {
  file_entity_metadata_invalid_column,
} from "../../server/test-fixtures/generated/entity-metadata/invalid-column_pb.js";
import { file_project_states } from "../../core/test-fixtures/generated/project_states_pb.js";
import { EntityQueryGenerator } from "../src/generation/entity-query-generator.js";

describe("EntityQueryGenerator", () => {
  it("emits a ready-to-import query for each eligible Entity kind", () => {
    const generated: string[] = [];
    const printed: string[] = [];
    const schema = {
      files: [file_entity_metadata_project_states],
      allFiles: [file_entity_metadata_project_states],
      typesInFile: () => [],
      generateFile: (name: string) => {
        generated.push(name);
        return {
          import: (name_: string) => name_,
          importSchema: (message: { readonly name: string }) => `${message.name}Schema`,
          preamble: () => undefined,
          export: (kind: string, name_: string) => `export ${kind} ${name_}`,
          print: (...parts: readonly string[]) => printed.push(parts.join("")),
        };
      },
    } as unknown as Schema;

    EntityQueryGenerator.generate(schema);

    expect(generated).toEqual(["entity-metadata/project_states_query.ts"]);
    const source = printed.join("\n");
    expect(source).toContain("export const ProjectOverviewStateQuery");
    expect(source).toContain("export const ProjectStateQuery");
    expect(source).toContain("export const ProjectWorkflowStateQuery");
    expect(source).toContain("GeneratedEntityColumns.define");
    expect(source).toContain("EntityColumn.register");
    expect(source).toContain(
      '"priority": { field: ProjectOverviewStateSchema.field["priority"], comparison: "ordering" }',
    );
    expect(source).toContain('idField: "id"');
  });

  it("rejects invalid marked columns in a normal application model", () => {
    const schema = {
      files: [file_entity_metadata_invalid_column],
      allFiles: [file_entity_metadata_invalid_column],
      generateFile: () => {
        throw new Error("invalid model must not emit a query");
      },
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(schema);
    }).toThrow(/column "tags" must be singular/u);
  });

  it.each([
    ["ProjectOverviewWithTagsState", /column "tags" must be singular/u],
    ["ProjectOverviewWithLabelCatalogState", /column "labels" must be singular/u],
    ["ProjectOverviewWithDisplayLabelState", /column "label" must be singular/u],
  ])("rejects the %s fixture column even with a legacy allowance", (name, error) => {
    const message = file_project_states.messages.find((candidate) => candidate.name === name);
    if (message === undefined) throw new Error(`Missing fixture state ${name}`);
    const schema = {
      files: [{ ...file_project_states, messages: [message] }],
      allFiles: [file_project_states],
      options: { fixtureInvalidColumns: true },
      generateFile: () => {
        throw new Error("Invalid query must not be emitted");
      },
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(schema);
    }).toThrow(error);
  });

  it("rejects a reserved system column despite a legacy allowance", () => {
    const state = file_entity_metadata_project_states.messages.find(
      (candidate) => candidate.name === "ProjectOverviewState",
    );
    if (state === undefined) throw new Error("Missing overview state fixture");
    const name = state.fields.find((field) => field.localName === "name");
    if (name === undefined) throw new Error("Missing name column fixture");
    const schema = {
      files: [
        {
          ...file_entity_metadata_project_states,
          messages: [{ ...state, fields: [{ ...name, localName: "archived" }] }],
        },
      ],
      allFiles: [file_entity_metadata_project_states],
      options: { fixtureInvalidColumns: true },
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(schema);
    }).toThrow(/reserved system column "archived"/u);
  });

  it("emits the comparison families of a valid state without hiding other invalid fixtures", () => {
    const overview = file_project_states.messages.find(
      (candidate) => candidate.name === "ProjectOverviewState",
    );
    if (overview === undefined) throw new Error("Missing overview fixture");
    const printed: string[] = [];
    const schema = {
      files: [{ ...file_project_states, messages: [overview] }],
      allFiles: [file_project_states],
      generateFile: () => ({
        import: (name: string) => name,
        importSchema: () => "ProjectOverviewStateSchema",
        preamble: () => undefined,
        export: (kind: string, name: string) => `export ${kind} ${name}`,
        print: (...parts: readonly string[]) => printed.push(parts.join("")),
      }),
    } as unknown as Schema;
    EntityQueryGenerator.generate(schema);
    const source = printed.join("\n");
    expect(source).toContain(
      '"status": { field: ProjectOverviewStateSchema.field["status"], comparison: "equality" }',
    );
    expect(source).toContain(
      '"fingerprint": { field: ProjectOverviewStateSchema.field["fingerprint"], comparison: "equality" }',
    );
    expect(source).toContain(
      '"active": { field: ProjectOverviewStateSchema.field["active"], comparison: "equality" }',
    );
    expect(source).toContain(
      '"dueAt": { field: ProjectOverviewStateSchema.field["dueAt"], comparison: "ordering" }',
    );
    expect(source).toContain(
      '"owner": { field: ProjectOverviewStateSchema.field["owner"], comparison: "equality" }',
    );
  });

  it("does not emit a query for files without an eligible Entity state", () => {
    const noEntities = {
      files: [{ ...file_project_states, messages: [] }],
      allFiles: [file_project_states],
      generateFile: () => {
        throw new Error("No query companion is expected");
      },
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(noEntities);
    }).not.toThrow();
    const noSpineOptions = {
      files: [{ ...file_project_states, proto: { ...file_project_states.proto, dependency: [] } }],
      allFiles: [],
      generateFile: () => {
        throw new Error("No query companion is expected");
      },
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(noSpineOptions);
    }).not.toThrow();
  });

  it("rejects an Entity state with no canonical ID field", () => {
    const overview = file_project_states.messages.find(
      (candidate) => candidate.name === "ProjectOverviewState",
    );
    if (overview === undefined) throw new Error("Missing overview fixture");
    const schema = {
      files: [{ ...file_project_states, messages: [{ ...overview, fields: [] }] }],
      allFiles: [file_project_states],
      generateFile: () => ({
        import: () => "Unused",
        preamble: () => undefined,
      }),
    } as unknown as Schema;
    expect(() => {
      EntityQueryGenerator.generate(schema);
    }).toThrow(/has no ID field/u);
  });
});
