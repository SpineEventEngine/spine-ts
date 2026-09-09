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

import { Buffer } from "node:buffer";

import { create, setExtension, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema, MessageOptionsSchema } from "@bufbuild/protobuf/wkt";
import { entity, EntityOptionSchema } from "@spine-event-engine/proto";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BuildHandlerAnalyzer } from "../src/generation/build-time-handler-analyzer.js";

const analyzeBuildHandlers = (...args: Parameters<typeof BuildHandlerAnalyzer.analyze>) =>
  BuildHandlerAnalyzer.analyze(...args);

function entityReceivers(analysis: ReturnType<typeof BuildHandlerAnalyzer.analyze>) {
  return analysis.receivers
    .filter((receiver) => receiver.receiverKind === "entity")
    .map(({ receiverKind, ...receiver }) => {
      void receiverKind;
      return receiver;
    });
}

describe("build-time handler analyzer", () => {
  it("requires canonical handler contexts that match the input signal role", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/context-contract.ts",
        `
          import { Assign, Command, ProcessManager, Subscribe } from "@spine-event-engine/server";
          import { type CommandContext, type EventContext } from "@spine-event-engine/proto";
          import { TaskSchema } from "../generated/task_pb.js";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
          import { type TaskCreated } from "../generated/events_pb.js";

          export class ContextContract extends ProcessManager<string, typeof TaskSchema, bigint> {
            @Assign assign(command: CreateTask, context: EventContext): TaskCreated {
              throw new Error(String(command) + String(context));
            }
            @Command substitute(command: CreateTask, context: CommandContext): RenameTask {
              throw new Error(String(command) + String(context));
            }
            @Subscribe observe(event: TaskCreated, context: CommandContext): void { void event; void context; }
          }
        `,
      ),
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_HANDLER_CONTEXT",
      "INVALID_HANDLER_CONTEXT",
    ]);
    expect(entityReceivers(result)[0]?.handlers).toEqual([
      expect.objectContaining({ methodName: "substitute", parameterCount: 2 }),
    ]);
  });

  it("accepts aliased and namespace-imported canonical handler contexts", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/canonical-context.ts",
        `
          import { Assign, Command, ProcessManager, Subscribe } from "@spine-event-engine/server";
          import { type CommandContext as CommandMetadata } from "@spine-event-engine/proto";
          import * as proto from "@spine-event-engine/proto";
          import { TaskSchema } from "../generated/task_pb.js";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
          import { type TaskCreated } from "../generated/events_pb.js";

          export class CanonicalContext extends ProcessManager<string, typeof TaskSchema, bigint> {
            @Assign assign(command: CreateTask, context: CommandMetadata): TaskCreated {
              throw new Error(String(command) + String(context));
            }
            @Command substitute(command: CreateTask, context: CommandMetadata): RenameTask {
              throw new Error(String(command) + String(context));
            }
            @Subscribe observe(event: TaskCreated, context: proto.EventContext): void { void event; void context; }
          }
        `,
      ),
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("rejects primitive and untyped second handler parameters", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/invalid-handler-contexts.ts",
        `
          import { Command, ProcessManager } from "@spine-event-engine/server";
          import { TaskSchema } from "../generated/task_pb.js";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";

          export class InvalidHandlerContexts extends ProcessManager<string, typeof TaskSchema, bigint> {
            @Command primitive(command: CreateTask, context: string): RenameTask {
              throw new Error(String(command) + context);
            }
            @Command untyped(command: CreateTask, context): RenameTask {
              throw new Error(String(command) + String(context));
            }
          }
        `,
      ),
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_HANDLER_CONTEXT",
      "INVALID_HANDLER_CONTEXT",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "primitive",
      "untyped",
    ]);
  });

  it("analyzes nominal standalone command receivers without an Entity state schema", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/standalone-commander.ts",
        `
          import { AbstractCommander, Command } from "@spine-event-engine/server";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
          export class TaskCommander extends AbstractCommander {
            @Command replace(command: CreateTask): RenameTask { throw new Error(String(command)); }
          }
        `,
      ),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.receivers).toMatchObject([
      {
        receiverKind: "standalone",
        className: "TaskCommander",
        handlers: [{ kind: "command-substitution" }],
      },
    ]);
  });

  it("analyzes a named default-export standalone receiver", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/default-commander.ts",
        `
      import { AbstractCommander, Command } from "@spine-event-engine/server";
      import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
      export default class DefaultCommander extends AbstractCommander {
        @Command replace(command: CreateTask): RenameTask { throw new Error(String(command)); }
      }
    `,
      ),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.receivers[0]).toMatchObject({ receiverKind: "standalone", defaultExport: true });
  });

  it("analyzes an anonymous default-export standalone receiver", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/anonymous-commander.ts",
        `
      import { AbstractCommander, Command } from "@spine-event-engine/server";
      import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
      export default class extends AbstractCommander {
        @Command replace(command: CreateTask): RenameTask { throw new Error(String(command)); }
      }
    `,
      ),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.receivers[0]).toMatchObject({ receiverKind: "standalone", defaultExport: true });
  });

  it.each([
    ["AbstractAssignee", "Command"],
    ["AbstractCommander", "Assign"],
    ["AbstractEventReactor", "Subscribe"],
    ["AbstractEventSubscriber", "React"],
  ])("rejects @%s methods with @%s outside the standalone role matrix", (base, decorator) => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/invalid-standalone.ts",
        `
      import { ${base}, ${decorator} } from "@spine-event-engine/server";
      import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
      export class InvalidReceiver extends ${base} {
        @${decorator} handle(signal: CreateTask): RenameTask { throw new Error(String(signal)); }
      }
    `,
      ),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "UNSUPPORTED_COMMAND_HANDLER",
    );
  });

  it("analyzes the standalone handler contract and rejects invalid standalone declarations", () => {
    const valid = analyzeBuildHandlers(
      standaloneContractProgram(
        "src/standalone-contract.ts",
        `
      import {
        AbstractAssignee, AbstractCommander, AbstractEventReactor, AbstractEventSubscriber,
        Assign, Command, React, Subscribe,
      } from "@spine-event-engine/server";
      import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
      import { type TaskCreated, type TaskRenamed } from "../generated/events_pb.js";
      import { type TaskAlreadyDone } from "../generated/rejections_pb.js";
      import { type Task } from "../generated/task_pb.js";

      export class TaskAssignee extends AbstractAssignee {
        @Assign
        assign(command: CreateTask): TaskCreated {
          throw new Error(String(command));
        }
      }
      export class TaskCommander extends AbstractCommander {
        @Command
        replace(command: CreateTask): RenameTask {
          throw new Error(String(command));
        }
        @Command
        reactToEvent(event: TaskCreated): RenameTask {
          throw new Error(String(event));
        }
        @Command
        reactToRejection(rejection: TaskAlreadyDone): RenameTask {
          throw new Error(String(rejection));
        }
      }
      export class TaskReactor extends AbstractEventReactor {
        @React
        react(event: TaskCreated): TaskRenamed {
          throw new Error(String(event));
        }
        @React
        observeRejection(rejection: TaskAlreadyDone): void {
          void rejection;
        }
      }
      export class TaskSubscriber extends AbstractEventSubscriber {
        @Subscribe
        observeEvent(event: TaskCreated): void {
          void event;
        }
        @Subscribe
        observeRejection(rejection: TaskAlreadyDone): void {
          void rejection;
        }
        @Subscribe
        observeState(state: Task): void {
          void state;
        }
      }
    `,
      ),
    );

    expect(valid.diagnostics).toEqual([]);
    expect(valid.receivers).toHaveLength(4);

    const invalid = analyzeBuildHandlers(
      standaloneContractProgram(
        "src/invalid-standalone-contract.ts",
        `
      import {
        AbstractAssignee, AbstractCommander, AbstractEventReactor, AbstractEventSubscriber,
        Assign, Command, External, React, Subscribe, Where,
      } from "@spine-event-engine/server";
      import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
      import { type TaskCreated } from "../generated/events_pb.js";
      import { type Task } from "../generated/task_pb.js";

      export class InvalidAssignee extends AbstractAssignee {
        @Assign
        assign(event: TaskCreated): TaskCreated {
          throw new Error(String(event));
        }
      }
      export class InvalidCommander extends AbstractCommander {
        @Command
        replace(command: CreateTask): TaskCreated {
          throw new Error(String(command));
        }
      }
      export class InvalidReactor extends AbstractEventReactor {
        @React
        react(command: CreateTask): RenameTask {
          throw new Error(String(command));
        }
      }
      export class InvalidSubscriber extends AbstractEventSubscriber {
        @Subscribe
        observe(event: TaskCreated): TaskCreated {
          throw new Error(String(event));
        }
        @Subscribe
        observeExternalState(state: External<Task>): void {
          void state;
        }
        @Where({ eventField: "id", equals: "task-1" })
        @Subscribe
        observeFilteredState(state: Task): void {
          void state;
        }
      }
    `,
      ),
    );

    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
      "INVALID_EMITTED_SCHEMA",
      "INVALID_SIGNAL_TYPE",
      "INVALID_EMITTED_SCHEMA",
      "INVALID_SUBSCRIBE_RETURN",
      "INVALID_SIGNAL_TYPE",
      "INVALID_WHERE",
    ]);
  });

  it("rejects every @Command handler declared on an Aggregate", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/aggregate-command.ts",
        handlerFixtureSource(
          "Aggregate",
          "TaskSchema",
          `
            @Command
            transform(command: CreateTask): RenameTask { throw new Error(String(command)); }

            @Command
            react(event: TaskCreated): RenameTask { throw new Error(String(event)); }
          `,
          `
            import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
            import { type TaskCreated } from "../generated/events_pb.js";
          `,
        ),
      ),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNSUPPORTED_COMMAND_HANDLER",
      "UNSUPPORTED_COMMAND_HANDLER",
    ]);
  });

  it("rejects every @Command handler declared on a Projection", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/projection-command.ts",
        handlerFixtureSource(
          "Projection",
          "TaskListSchema",
          `
            @Command
            transform(command: CreateTask): RenameTask { throw new Error(String(command)); }

            @Command
            react(event: TaskCreated): RenameTask { throw new Error(String(event)); }
          `,
          `
            import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
            import { type TaskCreated } from "../generated/events_pb.js";
          `,
        ),
      ),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNSUPPORTED_COMMAND_HANDLER",
      "UNSUPPORTED_COMMAND_HANDLER",
    ]);
  });

  it("rejects @Command inherited through Aggregate and Projection domain bases", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/inherited-command.ts",
        `
          import { Aggregate, Command, Projection } from "@spine-event-engine/server";
          import { TaskSchema } from "../generated/task_pb.js";
          import { TaskListSchema } from "../generated/task_list_pb.js";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";

          abstract class DomainAggregate extends Aggregate<string, typeof TaskSchema, bigint> {}
          abstract class DomainProjection extends Projection<string, typeof TaskListSchema, number> {}

          export class InheritedAggregate extends DomainAggregate {
            @Command transform(command: CreateTask): RenameTask { throw new Error(String(command)); }
          }
          export class InheritedProjection extends DomainProjection {
            @Command transform(command: CreateTask): RenameTask { throw new Error(String(command)); }
          }
        `,
      ),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNSUPPORTED_COMMAND_HANDLER",
      "UNSUPPORTED_COMMAND_HANDLER",
    ]);
  });

  it("accepts @Command inherited through a Process Manager domain base", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/inherited-process-manager-command.ts",
        `
          import { Command, ProcessManager } from "@spine-event-engine/server";
          import { TaskListSchema } from "../generated/task_list_pb.js";
          import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";

          abstract class DomainProcessManager extends ProcessManager<string, typeof TaskListSchema, number> {}
          export class InheritedProcessManager extends DomainProcessManager {
            @Command transform(command: CreateTask): RenameTask { throw new Error(String(command)); }
          }
        `,
      ),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers[0]?.kind).toBe("command-substitution");
  });

  it("ignores unrelated classes whose heritage type has no symbol", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/message-board-shape.ts",
        `
          import { ProcessManager, Subscribe } from "@spine-event-engine/server";
          import { TaskListSchema } from "../generated/task_list_pb.js";
          import { type TaskCreated } from "../generated/events_pb.js";

          declare const BootstrapBase: any;
          class MessageBoardBootstrap extends BootstrapBase {}
          export class InvalidBootstrapHandler extends BootstrapBase {
            @Subscribe observe(): void {}
          }
          export class TaskProcessManager extends ProcessManager<string, typeof TaskListSchema, number> {
            @Subscribe observe(event: TaskCreated): void { void event; }
          }
        `,
      ),
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_ENTITY_STATE_SCHEMA",
      "INVALID_PARAMETER_COUNT",
    ]);
    expect(entityReceivers(result).map((entity) => entity.className)).toEqual([
      "TaskProcessManager",
    ]);
  });

  it("discovers bare handler decorators and generated schema references", () => {
    const result = analyzeBuildHandlers(programWithSource("src/task.ts", validTaskSource));

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)).toEqual([
      {
        className: "TaskProcessManager",
        sourceFile: "src/task.ts",
        stateSchema: schema("../generated/spine/examples/todo/tasks_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "event-subscription",
            methodName: "observeCreated",
            origin: "domestic",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [],
            parameterCount: 1,
          },
          {
            kind: "command-reaction",
            methodName: "renameAgain",
            origin: "domestic",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/examples/todo/task_commands_pb.js", "RenameTaskSchema"),
            ],
            parameterCount: 2,
          },
          {
            kind: "event-reaction",
            methodName: "reactToCreated",
            origin: "domestic",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/examples/todo/task_events_pb.js", "TaskRenamedSchema"),
              schema("../generated/spine/examples/todo/task_events_pb.js", "TaskCompletedSchema"),
            ],
            parameterCount: 1,
          },
          {
            kind: "event-subscription",
            methodName: "onRenamed",
            origin: "domestic",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskRenamedSchema",
            ),
            emittedSchemas: [],
            parameterCount: 1,
          },
        ],
      },
    ]);
  });

  it("classifies command schemas from descriptors when generated module paths are neutral", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/neutral-command.ts", {
        "src/neutral-command.ts": neutralCommandSource,
        "generated/domain_pb.ts": generatedModule(
          "spine/examples/todo/task_commands.proto",
          "CreateTask",
        ),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/tasks.proto",
          [{ exportName: "Task", descriptorName: "Task", entityState: true }],
        ),
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers[0]).toEqual({
      kind: "command-assignment",
      methodName: "create",
      origin: "domestic",
      signalSchema: schema("../generated/domain_pb.js", "CreateTaskSchema"),
      emittedSchemas: [schema("../generated/events_pb.js", "TaskCreatedSchema")],
      parameterCount: 1,
    });
  });

  it("classifies event schemas from descriptors when generated module paths are neutral", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/neutral-event.ts", {
        "src/neutral-event.ts": neutralEventSource,
        "generated/domain_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_list_pb.ts": generatedModule(
          "spine/examples/todo/task_list.proto",
          "TaskList",
        ),
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers[0]).toEqual({
      kind: "event-subscription",
      methodName: "observe",
      origin: "domestic",
      signalSchema: schema("../generated/domain_pb.js", "TaskCreatedSchema"),
      emittedSchemas: [],
      parameterCount: 1,
    });
  });

  it("classifies a bare Subscribe parameter matching the entity schema as a state subscription", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/state-subscription.ts", {
        "src/state-subscription.ts": stateSubscriptionSource,
        "generated/task_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/tasks.proto",
          [{ exportName: "Task", descriptorName: "Task", entityState: true }],
        ),
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers).toEqual([
      {
        kind: "state-subscription",
        methodName: "observe",
        origin: "domestic",
        signalSchema: schema("../generated/task_pb.js", "TaskSchema"),
        emittedSchemas: [],
        parameterCount: 1,
      },
    ]);
  });

  it("classifies a subscription to another Entity state from descriptor metadata", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/foreign-state-subscription.ts", {
        "src/foreign-state-subscription.ts": foreignStateSubscriptionSource,
        "generated/receiver_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/neutral/receiver.proto",
          [{ exportName: "ReceiverState", descriptorName: "ReceiverState", entityState: true }],
        ),
        "generated/foreign_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/neutral/foreign.proto",
          [{ exportName: "ForeignState", descriptorName: "ForeignState", entityState: true }],
        ),
        "generated/audit_pb.ts": generatedModule(
          "spine/examples/neutral/audit.proto",
          "AuditRecord",
        ),
      }),
    );

    expect(entityReceivers(result)[0]?.handlers).toEqual([
      {
        kind: "state-subscription",
        methodName: "observeForeign",
        origin: "domestic",
        signalSchema: schema("../generated/foreign_pb.js", "ForeignStateSchema"),
        emittedSchemas: [],
        parameterCount: 1,
      },
    ]);
    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual([
      ["INVALID_SIGNAL_TYPE", "observeAudit"],
    ]);
  });

  it("accepts top-level rejection inputs for every event-consuming handler kind", () => {
    const roles = [
      ["Subscribe", "observe", "void", "event-subscription", [], 2],
      ["React", "react", "TaskCreated", "event-reaction", ["TaskCreatedSchema"], 1],
      ["Command", "compensate", "RenameTask", "command-reaction", ["RenameTaskSchema"], 1],
    ] as const;
    const methods = roles
      .map(
        ([decorator, methodName, returnType, , , parameterCount]) => `
          @${decorator}
          ${methodName}(rejection: TaskAlreadyDone${
            parameterCount === 2 ? ", context: EventContext" : ""
          }): ${returnType} {
            throw new Error(String(rejection));
          }`,
      )
      .join("\n");
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/rejection-consumers.ts",
        handlerFixtureSource("ProcessManager", "TaskListSchema", methods, rejectionRoleImports),
      ),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers).toEqual(
      roles.map(([, methodName, , kind, emittedSchemas, parameterCount]) => ({
        kind,
        methodName,
        origin: "domestic",
        signalSchema: schema("../generated/rejections_pb.js", "TaskAlreadyDoneSchema"),
        emittedSchemas: emittedSchemas.map((exportName) =>
          schema(
            `../generated/${exportName === "RenameTaskSchema" ? "commands" : "events"}_pb.js`,
            exportName,
          ),
        ),
        parameterCount,
      })),
    );
  });

  it("records Where declarations for all Event-consuming handler kinds", () => {
    const methods = `
      @Where({ eventField: "board", equals: "announcements" })
      @Subscribe
      observe(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", equals: "archive" })
      @React
      react(event: TaskCreated): TaskCreated { return event; }

      @Where({ eventField: "board", equals: "commands" })
      @Command
      command(event: TaskCreated): RenameTask { throw new Error(String(event)); }
    `;
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/where-handlers.ts",
        handlerFixtureSource(
          "ProcessManager",
          "TaskListSchema",
          methods,
          `
            import { type RenameTask } from "../generated/commands_pb.js";
            import { type TaskCreated } from "../generated/events_pb.js";
          `,
        ),
      ),
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      entityReceivers(result)[0]?.handlers.map(({ kind, where }) => ({ kind, where })),
    ).toEqual([
      {
        kind: "event-subscription",
        where: { eventField: "board", equals: "announcements" },
      },
      { kind: "event-reaction", where: { eventField: "board", equals: "archive" } },
      { kind: "command-reaction", where: { eventField: "board", equals: "commands" } },
    ]);
  });

  it("rejects every non-static or unsupported Where declaration", () => {
    const methods = `
      @Where(filter)
      @Subscribe
      variable(event: TaskCreated): void { void event; }

      @Where({ ...filter })
      @Subscribe
      spread(event: TaskCreated): void { void event; }

      @Where({ ["eventField"]: "board", equals: "one" })
      @Subscribe
      computed(event: TaskCreated): void { void event; }

      @Where({ eventField: "board" })
      @Subscribe
      missing(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", eventField: "other", equals: "one" })
      @Subscribe
      duplicate(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", equals: "one", unexpected: "value" })
      @Subscribe
      unknown(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", equals: 42 })
      @Subscribe
      nonString(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", equals: "one" })
      @Where({ eventField: "board", equals: "two" })
      @Subscribe
      multiple(event: TaskCreated): void { void event; }

      @Where({ eventField: "board", equals: "one" })
      @Assign
      assignment(command: CreateTask): TaskCreated { throw new Error(String(command)); }

      @Where({ eventField: "board", equals: "one" })
      @Command
      commandInput(command: CreateTask): RenameTask { throw new Error(String(command)); }

      @Where({ eventField: "board", equals: "one" })
      undecorated(event: TaskCreated): void { void event; }
    `;
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/invalid-where.ts",
        `
          const filter = { eventField: "board", equals: "one" };
          ${handlerFixtureSource(
            "ProcessManager",
            "TaskListSchema",
            methods,
            `
              import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
              import { type TaskCreated } from "../generated/events_pb.js";
            `,
          )}
        `,
      ),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual(
      [
        "variable",
        "spread",
        "computed",
        "missing",
        "duplicate",
        "unknown",
        "nonString",
        "multiple",
        "assignment",
        "commandInput",
        "undecorated",
      ].map((methodName) => ["INVALID_WHERE", methodName]),
    );
  });

  it("rejects Where on an Entity-state subscription", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/state-where.ts", {
        "src/state-where.ts": handlerFixtureSource(
          "Projection",
          "TaskListSchema",
          `
            @Where({ eventField: "id", equals: "one" })
            @Subscribe
            state(state: ObservedState): void { void state; }
          `,
          `import { type ObservedState } from "../generated/state_pb.js";`,
        ),
        "generated/task_list_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/task_list.proto",
          [{ exportName: "TaskList", descriptorName: "TaskList", entityState: true }],
        ),
        "generated/state_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/observed_state.proto",
          [{ exportName: "ObservedState", descriptorName: "ObservedState", entityState: true }],
        ),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "INVALID_WHERE", methodName: "state" }),
    ]);
  });

  it("recognizes Where through a server namespace import", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/namespaced-where.ts",
        `
          import * as Spine from "@spine-event-engine/server";
          import { TaskListSchema } from "../generated/task_list_pb.js";
          import { type TaskCreated } from "../generated/events_pb.js";

          export class NamespacedProjection extends Spine.Projection<
            string,
            typeof TaskListSchema,
            number
          > {
            @Spine.Where({ eventField: "board", equals: "announcements" })
            @Spine.Subscribe
            observe(event: TaskCreated): void { void event; }
          }
        `,
      ),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers[0]).toMatchObject({
      kind: "event-subscription",
      where: { eventField: "board", equals: "announcements" },
    });
  });

  it("rejects rejection messages as assignment inputs and normal handler outputs", () => {
    const roles = [
      ["Assign", "assignRejection", "TaskAlreadyDone", "TaskCreated", "INVALID_SIGNAL_TYPE"],
      ["Assign", "returnFromAssign", "CreateTask", "TaskAlreadyDone", "INVALID_EMITTED_SCHEMA"],
      ["React", "returnFromReact", "TaskCreated", "TaskAlreadyDone", "INVALID_EMITTED_SCHEMA"],
      ["Command", "returnFromCommand", "TaskCreated", "TaskAlreadyDone", "INVALID_EMITTED_SCHEMA"],
    ] as const;
    const methods = roles
      .map(
        ([decorator, methodName, input, output]) => `
          @${decorator}
          ${methodName}(signal: ${input}): ${output} {
            throw new Error(String(signal));
          }`,
      )
      .join("\n");
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/rejection-roles.ts",
        handlerFixtureSource("ProcessManager", "TaskSchema", methods, rejectionRoleImports),
      ),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual(
      roles.map(([, methodName, , , code]) => [code, methodName]),
    );
  });

  it("fails closed for nested and descriptor-mismatched rejection schemas", () => {
    const roles = [
      ["nested", "Container_TaskAlreadyDone"],
      ["mismatched", "ForgedRejection"],
    ] as const;
    const methods = roles
      .map(
        ([methodName, input]) => `
          @Subscribe
          ${methodName}(signal: ${input}): void {
            void signal;
          }`,
      )
      .join("\n");
    const result = analyzeBuildHandlers(
      programWithSources("src/rejection-fail-closed.ts", {
        "src/rejection-fail-closed.ts": handlerFixtureSource(
          "Projection",
          "TaskListSchema",
          methods,
          `
            import { type Container_TaskAlreadyDone } from "../generated/nested_rejections_pb.js";
            import { type ForgedRejection } from "../generated/mismatched_rejections_pb.js";`,
        ),
        "generated/nested_rejections_pb.ts": generatedNestedModule(
          "spine/examples/todo/nested_rejections.proto",
          "Container",
          "TaskAlreadyDone",
        ),
        "generated/mismatched_rejections_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/mismatched_rejections.proto",
          [{ exportName: "ForgedRejection", descriptorName: "DifferentRejection" }],
        ),
        "generated/task_list_pb.ts": generatedModule(
          "spine/examples/todo/task_list.proto",
          "TaskList",
        ),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual(
      roles.map(([methodName]) => ["INVALID_SIGNAL_TYPE", methodName]),
    );
  });

  it("does not classify a misleading rejection filename as a rejection signal", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/misleading-rejection.ts", {
        "src/misleading-rejection.ts": handlerFixtureSource(
          "Projection",
          "TaskListSchema",
          `
            @Subscribe
            observe(signal: MisleadingRejection): void { void signal; }
          `,
          `import { type MisleadingRejection } from "../generated/notrejections_pb.js";`,
        ),
        "generated/notrejections_pb.ts": generatedModule(
          "spine/examples/todo/notrejections.proto",
          "MisleadingRejection",
        ),
        "generated/task_list_pb.ts": generatedModule(
          "spine/examples/todo/task_list.proto",
          "TaskList",
        ),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual([
      ["INVALID_SIGNAL_TYPE", "observe"],
    ]);
  });

  it("does not classify neutral descriptors from misleading command module paths", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/misleading.ts", {
        "src/misleading.ts": misleadingCommandPathSource,
        "generated/commands_pb.ts": generatedModule(
          "spine/examples/todo/audit.proto",
          "CreateTask",
        ),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
    ]);
    expect(result.diagnostics[0]?.methodName).toBe("create");
  });

  it("requires exact generated command and event source basenames", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/misnamed.ts", {
        "src/misnamed.ts": `
          import { Aggregate, Assign, React } from "@spine-event-engine/server";
          import { TaskSchema } from "../generated/task_pb.js";
          import { type NotACommand } from "../generated/notcommands_pb.js";
          import { type NotAnEvent } from "../generated/notevents_pb.js";
          export class MisnamedAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
            @Assign command(command: NotACommand): NotAnEvent { throw new Error(String(command)); }
            @React event(event: NotAnEvent): NotAnEvent { throw new Error(String(event)); }
          }
        `,
        "generated/notcommands_pb.ts": generatedModule("example/notcommands.proto", "NotACommand"),
        "generated/notevents_pb.ts": generatedModule("example/notevents.proto", "NotAnEvent"),
        "generated/task_pb.ts": generatedModule("example/tasks.proto", "Task"),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
      "INVALID_EMITTED_SCHEMA",
      "INVALID_SIGNAL_TYPE",
      "INVALID_EMITTED_SCHEMA",
    ]);
  });

  it("ties descriptor roles to the imported schema export", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/mixed-descriptors.ts", {
        "src/mixed-descriptors.ts": mixedDescriptorSource,
        "generated/domain_pb.ts": generatedModuleWithMixedDescriptors(),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
    ]);
    expect(result.diagnostics[0]?.methodName).toBe("audit");
  });

  it("fails closed for forged command and event descriptors with mismatched message names", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/forged.ts", {
        "src/forged.ts": forgedDescriptorSource,
        "generated/commands_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/task_commands.proto",
          [{ exportName: "CreateTask", descriptorName: "RenameTask" }],
        ),
        "generated/events_pb.ts": generatedModuleWithDescriptorMessages(
          "spine/examples/todo/task_events.proto",
          [{ exportName: "TaskCreated", descriptorName: "TaskRenamed" }],
        ),
        "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
      "INVALID_EMITTED_SCHEMA",
      "INVALID_SIGNAL_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "forgedCommand",
      "forgedCommand",
      "forgedEvent",
    ]);
  });

  it("fails closed for missing or malformed descriptor data", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/bad-descriptor.ts", {
        "src/bad-descriptor.ts": badDescriptorSource,
        "generated/missing_pb.ts": generatedModuleWithoutDescriptor("CreateTask"),
        "generated/malformed_pb.ts": generatedModuleWithMalformedDescriptor("RenameTask"),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "INVALID_SIGNAL_TYPE",
      "INVALID_SIGNAL_TYPE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "missing",
      "malformed",
    ]);
  });

  it("keeps neutral generated modules usable as entity state schemas", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/neutral-state.ts", {
        "src/neutral-state.ts": neutralStateSource,
        "generated/commands_pb.ts": generatedModule(
          "spine/examples/todo/task_commands.proto",
          "CreateTask",
        ),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/state_pb.ts": generatedModule("spine/examples/todo/task_state.proto", "Task"),
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.stateSchema).toEqual(
      schema("../generated/state_pb.js", "TaskSchema"),
    );
  });

  it("prefers executable generated source over declarations for descriptor inspection", () => {
    const result = analyzeBuildHandlers(
      programWithSources("src/source-preference.ts", {
        "src/source-preference.ts": sourcePreferenceSource,
        "generated/domain_pb.d.ts": [
          "export interface CreateTask {}",
          "export declare const CreateTaskSchema: unknown;",
        ].join("\n"),
        "generated/domain_pb.ts": generatedModule(
          "spine/examples/todo/task_commands.proto",
          "CreateTask",
        ),
        "generated/events_pb.ts": generatedModule(
          "spine/examples/todo/task_events.proto",
          "TaskCreated",
        ),
        "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers[0]?.signalSchema).toEqual(
      schema("../generated/domain_pb.js", "CreateTaskSchema"),
    );
  });

  it("accepts no-emission React handlers with explicit void returns", () => {
    const result = analyzeBuildHandlers(programWithSource("src/reaction.ts", noEmissionSource));

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)).toEqual([
      {
        className: "TaskProjection",
        sourceFile: "src/reaction.ts",
        stateSchema: schema("../generated/task_list_pb.js", "TaskListSchema"),
        handlers: [
          {
            kind: "event-reaction",
            methodName: "observe",
            origin: "domestic",
            signalSchema: schema("../generated/events_pb.js", "TaskCreatedSchema"),
            emittedSchemas: [],
            parameterCount: 1,
          },
        ],
      },
    ]);
  });

  it("rejects unsupported promise-like handler returns without weakening inner validation", () => {
    const result = analyzeBuildHandlers(
      programWithSource(
        "src/invalid-promise-returns.ts",
        handlerFixtureSource(
          "ProcessManager",
          "TaskListSchema",
          `
            @Assign
            promiseLike(command: CreateTask): PromiseLike<TaskCreated> { throw new Error(String(command)); }

            @Assign
            thenable(command: CreateTask): { then(): void } { throw new Error(String(command)); }

            @Assign
            missingArgument(command: CreateTask): Promise { throw new Error(String(command)); }

            @Assign
            nested(command: CreateTask): Promise<Promise<TaskCreated>> { throw new Error(String(command)); }

            @Assign
            invalidInner(command: CreateTask): Promise<CreateTask> { throw new Error(String(command)); }
          `,
          `import { type CreateTask } from "../generated/commands_pb.js";`,
        ),
      ),
    );

    expect(result.diagnostics.map(({ code, methodName }) => [code, methodName])).toEqual([
      ["UNSUPPORTED_RETURN_TYPE", "promiseLike"],
      ["UNSUPPORTED_RETURN_TYPE", "thenable"],
      ["UNSUPPORTED_RETURN_TYPE", "missingArgument"],
      ["UNSUPPORTED_RETURN_TYPE", "nested"],
      ["INVALID_EMITTED_SCHEMA", "invalidInner"],
    ]);
  });

  it("rejects void Assign and Command handlers", () => {
    const result = analyzeBuildHandlers(programWithSource("src/void.ts", voidEmissionSource));

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_EMITTED_SCHEMAS",
      "MISSING_EMITTED_SCHEMAS",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.methodName)).toEqual([
      "silentAssign",
      "silentCommand",
    ]);
  });

  it("rejects no-emission React handlers with empty tuple returns", () => {
    const result = analyzeBuildHandlers(programWithSource("src/tuple.ts", emptyTupleReactSource));

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MISSING_EMITTED_SCHEMAS",
    ]);
    expect(result.diagnostics[0]?.methodName).toBe("observe");
  });

  it("accepts string-literal handler method names", () => {
    const result = analyzeBuildHandlers(programWithSource("src/string-name.ts", stringNameSource));

    expect(result.diagnostics).toEqual([]);
    expect(entityReceivers(result)[0]?.handlers).toEqual([
      {
        kind: "command-assignment",
        methodName: 'create\u2028"task"\nnext',
        origin: "domestic",
        signalSchema: schema("../generated/commands_pb.js", "CreateTaskSchema"),
        emittedSchemas: [schema("../generated/events_pb.js", "TaskCreatedSchema")],
        parameterCount: 1,
      },
    ]);
  });

  it("reports deterministic diagnostics for unsupported decorator and signature shapes", () => {
    const result = analyzeBuildHandlers(programWithSource("src/bad.ts", invalidSource));

    expect(entityReceivers(result)).toEqual([]);
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

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "NON_EXPORTED_RECEIVER_CLASS",
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
    expect(entityReceivers(namedResult)[0]?.className).toBe("ListedAggregate");
    expect(defaultResult.diagnostics).toEqual([]);
    expect(entityReceivers(defaultResult)[0]).toMatchObject({
      className: "DefaultAggregate",
      defaultExport: true,
    });
  });

  it("reports deterministic diagnostics for cyclic aliases", () => {
    const result = analyzeBuildHandlers(programWithSource("src/cyclic.ts", cyclicAliasSource));

    expect(entityReceivers(result)).toEqual([]);
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

    expect(entityReceivers(result)).toEqual([]);
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
        "generated/commands_pb.ts": generatedModule(
          "spine/examples/todo/task_commands.proto",
          "CreateTask",
        ),
        "generated/events_pb.ts": [
          "export interface TaskCreated {}",
          "export interface TaskCreatedSchema {}",
          "export interface TaskRenamed {}",
          "export type TaskRenamedSchema = {};",
        ].join("\n"),
        "generated/task_pb.ts": "export interface TaskSchema {}",
      }),
    );

    expect(entityReceivers(result)).toEqual([]);
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

    expect(entityReceivers(result)).toEqual([]);
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

    expect(entityReceivers(result)).toEqual([
      {
        className: "OddballAggregate",
        sourceFile: "src/oddball.ts",
        stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "create",
            origin: "domestic",
            signalSchema: schema("../generated/commands_pb", "CreateTaskSchema"),
            emittedSchemas: [schema("../generated/events_pb", "TaskCreatedSchema")],
            parameterCount: 1,
          },
          {
            kind: "command-substitution",
            methodName: "rename",
            origin: "domestic",
            signalSchema: schema("../generated/commands_pb", "CreateTaskSchema"),
            emittedSchemas: [schema("../generated/commands_pb", "RenameTaskSchema")],
            parameterCount: 1,
          },
          {
            kind: "event-reaction",
            methodName: "fanOut",
            origin: "domestic",
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

    expect(entityReceivers(result)).toEqual([
      {
        className: "EdgeAggregate",
        sourceFile: "src/edge.ts",
        stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "parenthesized",
            origin: "domestic",
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

    expect(entityReceivers(result)).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "TYPESCRIPT_SYNTAX_ERROR",
    ]);
    expect(result.diagnostics[0]?.message).toContain("'}' expected");
  });
});

function programWithSource(fileName: string, source: string): ts.Program {
  return programWithSources(fileName, {
    [fileName]: source,
    "generated/audit_pb.ts": generatedModule("spine/examples/todo/audit.proto", "AuditRecord"),
    "generated/commands_pb.ts": generatedModule(
      "spine/examples/todo/task_commands.proto",
      "CreateTask",
      "RenameTask",
      "MissingSchemaCommand",
    ),
    "generated/events_pb.ts": generatedModule(
      "spine/examples/todo/task_events.proto",
      "TaskCreated",
      "TaskRenamed",
    ),
    "generated/rejections_pb.ts": generatedModule(
      "spine/examples/todo/task_rejections.proto",
      "TaskAlreadyDone",
    ),
    "generated/task_list_pb.ts": generatedModule("spine/examples/todo/task_list.proto", "TaskList"),
    "generated/task_pb.ts": generatedModule("spine/examples/todo/tasks.proto", "Task"),
    "generated/spine/examples/todo/task_commands_pb.ts": generatedModule(
      "spine/examples/todo/task_commands.proto",
      "CreateTask",
      "RenameTask",
    ),
    "generated/spine/examples/todo/task_events_pb.ts": generatedModule(
      "spine/examples/todo/task_events.proto",
      "TaskCompleted",
      "TaskCreated",
      "TaskRenamed",
    ),
    "generated/spine/examples/todo/tasks_pb.ts": generatedModule(
      "spine/examples/todo/tasks.proto",
      "Task",
    ),
  });
}

function standaloneContractProgram(fileName: string, source: string): ts.Program {
  return programWithSources(fileName, {
    [fileName]: source,
    "generated/commands_pb.ts": generatedModule(
      "spine/examples/todo/task_commands.proto",
      "CreateTask",
      "RenameTask",
    ),
    "generated/events_pb.ts": generatedModule(
      "spine/examples/todo/task_events.proto",
      "TaskCreated",
      "TaskRenamed",
    ),
    "generated/rejections_pb.ts": generatedModule(
      "spine/examples/todo/task_rejections.proto",
      "TaskAlreadyDone",
    ),
    "generated/task_pb.ts": generatedModuleWithDescriptorMessages(
      "spine/examples/todo/tasks.proto",
      [{ exportName: "Task", descriptorName: "Task", entityState: true }],
    ),
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

const rejectionRoleImports = `
  import { type EventContext } from "@spine-event-engine/proto";
  import { type TaskAlreadyDone } from "../generated/rejections_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";
  import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";`;

function handlerFixtureSource(
  entityBase: string,
  stateSchema: string,
  methods: string,
  imports: string,
): string {
  const stateModule = stateSchema === "TaskSchema" ? "task_pb" : "task_list_pb";
  const versionType = entityBase === "Aggregate" ? "bigint" : "number";
  return `
    import {
      Aggregate, Assign, Command, ProcessManager, Projection, React, Subscribe, Where,
    } from "@spine-event-engine/server";
    import { ${stateSchema} } from "../generated/${stateModule}.js";
    ${imports}

    export class RejectionFixture extends ${entityBase}<string, typeof ${stateSchema}, ${versionType}> {
      ${methods}
    }
  `;
}

function generatedModule(protoSource: string, ...names: string[]): string {
  return generatedModuleWithDescriptorMessages(
    protoSource,
    names.map((name) => ({ exportName: name, descriptorName: name })),
  );
}

function generatedModuleWithDescriptorMessages(
  protoSource: string,
  messages: readonly {
    readonly exportName: string;
    readonly descriptorName: string;
    readonly entityState?: boolean;
  }[],
): string {
  const file = "file_spine_example_todo_v1_test";
  const schemas = messages
    .map(({ exportName }, index) =>
      exportName === "MissingSchemaCommand"
        ? `export interface ${exportName} {}`
        : [
            `export interface ${exportName} {}`,
            `export const ${exportName}Schema = messageDesc(${file}, ${String(index)});`,
          ].join("\n"),
    )
    .join("\n");

  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, index: number): unknown;",
    `export const ${file} = fileDesc("${fileDescriptor(protoSource, messages)}");`,
    schemas,
  ].join("\n");
}

function generatedModuleWithoutDescriptor(...names: string[]): string {
  return names
    .map((name) => [`export interface ${name} {}`, `export const ${name}Schema = {};`].join("\n"))
    .join("\n");
}

function generatedModuleWithMalformedDescriptor(...names: string[]): string {
  const file = "file_spine_example_todo_v1_malformed";
  const schemas = names
    .map((name, index) =>
      [
        `export interface ${name} {}`,
        `export const ${name}Schema = messageDesc(${file}, ${String(index)});`,
      ].join("\n"),
    )
    .join("\n");

  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, index: number): unknown;",
    `export const ${file} = fileDesc("not-a-file-descriptor");`,
    schemas,
  ].join("\n");
}

function generatedNestedModule(protoSource: string, parent: string, nested: string): string {
  const file = "file_spine_example_todo_v1_nested";
  const descriptor = create(FileDescriptorProtoSchema, {
    name: protoSource,
    messageType: [{ name: parent, nestedType: [{ name: nested }] }],
  });
  const encodedDescriptor = Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString(
    "base64",
  );

  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, ...indexes: number[]): unknown;",
    `export const ${file} = fileDesc("${encodedDescriptor}");`,
    `export interface ${parent}_${nested} {}`,
    `export const ${parent}_${nested}Schema = messageDesc(${file}, 0, 0);`,
  ].join("\n");
}

function generatedModuleWithMixedDescriptors(): string {
  const commandDescriptor = fileDescriptor("spine/examples/todo/task_commands.proto", [
    { descriptorName: "CreateTask" },
  ]);
  const neutralDescriptor = fileDescriptor("spine/examples/todo/audit.proto", [
    { descriptorName: "AuditRecord" },
  ]);

  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, index: number): unknown;",
    `export const command_file = fileDesc("${commandDescriptor}");`,
    `export const neutral_file = fileDesc("${neutralDescriptor}");`,
    "export interface CreateTask {}",
    "export const CreateTaskSchema = messageDesc(command_file, 0);",
    "export interface AuditRecord {}",
    "export const AuditRecordSchema = messageDesc(neutral_file, 0);",
  ].join("\n");
}

function fileDescriptor(
  protoSource: string,
  messages: readonly { readonly descriptorName: string; readonly entityState?: boolean }[],
): string {
  const descriptor = create(FileDescriptorProtoSchema, {
    name: protoSource,
    messageType: messages.map(({ descriptorName, entityState }) => {
      if (entityState !== true) {
        return { name: descriptorName };
      }
      const options = create(MessageOptionsSchema);
      setExtension(options, entity, create(EntityOptionSchema));
      return { name: descriptorName, options };
    }),
  });

  return Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64");
}

const validTaskSource = `
  import { Command, ProcessManager, Subscribe } from "@spine-event-engine/server";
  import { type EventContext } from "@spine-event-engine/proto";
  import * as server from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/spine/examples/todo/tasks_pb.js";
  import { type RenameTask } from "../generated/spine/examples/todo/task_commands_pb.js";
  import * as events from "../generated/spine/examples/todo/task_events_pb.js";

  export class TaskProcessManager extends ProcessManager<string, typeof TaskSchema, bigint> {
    @Subscribe
    observeCreated(event: events.TaskCreated): Promise<void> {
      void event;
    }

    @Command
    renameAgain(event: events.TaskCreated, context: EventContext): Promise<Array<RenameTask>> {
      throw new Error(String(event) + String(context));
    }

    @server.React
    reactToCreated(event: events.TaskCreated): Promise<readonly [events.TaskRenamed, events.TaskCompleted]> {
      throw new Error(String(event));
    }

    @Subscribe
    onRenamed(event: events.TaskRenamed): Promise<void> {
      void event;
    }
  }
`;

const neutralCommandSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/domain_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class NeutralCommandAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const neutralEventSource = `
  import { Projection, Subscribe } from "@spine-event-engine/server";
  import { TaskListSchema } from "../generated/task_list_pb.js";
  import { type TaskCreated } from "../generated/domain_pb.js";

  export class NeutralEventProjection extends Projection<string, typeof TaskListSchema, bigint> {
    @Subscribe
    observe(event: TaskCreated): void {
      void event;
    }
  }
`;

const stateSubscriptionSource = `
  import { Projection, Subscribe } from "@spine-event-engine/server";
  import { TaskSchema, type Task } from "../generated/task_pb.js";

  export class StateProjection extends Projection<string, typeof TaskSchema, bigint> {
    @Subscribe
    observe(state: Task): void {
      void state;
    }
  }
`;

const foreignStateSubscriptionSource = `
  import { Projection, Subscribe } from "@spine-event-engine/server";
  import { ReceiverStateSchema } from "../generated/receiver_pb.js";
  import { type ForeignState } from "../generated/foreign_pb.js";
  import { type AuditRecord } from "../generated/audit_pb.js";

  export class ReceiverProjection extends Projection<string, typeof ReceiverStateSchema, bigint> {
    @Subscribe
    observeForeign(state: ForeignState): void {
      void state;
    }

    @Subscribe
    observeAudit(record: AuditRecord): void {
      void record;
    }
  }
`;

const misleadingCommandPathSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class MisleadingAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const mixedDescriptorSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type AuditRecord } from "../generated/domain_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class MixedDescriptorAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    audit(command: AuditRecord): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const forgedDescriptorSource = `
  import { Aggregate, Assign, Subscribe } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class ForgedDescriptorAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    forgedCommand(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Subscribe
    forgedEvent(event: TaskCreated): void {
      void event;
    }
  }
`;

const badDescriptorSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/missing_pb.js";
  import { type RenameTask } from "../generated/malformed_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class BadDescriptorAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    missing(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }

    @Assign
    malformed(command: RenameTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const sourcePreferenceSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/domain_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class SourcePreferenceAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const neutralStateSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/state_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class NeutralStateAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }
`;

const localEntitySource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Assign, Command, ProcessManager, React } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask, type RenameTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class InvalidRoleAggregate extends ProcessManager<string, typeof TaskSchema, bigint> {
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
  import * as spine from "@spine-event-engine/server";
  import * as proto from "@spine-event-engine/proto";
  import * as commands from "../generated/commands_pb";
  import * as events from "../generated/events_pb";
  import { TaskSchema as StateSchema } from "../generated/task_pb.js";

  type State = (typeof StateSchema);
  const computed = "computed";

  export class OddballAggregate extends spine.ProcessManager<string, State, bigint> {
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import * as Proto from "@spine-event-engine/proto";
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
  import { Aggregate, Assign } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class BrokenAggregate extends Aggregate<string, typeof TaskSchema, bigint> {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
`;

const noEmissionSource = `
  import { Projection, React } from "@spine-event-engine/server";
  import { TaskListSchema } from "../generated/task_list_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class TaskProjection extends Projection<string, typeof TaskListSchema, number> {
    @React
    observe(event: TaskCreated): void {
      void event;
    }
  }
`;

const voidEmissionSource = `
  import { Assign, Command, ProcessManager } from "@spine-event-engine/server";
  import { TaskSchema } from "../generated/task_pb.js";
  import { type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class TaskAggregate extends ProcessManager<string, typeof TaskSchema, bigint> {
    @Assign
    silentAssign(command: CreateTask): void {
      void command;
    }

    @Command
    silentCommand(event: TaskCreated): void {
      void event;
    }
  }
`;

const emptyTupleReactSource = `
  import { Projection, React } from "@spine-event-engine/server";
  import { TaskListSchema } from "../generated/task_list_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class TaskProjection extends Projection<string, typeof TaskListSchema, bigint> {
    @React
    observe(event: TaskCreated): [] {
      void event;
      return [];
    }
  }
`;

const stringNameSource = `
  import { Aggregate, Assign } from "@spine-event-engine/server";
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
  import { Apply, Assign, Command, ProcessManager, Subscribe } from "@spine-event-engine/server";
  import { type Event } from "@spine-event-engine/proto";
  import { TaskSchema } from "../generated/task_pb.js";
  import { CreateTaskSchema, type CreateTask } from "../generated/commands_pb.js";
  import { type TaskCreated } from "../generated/events_pb.js";

  export class MissingState {
    @Assign
    create(command: CreateTask): TaskCreated {
      throw new Error(String(command));
    }
  }

  export class BadAggregate extends ProcessManager<string, typeof TaskSchema, bigint> {
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
