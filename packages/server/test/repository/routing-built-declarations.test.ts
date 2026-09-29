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

import { join } from "node:path";
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
} from "typescript";
import { expect, it } from "vitest";

const packageRoot = join(process.cwd(), "packages/server");
const common = `
import { Aggregate, Projection, Repository, CommandRouting, EventRouting,
  StateUpdateRouting, type RepositoryOptions } from "@spine-event-engine/server";
import { ProjectStateSchema, ProjectOverviewStateSchema } from
  "./test-fixtures/generated/repository-routing/project_states_pb.js";
class PrimaryAggregate extends Aggregate<string, typeof ProjectStateSchema> {
  primary(): void {}
}
class OtherAggregate extends Aggregate<string, typeof ProjectStateSchema> {
  other(): void {}
}
class PrimaryProjection extends Projection<string, typeof ProjectOverviewStateSchema> {
  primary(): void {}
}
class OtherProjection extends Projection<string, typeof ProjectOverviewStateSchema> {
  other(): void {}
}
`;

const cases: Readonly<Record<string, string>> = {
  valid: `
const command: RepositoryOptions<typeof PrimaryAggregate> = {
  entityType: PrimaryAggregate, schema: ProjectStateSchema,
  commandRouting: CommandRouting.create(PrimaryAggregate),
};
const event: RepositoryOptions<typeof PrimaryAggregate> = {
  entityType: PrimaryAggregate, schema: ProjectStateSchema,
  eventRouting: EventRouting.create(PrimaryAggregate),
};
const state: RepositoryOptions<typeof PrimaryProjection> = {
  entityType: PrimaryProjection, schema: ProjectOverviewStateSchema,
  stateUpdateRouting: StateUpdateRouting.create(PrimaryProjection),
};
new Repository(command);
new Repository(event);
new Repository(state);
new Repository({ entityType: OtherAggregate, schema: ProjectStateSchema,
  commandRouting: CommandRouting.create<string>(),
  eventRouting: EventRouting.create<string>() });
new Repository({ entityType: OtherProjection, schema: ProjectOverviewStateSchema,
  stateUpdateRouting: StateUpdateRouting.create<string>() });
`,
  commandOption: `const value: RepositoryOptions<typeof OtherAggregate> = {
  entityType: OtherAggregate, schema: ProjectStateSchema,
  commandRouting: CommandRouting.create(PrimaryAggregate) };`,
  commandRepository: `new Repository({ entityType: OtherAggregate,
  schema: ProjectStateSchema, commandRouting: CommandRouting.create(PrimaryAggregate) });`,
  eventOption: `const value: RepositoryOptions<typeof OtherAggregate> = {
  entityType: OtherAggregate, schema: ProjectStateSchema,
  eventRouting: EventRouting.create(PrimaryAggregate) };`,
  eventRepository: `new Repository({ entityType: OtherAggregate,
  schema: ProjectStateSchema, eventRouting: EventRouting.create(PrimaryAggregate) });`,
  stateOption: `const value: RepositoryOptions<typeof OtherProjection> = {
  entityType: OtherProjection, schema: ProjectOverviewStateSchema,
  stateUpdateRouting: StateUpdateRouting.create(PrimaryProjection) };`,
  stateRepository: `new Repository({ entityType: OtherProjection,
  schema: ProjectOverviewStateSchema,
  stateUpdateRouting: StateUpdateRouting.create(PrimaryProjection) });`,
};

it("keeps class-aware routing constraints in built package declarations", () => {
  const files = new Map(
    Object.entries(cases).map(([name, source]) => [
      join(packageRoot, `.routing-built-consumer-${name}.ts`),
      common + source,
    ]),
  );
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    target: ScriptTarget.ES2024,
  };
  const host = createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (path) => files.get(path) ?? readFile(path);
  host.fileExists = (path) => files.has(path) || fileExists(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = files.get(path);
    return source === undefined
      ? getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
      : createSourceFile(path, source, languageVersion, true);
  };
  const program = createProgram([...files.keys()], options, host);
  expect(program.getSourceFile(join(packageRoot, "dist/index.d.ts"))).toBeDefined();
  expect(program.getSourceFile(join(packageRoot, "src/index.ts"))).toBeUndefined();
  const diagnostics = getPreEmitDiagnostics(program);
  const byFile = new Map<string, string[]>();
  for (const diagnostic of diagnostics) {
    const path = diagnostic.file?.fileName ?? "<global>";
    const messages = byFile.get(path) ?? [];
    messages.push(flattenDiagnosticMessageText(diagnostic.messageText, " "));
    byFile.set(path, messages);
  }
  const validPath = join(packageRoot, ".routing-built-consumer-valid.ts");
  expect(byFile.get(validPath) ?? []).toEqual([]);
  for (const name of Object.keys(cases).filter((value) => value !== "valid")) {
    const path = join(packageRoot, `.routing-built-consumer-${name}.ts`);
    expect(byFile.get(path), name).toBeDefined();
  }
  expect([...byFile.keys()].filter((path) => !files.has(path))).toEqual([]);
});
