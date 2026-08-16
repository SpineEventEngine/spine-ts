/* Copyright 2026, CodeMatters. All rights reserved. Licensed under Apache-2.0. */
import { Buffer } from "node:buffer";

import { create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { EventContextSchema, EventIdSchema } from "@spine-event-engine/proto";
import { AnyMessages } from "@spine-event-engine/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BuildHandlerAnalyzer } from "../../src/handler/build-time-handler-analyzer.js";
import { GeneratedRegistryWriter } from "../../src/handler/generated-registry-writer.js";
import { BoundedContext } from "../../src/index.js";
import { expectWave13ContractToCompile } from "../integration/wave13-compile-contract.js";
import {
  createWave13OriginRegistry,
  wave13OriginRouting,
  Wave13OriginProjection,
} from "../integration/wave13-origin-repository.js";

describe("Wave 13 external receptor origin", () => {
  it("RED-03 excludes imported events from a domestic receptor", async () => {
    const registry = createWave13OriginRegistry();
    Wave13OriginProjection.reset();
    const context = await BoundedContext.singleTenant("Red03MixedOrigin")
      .withGeneratedRegistryRoot(registry.root)
      .add(Wave13OriginProjection, { eventRouting: wave13OriginRouting })
      .buildAsync();
    try {
      await context.eventBus().post(event(true));
      expect(Wave13OriginProjection.domesticContexts).toEqual([]);
      expect(Wave13OriginProjection.externalContexts).toHaveLength(1);
    } finally {
      await context.close();
      registry.clear();
    }
  });
  it("RED-04 excludes domestic events from an external receptor", async () => {
    const registry = createWave13OriginRegistry();
    Wave13OriginProjection.reset();
    const context = await BoundedContext.singleTenant("Red04MixedOrigin")
      .withGeneratedRegistryRoot(registry.root)
      .add(Wave13OriginProjection, { eventRouting: wave13OriginRouting })
      .buildAsync();
    try {
      await context.eventBus().post(event(false));
      expect(Wave13OriginProjection.domesticContexts).toHaveLength(1);
      expect(Wave13OriginProjection.externalContexts).toEqual([]);
    } finally {
      await context.close();
      registry.clear();
    }
  });
  it("RED-17 rejects external command receivers while retaining external event command methods", async () => {
    expectWave13ContractToCompile(publicOriginContract);
    const server = await import("../../src/index.js");
    expect(server).not.toHaveProperty("External");
    const result = BuildHandlerAnalyzer.analyze(programWithSource(externalCommandSource));
    const records = result.entities[0]?.handlers as
      readonly { readonly methodName: string; readonly origin?: string }[] | undefined;

    expect(result.diagnostics.map(({ code }) => code)).toContain("EXTERNAL_COMMAND_RECEIVER");
    expect(records).toContainEqual(
      expect.objectContaining({ methodName: "onEvent", origin: "external" }),
    );
    expect(records).not.toContainEqual(expect.objectContaining({ methodName: "assign" }));
  });
  it("RED-19 emits first-parameter External<T> origin metadata and rejects untrusted shapes", () => {
    const result = BuildHandlerAnalyzer.analyze(programWithSource(externalOriginSource));
    const records = result.entities[0]?.handlers as
      readonly { readonly methodName: string; readonly origin?: string }[] | undefined;

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodName: "externalEvent", origin: "external" }),
        expect.objectContaining({ methodName: "domesticEvent", origin: "domestic" }),
        expect.objectContaining({ methodName: "externalReaction", origin: "external" }),
        expect.objectContaining({ methodName: "externalRejection", origin: "external" }),
      ]),
    );
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "INVALID_EXTERNAL_ORIGIN",
      "INVALID_EXTERNAL_ORIGIN",
      "INVALID_EXTERNAL_ORIGIN",
    ]);
    const generated = new GeneratedRegistryWriter().render(result, {
      outputFile: "/tmp/wave13/generated/handler/generated-handler-registry.ts",
    });
    expect(generated).toContain("version: 3");
    expect(generated).toContain('origin: "external"');
    expect(generated).toContain('origin: "domestic"');
    void EventIdSchema;
  });
});

function event(externalOrigin: boolean) {
  const value = `origin-${String(externalOrigin)}`;
  return {
    $typeName: "spine.core.Event",
    id: create(EventIdSchema, { value }),
    context: create(EventContextSchema, { external: externalOrigin }),
    message: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value })),
  } as never;
}

function programWithSource(source: string): ts.Program {
  const sources: Record<string, string> = {
    "src/external.ts": source,
    "generated/task_pb.ts": generatedModule("spine/wave13/task.proto", "Task"),
    "generated/task_commands_pb.ts": generatedModule(
      "spine/wave13/task_commands.proto",
      "CreateTask",
      "RenameTask",
    ),
    "generated/task_events_pb.ts": generatedModule(
      "spine/wave13/task_events.proto",
      "TaskCreated",
      "TaskRenamed",
    ),
    "generated/task_rejections_pb.ts": generatedModule(
      "spine/wave13/task_rejections.proto",
      "TaskAlreadyDone",
    ),
  };
  const options: ts.CompilerOptions = {
    baseUrl: process.cwd(),
    experimentalDecorators: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: { "@spine-event-engine/server": ["packages/server/src/index.ts"] },
    target: ts.ScriptTarget.ES2024,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (requested) => sources[requested] ?? readFile(requested);
  host.fileExists = (requested) => sources[requested] !== undefined || fileExists(requested);
  return ts.createProgram(Object.keys(sources), options, host);
}

function generatedModule(protoSource: string, ...names: string[]): string {
  const descriptor = create(FileDescriptorProtoSchema, {
    name: protoSource,
    messageType: names.map((name) => ({ name })),
  });
  const encoded = Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64");
  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, index: number): unknown;",
    `export const file_wave13 = fileDesc("${encoded}");`,
    ...names.flatMap((name, index) => [
      `export interface ${name} {}`,
      `export const ${name}Schema = messageDesc(file_wave13, ${String(index)});`,
    ]),
  ].join("\n");
}

const externalCommandSource = `
  import { Aggregate, Assign, Command, type External } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask, type RenameTask } from "../generated/task_commands_pb.js";
  import { type TaskCreated } from "../generated/task_events_pb.js";

  export class TaskAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign assign(command: External<CreateTask>): TaskCreated { throw new Error(String(command)); }
    @Command onEvent(event: External<TaskCreated>): RenameTask { throw new Error(String(event)); }
  }
`;

const externalOriginSource = `
  import { Command, Projection, React, Subscribe, type External } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type RenameTask } from "../generated/task_commands_pb.js";
  import { type TaskCreated, type TaskRenamed } from "../generated/task_events_pb.js";
  import { type TaskAlreadyDone } from "../generated/task_rejections_pb.js";

  type IndirectExternal<T> = External<T>;
  type LocalEvent = TaskCreated;
  export class TaskProjection extends Projection<string, typeof TaskSchema, number> {
    @Subscribe externalEvent(event: External<TaskCreated>): void { void event; }
    @Subscribe domesticEvent(event: TaskRenamed): void { void event; }
    @React externalReaction(event: External<TaskCreated>): TaskRenamed { throw new Error(String(event)); }
    @Command externalRejection(rejection: External<TaskAlreadyDone>): RenameTask { throw new Error(String(rejection)); }
    @Subscribe nested(event: Array<External<TaskCreated>>): void { void event; }
    @Subscribe second(event: TaskCreated, context: External<unknown>): void { void event; void context; }
    @Subscribe indirect(event: IndirectExternal<TaskCreated>): void { void event; }
    @Subscribe local(event: LocalEvent): void { void event; }
  }
`;

const publicOriginContract = `
  import type { Message } from "@bufbuild/protobuf";
  import type { MessageSchema } from "@spine-event-engine/core";
  import type { Event } from "@spine-event-engine/proto";
  import type { BaseHandlerMetadata, EventDispatcher, External } from "@spine-event-engine/server";
  import type {
    GeneratedHandlerRecordInput,
    GeneratedHandlerRegistry,
  } from "@spine-event-engine/server/internal/generated-handler-registry";

  type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2) ? true : false;
  type Assert<Value extends true> = Value;
  type IsRequired<Value, Key extends keyof Value> =
    {} extends Pick<Value, Key> ? false : true;
  type RegistryVersionIsExactlyThree = Assert<
    Equal<GeneratedHandlerRegistry["version"], 3>
  >;
  type GeneratedOriginIsExact = Assert<
    Equal<GeneratedHandlerRecordInput["origin"], "domestic" | "external">
  >;
  type CanonicalOriginIsExact = Assert<
    Equal<BaseHandlerMetadata["origin"], "domestic" | "external">
  >;
  type GeneratedOriginIsRequired = Assert<
    Equal<IsRequired<GeneratedHandlerRecordInput, "origin">, true>
  >;
  type CanonicalOriginIsRequired = Assert<
    Equal<IsRequired<BaseHandlerMetadata, "origin">, true>
  >;

  declare const message: Message;
  declare const external: External<Message>;
  const transparentForward: External<Message> = message;
  const transparentBackward: Message = external;
  const dispatcher: EventDispatcher = {
    messageSchemas: (): readonly MessageSchema[] => [],
    externalEventSchemas: (): readonly MessageSchema[] => [],
    dispatch: async (_event: Event): Promise<void> => undefined,
  };
  const registryVersion: GeneratedHandlerRegistry["version"] = 3;
  const generatedOrigin: GeneratedHandlerRecordInput["origin"] = "external";
  const canonicalOrigin: BaseHandlerMetadata["origin"] = "domestic";
  void transparentForward;
  void transparentBackward;
  void dispatcher.externalEventSchemas?.();
  void registryVersion;
  void generatedOrigin;
  void canonicalOrigin;
  void (undefined as unknown as RegistryVersionIsExactlyThree);
  void (undefined as unknown as GeneratedOriginIsExact);
  void (undefined as unknown as CanonicalOriginIsExact);
  void (undefined as unknown as GeneratedOriginIsRequired);
  void (undefined as unknown as CanonicalOriginIsRequired);
`;
