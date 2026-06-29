import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-ts/proto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, expect, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import {
  Apply,
  Assign,
  Command,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  React,
  Subscribe,
  defineEntityHandlers,
  materializeDecoratedEntityHandlers,
} from "./index.js";

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

      return {
        DecoratedProjection,
        DecoratedAggregate,
        DecoratedFallbackProjection,
        FirstDecoratedProjection,
        SecondDecoratedProjection,
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

describe("handler decorators", () => {
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
    const explicit = defineEntityHandlers(ExplicitProjection, AggregateStateSchema, (builder) => [
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
    const explicit = defineEntityHandlers(ExplicitProjection, ProjectionStateSchema, (builder) => [
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
