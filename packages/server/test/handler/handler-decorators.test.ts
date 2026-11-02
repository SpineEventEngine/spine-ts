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

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  parseJsonConfigFileContent,
  readConfigFile,
  sys,
  type CompilerOptions,
  type Diagnostic,
} from "typescript";
import { describe, expect, it } from "vitest";

import { Assign, Command, React, Subscribe, Throws, Where } from "../../src/index.js";
import { CreateProjectSchema } from "../../test-fixtures/generated/entity-metadata/project_commands_pb.js";
import { ProjectCreatedSchema } from "../../test-fixtures/generated/entity-metadata/project_events_pb.js";

it("creates a public Where method decorator", () => {
  const decorator = Where({ eventField: "board", equals: '{"value":"announcements"}' });

  expect(decorator).toBeTypeOf("function");
});

it("rejects an empty declared rejection list", () => {
  expect(() => Throws()).toThrow("@Throws requires at least one generated rejection declaration.");
});

it("rejects a declaration without a generated message schema", () => {
  expect(() => Throws({ schema: {} } as never)).toThrow(
    "@Throws accepts only generated rejection declarations.",
  );
});

function createFixtureCompilerOptions(): CompilerOptions {
  const configPath = join(process.cwd(), "tsconfig.base.json");
  const configFile = readConfigFile(configPath, (fileName) => readFileSync(fileName, "utf8"));

  if (configFile.error !== undefined) {
    throw new Error(formatDiagnostic(configFile.error));
  }

  const parsed = parseJsonConfigFileContent(configFile.config, sys, process.cwd());

  return {
    ...parsed.options,
    noEmit: true,
    types: ["node"],
  };
}

function compileSemanticTypeScriptFixture(source: string): readonly string[] {
  const fixturePath = join(
    process.cwd(),
    "packages/server/src/typed-decorator-semantic-fixture.ts",
  );
  const options = createFixtureCompilerOptions();
  const host = createCompilerHost(options);
  const hostReadFile = host.readFile.bind(host);
  const hostFileExists = host.fileExists.bind(host);
  const hostGetSourceFile = host.getSourceFile.bind(host);

  host.readFile = (fileName) => (fileName === fixturePath ? source : hostReadFile(fileName));
  host.fileExists = (fileName) => fileName === fixturePath || hostFileExists(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === fixturePath
      ? createSourceFile(fileName, source, languageVersion, true)
      : hostGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

  const program = createProgram([fixturePath], options, host);

  return getPreEmitDiagnostics(program).map(formatDiagnostic);
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const message = flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const diagnosticCode = String(diagnostic.code);

  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return `TS${diagnosticCode}: ${message}`;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const line = String(position.line + 1);
  const character = String(position.character + 1);

  return `${relative(
    process.cwd(),
    diagnostic.file.fileName,
  )}:${line}:${character} TS${diagnosticCode}: ${message}`;
}

describe("handler decorators", () => {
  it("semantically compiles typed decorated handler methods under the repo compiler", () => {
    const diagnostics = compileSemanticTypeScriptFixture(`
      import { Assign } from "./handler/handler-decorators.js";

      interface CreateTask {
        readonly taskId: string;
      }

      class TypedAggregate {
        @Assign
        create(command: CreateTask): void {
          void command.taskId;
        }
      }

      void TypedAggregate;
    `);

    expect(diagnostics).toEqual([]);
  }, 15_000);

  it("does not expose schema-bearing decorator overloads to public TypeScript callers", () => {
    const diagnostics = compileSemanticTypeScriptFixture(`
      import { Assign } from "./handler/handler-decorators.js";
      import type { DescriptorMessageSchema } from "./entity/entity-metadata.js";

      declare const CommandSchema: DescriptorMessageSchema;

      const decorator = Assign(CommandSchema);
      void decorator;
    `);

    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.stringContaining("Expected 2 arguments, but got 1.")]),
    );
  }, 15_000);

  it("rejects schema-bearing decorator calls at runtime", () => {
    for (const [decorator, schema] of [
      [Assign, CreateProjectSchema],
      [Command, CreateProjectSchema],
      [Subscribe, ProjectCreatedSchema],
      [React, ProjectCreatedSchema],
    ] as const) {
      expect(() => (decorator as (...args: unknown[]) => unknown)(schema)).toThrow(
        "Spine handler decorators require a standard method decorator context.",
      );
    }
  });

  it("accepts bare handler decorators without runtime metadata", () => {
    let calls = 0;
    const method = function handler(): void {
      calls += 1;
    };

    for (const decorator of [Assign, Command, Subscribe, React]) {
      expect(() => {
        decorator(method, decoratorContext({ metadata: undefined }));
      }).not.toThrow();
    }
    method();
    expect(calls).toBe(1);
  });

  it("rejects invalid standard decorator contexts", () => {
    const method = function handler(): void {
      return;
    };

    expect(() => {
      Assign(method, decoratorContext({ static: true }));
    }).toThrow("public instance methods");
    expect(() => {
      Assign(method, decoratorContext({ private: true }));
    }).toThrow("public instance methods");
    expect(() => {
      Assign(method, decoratorContext({ name: Symbol("handler") }));
    }).toThrow("string-named methods");
  });
});

type HandlerDecoratorContextOverrides = Partial<
  Omit<ClassMethodDecoratorContext<object, HandlerFixtureMethod>, "metadata">
> & {
  metadata?: ClassMethodDecoratorContext<object, HandlerFixtureMethod>["metadata"] | undefined;
};

function decoratorContext(
  overrides: HandlerDecoratorContextOverrides,
): ClassMethodDecoratorContext<object, HandlerFixtureMethod> {
  const context = {
    kind: "method",
    name: "handler",
    static: false,
    private: false,
    access: {
      has: () => true,
      get: () =>
        function handler(): void {
          return;
        },
    },
    metadata: {},
    addInitializer: () => {
      return;
    },
    ...overrides,
  };

  return context as ClassMethodDecoratorContext<object, HandlerFixtureMethod>;
}

type HandlerFixtureMethod = () => void;
