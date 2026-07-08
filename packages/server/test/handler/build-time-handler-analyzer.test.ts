import ts from "typescript";
import { describe, expect, it } from "vitest";

import { analyzeBuildHandlers } from "../../src/handler/build-time-handler-analyzer.js";

describe("build-time handler analyzer", () => {
  it("discovers bare handler decorators and generated schema references", () => {
    const result = analyzeBuildHandlers(programWithSource("src/task.ts", validTaskSource));

    expect(result.diagnostics).toEqual([]);
    expect(result.entities).toEqual([
      {
        className: "TaskAggregate",
        sourceFile: "src/task.ts",
        stateSchema: schema("../generated/spine/example/todo/v1/tasks_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "createTask",
            signalSchema: schema(
              "../generated/spine/example/todo/v1/task_commands_pb.js",
              "CreateTaskSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/example/todo/v1/task_events_pb.js", "TaskCreatedSchema"),
            ],
            parameterCount: 1,
          },
          {
            kind: "command-reaction",
            methodName: "renameAgain",
            signalSchema: schema(
              "../generated/spine/example/todo/v1/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/example/todo/v1/task_commands_pb.js", "RenameTaskSchema"),
            ],
            parameterCount: 2,
          },
          {
            kind: "event-reaction",
            methodName: "reactToCreated",
            signalSchema: schema(
              "../generated/spine/example/todo/v1/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/example/todo/v1/task_events_pb.js", "TaskRenamedSchema"),
              schema("../generated/spine/example/todo/v1/task_events_pb.js", "TaskCompletedSchema"),
            ],
            parameterCount: 1,
          },
          {
            kind: "event-subscription",
            methodName: "onRenamed",
            signalSchema: schema(
              "../generated/spine/example/todo/v1/task_events_pb.js",
              "TaskRenamedSchema",
            ),
            emittedSchemas: [],
            parameterCount: 1,
          },
        ],
      },
    ]);
  });

  it("allows no-emission React handlers with explicit void returns", () => {
    const result = analyzeBuildHandlers(programWithSource("src/reaction.ts", noEmissionSource));

    expect(result.diagnostics).toEqual([]);
    expect(result.entities[0]?.handlers).toEqual([
      {
        kind: "event-reaction",
        methodName: "observe",
        signalSchema: schema("../generated/events_pb.js", "TaskCreatedSchema"),
        emittedSchemas: [],
        parameterCount: 1,
      },
    ]);
  });

  it("accepts string-literal handler method names", () => {
    const result = analyzeBuildHandlers(programWithSource("src/string-name.ts", stringNameSource));

    expect(result.diagnostics).toEqual([]);
    expect(result.entities[0]?.handlers).toEqual([
      {
        kind: "command-assignment",
        methodName: 'create\u2028"task"\nnext',
        signalSchema: schema("../generated/commands_pb.js", "CreateTaskSchema"),
        emittedSchemas: [schema("../generated/events_pb.js", "TaskCreatedSchema")],
        parameterCount: 1,
      },
    ]);
  });

  it("reports deterministic diagnostics for unsupported decorator and signature shapes", () => {
    const result = analyzeBuildHandlers(programWithSource("src/bad.ts", invalidSource));

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_ENTITY_STATE_SCHEMA",
      "SCHEMA_BEARING_DECORATOR",
      "APPLY_DECORATOR",
      "INVALID_HANDLER_VISIBILITY",
      "MISSING_SIGNAL_TYPE",
      "INVALID_PARAMETER_COUNT",
      "INVALID_SUBSCRIBE_RETURN",
      "FRAMEWORK_ENVELOPE_RETURN",
      "MISSING_EMITTED_SCHEMAS",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "create",
      "schemaDecorator",
      "apply",
      "hidden",
      "missingSignal",
      "tooMany",
      "badSubscribe",
      "envelope",
      "silentCommand",
    ]);
  });

  it("requires decorated entity classes to be exported", () => {
    const result = analyzeBuildHandlers(programWithSource("src/local.ts", localEntitySource));

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "NON_EXPORTED_ENTITY_CLASS",
    ]);
    expect(result.diagnostics[0]?.className).toBe("LocalAggregate");
  });

  it("accepts named export lists but rejects default-exported entity classes", () => {
    const namedResult = analyzeBuildHandlers(
      programWithSource("src/named-export.ts", namedExportSource),
    );
    const defaultResult = analyzeBuildHandlers(
      programWithSource("src/default-export.ts", defaultExportSource),
    );

    expect(namedResult.diagnostics).toEqual([]);
    expect(namedResult.entities[0]?.className).toBe("ListedAggregate");
    expect(defaultResult.entities).toEqual([]);
    expect(defaultResult.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNSUPPORTED_ENTITY_EXPORT",
    ]);
    expect(defaultResult.diagnostics[0]?.className).toBe("DefaultAggregate");
  });

  it("reports deterministic diagnostics for cyclic aliases", () => {
    const result = analyzeBuildHandlers(programWithSource("src/cyclic.ts", cyclicAliasSource));

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_ENTITY_STATE_SCHEMA",
      "INVALID_SIGNAL_TYPE",
      "UNSUPPORTED_RETURN_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "create",
      "create",
      "create",
    ]);
  });

  it("rejects generated imports without verified message and schema exports", () => {
    const result = analyzeBuildHandlers(
      programWithSource("src/invalid-generated.ts", invalidGeneratedSource),
    );

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
      "INVALID_SIGNAL_TYPE",
      "UNSUPPORTED_RETURN_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "typo",
      "generic",
      "missingReturnSchema",
    ]);
  });

  it("requires generated schema companions to be runtime value exports", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/type-schema.ts", {
        "src/type-schema.ts": typeOnlySchemaSource,
        "generated/commands_pb.ts": generatedModule("CreateTask"),
        "generated/events_pb.ts": [
          "export interface TaskCreated {}",
          "export interface TaskCreatedSchema {}",
          "export interface TaskRenamed {}",
          "export type TaskRenamedSchema = {};",
        ].join("\n"),
        "generated/task_pb.ts": "export interface TaskSchema {}",
      }),
    );

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_ENTITY_STATE_SCHEMA",
      "UNSUPPORTED_RETURN_TYPE",
      "MISSING_ENTITY_STATE_SCHEMA",
      "UNSUPPORTED_RETURN_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "create",
      "create",
      "rename",
      "rename",
    ]);
  });

  it("validates emitted schema roles for each handler decorator", () => {
    const result = analyzeBuildHandlers(programWithSource("src/roles.ts", invalidRoleSource));

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_EMITTED_SCHEMA",
      "INVALID_EMITTED_SCHEMA",
      "INVALID_EMITTED_SCHEMA",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "assignCommand",
      "commandEvent",
      "reactCommand",
    ]);
  });

  it("handles namespace imports, aliases, readonly wrappers, and computed method diagnostics", () => {
    const result = analyzeBuildHandlers(programWithSource("src/oddball.ts", oddballSource));

    expect(result.entities).toEqual([
      {
        className: "OddballAggregate",
        sourceFile: "src/oddball.ts",
        stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "create",
            signalSchema: schema("../generated/commands_pb", "CreateTaskSchema"),
            emittedSchemas: [schema("../generated/events_pb", "TaskCreatedSchema")],
            parameterCount: 1,
          },
          {
            kind: "command-reaction",
            methodName: "rename",
            signalSchema: schema("../generated/commands_pb", "CreateTaskSchema"),
            emittedSchemas: [schema("../generated/commands_pb", "RenameTaskSchema")],
            parameterCount: 1,
          },
          {
            kind: "event-reaction",
            methodName: "fanOut",
            signalSchema: schema("../generated/events_pb", "TaskCreatedSchema"),
            emittedSchemas: [
              schema("../generated/events_pb", "TaskRenamedSchema"),
              schema("../generated/events_pb", "TaskCreatedSchema"),
            ],
            parameterCount: 1,
          },
        ],
      },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_HANDLER_NAME",
      "FRAMEWORK_ENVELOPE_RETURN",
      "MISSING_RETURN_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      undefined,
      "envelope",
      "missingReturn",
    ]);
  });

  it("reports edge diagnostics for tuple members, missing generics, and proto envelopes", () => {
    const result = analyzeBuildHandlers(programWithSource("src/edge.ts", edgeSource));

    expect(result.entities).toEqual([
      {
        className: "EdgeAggregate",
        sourceFile: "src/edge.ts",
        stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "parenthesized",
            signalSchema: schema("../generated/commands_pb.js", "CreateTaskSchema"),
            emittedSchemas: [schema("../generated/events_pb.js", "TaskCreatedSchema")],
            parameterCount: 1,
          },
        ],
      },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_HANDLER_NAME",
      "UNSUPPORTED_RETURN_TYPE",
      "UNSUPPORTED_RETURN_TYPE",
      "UNSUPPORTED_RETURN_TYPE",
      "INVALID_SIGNAL_TYPE",
      "MISSING_RETURN_TYPE",
      "FRAMEWORK_ENVELOPE_RETURN",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      undefined,
      "optionalTuple",
      "restTuple",
      "missingArrayArgument",
      "stringSignal",
      "missingReturn",
      "protoCommand",
    ]);
  });

  it("surfaces TypeScript syntax diagnostics for malformed source", () => {
    const result = analyzeBuildHandlers(programWithSource("src/malformed.ts", malformedSource));

    expect(result.entities).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "TYPESCRIPT_SYNTAX_ERROR",
    ]);
    expect(result.diagnostics[0]?.message).toContain("'}' expected");
  });
});

function programWithSource(fileName: string, source: string): ts.Program {
  return programWithSources(fileName, {
    [fileName]: source,
    "generated/audit_pb.ts": generatedModule("AuditRecord"),
    "generated/commands_pb.ts": generatedModule("CreateTask", "RenameTask", "MissingSchemaCommand"),
    "generated/events_pb.ts": generatedModule("TaskCreated", "TaskRenamed"),
    "generated/task_list_pb.ts": "export const TaskListSchema = {};",
    "generated/task_pb.ts": "export const TaskSchema = {};",
    "generated/spine/example/todo/v1/task_commands_pb.ts": generatedModule(
      "CreateTask",
      "RenameTask",
    ),
    "generated/spine/example/todo/v1/task_events_pb.ts": generatedModule(
      "TaskCompleted",
      "TaskCreated",
      "TaskRenamed",
    ),
    "generated/spine/example/todo/v1/tasks_pb.ts": "export const TaskSchema = {};",
  });
}

function programWithSources(rootFileName: string, sources: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    experimentalDecorators: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    target: ts.ScriptTarget.ES2024,
  };
  const host = ts.createCompilerHost(options);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);

  host.readFile = (requested) => sources[requested] ?? originalReadFile(requested);
  host.fileExists = (requested) =>
    sources[requested] !== undefined || originalFileExists(requested);

  return ts.createProgram([rootFileName, ...Object.keys(sources)], options, host);
}

function schema(moduleSpecifier: string, exportName: string) {
  return { moduleSpecifier, exportName };
}

function generatedModule(...names: string[]): string {
  return names
    .map((name) =>
      name === "MissingSchemaCommand"
        ? `export interface ${name} {}`
        : `export interface ${name} {}\nexport const ${name}Schema = {};`,
    )
    .join("\n");
}

const validTaskSource = `
  import { Aggregate, Assign as HandleCommand, Command, Subscribe } from "@spine-ts/server";
  import * as server from "@spine-ts/server";
  import { TaskSchema } from "../generated/spine/example/todo/v1/tasks_pb.js";
  import { type CreateTask, type RenameTask } from "../generated/spine/example/todo/v1/task_commands_pb.js";
  import * as events from "../generated/spine/example/todo/v1/task_events_pb.js";

  export class TaskAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @HandleCommand
    createTask(command: CreateTask): events.TaskCreated {
      throw new Error(String(command));
    }

    @Command
    renameAgain(event: events.TaskCreated, context: unknown): Array<RenameTask> {
      throw new Error(String(event) + String(context));
    }

    @server.React
    reactToCreated(event: events.TaskCreated): readonly [events.TaskRenamed, events.TaskCompleted] {
      throw new Error(String(event));
    }

    @Subscribe
    onRenamed(event: events.TaskRenamed): void {
      void event;
    }
  }
`;

const localEntitySource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  class LocalAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const namedExportSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  class ListedAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }

  export { ListedAggregate };
`;

const defaultExportSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export default class DefaultAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const cyclicAliasSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { type TaskCreated } from "../generated/events_pb.js";

  type StateA = StateB;
  type StateB = StateA;
  type SignalA = SignalB;
  type SignalB = SignalA;
  type ReturnA = ReturnB;
  type ReturnB = ReturnA;

  export class CyclicAggregate extends Aggregate<string, StateA, bigint> {
    @Assign
    create(command: SignalA): ReturnA {
      throw new Error(String(command));
    }
  }
`;

const invalidGeneratedSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask, type TaskCreatd, type MissingSchemaCommand } from "../generated/commands_pb.js";
  import { type AuditRecord } from "../generated/audit_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class InvalidGeneratedAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    typo(command: TaskCreatd): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    generic(command: AuditRecord): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    missingReturnSchema(command: CreateTask): MissingSchemaCommand {
      throw new Error(String(command));
    }
  }
`;

const typeOnlySchemaSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated, type TaskRenamed } from "../generated/events_pb.js";

  export class TypeOnlySchemaAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    rename(command: CreateTask): TaskRenamed {
      throw new Error(String(command));
    }
  }
`;

const invalidRoleSource = `
  import { Aggregate, Assign, Command, React } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class InvalidRoleAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    assignCommand(command: CreateTask): RenameTask {
      throw new Error(String(command));
    }

    @Command
    commandEvent(event: TaskCreated): TaskCreated {
      throw new Error(String(event));
    }

    @React
    reactCommand(event: TaskCreated): RenameTask {
      throw new Error(String(event));
    }
  }
`;

const oddballSource = `
  import * as spine from "@spine-ts/server";
  import * as proto from "@spine-ts/proto";
  import * as commands from "../generated/commands_pb";
  import * as events from "../generated/events_pb";
  import { TaskSchema as StateSchema } from "../generated/task_pb.js";

  type State = (typeof StateSchema);
  const computed = "computed";

  export class OddballAggregate extends spine.Aggregate<string, State, bigint> {
    @spine.Assign
    create(command: commands.CreateTask): readonly events.TaskCreated[] {
      throw new Error(String(command));
    }

    @spine.Command
    rename(command: commands.CreateTask): ReadonlyArray<commands.RenameTask> {
      throw new Error(String(command));
    }

    @spine.React
    fanOut(event: events.TaskCreated): readonly [renamed: events.TaskRenamed, created: events.TaskCreated] {
      throw new Error(String(event));
    }

    @spine.Assign
    [computed](command: commands.CreateTask): events.TaskCreated {
      throw new Error(String(command));
    }

    @spine.Assign
    envelope(command: commands.CreateTask): proto.Event {
      throw new Error(String(command));
    }

    @spine.Assign
    missingReturn(command: commands.CreateTask) {
      throw new Error(String(command));
    }
  }
`;

const edgeSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import * as Proto from "@spine-ts/proto";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  const computed = "computed";

  export class EdgeAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    [computed](command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    optionalTuple(command: CreateTask): [created?: TaskCreated] {
      throw new Error(String(command));
    }

    @Assign
    restTuple(command: CreateTask): [...TaskCreated[]] {
      throw new Error(String(command));
    }

    @Assign
    missingArrayArgument(command: CreateTask): ReadonlyArray {
      throw new Error(String(command));
    }

    @Assign
    parenthesized(command: CreateTask): readonly (TaskCreated)[] {
      throw new Error(String(command));
    }

    @Assign
    stringSignal(command: string): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    missingReturn(command: CreateTask) {
      throw new Error(String(command));
    }

    @Assign
    protoCommand(command: CreateTask): Proto.Command {
      throw new Error(String(command));
    }
  }
`;

const malformedSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class BrokenAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
`;

const noEmissionSource = `
  import { Projection, React } from "@spine-ts/server";
  import { TaskListSchema } from "../generated/task_list_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class TaskProjection extends Projection<string, typeof TaskListSchema, number> {
    @React
    observe(event: TaskCreated): void {
      void event;
    }
  }
`;

const stringNameSource = `
  import { Aggregate, Assign } from "@spine-ts/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class QuotedAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    "create\\u2028\\"task\\"\\nnext"(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const invalidSource = `
  import { Aggregate, Apply, Assign, Command, Subscribe } from "@spine-ts/server";
  import { type Event } from "@spine-ts/proto";
  import { TaskSchema } from "../generated/task_pb.js";
  import { CreateTaskSchema, type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class MissingState {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }

  export class BadAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign(CreateTaskSchema)
    schemaDecorator(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Apply
    apply(event: TaskCreated): void {
      void event;
    }

    @Assign
    private hidden(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    missingSignal(command): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    tooMany(command: CreateTask, context: unknown, extra: unknown): TaskCreated {
      throw new Error(String(command) + String(context) + String(extra));
    }

    @Subscribe
    badSubscribe(event: TaskCreated): TaskCreated {
      throw new Error(String(event));
    }

    @Assign
    envelope(command: CreateTask): Event {
      throw new Error(String(command));
    }

    @Command
    silentCommand(command: CreateTask): void {
      void command;
    }
  }
`;
