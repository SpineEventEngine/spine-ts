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

import {
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  GeneratedRegistryWriter,
  type BuildHandlerAnalysis,
} from "../../src/handler/generated-registry-writer.js";

describe("generated registry writer", () => {
  it("renders deterministic registry source from analyzed handlers", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(
      repoRoot,
      "examples/todo/generated/handler/generated-handler-registry.ts",
    );
    const source = new GeneratedRegistryWriter().render(analysis(repoRoot), { outputFile });

    expect(source).toBe(
      [
        "import type { GeneratedHandlerRegistry } from " +
          '"@spine-event-engine/server/internal/generated-handler-registry";',
        'import { TaskAggregate } from "../../src/task-aggregate.js";',
        'import { TaskProjection } from "../../src/task-projection.js";',
        'import { CreateTaskSchema, RenameTaskSchema } from "../spine/examples/todo/task_commands_pb.js";',
        "import { TaskCompletedSchema, TaskCreatedSchema, TaskRenamedSchema } " +
          'from "../spine/examples/todo/task_events_pb.js";',
        'import { TaskSchema } from "../spine/examples/todo/tasks_pb.js";',
        "",
        "export const generatedHandlerRegistry: GeneratedHandlerRegistry = {",
        "  version: 3,",
        "  entities: [",
        "    {",
        "      entityType: TaskAggregate,",
        "      stateSchema: TaskSchema,",
        "      handlers: [",
        "        {",
        '          kind: "command-assignment",',
        '          methodName: "createTask",',
        "          signalSchema: CreateTaskSchema,",
        "          emittedSchemas: [TaskCreatedSchema],",
        "          parameterCount: 1,",
        '          origin: "domestic",',
        "        },",
        "        {",
        '          kind: "command-reaction",',
        '          methodName: "renameTask",',
        "          signalSchema: TaskCreatedSchema,",
        "          emittedSchemas: [RenameTaskSchema],",
        "          parameterCount: 2,",
        '          origin: "domestic",',
        "        },",
        "      ],",
        "    },",
        "    {",
        "      entityType: TaskProjection,",
        "      stateSchema: TaskSchema,",
        "      handlers: [",
        "        {",
        '          kind: "event-subscription",',
        '          methodName: "onTaskCreated",',
        "          signalSchema: TaskCreatedSchema,",
        "          emittedSchemas: [],",
        "          parameterCount: 1,",
        '          origin: "domestic",',
        "        },",
        "        {",
        '          kind: "event-reaction",',
        '          methodName: "onTaskRenamed",',
        "          signalSchema: TaskRenamedSchema,",
        "          emittedSchemas: [TaskCompletedSchema, TaskCreatedSchema],",
        "          parameterCount: 2,",
        '          origin: "domestic",',
        "        },",
        "      ],",
        "    },",
        "  ],",
        "};",
        "",
      ].join("\n"),
    );
  });

  it("renders rejection schemas for all accepted event-consuming handler records", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");
    const rejectionSchema = schema("../generated/task_rejections_pb.js", "TaskAlreadyDoneSchema");
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [
          {
            className: "RejectionConsumers",
            sourceFile: join(repoRoot, "src/rejection-consumers.ts"),
            stateSchema: schema("../generated/task_list_pb.js", "TaskListSchema"),
            handlers: [
              {
                kind: "event-subscription",
                methodName: "observe",
                signalSchema: rejectionSchema,
                emittedSchemas: [],
                parameterCount: 2,
                origin: "domestic",
              },
              {
                kind: "event-reaction",
                methodName: "react",
                signalSchema: rejectionSchema,
                emittedSchemas: [schema("../generated/task_events_pb.js", "TaskCreatedSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
              {
                kind: "command-reaction",
                methodName: "compensate",
                signalSchema: rejectionSchema,
                emittedSchemas: [schema("../generated/task_commands_pb.js", "RenameTaskSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      },
      { outputFile },
    );

    expect(source.match(/signalSchema: TaskAlreadyDoneSchema,/g)).toHaveLength(3);
    expect(source).toContain('kind: "event-subscription"');
    expect(source).toContain('kind: "event-reaction"');
    expect(source).toContain('kind: "command-reaction"');
  });

  it("renders Event field filters into generated handler records", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [
          {
            className: "TaskProjection",
            sourceFile: join(repoRoot, "src/task-projection.ts"),
            stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
            handlers: [
              {
                kind: "event-subscription",
                methodName: "onTaskCreated",
                signalSchema: schema("../generated/event_pb.js", "TaskCreatedSchema"),
                emittedSchemas: [],
                parameterCount: 1,
                origin: "domestic",
                where: { eventField: "board", equals: '{"value":"announcements"}' },
              },
            ],
          },
        ],
      },
      { outputFile },
    );

    expect(source).toContain(
      [
        "          where: {",
        '            eventField: "board",',
        String.raw`            equals: "{\"value\":\"announcements\"}",`,
        "          },",
      ].join("\n"),
    );
  });

  it("renders safe string literals for module specifiers and method names", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [
          {
            className: "TaskAggregate",
            sourceFile: join(repoRoot, "src/task-aggregate.ts"),
            stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
            handlers: [
              {
                kind: "command-assignment",
                methodName: 'create\u2028"task"\nnext',
                signalSchema: schema("../generated/command_pb.js", "CreateTaskSchema"),
                emittedSchemas: [schema("../generated/event_pb.js", "TaskCreatedSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      },
      {
        outputFile,
        registryModuleSpecifier: "@spine-event-engine/server\u2029with\nbreak",
      },
    );

    expect(source).toContain(
      'import type { GeneratedHandlerRegistry } from "@spine-event-engine/server\\u2029with\\nbreak";',
    );
    expect(source).toContain('methodName: "create\\u2028\\"task\\"\\nnext",');
  });

  it("rejects invalid registry export names", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");

    expect(() =>
      new GeneratedRegistryWriter().render(analysis(repoRoot), {
        outputFile,
        registryName: "generated-handler-registry",
      }),
    ).toThrow(/valid TypeScript identifier/);
  });

  it("rejects reserved-word registry export names", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");

    for (const registryName of ["arguments", "class", "default", "eval", "function"]) {
      expect(() =>
        new GeneratedRegistryWriter().render(analysis(repoRoot), {
          outputFile,
          registryName,
        }),
      ).toThrow(/reserved TypeScript word/);
    }
  });

  it("rejects registry export names that collide with generated import bindings", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");

    for (const registryName of ["GeneratedHandlerRegistry", "TaskAggregate"]) {
      expect(() =>
        new GeneratedRegistryWriter().render(analysis(repoRoot), {
          outputFile,
          registryName,
        }),
      ).toThrow(/collides with generated import binding/);
    }
  });

  it("aliases colliding entity and schema bindings deterministically", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [
          {
            className: "TaskEntity",
            sourceFile: join(repoRoot, "src/alpha/task.ts"),
            stateSchema: schema("../../generated/alpha_pb.js", "TaskSchema"),
            handlers: [
              {
                kind: "command-assignment",
                methodName: "createAlpha",
                signalSchema: schema("../../generated/alpha_commands_pb.js", "CreateTaskSchema"),
                emittedSchemas: [schema("../../generated/alpha_events_pb.js", "TaskCreatedSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
          {
            className: "TaskEntity",
            sourceFile: join(repoRoot, "src/beta/task.ts"),
            stateSchema: schema("../../generated/beta_pb.js", "TaskSchema"),
            handlers: [
              {
                kind: "command-assignment",
                methodName: "createBeta",
                signalSchema: schema("../../generated/beta_commands_pb.js", "CreateTaskSchema"),
                emittedSchemas: [schema("../../generated/beta_events_pb.js", "TaskCreatedSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      },
      { outputFile },
    );

    expect(source).toContain('import { TaskEntity } from "../../src/alpha/task.js";');
    expect(source).toContain(
      'import { TaskEntity as TaskEntity_2 } from "../../src/beta/task.js";',
    );
    expect(source).toContain('import { TaskSchema } from "../alpha_pb.js";');
    expect(source).toContain('import { TaskSchema as TaskSchema_2 } from "../beta_pb.js";');
    expect(source).toContain("      entityType: TaskEntity,");
    expect(source).toContain("      entityType: TaskEntity_2,");
    expect(source).toContain("      stateSchema: TaskSchema,");
    expect(source).toContain("      stateSchema: TaskSchema_2,");
  });

  it("reuses the same entity import binding for repeated identical entity references", () => {
    const repoRoot = "/workspace/repo";
    const outputFile = join(repoRoot, "generated/handler/generated-handler-registry.ts");
    const repeatedEntity = {
      className: "TaskAggregate",
      sourceFile: join(repoRoot, "src/task-aggregate.ts"),
      stateSchema: schema("../generated/task_pb.js", "TaskSchema"),
      handlers: [
        {
          kind: "command-assignment" as const,
          methodName: "createTask",
          signalSchema: schema("../generated/command_pb.js", "CreateTaskSchema"),
          emittedSchemas: [schema("../generated/event_pb.js", "TaskCreatedSchema")],
          parameterCount: 1 as const,
          origin: "domestic" as const,
        },
      ],
    };
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [repeatedEntity, repeatedEntity],
      },
      { outputFile },
    );

    expect(source).toContain('import { TaskAggregate } from "../../src/task-aggregate.js";');
    expect(source).not.toContain("TaskAggregate_2");
    expect(source.match(/entityType: TaskAggregate,/g)).toHaveLength(2);
  });

  it("writes a generated registry file only inside an ignored generated root", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    new GeneratedRegistryWriter().write(analysis(repoRoot), {
      generatedRoot,
      outputFile,
      repoRoot,
    });

    expect(readFileSync(outputFile, "utf8")).toContain("generatedHandlerRegistry");
  });

  it("renders imports for the published registry path when writing to staging", () => {
    const repoRoot = createRepoFixture(
      "examples/todo/generated/\nexamples/todo/.generated-*/generated/\n",
    );
    const stagedGeneratedRoot = join(repoRoot, "examples/todo/.generated-test/generated");
    const stagedOutputFile = join(stagedGeneratedRoot, "handler/generated-handler-registry.ts");
    const publishedOutputFile = join(
      repoRoot,
      "examples/todo/generated/handler/generated-handler-registry.ts",
    );

    new GeneratedRegistryWriter().write(analysis(repoRoot), {
      generatedRoot: stagedGeneratedRoot,
      outputFile: stagedOutputFile,
      publishedOutputFile,
      repoRoot,
    });

    expect(readFileSync(stagedOutputFile, "utf8")).toContain(
      'import { TaskAggregate } from "../../src/task-aggregate.js";',
    );
  });

  it("fails invalid render options before creating the output directory", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    expect(existsSync(dirname(outputFile))).toBe(false);
    expect(() =>
      new GeneratedRegistryWriter().write(analysis(repoRoot), {
        generatedRoot,
        outputFile,
        repoRoot,
        registryName: "class",
      }),
    ).toThrow(/reserved TypeScript word/);
    expect(existsSync(dirname(outputFile))).toBe(false);
  });

  it("rejects writes when analyzer diagnostics are present", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");
    const writer = new GeneratedRegistryWriter();

    expect(() =>
      writer.write(
        {
          ...analysis(repoRoot),
          diagnostics: [
            {
              code: "MISSING_SIGNAL_TYPE",
              sourceFile: join(repoRoot, "packages/demo/src/task.ts"),
              line: 2,
              column: 3,
              message: "missing signal type",
            },
          ],
        },
        { generatedRoot, outputFile, repoRoot },
      ),
    ).toThrow(/diagnostics/);
  });

  it("rejects writes when the generated root is not ignored by Git", () => {
    const repoRoot = createRepoFixture("\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    expect(() =>
      new GeneratedRegistryWriter().write(analysis(repoRoot), {
        generatedRoot,
        outputFile,
        repoRoot,
      }),
    ).toThrow(/ignored by Git/);
  });

  it("reports git ignore verification failures before writing", async () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    vi.resetModules();
    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");

      return {
        ...actual,
        spawnSync: () =>
          ({
            status: 128,
            signal: null,
            output: [],
            pid: 0,
            stdout: "",
            stderr: "fatal: not a git repository",
          }) as ReturnType<typeof spawnSync>,
      };
    });

    try {
      const { GeneratedRegistryWriter: MockedWriter } =
        await import("../../src/handler/generated-registry-writer.js");

      expect(() =>
        new MockedWriter().write(analysis(repoRoot), {
          generatedRoot,
          outputFile,
          repoRoot,
        }),
      ).toThrow(/Failed to verify Git ignore status/);
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("propagates unexpected path validation filesystem failures", async () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

      return {
        ...actual,
        lstatSync(path: string) {
          if (path === generatedRoot) {
            const error = new Error("permission denied") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
          }

          return actual.lstatSync(path);
        },
      };
    });

    try {
      const { GeneratedRegistryWriter: MockedWriter } =
        await import("../../src/handler/generated-registry-writer.js");

      expect(() =>
        new MockedWriter().write(analysis(repoRoot), {
          generatedRoot,
          outputFile,
          repoRoot,
        }),
      ).toThrow("permission denied");
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });

  it("rejects symlinked generated roots", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const linkedRoot = mkdtempSync(join(tmpdir(), "spine-linked-generated-"));
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    mkdirSync(dirname(generatedRoot), { recursive: true });
    symlinkSync(linkedRoot, generatedRoot, "dir");

    expect(() =>
      new GeneratedRegistryWriter().write(analysis(repoRoot), {
        generatedRoot,
        outputFile,
        repoRoot,
      }),
    ).toThrow(/symlink/);
  });

  it("rejects symlinked repo roots", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const linkedRepoRoot = join(tempRoot(), `spine-repo-root-link-${String(Date.now())}`);
    const generatedRoot = join(linkedRepoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    symlinkSync(repoRoot, linkedRepoRoot, "dir");

    expect(() =>
      new GeneratedRegistryWriter().write(analysis(linkedRepoRoot), {
        generatedRoot,
        outputFile,
        repoRoot: linkedRepoRoot,
      }),
    ).toThrow(/Repository root must not be a symlink/);
  });

  it("rejects repo roots reached through a symlinked ancestor", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const linkedAncestor = join(tempRoot(), `spine-ancestor-link-${String(Date.now())}`);
    const linkedRepoRoot = join(linkedAncestor, basename(repoRoot));
    const generatedRoot = join(linkedRepoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");

    symlinkSync(dirname(repoRoot), linkedAncestor, "dir");

    expect(() =>
      new GeneratedRegistryWriter().write(analysis(linkedRepoRoot), {
        generatedRoot,
        outputFile,
        repoRoot: linkedRepoRoot,
      }),
    ).toThrow(/Repository root path must not use a symlink ancestor/);
  });

  it("rejects pre-existing symlink output files", () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");
    const linkedFile = join(repoRoot, "packages/demo/escaped.ts");

    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(linkedFile, "escape\n");
    symlinkSync(linkedFile, outputFile, "file");

    expect(() =>
      new GeneratedRegistryWriter().write(analysis(repoRoot), {
        generatedRoot,
        outputFile,
        repoRoot,
      }),
    ).toThrow(/symlink/);
  });

  it("re-checks the output directory path after mkdir before writing", async () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");
    const outputDir = dirname(outputFile);
    const linkedDir = mkdtempSync(join(tmpdir(), "spine-output-dir-link-"));

    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

      return {
        ...actual,
        mkdirSync(path: string, options: { readonly recursive?: boolean }) {
          const result = actual.mkdirSync(path, options);

          if (path === outputDir) {
            actual.rmSync(path, { recursive: true, force: true });
            actual.symlinkSync(linkedDir, path, "dir");
          }

          return result;
        },
      };
    });

    try {
      const { GeneratedRegistryWriter: MockedWriter } =
        await import("../../src/handler/generated-registry-writer.js");

      expect(() =>
        new MockedWriter().write(analysis(repoRoot), {
          generatedRoot,
          outputFile,
          repoRoot,
        }),
      ).toThrow(/Generated output directory must not use a symlink path/);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });

  it("opens the generated output with no-follow semantics", async () => {
    const repoRoot = createRepoFixture("packages/demo/generated/\n");
    const generatedRoot = join(repoRoot, "packages/demo/generated");
    const outputFile = join(generatedRoot, "handler/generated-handler-registry.ts");
    let actualFlags = 0;

    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

      return {
        ...actual,
        openSync(path: string, flags: number, mode?: number) {
          actualFlags = flags;
          return actual.openSync(path, flags, mode);
        },
      };
    });

    try {
      const { GeneratedRegistryWriter: MockedWriter } =
        await import("../../src/handler/generated-registry-writer.js");

      new MockedWriter().write(analysis(repoRoot), {
        generatedRoot,
        outputFile,
        repoRoot,
      });
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }

    expect(actualFlags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });

  it("renders package schema imports unchanged and compiles under isolated declarations", () => {
    const repoRoot = createCompileFixture();
    const outputFile = join(
      repoRoot,
      "packages/demo/generated/handler/generated-handler-registry.ts",
    );
    const source = new GeneratedRegistryWriter().render(
      {
        diagnostics: [],
        entities: [
          {
            className: "TaskAggregate",
            sourceFile: join(repoRoot, "packages/demo/src/task-aggregate.ts"),
            stateSchema: schema("@acme/generated/task_pb.js", "TaskSchema"),
            handlers: [
              {
                kind: "command-assignment",
                methodName: "createTask",
                signalSchema: schema("@acme/generated/command_pb.js", "CreateTaskSchema"),
                emittedSchemas: [schema("@acme/generated/event_pb.js", "TaskCreatedSchema")],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      },
      { outputFile },
    );

    expect(source).toContain('import { TaskSchema } from "@acme/generated/task_pb.js";');
    expect(source).toContain('import { CreateTaskSchema } from "@acme/generated/command_pb.js";');
    expect(source).toContain('import { TaskCreatedSchema } from "@acme/generated/event_pb.js";');
    writeFileSync(outputFile, source);

    const diagnostics = compileIsolatedDeclarations(outputFile);

    expect(diagnostics).toEqual([]);
  }, 20_000);
});

function analysis(repoRoot: string): BuildHandlerAnalysis {
  return {
    diagnostics: [],
    entities: [
      {
        className: "TaskAggregate",
        sourceFile: join(repoRoot, "examples/todo/src/task-aggregate.ts"),
        stateSchema: schema("../generated/spine/examples/todo/tasks_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "command-assignment",
            methodName: "createTask",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_commands_pb.js",
              "CreateTaskSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/examples/todo/task_events_pb.js", "TaskCreatedSchema"),
            ],
            parameterCount: 1,
            origin: "domestic",
          },
          {
            kind: "command-reaction",
            methodName: "renameTask",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/examples/todo/task_commands_pb.js", "RenameTaskSchema"),
            ],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
      {
        className: "TaskProjection",
        sourceFile: join(repoRoot, "examples/todo/src/task-projection.ts"),
        stateSchema: schema("../generated/spine/examples/todo/tasks_pb.js", "TaskSchema"),
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onTaskCreated",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskCreatedSchema",
            ),
            emittedSchemas: [],
            parameterCount: 1,
            origin: "domestic",
          },
          {
            kind: "event-reaction",
            methodName: "onTaskRenamed",
            signalSchema: schema(
              "../generated/spine/examples/todo/task_events_pb.js",
              "TaskRenamedSchema",
            ),
            emittedSchemas: [
              schema("../generated/spine/examples/todo/task_events_pb.js", "TaskCompletedSchema"),
              schema("../generated/spine/examples/todo/task_events_pb.js", "TaskCreatedSchema"),
            ],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  };
}

function schema(moduleSpecifier: string, exportName: string) {
  return { exportName, moduleSpecifier };
}

function createRepoFixture(gitignore: string): string {
  const repoRoot = mkdtempSync(join(tempRoot(), "spine-registry-writer-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  writeFileSync(join(repoRoot, ".gitignore"), gitignore);
  mkdirSync(join(repoRoot, "packages/demo/src"), { recursive: true });
  writeFileSync(join(repoRoot, "packages/demo/package.json"), '{"name":"demo"}\n');
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "-m", "fixture"], repoRoot);

  return repoRoot;
}

function createCompileFixture(): string {
  const repoRoot = mkdtempSync(join(tempRoot(), "spine-registry-compile-"));

  mkdirSync(join(repoRoot, "packages/demo/generated/handler"), { recursive: true });
  mkdirSync(join(repoRoot, "packages/demo/src"), { recursive: true });
  mkdirSync(join(repoRoot, "node_modules/@spine-event-engine/server/internal"), {
    recursive: true,
  });
  mkdirSync(join(repoRoot, "node_modules/@acme/generated"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages/demo/src/task-aggregate.ts"),
    ["export class TaskAggregate {", "  createTask(): void {}", "}", ""].join("\n"),
  );
  writeFileSync(
    join(
      repoRoot,
      "node_modules/@spine-event-engine/server/internal/generated-handler-registry.d.ts",
    ),
    [
      "export interface GeneratedHandlerRegistry {",
      "  readonly version: 3;",
      "  readonly entities: readonly {",
      "    readonly entityType: new (...args: never[]) => object;",
      "    readonly stateSchema: object;",
      "    readonly handlers: readonly {",
      '      readonly kind: "command-assignment" | "command-reaction" | "event-subscription" | "event-reaction";',
      "      readonly methodName: string;",
      "      readonly signalSchema: object;",
      "      readonly emittedSchemas: readonly object[];",
      '      readonly origin: "domestic" | "external";',
      "      readonly parameterCount: 1 | 2;",
      "    }[];",
      "  }[];",
      "}",
      "",
    ].join("\n"),
  );

  for (const fileName of ["task_pb.ts", "command_pb.ts", "event_pb.ts"]) {
    const exportName =
      fileName === "task_pb.ts"
        ? "TaskSchema"
        : fileName === "command_pb.ts"
          ? "CreateTaskSchema"
          : "TaskCreatedSchema";
    writeFileSync(
      join(repoRoot, "node_modules/@acme/generated", fileName),
      `export const ${exportName} = {};\n`,
    );
  }

  return repoRoot;
}

function compileIsolatedDeclarations(entryFile: string): readonly string[] {
  const program = ts.createProgram([entryFile], {
    declaration: true,
    emitDeclarationOnly: true,
    isolatedDeclarations: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmitOnError: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];

  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  );
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  if (result.status === 0) {
    return;
  }

  throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
}

function tempRoot(): string {
  return realpathSync(tmpdir());
}
