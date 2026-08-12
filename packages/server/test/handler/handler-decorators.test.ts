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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  parseJsonConfigFileContent,
  readConfigFile,
  ScriptTarget,
  sys,
  transpileModule,
  type CompilerOptions,
  type Diagnostic,
} from "typescript";
import { describe, expect, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  Apply,
  Assign,
  Command,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  React,
  Subscribe,
  Where,
  EntityHandlers,
  materializeDecoratedEntityHandlers,
} from "../../src/index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

it("creates a public Where method decorator", () => {
  const decorator = Where({ eventField: "board", equals: '{"value":"announcements"}' });

  expect(decorator).toBeTypeOf("function");
});

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server handler decorator fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

interface DecoratedClassFactoryInput {
  readonly Assign: typeof Assign;
  readonly Command: typeof Command;
  readonly Subscribe: typeof Subscribe;
  readonly React: typeof React;
  readonly Apply: typeof Apply;
  readonly CommandSchema: typeof CommandSchema;
  readonly EventSchema: typeof EventSchema;
}

interface DecoratedClassFactoryOutput {
  readonly DecoratedProjection: new () => object;
  readonly DecoratedAggregate: new () => object;
  readonly DecoratedFallbackProjection: new () => object;
  readonly FirstDecoratedProjection: new () => object;
  readonly SecondDecoratedProjection: new () => object;
  readonly SourceCopiedProjection: new () => object;
  readonly BorrowingProjection: new () => object;
  readonly DecoratedBaseProjection: new () => object;
  readonly UndecoratedOverrideProjection: new () => object;
  readonly BareDecoratedProjection: new () => object;
}

async function createDecoratedClasses(): Promise<DecoratedClassFactoryOutput> {
  const source = `
    export function defineDecoratedClasses({
      Assign,
      Command,
      Subscribe,
      React,
      Apply,
      CommandSchema,
      EventSchema,
    }) {
      class DecoratedProjection {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }

        @Command(CommandSchema)
        commandFromCommand(command) {
          void command;
        }

        @Subscribe(EventSchema)
        subscribeCreated(event) {
          void event;
        }

        @React(EventSchema)
        reactToCreated(event) {
          void event;
        }

        @Apply(EventSchema, { allowImport: true })
        applyCreated(event) {
          void event;
        }
      }

      class DecoratedAggregate {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }

        @Apply(EventSchema)
        applyCreated(event) {
          void event;
        }
      }

      class DecoratedFallbackProjection {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }

        @Apply(EventSchema, { allowImport: true })
        applyCreated(event) {
          void event;
        }
      }

      class FirstDecoratedProjection {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }
      }

      class SecondDecoratedProjection {
        @Apply(EventSchema)
        applyCreated(event) {
          void event;
        }
      }

      class SourceCopiedProjection {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }
      }

      class BorrowingProjection {}

      Object.defineProperty(
        BorrowingProjection.prototype,
        "assignCreate",
        Object.getOwnPropertyDescriptor(SourceCopiedProjection.prototype, "assignCreate"),
      );

      class DecoratedBaseProjection {
        @Assign(CommandSchema)
        assignCreate(command) {
          void command;
        }
      }

      class UndecoratedOverrideProjection extends DecoratedBaseProjection {
        assignCreate(command) {
          void command;
        }
      }

      class BareDecoratedProjection {
        @Assign
        assignCreate(command) {
          void command;
        }

        @Command
        commandFromCommand(command) {
          void command;
        }

        @Subscribe
        subscribeCreated(event) {
          void event;
        }

        @React
        reactToCreated(event) {
          void event;
        }
      }

      return {
        DecoratedProjection,
        DecoratedAggregate,
        DecoratedFallbackProjection,
        FirstDecoratedProjection,
        SecondDecoratedProjection,
        SourceCopiedProjection,
        BorrowingProjection,
        DecoratedBaseProjection,
        UndecoratedOverrideProjection,
        BareDecoratedProjection,
      };
    }
  `;
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2024,
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "spine-handler-decorators-"));
  const modulePath = join(directory, "decorated-classes.mjs");
  writeFileSync(modulePath, compiled.outputText, "utf8");
  const module = (await import(modulePath)) as {
    defineDecoratedClasses(input: DecoratedClassFactoryInput): DecoratedClassFactoryOutput;
  };

  return module.defineDecoratedClasses({
    Assign,
    Command,
    Subscribe,
    React,
    Apply,
    CommandSchema,
    EventSchema,
  });
}

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

  it("materializes every decorator kind into frozen handler metadata in declaration order", async () => {
    const { DecoratedProjection } = await createDecoratedClasses();

    const metadata = materializeDecoratedEntityHandlers(DecoratedProjection, ProjectionStateSchema);

    expect(metadata.entityType).toBe(DecoratedProjection);
    expect(metadata.entity.fullTypeName).toBe("ProjectionState");
    expect(metadata.handlers.map((handler) => handler.kind)).toEqual([
      "command-assignment",
      "command-reaction",
      "event-subscription",
      "event-reaction",
      "event-application",
    ]);
    expect(metadata.handlers.map((handler) => handler.methodName)).toEqual([
      "assignCreate",
      "commandFromCommand",
      "subscribeCreated",
      "reactToCreated",
      "applyCreated",
    ]);
    expect(metadata.handlers.map((handler) => handler.messageFullTypeName)).toEqual([
      "spine.core.Command",
      "spine.core.Command",
      "spine.core.Event",
      "spine.core.Event",
      "spine.core.Event",
    ]);
    expect(metadata.commandAssignments[0]).toBe(metadata.handlers[0]);
    expect(metadata.commandReactions[0]).toBe(metadata.handlers[1]);
    expect(metadata.eventSubscriptions[0]).toBe(metadata.handlers[2]);
    expect(metadata.eventReactions[0]).toBe(metadata.handlers[3]);
    expect(metadata.eventApplications[0]).toBe(metadata.handlers[4]);
    expect(metadata.eventApplications[0]?.allowImport).toBe(true);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.handlers)).toBe(true);
    expect(Object.isFrozen(metadata.handlers[0])).toBe(true);
  });

  it("keeps bare decorators for framework-owned registry generation only", async () => {
    const { BareDecoratedProjection } = await createDecoratedClasses();

    expect(() =>
      materializeDecoratedEntityHandlers(BareDecoratedProjection, ProjectionStateSchema),
    ).toThrow(
      'Decorated handler "assignCreate" was declared without a schema; use generated registry ' +
        "metadata or explicit EntityHandlers.define() registration.",
    );
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
    expect(() => {
      Assign(method, decoratorContext({ metadata: undefined }));
    }).toThrow("metadata support");
  });

  it("registers materialized decorator metadata through the caller-owned registry", async () => {
    const { DecoratedAggregate } = await createDecoratedClasses();

    const metadata = materializeDecoratedEntityHandlers(DecoratedAggregate, AggregateStateSchema);
    const registry = new HandlerMetadataRegistry([metadata]);

    expect(registry.findCommandAssignment("spine.core.Command")?.entityType).toBe(
      DecoratedAggregate,
    );
    expect(registry.findCommandAssignment("spine.core.Command")?.handler.methodName).toBe(
      "assignCreate",
    );
    expect(registry.findEventApplication("AggregateState", "spine.core.Event")?.handler).toBe(
      metadata.eventApplications[0],
    );
  });

  it("keeps decorator metadata class-owned and isolated between classes", async () => {
    const { FirstDecoratedProjection, SecondDecoratedProjection } = await createDecoratedClasses();

    const first = materializeDecoratedEntityHandlers(
      FirstDecoratedProjection,
      ProjectionStateSchema,
    );
    const second = materializeDecoratedEntityHandlers(
      SecondDecoratedProjection,
      ProjectionStateSchema,
    );

    expect(first.handlers.map((handler) => handler.methodName)).toEqual(["assignCreate"]);
    expect(second.handlers.map((handler) => handler.methodName)).toEqual(["applyCreated"]);
    expect(new HandlerMetadataRegistry().listHandlers()).toEqual([]);
  });

  it("does not borrow decorator metadata from a copied method function", async () => {
    const { BorrowingProjection, SourceCopiedProjection } = await createDecoratedClasses();

    const source = materializeDecoratedEntityHandlers(
      SourceCopiedProjection,
      ProjectionStateSchema,
    );
    const borrowing = materializeDecoratedEntityHandlers(
      BorrowingProjection,
      ProjectionStateSchema,
    );

    expect(source.handlers.map((handler) => handler.methodName)).toEqual(["assignCreate"]);
    expect(borrowing.handlers).toEqual([]);
  });

  it("does not borrow decorator metadata from an undecorated subclass override", async () => {
    const { DecoratedBaseProjection, UndecoratedOverrideProjection } =
      await createDecoratedClasses();

    const base = materializeDecoratedEntityHandlers(DecoratedBaseProjection, ProjectionStateSchema);
    const subclass = materializeDecoratedEntityHandlers(
      UndecoratedOverrideProjection,
      ProjectionStateSchema,
    );

    expect(base.handlers.map((handler) => handler.methodName)).toEqual(["assignCreate"]);
    expect(subclass.handlers).toEqual([]);
  });

  it("uses the same duplicate policy as explicit handler metadata", async () => {
    const { FirstDecoratedProjection } = await createDecoratedClasses();
    class ExplicitProjection {
      assignCreate(command: Message<"spine.core.Command">): void {
        void command;
      }
    }

    const decorated = materializeDecoratedEntityHandlers(
      FirstDecoratedProjection,
      ProjectionStateSchema,
    );
    const explicit = EntityHandlers.define(ExplicitProjection, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);

    expect(() => new HandlerMetadataRegistry([decorated, explicit])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => new HandlerMetadataRegistry([decorated, explicit])).toThrow(
      /Duplicate command assignment for "spine\.core\.Command"/,
    );
  });

  it("materializes the same handler contract as the explicit fallback", async () => {
    const { DecoratedFallbackProjection } = await createDecoratedClasses();
    class ExplicitProjection {
      assignCreate(command: Message<"spine.core.Command">): void {
        void command;
      }

      applyCreated(event: Message<"spine.core.Event">): void {
        void event;
      }
    }

    const decorated = materializeDecoratedEntityHandlers(
      DecoratedFallbackProjection,
      ProjectionStateSchema,
    );
    const explicit = EntityHandlers.define(ExplicitProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);

    expect(
      decorated.handlers.map((handler) => ({
        kind: handler.kind,
        messageFullTypeName: handler.messageFullTypeName,
        methodName: handler.methodName,
      })),
    ).toEqual(
      explicit.handlers.map((handler) => ({
        kind: handler.kind,
        messageFullTypeName: handler.messageFullTypeName,
        methodName: handler.methodName,
      })),
    );
    expect(decorated.eventApplications[0]?.allowImport).toBe(
      explicit.eventApplications[0]?.allowImport,
    );
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
