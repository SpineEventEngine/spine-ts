import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cleanupStagedTargets,
  atomicGeneratedTargets,
  generatedTargets,
  modelAtomicTargets,
  generateTargets,
  normalizeGeneratedTypeScriptTree,
  prepareGeneratedOutput,
  prepareProtoToolsBootstrap,
  protoToolsExecutable,
  releaseProtoToolsBootstrap,
  publishGeneratedTargets,
  stageGeneratedTargets,
  writeStagedTemplate,
  withCopyrightHeader,
} from "./proto-workflow.mjs";
import { writeSpineProtoArtifacts } from "./generate-spine-proto-artifacts.mjs";

describe("clean proto-tools bootstrap", () => {
  it("generates through the bootstrap when the compiled proto-tools output is absent", () => {
    const root = process.cwd();
    const isolated = mkdtempSync(join(tmpdir(), "spine-clean-bootstrap-"));
    const clone = join(isolated, "repo");
    const worktree = spawnSync("git", ["worktree", "add", "--detach", clone, "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    if (worktree.status !== 0) throw new Error(`${worktree.stdout}${worktree.stderr}`);
    try {
      const install = spawnSync("pnpm", ["install", "--offline", "--frozen-lockfile"], {
        cwd: clone,
        encoding: "utf8",
      });
      if (install.status !== 0) throw new Error(`${install.stdout}${install.stderr}`);
      rmSync(join(clone, "packages/proto-tools/dist"), { recursive: true, force: true });
      const result = spawnSync("pnpm", ["proto:generate"], { cwd: clone, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
      expect(result.status).toBe(0);
      expect(
        readdirSync(join(clone, "packages/proto-tools/node_modules/.cache")),
      ).not.toContainEqual(expect.stringMatching(/^spine-proto-tools-bootstrap-/u));
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", clone], { cwd: root, encoding: "utf8" });
      rmSync(isolated, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("generated TypeScript traversal bounds", () => {
  it("uses generated markers and Proto imports as declaration provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-workflow-provenance-"));
    try {
      writeFileSync(
        join(root, "marked.ts"),
        "// @generated from file spine/owned.proto\nexport const marked = true;\n",
      );
      writeFileSync(
        join(root, "imported.ts"),
        'import { task } from "./spine/task_pb.js";\nexport const imported = task;\n',
      );
      normalizeGeneratedTypeScriptTree(root, ["spine/fallback.proto"]);
      expect(readFileSync(join(root, "marked.ts"), "utf8")).toContain(
        "Source Proto: spine/owned.proto",
      );
      expect(readFileSync(join(root, "imported.ts"), "utf8")).toContain(
        "Source Proto: spine/task.proto",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects generated output deeper than the bounded inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-workflow-depth-"));
    try {
      let directory = root;
      for (let depth = 0; depth <= 64; depth += 1) {
        directory = join(directory, "nested");
        mkdirSync(directory);
      }
      expect(() => normalizeGeneratedTypeScriptTree(root, ["spine/example/task.proto"])).toThrow(
        "generated TypeScript traversal exceeds bounded inventory",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects generated output exceeding the bounded entry inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-workflow-entries-"));
    try {
      for (let entry = 0; entry <= 1_000; entry += 1)
        writeFileSync(join(root, `file-${entry}.txt`), "x");
      expect(() => normalizeGeneratedTypeScriptTree(root, ["spine/example/task.proto"])).toThrow(
        "generated TypeScript traversal exceeds bounded inventory",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts generated output at the bounded entry inventory limit", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-workflow-entry-limit-"));
    try {
      for (let entry = 0; entry < 1_000; entry += 1)
        writeFileSync(join(root, `file-${entry}.txt`), "x");
      expect(() =>
        normalizeGeneratedTypeScriptTree(root, ["spine/example/task.proto"]),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function workflowClaimOperations(claims, liveness) {
  return {
    create(path, content) {
      const name = basename(path);
      if (claims.has(name)) throw new Error("exists");
      claims.set(name, { content, kind: "regular" });
    },
    list() {
      return [...claims.keys()];
    },
    read(path) {
      return claims.get(basename(path)).content;
    },
    snapshot(path) {
      const claim = claims.get(basename(path));
      if (claim === undefined || claim.kind !== "regular") throw new Error("unsafe claim");
      return { content: claim.content, identity: claim.identity ?? claim.content };
    },
    inspect(path) {
      return claims.get(basename(path)).kind;
    },
    remove(path) {
      claims.delete(basename(path));
    },
    move(from, to) {
      const claim = claims.get(basename(from));
      if (claim === undefined) throw new Error("missing claim");
      claims.delete(basename(from));
      claims.set(basename(to), claim);
    },
    liveness,
  };
}

describe("MessageBoard generated registry provenance", () => {
  it("preserves an authoritative multi-source generated notice without stacking it", () => {
    const composed =
      "/*\n" +
      " * Generated by Spine TypeScript. Do not edit manually.\n" +
      " * Source Proto: spine/examples/messageboard/commands.proto\n" +
      " * Source Proto: spine/examples/messageboard/message_board.proto\n" +
      " */\n\n" +
      "/**\n" +
      " * The application type registry.\n" +
      " * Generated from Proto: spine/examples/messageboard/commands.proto, spine/examples/messageboard/message_board.proto.\n" +
      " */\n" +
      "export const typeRegistry = true;\n";

    const rendered = withCopyrightHeader(composed);

    expect(rendered).toBe(composed);
    expect(rendered.match(/Generated by Spine TypeScript/gu)).toHaveLength(1);
    expect(rendered.match(/Generated from Proto:/gu)).toHaveLength(1);
  });
});

function todoTransactionFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-todo-transaction-"));
  for (const [template, output] of [
    ["buf.gen.yaml", "packages/proto/generated"],
    ["examples/projects/buf.gen.yaml", "examples/projects/generated"],
    ["examples/orders/buf.gen.yaml", "examples/orders/generated"],
  ]) {
    mkdirSync(join(repoRoot, dirname(template)), { recursive: true });
    writeFileSync(
      join(repoRoot, template),
      `version: v2\nplugins:\n  - local: test\n    out: ${output}\n`,
    );
  }
  const todo = join(repoRoot, "examples/todo");
  mkdirSync(join(todo, "proto"), { recursive: true });
  writeFileSync(join(todo, "package.json"), '{"name":"@example/todo","version":"1.0.0"}\n');
  writeFileSync(join(todo, "spine-proto.json"), "{}\n");
  writeFileSync(join(todo, "proto/todo.proto"), 'syntax = "proto3";\n');
  writeFileSync(
    join(todo, "buf.gen.custom.yaml"),
    "version: v2\nplugins:\n  - local: test\n    out: examples/todo/generated\n",
  );
  for (const path of ["packages/proto/generated", "examples/todo/generated"]) {
    mkdirSync(join(repoRoot, path), { recursive: true });
    writeFileSync(join(repoRoot, path, "previous.txt"), `${path}\n`);
  }
  writeFileSync(
    join(repoRoot, "packages/proto/generated/.spine-proto-generation.json"),
    '{"generationId":"root-live"}\n',
  );
  writeFileSync(
    join(repoRoot, "packages/proto/spine-proto-manifest.json"),
    rootManifest("root-live"),
  );
  writeTodoGenerationState(join(repoRoot, "examples/todo"), "todo-live", {
    companion: true,
    handler: true,
  });
  return repoRoot;
}

function messageBoardRegistryFixture() {
  const repoRoot = todoTransactionFixture();
  const chatRoot = join(repoRoot, "examples/message-board/app");
  mkdirSync(join(chatRoot, "src"), { recursive: true });
  writeFileSync(join(chatRoot, "package.json"), '{"name":"@example/chat","version":"1.0.0"}\n');
  writeFileSync(
    join(chatRoot, "spine-proto.json"),
    '{"formatVersion":1,"mode":"application","modelPackages":[],"registryOutput":"src/model-registry.ts"}\n',
  );
  writeFileSync(join(chatRoot, "src/model-registry.ts"), "previous registry\n");
  return repoRoot;
}

function rootStageCommand(label, _executable, args) {
  if (label.endsWith("source-view publication revalidation")) return 0;
  if (!label.startsWith("buf generate")) {
    const output = args[args.indexOf("--out") + 1];
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "handler\n");
    return 0;
  }
  const template = readFileSync(args.at(-1), "utf8");
  const output = template.match(/^\s*out:\s*(.+)$/mu)?.[1];
  if (output === undefined) return 1;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "next.txt"), "next\n");
  writeFileSync(join(output, ".spine-proto-generation.json"), '{"generationId":"root-staged"}\n');
  writeFileSync(join(dirname(output), "spine-proto-manifest.json"), rootManifest("root-staged"));
  return 0;
}

function todoManifest(generationId) {
  return `${JSON.stringify(
    {
      formatVersion: 2,
      packageName: "@example/todo",
      packageVersion: "1.0.0",
      protoFiles: ["todo.proto"],
      generatedExports: { "todo.proto": "generated/todo_pb.js" },
      dependencies: [],
      moduleExport: "todoProtoModule",
      generationId,
    },
    null,
    2,
  )}\n`;
}

function rootManifest(generationId) {
  return `${JSON.stringify(
    {
      formatVersion: 2,
      packageName: "@example/proto",
      packageVersion: "1.0.0",
      protoFiles: [],
      generatedExports: {},
      dependencies: [],
      moduleExport: "exampleProtoModule",
      generationId,
    },
    null,
    2,
  )}\n`;
}

function writeTodoGenerationState(packageRoot, generationId, options = {}) {
  const generatedRoot = join(packageRoot, "generated");
  mkdirSync(generatedRoot, { recursive: true });
  writeFileSync(join(generatedRoot, "model.txt"), options.model ?? "model\n");
  if (options.companion === true)
    writeFileSync(join(generatedRoot, "companion.txt"), "companion\n");
  if (options.handler === true) {
    mkdirSync(join(generatedRoot, "handler"), { recursive: true });
    writeFileSync(join(generatedRoot, "handler/generated-handler-registry.ts"), "handler\n");
    normalizeGeneratedTypeScriptTree(generatedRoot, ["todo.proto"]);
  }
  writeFileSync(
    join(generatedRoot, ".spine-proto-generation.json"),
    `${JSON.stringify({ generationId: options.markerGenerationId ?? generationId })}\n`,
  );
  if (options.manifest !== false)
    writeFileSync(
      join(packageRoot, "spine-proto-manifest.json"),
      options.manifest ?? todoManifest(generationId),
    );
}

function todoStageCommand(failure, writeManifest = true, configure) {
  return (label, _executable, args, cwd) => {
    if (label === "Todo model generation") {
      writeTodoGenerationState(cwd, "todo-staged", { manifest: writeManifest ? undefined : false });
      configure?.({ cwd, label });
      return 0;
    }
    if (label === failure) return 1;
    if (label.endsWith("source-view publication revalidation")) return 0;
    if (label === "Todo companion generation") {
      const template = readFileSync(args.at(-1), "utf8");
      const output = template.match(/^\s*out:\s*(.+)$/mu)?.[1];
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "companion.txt"), "companion\n");
      return 0;
    }
    const output = args[args.indexOf("--out") + 1];
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "handler\n");
    return 0;
  };
}

function messageBoardCompositionCommand(failure) {
  return (label, _executable, _args, cwd) => {
    if (label !== "MessageBoard model registry composition") return 1;
    if (failure) return 1;
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src/model-registry.ts"),
      [
        "/*",
        " * Generated by Spine TypeScript. Do not edit manually.",
        " * Source Proto: example-chat-model.proto",
        " */",
        "",
        "export const modelRegistry = {};",
        "",
      ].join("\n"),
    );
    return 0;
  };
}

function applicationModelTransactionFixture(target) {
  const root = mkdtempSync(join(tmpdir(), "spine-application-model-transaction-"));
  const packageRoot = join(root, target.packagePath);
  const generatedRoot = join(root, target.displayPath);
  const manifest = join(packageRoot, "spine-proto-manifest.json");
  const rootGenerated = join(root, "packages/proto/generated");

  mkdirSync(join(packageRoot, "proto"), { recursive: true });
  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(rootGenerated, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), '{"name":"@example/model","version":"1.0.0"}\n');
  writeFileSync(join(packageRoot, "spine-proto.json"), "{}\n");
  writeFileSync(join(packageRoot, "proto/model.proto"), 'syntax = "proto3";\n');
  writeFileSync(join(generatedRoot, "previous.txt"), "previous model output\n");
  writeFileSync(manifest, "previous model manifest\n");
  writeFileSync(join(rootGenerated, "previous.txt"), "previous root output\n");
  if (target.handlerGeneratedPath !== undefined) {
    const handlerGeneratedRoot = join(root, target.handlerGeneratedPath);
    mkdirSync(handlerGeneratedRoot, { recursive: true });
    writeFileSync(join(handlerGeneratedRoot, "previous.txt"), "previous handler output\n");
  }
  writeFileSync(
    join(root, "buf.gen.yaml"),
    "version: v2\nplugins:\n  - local: test\n    out: packages/proto/generated\n",
  );
  return root;
}

function applicationModelStageCommand(failure) {
  return (label, _executable, args, cwd) => {
    if (label.endsWith("model generation")) {
      mkdirSync(join(cwd, "generated"), { recursive: true });
      writeFileSync(join(cwd, "generated/model.txt"), "model\n");
      writeFileSync(join(cwd, "spine-proto-manifest.json"), "next model manifest\n");
      return 0;
    }
    if (label === failure) return 1;
    if (label.endsWith("source-view publication revalidation")) return 0;
    const output = args[args.indexOf("--out") + 1];
    if (output === undefined) return 1;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "handler\n");
    return 0;
  };
}

function bootstrapInChild(repoRoot) {
  const workflowModule = new URL("./proto-workflow.mjs", import.meta.url).href;
  const program = `
    import {
      prepareProtoToolsBootstrap,
      releaseProtoToolsBootstrap,
    } from ${JSON.stringify(workflowModule)};
    const root = ${JSON.stringify(repoRoot)};
    const executable = prepareProtoToolsBootstrap(root);
    process.stdout.write(executable);
    setTimeout(() => releaseProtoToolsBootstrap(root), 100);
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Bootstrap child failed with status ${String(status)}: ${stderr}`));
      }
    });
  });
}

function generatedDescriptorModule(encoded, names) {
  const schemas = names
    .map(
      (name, index) =>
        `export interface ${name} {}\n` +
        `export const ${name}Schema = messageDesc(file_model, ${String(index)});`,
    )
    .join("\n");
  return [
    "declare function fileDesc(source: string): unknown;",
    "declare function messageDesc(file: unknown, index: number): unknown;",
    `export const file_model = fileDesc(${JSON.stringify(encoded)});`,
    schemas,
  ].join("\n");
}

function stagedHandlerRegistryFixture() {
  const cacheRoot = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
  mkdirSync(cacheRoot, { recursive: true });
  const root = mkdtempSync(join(cacheRoot, "spine-handler-staged-model-"));
  const appRoot = join(root, "app");
  const modelRoot = join(root, "packages/model");
  const liveRoot = join(modelRoot, "dist/generated");
  const stagedRoot = join(modelRoot, ".generated-stage/generated");
  const linkedModel = join(appRoot, "node_modules/@example/model");

  mkdirSync(join(appRoot, "src"), { recursive: true });
  mkdirSync(dirname(linkedModel), { recursive: true });
  mkdirSync(liveRoot, { recursive: true });
  mkdirSync(stagedRoot, { recursive: true });
  writeFileSync(join(root, ".gitignore"), "app/generated/\n");
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
  writeFileSync(
    join(modelRoot, "package.json"),
    JSON.stringify({
      name: "@example/model",
      type: "module",
      exports: {
        "./generated/*.js": {
          types: "./dist/generated/*.d.ts",
          default: "./dist/generated/*.js",
        },
      },
    }),
  );
  for (const [file, exports] of [
    ["state_pb", ["Task", "TaskSchema"]],
    ["commands_pb", ["CreateTask", "CreateTaskSchema"]],
    ["events_pb", ["TaskCreated", "TaskCreatedSchema"]],
  ]) {
    writeFileSync(
      join(liveRoot, `${file}.d.ts`),
      exports
        .map((name) =>
          name.endsWith("Schema")
            ? `export declare const ${name}: unknown;`
            : `export interface ${name} {}`,
        )
        .join("\n"),
    );
  }
  writeFileSync(
    join(stagedRoot, "state_pb.ts"),
    generatedDescriptorModule("ChNleGFtcGxlL3N0YXRlLnByb3RvIgYKBFRhc2s=", ["Task"]),
  );
  writeFileSync(
    join(stagedRoot, "commands_pb.ts"),
    generatedDescriptorModule("ChtleGFtcGxlL3Rhc2tfY29tbWFuZHMucHJvdG8iDAoKQ3JlYXRlVGFzaw==", [
      "CreateTask",
    ]),
  );
  writeFileSync(
    join(stagedRoot, "events_pb.ts"),
    generatedDescriptorModule("ChlleGFtcGxlL3Rhc2tfZXZlbnRzLnByb3RvIg0KC1Rhc2tDcmVhdGVk", [
      "TaskCreated",
    ]),
  );
  symlinkSync(modelRoot, linkedModel, "dir");
  writeFileSync(
    join(appRoot, "src/task.ts"),
    `
      import { Aggregate, Assign } from "@spine-event-engine/server";
      import { TaskSchema } from "@example/model/generated/state_pb.js";
      import { type CreateTask } from "@example/model/generated/commands_pb.js";
      import { type TaskCreated } from "@example/model/generated/events_pb.js";

      export class TaskAggregate extends Aggregate<string, typeof TaskSchema> {
        @Assign
        create(command: CreateTask): TaskCreated {
          throw new Error(String(command));
        }
      }
    `,
  );
  writeFileSync(
    join(appRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2024",
      },
      include: ["src/**/*.ts"],
    }),
  );

  return { root, appRoot, modelRoot, liveRoot, stagedRoot };
}

function packageRootFor(entry) {
  let directory = dirname(entry);
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package root for ${entry}.`);
    directory = parent;
  }
  return directory;
}

describe("proto-workflow", () => {
  it("loads handler-registry descriptor dependencies from the application boundary", () => {
    const script = fileURLToPath(new URL("./generate-handler-registry.mjs", import.meta.url));
    const repoRoot = dirname(dirname(script));
    const fixture = stagedHandlerRegistryFixture();
    const protobufEntry = createRequire(join(repoRoot, "examples/todo/package.json")).resolve(
      "@bufbuild/protobuf",
    );
    const protobufLink = join(fixture.appRoot, "node_modules/@bufbuild/protobuf");
    mkdirSync(dirname(protobufLink), { recursive: true });
    symlinkSync(packageRootFor(protobufEntry), protobufLink, "dir");
    const unavailableProtoTools = join(
      fixture.appRoot,
      "node_modules/@spine-event-engine/proto-tools",
    );
    mkdirSync(unavailableProtoTools, { recursive: true });
    writeFileSync(
      join(unavailableProtoTools, "package.json"),
      JSON.stringify({
        name: "@spine-event-engine/proto-tools",
        type: "module",
        exports: null,
      }),
    );
    const output = join(fixture.appRoot, "generated/handler-registry.ts");

    try {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "--project",
          join(fixture.appRoot, "tsconfig.json"),
          "--generated-root",
          join(fixture.appRoot, "generated"),
          "--out",
          output,
          "--repo-root",
          repoRoot,
          "--source-generated-redirects",
          JSON.stringify([
            {
              source: fixture.liveRoot,
              staged: fixture.stagedRoot,
              packageName: "@example/model",
              moduleRoot: fixture.stagedRoot,
            },
          ]),
        ],
        { cwd: repoRoot, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(output, "utf8")).toContain("GeneratedHandlerRegistry");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("removes retired Stand subscription generated artifacts after full publication", () => {
    const repoRoot = todoTransactionFixture();
    const paths = [
      "packages/proto/generated/spine/system/server/stand_subscription_pb.ts",
      "packages/proto/dist/generated/spine/system/server/stand_subscription_pb.js",
      "packages/proto/dist/generated/spine/system/server/stand_subscription_pb.d.ts",
      "packages/proto/dist/generated/spine/system/server/stand_subscription_pb.js.map",
      "packages/proto/dist/generated/spine/system/server/stand_subscription_pb.d.ts.map",
    ];
    for (const path of paths) {
      mkdirSync(dirname(join(repoRoot, path)), { recursive: true });
      writeFileSync(join(repoRoot, path), "stale\n");
    }

    const targets = [...modelAtomicTargets];
    modelAtomicTargets.splice(1);
    try {
      expect(
        generateTargets({
          repoRoot,
          runCommand(label, executable, args, cwd) {
            const status = rootStageCommand(label, executable, args, cwd);
            if (label.startsWith("buf generate")) {
              const template = readFileSync(args.at(-1), "utf8");
              const output = template.match(/^\s*out:\s*(.+)$/mu)?.[1];
              if (output !== undefined)
                writeFileSync(join(dirname(output), "spine-proto-manifest.json"), "root next\n");
            }
            return status;
          },
          runModelCommand: todoStageCommand(undefined),
        }),
      ).toBe(0);
    } finally {
      modelAtomicTargets.splice(0, modelAtomicTargets.length, ...targets);
    }

    for (const path of paths) expect(existsSync(join(repoRoot, path))).toBe(false);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("builds and reuses a clean Proto Tools bootstrap executable", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-bootstrap-"));
    let calls = 0;
    const run = (label, executable, args) => {
      calls += 1;
      expect(executable).toBe(process.execPath);
      expect(label).toBe("Proto Tools bootstrap build");
      expect(args).toEqual([
        join(repoRoot, "node_modules/typescript/bin/tsc"),
        "--project",
        join(repoRoot, "packages/proto-tools/tsconfig.bootstrap.json"),
        "--outDir",
        expect.stringMatching(/spine-proto-tools-bootstrap-/u),
      ]);
      const output = join(args.at(-1), "cli/spine-proto-bootstrap.js");
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, "export {};\n");
      return 0;
    };

    try {
      const expected = prepareProtoToolsBootstrap(repoRoot, run);
      expect(expected).toMatch(/spine-proto-tools-bootstrap-.+\/cli\/spine-proto-bootstrap\.js$/u);
      expect(prepareProtoToolsBootstrap(repoRoot, run)).toBe(expected);
      expect(calls).toBe(1);
      releaseProtoToolsBootstrap(repoRoot);
      expect(existsSync(expected)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("ignores stale compiled Proto Tools output for real workflows", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-stale-dist-"));
    const stale = join(repoRoot, "packages/proto-tools/dist/src/cli/spine-proto.js");
    const source = join(repoRoot, "packages/proto-tools/src/cli/spine-proto-bootstrap.ts");
    mkdirSync(dirname(stale), { recursive: true });
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(stale, "stale\n");
    writeFileSync(source, "current source\n");
    const run = (_label, _executable, args) => {
      const output = join(args.at(-1), "cli/spine-proto-bootstrap.js");
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, "current source bootstrap\n");
      return 0;
    };

    try {
      const selected = protoToolsExecutable(repoRoot, undefined, run);
      expect(selected).not.toBe(stale);
      expect(readFileSync(selected, "utf8")).toBe("current source bootstrap\n");
      releaseProtoToolsBootstrap(repoRoot);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("retains the compiled CLI seam for source-free workflow fixtures", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-compiled-fixture-"));
    const compiled = join(repoRoot, "packages/proto-tools/dist/src/cli/spine-proto.js");
    mkdirSync(dirname(compiled), { recursive: true });
    writeFileSync(compiled, "fixture\n");

    try {
      expect(protoToolsExecutable(repoRoot)).toBe(compiled);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("isolates simultaneous Proto Tools bootstrap builds by process", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const [first, second] = await Promise.all([bootstrapInChild(root), bootstrapInChild(root)]);

    expect(first).not.toBe(second);
    expect(first).toMatch(/spine-proto-tools-bootstrap-.+\/cli\/spine-proto-bootstrap\.js$/u);
    expect(second).toMatch(/spine-proto-tools-bootstrap-.+\/cli\/spine-proto-bootstrap\.js$/u);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  }, 30_000);

  it("includes generated companion plugins in the bootstrap output", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const executable = prepareProtoToolsBootstrap(root);
    try {
      expect(existsSync(join(dirname(executable), "../generation/rejection-generator.js"))).toBe(
        true,
      );
      expect(existsSync(join(dirname(executable), "../generation/interface-generator.js"))).toBe(
        true,
      );
      expect(
        existsSync(join(dirname(executable), "../generation/authored-interface-provider.js")),
      ).toBe(true);
    } finally {
      releaseProtoToolsBootstrap(root);
    }
  }, 30_000);

  it("keeps every application model inside the single atomic publication boundary", () => {
    expect(generatedTargets.map((target) => target.displayPath)).toEqual([
      "packages/proto/generated",
    ]);
    expect(modelAtomicTargets.map((target) => target.displayPath)).toEqual([
      "examples/todo/generated",
      "examples/projects/generated",
      "examples/orders/generated",
      "examples/message-board/model/generated",
    ]);
    expect(atomicGeneratedTargets.map((target) => target.displayPath)).toEqual([
      "packages/proto/generated",
      "examples/todo/generated",
      "examples/projects/generated",
      "examples/orders/generated",
      "examples/message-board/model/generated",
      "examples/message-board/app/generated",
    ]);
  });

  it("stages the MessageBoard handler registry with its model output", () => {
    expect(
      modelAtomicTargets.find((target) => target.packagePath === "examples/message-board/model"),
    ).toMatchObject({
      handlerGeneratedPath: "examples/message-board/app/generated",
      handlerProjectPath: "examples/message-board/app/tsconfig.json",
    });
  });

  it("redirects MessageBoard handler analysis from live schemas to the staged model schemas", () => {
    const target = modelAtomicTargets.find(
      (candidate) => candidate.packagePath === "examples/message-board/model",
    );
    const repoRoot = applicationModelTransactionFixture(target);
    let handlerArguments;

    try {
      const staged = stageGeneratedTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand(label, _executable, args, cwd) {
          if (label === "MessageBoard model generation") {
            mkdirSync(join(cwd, "generated"), { recursive: true });
            writeFileSync(join(cwd, "generated/model.ts"), "export {};\n");
            writeFileSync(join(cwd, "spine-proto-manifest.json"), "message board next\n");
            return 0;
          }
          if (label === "MessageBoard handler registry post-step") {
            handlerArguments = args;
            const output = args[args.indexOf("--out") + 1];
            mkdirSync(dirname(output), { recursive: true });
            writeFileSync(output, "handler\n");
            return 0;
          }
          return 1;
        },
      });

      expect(staged.status).toBe(0);
      const redirects = JSON.parse(
        handlerArguments[handlerArguments.indexOf("--source-generated-redirects") + 1],
      );
      expect(redirects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: join(repoRoot, "packages/proto/dist"),
            staged: expect.stringMatching(/packages\/proto\/\.generated-[^/]+$/u),
          }),
          expect.objectContaining({
            source: join(repoRoot, "examples/message-board/model/dist"),
            staged: expect.stringMatching(/examples\/message-board\/model\/\.generated-[^/]+$/u),
          }),
          expect.objectContaining({
            source: join(repoRoot, "examples/message-board/app/node_modules/@example/model/dist"),
            staged: expect.stringMatching(/examples\/message-board\/model\/\.generated-[^/]+$/u),
            packageName: "@example/model",
          }),
        ]),
      );
      cleanupStagedTargets(staged.stagedTargets);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("executes handler analysis against staged schemas behind a workspace package symlink", () => {
    const fixture = stagedHandlerRegistryFixture();
    const generatedRoot = join(fixture.appRoot, "generated");
    const output = join(generatedRoot, "handler-registry.ts");
    const script = fileURLToPath(new URL("./generate-handler-registry.mjs", import.meta.url));
    const commonArgs = [
      script,
      "--project",
      join(fixture.appRoot, "tsconfig.json"),
      "--generated-root",
      generatedRoot,
      "--out",
      output,
      "--repo-root",
      fixture.root,
    ];

    try {
      const stale = spawnSync(process.execPath, commonArgs, {
        cwd: fixture.root,
        encoding: "utf8",
      });
      expect(stale.status).toBe(1);

      const redirected = spawnSync(
        process.execPath,
        [
          ...commonArgs,
          "--source-generated-redirects",
          JSON.stringify([
            {
              source: fixture.liveRoot,
              staged: fixture.stagedRoot,
              packageName: "@example/model",
              moduleRoot: fixture.stagedRoot,
            },
          ]),
        ],
        { cwd: fixture.root, encoding: "utf8" },
      );
      expect(redirected.stderr).toBe("");
      expect(redirected.status).toBe(0);
      expect(readFileSync(output, "utf8")).toContain("TaskAggregate");
      expect(readFileSync(output, "utf8")).toContain("CreateTaskSchema");
      expect(readFileSync(output, "utf8")).toContain("TaskCreatedSchema");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(modelAtomicTargets.filter((target) => target.packagePath !== "examples/todo"))(
    "preserves $moduleName output and manifest when its handler post-step fails",
    (target) => {
      const root = applicationModelTransactionFixture(target);
      const packageRoot = join(root, target.packagePath);

      expect(
        generateTargets({
          repoRoot: root,
          runCommand: rootStageCommand,
          runModelCommand: applicationModelStageCommand(
            `${target.moduleName} handler registry post-step`,
          ),
        }),
      ).toBe(1);
      expect(readFileSync(join(root, target.displayPath, "previous.txt"), "utf8")).toBe(
        "previous model output\n",
      );
      expect(readFileSync(join(packageRoot, "spine-proto-manifest.json"), "utf8")).toBe(
        "previous model manifest\n",
      );
      expect(readFileSync(join(root, "packages/proto/generated/previous.txt"), "utf8")).toBe(
        "previous root output\n",
      );
      if (target.handlerGeneratedPath !== undefined) {
        expect(readFileSync(join(root, target.handlerGeneratedPath, "previous.txt"), "utf8")).toBe(
          "previous handler output\n",
        );
        expect(
          readdirSync(dirname(join(root, target.handlerGeneratedPath))).some((name) =>
            name.startsWith(".generated-"),
          ),
        ).toBe(false);
      }
      expect(readdirSync(packageRoot).some((name) => name.startsWith(".generated-"))).toBe(false);
      expect(readdirSync(root).some((name) => name.startsWith(".spine-proto-"))).toBe(false);
    },
  );

  it("fails closed and cleans staging when per-model provenance exceeds the depth bound", () => {
    const target = modelAtomicTargets.find((candidate) => candidate.moduleName === "Projects");
    const root = applicationModelTransactionFixture(target);
    try {
      let directory = join(root, target.packagePath, "proto");
      for (let depth = 0; depth <= 64; depth += 1) {
        directory = join(directory, "nested");
        mkdirSync(directory);
      }
      expect(
        generateTargets({
          repoRoot: root,
          runCommand: rootStageCommand,
          runModelCommand: applicationModelStageCommand(undefined),
        }),
      ).toBe(1);
      expect(readdirSync(join(root, target.packagePath))).not.toContainEqual(
        expect.stringMatching(/^\.generated-/u),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed and cleans staging when per-model provenance exceeds the entry bound", () => {
    const target = modelAtomicTargets.find((candidate) => candidate.moduleName === "Projects");
    const root = applicationModelTransactionFixture(target);
    try {
      const protoRoot = join(root, target.packagePath, "proto");
      for (let entry = 0; entry <= 1_000; entry += 1)
        writeFileSync(join(protoRoot, `extra-${entry}.proto`), 'syntax = "proto3";');
      expect(
        generateTargets({
          repoRoot: root,
          runCommand: rootStageCommand,
          runModelCommand: applicationModelStageCommand(undefined),
        }),
      ).toBe(1);
      expect(readdirSync(join(root, target.packagePath))).not.toContainEqual(
        expect.stringMatching(/^\.generated-/u),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "Todo companion generation",
    "Todo handler registry post-step",
    "Todo source-view publication revalidation",
  ])("%s preserves live Todo and root artifacts when its staged post-step fails", (failure) => {
    const repoRoot = todoTransactionFixture();
    expect(
      generateTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(failure),
      }),
    ).toBe(1);
    expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
      "examples/todo/generated\n",
    );
    expect(readFileSync(join(repoRoot, "examples/todo/spine-proto-manifest.json"), "utf8")).toBe(
      todoManifest("todo-live"),
    );
    expect(readFileSync(join(repoRoot, "packages/proto/generated/previous.txt"), "utf8")).toBe(
      "packages/proto/generated\n",
    );
    expect(readFileSync(join(repoRoot, "packages/proto/spine-proto-manifest.json"), "utf8")).toBe(
      rootManifest("root-live"),
    );
    expect(
      readdirSync(join(repoRoot, "examples/todo")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(readdirSync(repoRoot).some((name) => name.startsWith(".spine-proto-"))).toBe(false);
  });

  it("uses the supplied root Buf executable for Todo companion generation", () => {
    const repoRoot = todoTransactionFixture();
    const localBuf = join(
      repoRoot,
      "node_modules/.bin",
      process.platform === "win32" ? "buf.cmd" : "buf",
    );
    mkdirSync(dirname(localBuf), { recursive: true });
    writeFileSync(localBuf, "fixture Buf\n");
    let companionExecutable;

    try {
      const staged = stageGeneratedTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand(label, executable, args, cwd) {
          if (label === "Todo companion generation") companionExecutable = executable;
          return todoStageCommand(undefined)(label, executable, args, cwd);
        },
      });

      expect(staged.status).toBe(0);
      expect(companionExecutable).toBe(localBuf);
      cleanupStagedTargets(staged.stagedTargets);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reuses a v2 Todo generation ID only when the complete staged and live output agree", () => {
    const repoRoot = todoTransactionFixture();
    const todoRoot = join(repoRoot, "examples/todo");
    try {
      rmSync(join(todoRoot, "generated"), { recursive: true, force: true });
      writeTodoGenerationState(todoRoot, "todo-live", { companion: true, handler: true });

      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined),
        }),
      ).toBe(0);
      expect(
        JSON.parse(readFileSync(join(todoRoot, "spine-proto-manifest.json"), "utf8")),
      ).toMatchObject({
        generationId: "todo-live",
      });
      expect(
        JSON.parse(readFileSync(join(todoRoot, "generated/.spine-proto-generation.json"), "utf8")),
      ).toEqual({ generationId: "todo-live" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reuses a v2 root generation ID when its staged and live output agree", () => {
    const repoRoot = todoTransactionFixture();
    const rootPackage = join(repoRoot, "packages/proto");
    try {
      rmSync(join(rootPackage, "generated"), { recursive: true, force: true });
      mkdirSync(join(rootPackage, "generated"), { recursive: true });
      writeFileSync(join(rootPackage, "generated/next.txt"), "next\n");
      writeFileSync(
        join(rootPackage, "generated/.spine-proto-generation.json"),
        '{"generationId":"root-live"}\n',
      );
      writeFileSync(join(rootPackage, "spine-proto-manifest.json"), rootManifest("root-live"));

      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined),
        }),
      ).toBe(0);
      expect(
        JSON.parse(readFileSync(join(rootPackage, "spine-proto-manifest.json"), "utf8")),
      ).toMatchObject({
        generationId: "root-live",
      });
      expect(
        JSON.parse(
          readFileSync(join(rootPackage, "generated/.spine-proto-generation.json"), "utf8"),
        ),
      ).toEqual({ generationId: "root-live" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["has no live manifest", (todoRoot) => rmSync(join(todoRoot, "spine-proto-manifest.json"))],
    [
      "has a malformed live manifest",
      (todoRoot) => writeFileSync(join(todoRoot, "spine-proto-manifest.json"), "not json\n"),
    ],
    [
      "has a marker that disagrees with its live manifest",
      (todoRoot) =>
        writeFileSync(
          join(todoRoot, "generated/.spine-proto-generation.json"),
          `${JSON.stringify({ generationId: "different-live-id" })}\n`,
        ),
    ],
    [
      "has a semantically different generated tree",
      (todoRoot) => writeFileSync(join(todoRoot, "generated/model.txt"), "different model\n"),
    ],
  ])("publishes a fresh Todo generation ID when it %s", (_reason, changeLive) => {
    const repoRoot = todoTransactionFixture();
    const todoRoot = join(repoRoot, "examples/todo");
    try {
      rmSync(join(todoRoot, "generated"), { recursive: true, force: true });
      writeTodoGenerationState(todoRoot, "todo-live", { companion: true, handler: true });
      changeLive(todoRoot);

      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined),
        }),
      ).toBe(0);
      expect(
        JSON.parse(readFileSync(join(todoRoot, "spine-proto-manifest.json"), "utf8")),
      ).toMatchObject({
        generationId: "todo-staged",
      });
      expect(
        JSON.parse(readFileSync(join(todoRoot, "generated/.spine-proto-generation.json"), "utf8")),
      ).toEqual({ generationId: "todo-staged" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", "live", undefined],
    ["malformed", "live", "not json\n"],
    ["empty", "live", '{"generationId":""}\n'],
    ["mismatched", "live", '{"generationId":"other"}\n'],
    ["missing", "staged", undefined],
    ["malformed", "staged", "not json\n"],
    ["empty", "staged", '{"generationId":""}\n'],
    ["mismatched", "staged", '{"generationId":"other"}\n'],
  ])("publishes a fresh Todo generation ID with a %s %s marker", (_state, location, marker) => {
    const repoRoot = todoTransactionFixture();
    const todoRoot = join(repoRoot, "examples/todo");
    const rewriteMarker = (root) => {
      const path = join(root, "generated/.spine-proto-generation.json");
      if (marker === undefined) rmSync(path);
      else writeFileSync(path, marker);
    };
    try {
      rmSync(join(todoRoot, "generated"), { recursive: true, force: true });
      writeTodoGenerationState(todoRoot, "todo-live", { companion: true, handler: true });
      if (location === "live") rewriteMarker(todoRoot);

      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined, true, ({ cwd }) => {
            if (location === "staged") rewriteMarker(cwd);
          }),
        }),
      ).toBe(0);
      expect(
        JSON.parse(readFileSync(join(todoRoot, "spine-proto-manifest.json"), "utf8")),
      ).toMatchObject({ generationId: "todo-staged" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "a depth of 64",
      ({ cwd }) => {
        let directory = join(cwd, "generated");
        for (let depth = 0; depth < 64; depth += 1) {
          directory = join(directory, "nested");
          mkdirSync(directory);
        }
      },
    ],
    [
      "1,000 generated entries",
      ({ cwd }) => {
        for (let entry = 0; entry < 995; entry += 1)
          writeFileSync(join(cwd, "generated", `entry-${entry}.txt`), "x");
      },
    ],
  ])("publishes Todo output at %s", (_description, configure) => {
    const repoRoot = todoTransactionFixture();
    try {
      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined, true, configure),
        }),
      ).toBe(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "depth 65",
      ({ cwd }) => {
        let directory = join(cwd, "generated");
        for (let depth = 0; depth < 65; depth += 1) {
          directory = join(directory, "nested");
          mkdirSync(directory);
        }
      },
    ],
    [
      "1,001 entries",
      ({ cwd }) => {
        for (let entry = 0; entry < 996; entry += 1)
          writeFileSync(join(cwd, "generated", `entry-${entry}.txt`), "x");
      },
    ],
    [
      "a symlink",
      ({ cwd }) => {
        const external = join(cwd, "external.txt");
        writeFileSync(external, "outside\n");
        symlinkSync(external, join(cwd, "generated", "unsafe.txt"));
      },
    ],
  ])("rejects Todo staged output with %s before journal publication", (_description, configure) => {
    const repoRoot = todoTransactionFixture();
    const todoRoot = join(repoRoot, "examples/todo");
    const operations = {
      write(path, contents) {
        throw new Error(`journal unexpectedly written: ${path} ${contents}`);
      },
      rename(path, target) {
        throw new Error(`rename unexpectedly attempted: ${path} ${target}`);
      },
    };
    try {
      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined, true, configure),
          publicationOperations: operations,
        }),
      ).toBe(1);
      expect(readFileSync(join(todoRoot, "generated/previous.txt"), "utf8")).toBe(
        "examples/todo/generated\n",
      );
      expect(readFileSync(join(todoRoot, "spine-proto-manifest.json"), "utf8")).toBe(
        todoManifest("todo-live"),
      );
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked live Todo tree before journal publication", () => {
    const repoRoot = todoTransactionFixture();
    const todoRoot = join(repoRoot, "examples/todo");
    let journalWrites = 0;
    const operations = {
      write() {
        journalWrites += 1;
      },
      rename(path, target) {
        throw new Error(`rename unexpectedly attempted: ${path} ${target}`);
      },
    };
    try {
      writeFileSync(join(todoRoot, "outside.txt"), "outside\n");
      symlinkSync(join(todoRoot, "outside.txt"), join(todoRoot, "generated/unsafe.txt"));

      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand: todoStageCommand(undefined),
          publicationOperations: operations,
        }),
      ).toBe(1);
      expect(journalWrites).toBe(0);
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the staged Todo manifest is missing", () => {
    const repoRoot = todoTransactionFixture();
    expect(
      generateTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(undefined, false),
      }),
    ).toBe(1);
    expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
      "examples/todo/generated\n",
    );
    expect(readFileSync(join(repoRoot, "examples/todo/spine-proto-manifest.json"), "utf8")).toBe(
      todoManifest("todo-live"),
    );
  });

  it("preserves every live artifact when MessageBoard registry composition fails", () => {
    const repoRoot = messageBoardRegistryFixture();

    expect(
      generateTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(undefined),
        runCompositionCommand: messageBoardCompositionCommand(true),
      }),
    ).toBe(1);

    expect(readFileSync(join(repoRoot, "packages/proto/generated/previous.txt"), "utf8")).toBe(
      "packages/proto/generated\n",
    );
    expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
      "examples/todo/generated\n",
    );
    expect(readFileSync(join(repoRoot, "packages/proto/spine-proto-manifest.json"), "utf8")).toBe(
      rootManifest("root-live"),
    );
    expect(readFileSync(join(repoRoot, "examples/todo/spine-proto-manifest.json"), "utf8")).toBe(
      todoManifest("todo-live"),
    );
    expect(
      readFileSync(join(repoRoot, "examples/message-board/app/src/model-registry.ts"), "utf8"),
    ).toBe("previous registry\n");
    expect(
      readdirSync(join(repoRoot, "examples/message-board")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("validates staged model records after MessageBoard registry composition and before publication", () => {
    const repoRoot = messageBoardRegistryFixture();
    const order = [];
    try {
      mkdirSync(join(repoRoot, "packages/proto"), { recursive: true });
      writeFileSync(join(repoRoot, "packages/proto/spine-proto.json"), "{}\n");
      expect(
        generateTargets({
          repoRoot,
          runCommand: rootStageCommand,
          runModelCommand(label, executable, args, cwd) {
            if (label.endsWith("source-view publication revalidation")) {
              order.push("verification");
              return 1;
            }
            return todoStageCommand(undefined)(label, executable, args, cwd);
          },
          runCompositionCommand(label, executable, args, cwd) {
            order.push("composition");
            return messageBoardCompositionCommand(false)(label, executable, args, cwd);
          },
          publicationOperations: {
            write() {
              order.push("journal");
            },
          },
          writeSpineArtifacts(_root, _generatedRoot, stagedManifest) {
            writeFileSync(stagedManifest, "root next manifest\n");
          },
        }),
      ).toBe(1);

      expect(order).toEqual(["composition", "verification"]);
      expect(readFileSync(join(repoRoot, "packages/proto/generated/previous.txt"), "utf8")).toBe(
        "packages/proto/generated\n",
      );
      expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
        "examples/todo/generated\n",
      );
      expect(readFileSync(join(repoRoot, "packages/proto/spine-proto-manifest.json"), "utf8")).toBe(
        rootManifest("root-live"),
      );
      expect(readFileSync(join(repoRoot, "examples/todo/spine-proto-manifest.json"), "utf8")).toBe(
        todoManifest("todo-live"),
      );
      expect(
        readFileSync(join(repoRoot, "examples/message-board/app/src/model-registry.ts"), "utf8"),
      ).toBe("previous registry\n");
      expect(readdirSync(repoRoot).some((name) => name.startsWith(".spine-proto-"))).toBe(false);
      for (const directory of [
        "examples/todo",
        "examples/message-board",
        "examples/message-board/app",
        "examples/message-board/app/src",
        "packages/proto",
      ])
        expect(
          readdirSync(join(repoRoot, directory)).some((name) => name.startsWith(".generated-")),
        ).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked staged MessageBoard registry before publication", () => {
    const repoRoot = messageBoardRegistryFixture();
    const external = mkdtempSync(join(tmpdir(), "spine-chat-registry-external-"));
    const externalRegistry = join(external, "model-registry.ts");
    writeFileSync(externalRegistry, "unsafe registry\n");

    expect(
      generateTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(undefined),
        runCompositionCommand(label, _executable, _args, cwd) {
          if (label !== "MessageBoard model registry composition") return 1;
          mkdirSync(join(cwd, "src"), { recursive: true });
          symlinkSync(externalRegistry, join(cwd, "src/model-registry.ts"));
          return 0;
        },
      }),
    ).toBe(1);

    expect(
      readFileSync(join(repoRoot, "examples/message-board/app/src/model-registry.ts"), "utf8"),
    ).toBe("previous registry\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    rmSync(external, { recursive: true, force: true });
  });

  it("rejects a FIFO in staged workflow output before publication", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-workflow-fifo-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-fifo");
    const stagedOutputRoot = join(stageRoot, "output");
    try {
      mkdirSync(generatedRoot, { recursive: true });
      mkdirSync(stagedOutputRoot, { recursive: true });
      writeFileSync(join(generatedRoot, "previous.txt"), "previous\n");
      const created = spawnSync("mkfifo", [join(stagedOutputRoot, "unsafe.fifo")]);
      if (created.status !== 0) throw new Error(created.stderr.toString());

      expect(() =>
        publishGeneratedTargets(
          [
            {
              generatedRoot,
              stagedOutputRoot,
              stageRoot,
              target: { displayPath: "packages/proto/generated" },
            },
          ],
          repoRoot,
        ),
      ).toThrow("Staged generated output must contain only regular files and directories");
      expect(readFileSync(join(generatedRoot, "previous.txt"), "utf8")).toBe("previous\n");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the staged Spine manifest is missing", () => {
    const repoRoot = todoTransactionFixture();
    mkdirSync(join(repoRoot, "packages/proto"), { recursive: true });
    writeFileSync(join(repoRoot, "packages/proto/spine-proto.json"), "{}\n");
    let writerCalled = false;
    expect(
      generateTargets({
        repoRoot,
        runCommand(label, executable, args, cwd) {
          if (!label.startsWith("buf generate"))
            return rootStageCommand(label, executable, args, cwd);
          const template = readFileSync(args.at(-1), "utf8");
          const output = template.match(/^\s*out:\s*(.+)$/mu)?.[1];
          if (output === undefined) return 1;
          mkdirSync(output, { recursive: true });
          writeFileSync(join(output, "next.txt"), "next\n");
          return 0;
        },
        runModelCommand: todoStageCommand(undefined),
        writeSpineArtifacts() {
          writerCalled = true;
        },
      }),
    ).toBe(1);
    expect(writerCalled).toBe(true);
    expect(readFileSync(join(repoRoot, "packages/proto/generated/previous.txt"), "utf8")).toBe(
      "packages/proto/generated\n",
    );
    expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
      "examples/todo/generated\n",
    );
    expect(readFileSync(join(repoRoot, "packages/proto/spine-proto-manifest.json"), "utf8")).toBe(
      rootManifest("root-live"),
    );
    expect(readFileSync(join(repoRoot, "examples/todo/spine-proto-manifest.json"), "utf8")).toBe(
      todoManifest("todo-live"),
    );
    expect(readdirSync(repoRoot).some((name) => name.startsWith(".spine-proto-"))).toBe(false);
  });

  it("rejects a competing root claim before creating a Todo stage", () => {
    const repoRoot = todoTransactionFixture();
    const claims = new Map([
      [
        ".spine-proto-workflow.lock.live",
        { content: JSON.stringify({ pid: 99, token: "live" }), kind: "regular" },
      ],
    ]);
    expect(
      generateTargets({
        repoRoot,
        lockOperations: workflowClaimOperations(claims, () => "alive"),
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(undefined),
      }),
    ).toBe(1);
    expect(
      readdirSync(join(repoRoot, "examples/todo")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(readFileSync(join(repoRoot, "examples/todo/generated/previous.txt"), "utf8")).toBe(
      "examples/todo/generated\n",
    );
    expect(readFileSync(join(repoRoot, "packages/proto/generated/previous.txt"), "utf8")).toBe(
      "packages/proto/generated\n",
    );
  });

  it("recovers an interrupted Todo/root publication with both manifests", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const entries = [
      ["packages/proto/generated", "packages/proto/.generated-root/generated", "root"],
      ["examples/todo/generated", "examples/todo/.generated-todo/generated", "todo"],
    ];
    const targets = entries.map(([target, staged, name]) => {
      const targetPath = join(repoRoot, target);
      const backup = join(dirname(targetPath), `.${basename(targetPath)}.backup-${name}`);
      mkdirSync(targetPath, { recursive: true });
      const stagedPath = join(repoRoot, staged);
      mkdirSync(stagedPath, { recursive: true });
      writeFileSync(join(targetPath, "value.txt"), "next\n");
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(backup, "value.txt"), "previous\n");
      return { target: targetPath, staged: stagedPath, backup, hadPrevious: true };
    });
    const manifests = [
      "packages/proto/spine-proto-manifest.json",
      "examples/todo/spine-proto-manifest.json",
    ].map((target, index) => {
      const targetPath = join(repoRoot, target);
      const staged = join(dirname(targetPath), `.generated-${index}/spine-proto-manifest.json`);
      const backup = join(dirname(targetPath), `.spine-proto-manifest.backup-${index}`);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(targetPath, "next\n");
      writeFileSync(staged, "next\n");
      writeFileSync(backup, "previous\n");
      return { target: targetPath, staged, backup, hadPrevious: true, contents: "next\n" };
    });
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({ version: 2, state: "preparing", targets, manifests })}\n`,
    );
    publishGeneratedTargets([], repoRoot);
    for (const target of targets)
      expect(readFileSync(join(target.target, "value.txt"), "utf8")).toBe("previous\n");
    for (const manifest of manifests)
      expect(readFileSync(manifest.target, "utf8")).toBe("previous\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("rolls back a v2 mid-commit interruption across every atomic root and manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const targets = atomicGeneratedTargets.map((target, index) => {
      const live = join(root, target.displayPath);
      const stageRoot = join(dirname(live), `.generated-interrupted-${index}`);
      const staged = join(stageRoot, "generated");
      const backup = join(dirname(live), `.${basename(live)}.backup-interrupted-${index}`);
      mkdirSync(live, { recursive: true });
      mkdirSync(staged, { recursive: true });
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(live, "value.txt"), "next\n");
      writeFileSync(join(staged, "value.txt"), "staged\n");
      writeFileSync(join(backup, "value.txt"), "previous\n");
      return { target: live, staged, backup, hadPrevious: true };
    });
    const manifestPaths = [
      "packages/proto/spine-proto-manifest.json",
      ...modelAtomicTargets.map((target) => `${target.packagePath}/spine-proto-manifest.json`),
    ];
    const manifests = manifestPaths.map((path, index) => {
      const target = join(root, path);
      const staged = join(
        dirname(target),
        `.generated-interrupted-${index}/spine-proto-manifest.json`,
      );
      const backup = join(dirname(target), `.spine-proto-manifest.backup-interrupted-${index}`);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(target, index === 0 ? "next\n" : "previous\n");
      writeFileSync(staged, "next\n");
      if (index === 0) writeFileSync(backup, "previous\n");
      return { target, staged, backup, hadPrevious: true, contents: "next\n" };
    });
    writeFileSync(
      join(root, ".spine-proto-publication.json"),
      `${JSON.stringify({ version: 2, state: "committing", targets, manifests })}\n`,
    );

    publishGeneratedTargets([], root);

    for (const target of targets) {
      expect(readFileSync(join(target.target, "value.txt"), "utf8")).toBe("previous\n");
      expect(existsSync(target.staged)).toBe(false);
      expect(existsSync(target.backup)).toBe(false);
    }
    for (const manifest of manifests) {
      expect(readFileSync(manifest.target, "utf8")).toBe("previous\n");
      expect(existsSync(manifest.staged)).toBe(false);
      expect(existsSync(manifest.backup)).toBe(false);
    }
    expect(existsSync(join(root, ".spine-proto-publication.json"))).toBe(false);
  });

  it.each([1, 2])("rejects a v%s committing journal with no manifests", (version) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify(
        version === 1
          ? { version, state: "committing", targets: [] }
          : { version, state: "committing", targets: [], manifests: [] },
      )}\n`,
    );
    expect(() => publishGeneratedTargets([], repoRoot)).toThrow("invalid publication journal");
  });

  it("rolls back a mid-commit Todo manifest rename", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const rootGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const targets = [rootGenerated, todoGenerated].map((target, index) => {
      const backup = join(dirname(target), `.generated.backup-${index}`);
      mkdirSync(target, { recursive: true });
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(target, "value.txt"), "next\n");
      writeFileSync(join(backup, "value.txt"), "previous\n");
      return {
        target,
        staged: join(dirname(target), `.generated-stage-${index}`),
        backup,
        hadPrevious: true,
      };
    });
    const rootManifest = join(repoRoot, "packages/proto/spine-proto-manifest.json");
    const todoManifest = join(repoRoot, "examples/todo/spine-proto-manifest.json");
    const manifests = [rootManifest, todoManifest].map((target, index) => {
      const staged = join(
        dirname(target),
        `.generated-manifest-${index}/spine-proto-manifest.json`,
      );
      const backup = join(dirname(target), `.spine-proto-manifest.backup-${index}`);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(target, index === 0 ? "next\n" : "previous\n");
      if (index === 1) writeFileSync(staged, "next\n");
      writeFileSync(backup, "previous\n");
      return { target, staged, backup, hadPrevious: true, contents: "next\n" };
    });
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({ version: 2, state: "committing", targets, manifests })}\n`,
    );
    publishGeneratedTargets([], repoRoot);
    for (const target of targets)
      expect(readFileSync(join(target.target, "value.txt"), "utf8")).toBe("previous\n");
    for (const manifest of manifests)
      expect(readFileSync(manifest.target, "utf8")).toBe("previous\n");
  });

  it("includes Todo in the root atomic publication boundary without restoring it as a legacy generator", () => {
    expect(generatedTargets.map((target) => target.displayPath)).not.toContain(
      "examples/todo/generated",
    );
    expect(atomicGeneratedTargets.map((target) => target.displayPath)).toContain(
      "examples/todo/generated",
    );
  });

  it("publishes Todo output and both manifests in the root transaction", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const rootGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const rootStage = join(repoRoot, "packages/proto/.generated-root/generated");
    const todoStage = join(repoRoot, "examples/todo/.generated-todo/generated");
    const rootManifest = join(repoRoot, "packages/proto/spine-proto-manifest.json");
    const todoManifest = join(repoRoot, "examples/todo/spine-proto-manifest.json");
    const rootManifestStage = join(
      repoRoot,
      "packages/proto/.generated-root/spine-proto-manifest.json",
    );
    const todoManifestStage = join(
      repoRoot,
      "examples/todo/.generated-todo/spine-proto-manifest.json",
    );
    for (const path of [rootGenerated, todoGenerated, rootStage, todoStage])
      mkdirSync(path, { recursive: true });
    writeFileSync(join(rootGenerated, "previous.txt"), "root previous\n");
    writeFileSync(join(todoGenerated, "previous.txt"), "todo previous\n");
    writeFileSync(join(rootStage, "complete.txt"), "root next\n");
    writeFileSync(join(todoStage, "complete.txt"), "todo next\n");
    writeFileSync(rootManifest, "root previous\n");
    writeFileSync(todoManifest, "todo previous\n");
    writeFileSync(rootManifestStage, "root next\n");
    writeFileSync(todoManifestStage, "todo next\n");
    publishGeneratedTargets(
      [
        {
          generatedRoot: rootGenerated,
          stagedOutputRoot: rootStage,
          target: { displayPath: "packages/proto/generated" },
        },
        {
          generatedRoot: todoGenerated,
          stagedOutputRoot: todoStage,
          target: { displayPath: "examples/todo/generated" },
        },
      ],
      repoRoot,
      {
        files: [
          {
            target: rootManifest,
            staged: rootManifestStage,
            backup: join(repoRoot, "packages/proto/.spine-proto-manifest.backup-root"),
            hadPrevious: true,
            contents: "root next\n",
          },
          {
            target: todoManifest,
            staged: todoManifestStage,
            backup: join(repoRoot, "examples/todo/.spine-proto-manifest.backup-todo"),
            hadPrevious: true,
            contents: "todo next\n",
          },
        ],
      },
    );
    expect(readFileSync(join(rootGenerated, "complete.txt"), "utf8")).toBe("root next\n");
    expect(readFileSync(join(todoGenerated, "complete.txt"), "utf8")).toBe("todo next\n");
    expect(readFileSync(rootManifest, "utf8")).toBe("root next\n");
    expect(readFileSync(todoManifest, "utf8")).toBe("todo next\n");
  });

  it("publishes a staged MessageBoard registry with the generated roots and manifests", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stagedOutputRoot = join(repoRoot, "packages/proto/.generated-root/generated");
    const registry = join(repoRoot, "examples/message-board/app/src/model-registry.ts");
    const stagedRegistry = join(
      repoRoot,
      "examples/message-board/app/src/.generated-registry/model-registry.ts",
    );
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    mkdirSync(dirname(registry), { recursive: true });
    mkdirSync(dirname(stagedRegistry), { recursive: true });
    writeFileSync(join(generatedRoot, "previous.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "next.txt"), "next output\n");
    writeFileSync(registry, "previous registry\n");
    writeFileSync(stagedRegistry, "next registry\n");

    publishGeneratedTargets(
      [{ generatedRoot, stagedOutputRoot, target: { displayPath: "packages/proto/generated" } }],
      repoRoot,
      {
        files: [
          {
            target: registry,
            staged: stagedRegistry,
            backup: join(dirname(registry), ".model-registry.ts.backup-test"),
            hadPrevious: true,
            contents: "next registry\n",
          },
        ],
      },
    );

    expect(readFileSync(join(generatedRoot, "next.txt"), "utf8")).toBe("next output\n");
    expect(readFileSync(registry, "utf8")).toBe("next registry\n");
  });

  it("rolls back a v3 mid-file interruption including the MessageBoard registry", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const registry = join(repoRoot, "examples/message-board/app/src/model-registry.ts");
    const staged = join(
      repoRoot,
      "examples/message-board/app/src/.generated-interrupted/model-registry.ts",
    );
    const backup = join(
      repoRoot,
      "examples/message-board/app/src/.model-registry.ts.backup-interrupted",
    );
    const manifest = join(repoRoot, "packages/proto/spine-proto-manifest.json");
    const stagedManifest = join(
      repoRoot,
      "packages/proto/.generated-interrupted/spine-proto-manifest.json",
    );
    const manifestBackup = join(
      repoRoot,
      "packages/proto/.spine-proto-manifest.backup-interrupted",
    );
    mkdirSync(dirname(staged), { recursive: true });
    mkdirSync(dirname(stagedManifest), { recursive: true });
    writeFileSync(registry, "next registry\n");
    writeFileSync(staged, "next registry\n");
    writeFileSync(backup, "previous registry\n");
    writeFileSync(manifest, "previous manifest\n");
    writeFileSync(stagedManifest, "next manifest\n");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 3,
        state: "committing",
        targets: [],
        files: [
          {
            target: registry,
            staged,
            backup,
            hadPrevious: true,
            contents: "next registry\n",
          },
          {
            target: manifest,
            staged: stagedManifest,
            backup: manifestBackup,
            hadPrevious: true,
            contents: "next manifest\n",
          },
        ],
      })}\n`,
    );

    publishGeneratedTargets([], repoRoot);

    expect(readFileSync(registry, "utf8")).toBe("previous registry\n");
    expect(readFileSync(manifest, "utf8")).toBe("previous manifest\n");
    expect(existsSync(staged)).toBe(false);
    expect(existsSync(backup)).toBe(false);
    expect(existsSync(stagedManifest)).toBe(false);
    expect(existsSync(manifestBackup)).toBe(false);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("recovers every atomic root, manifest, and MessageBoard registry from a v3 mid-file interruption", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const targets = atomicGeneratedTargets.map((definition, index) => {
      const target = join(repoRoot, definition.displayPath);
      const staged = join(dirname(target), `.generated-v3-${index}/generated`);
      const backup = join(dirname(target), `.${basename(target)}.backup-v3-${index}`);
      mkdirSync(target, { recursive: true });
      mkdirSync(staged, { recursive: true });
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(target, "value.txt"), "next\n");
      writeFileSync(join(staged, "value.txt"), "staged\n");
      writeFileSync(join(backup, "value.txt"), "previous\n");
      return { target, staged, backup, hadPrevious: true };
    });
    const manifestPaths = [
      "packages/proto/spine-proto-manifest.json",
      ...modelAtomicTargets.map((target) => `${target.packagePath}/spine-proto-manifest.json`),
      "examples/message-board/app/src/model-registry.ts",
    ];
    const files = manifestPaths.map((path, index) => {
      const target = join(repoRoot, path);
      const staged = join(dirname(target), `.generated-v3-${index}/${basename(target)}`);
      const backup = join(dirname(target), `.${basename(target)}.backup-v3-${index}`);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(target, index === 0 ? "next\n" : "previous\n");
      writeFileSync(staged, "next\n");
      writeFileSync(backup, "previous\n");
      return { target, staged, backup, hadPrevious: true, contents: "next\n" };
    });
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({ version: 3, state: "committing", targets, files })}\n`,
    );

    publishGeneratedTargets([], repoRoot);

    for (const target of targets) {
      expect(readFileSync(join(target.target, "value.txt"), "utf8")).toBe("previous\n");
      expect(existsSync(target.staged)).toBe(false);
      expect(existsSync(target.backup)).toBe(false);
    }
    for (const file of files) {
      expect(readFileSync(file.target, "utf8")).toBe("previous\n");
      expect(existsSync(file.staged)).toBe(false);
      expect(existsSync(file.backup)).toBe(false);
      expect(existsSync(dirname(file.staged))).toBe(false);
    }
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("preserves an unexpected stage sibling while removing the journal-owned file", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const target = join(repoRoot, "examples/message-board/app/src/model-registry.ts");
    const stageRoot = join(repoRoot, "examples/message-board/app/src/.generated-preserve");
    const staged = join(stageRoot, "model-registry.ts");
    const sibling = join(stageRoot, "keep.txt");
    const backup = join(
      repoRoot,
      "examples/message-board/app/src/.model-registry.ts.backup-preserve",
    );
    mkdirSync(stageRoot, { recursive: true });
    writeFileSync(target, "next\n");
    writeFileSync(staged, "next\n");
    writeFileSync(sibling, "keep\n");
    writeFileSync(backup, "previous\n");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 3,
        state: "committing",
        targets: [],
        files: [{ target, staged, backup, hadPrevious: true, contents: "replacement\n" }],
      })}\n`,
    );

    publishGeneratedTargets([], repoRoot);

    expect(readFileSync(target, "utf8")).toBe("previous\n");
    expect(existsSync(staged)).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("keep\n");
    expect(existsSync(stageRoot)).toBe(true);
  });

  it("leaves Todo Protobuf-ES ownership to its model package", () => {
    expect(generatedTargets.map((target) => target.displayPath)).not.toContain(
      "examples/todo/generated",
    );
    expect(readFileSync("examples/todo/spine-proto.json", "utf8")).toContain(
      '"moduleExport": "todoProtoModule"',
    );
    expect(readFileSync("examples/todo/buf.gen.custom.yaml", "utf8")).not.toContain(
      "protoc-gen-es",
    );
  });

  it("keeps frozen-source lint ignores scoped away from authored modules", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-lint-scope-"));
    const modulePaths = [
      "packages/proto/proto",
      "examples/todo/proto",
      "examples/projects/proto",
      "examples/orders/proto",
    ];

    for (const modulePath of modulePaths) {
      mkdirSync(join(repoRoot, modulePath), { recursive: true });
    }

    writeFileSync(join(repoRoot, "buf.yaml"), readFileSync("buf.yaml", "utf8"));
    const frozenHealthRoot = join(repoRoot, "packages/proto/proto/grpc/health/v1");
    mkdirSync(frozenHealthRoot, { recursive: true });
    writeFileSync(
      join(frozenHealthRoot, "health.proto"),
      'syntax = "proto3";\npackage grpc.health.v1;\nservice Health {}\n',
    );
    const validExampleModules = [
      ["examples/projects/proto/spine/examples/projects", "projects"],
      ["examples/orders/proto/spine/examples/orders", "orders"],
    ];
    for (const [directory, packageSegment] of validExampleModules) {
      const absoluteDirectory = join(repoRoot, directory);
      mkdirSync(absoluteDirectory, { recursive: true });
      writeFileSync(
        join(absoluteDirectory, "fixture.proto"),
        `syntax = "proto3";\npackage spine.examples.${packageSegment};\n`,
      );
    }

    const authoredRoot = join(repoRoot, "examples/todo/proto");
    const packageRoot = join(authoredRoot, "spine/examples/todo");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "service.proto"),
      'syntax = "proto3";\npackage spine.examples.todo;\nservice Todo {}\n',
    );
    writeFileSync(
      join(packageRoot, "first.proto"),
      'syntax = "proto3";\npackage spine.examples.todo;\noption java_multiple_files = true;\n',
    );
    writeFileSync(
      join(packageRoot, "second.proto"),
      'syntax = "proto3";\npackage spine.examples.todo;\n',
    );
    mkdirSync(join(authoredRoot, "alternate"), { recursive: true });
    writeFileSync(
      join(authoredRoot, "alternate/shared.proto"),
      'syntax = "proto3";\npackage spine.examples.todo;\n',
    );

    const result = spawnSync(
      join(process.cwd(), "node_modules/.bin/buf"),
      ["lint", "--error-format=json"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const findings = `${result.stdout}\n${result.stderr}`
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));

    expect(result.status).not.toBe(0);
    expect(findings.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "SERVICE_SUFFIX",
        "PACKAGE_DIRECTORY_MATCH",
        "PACKAGE_SAME_DIRECTORY",
        "PACKAGE_SAME_JAVA_MULTIPLE_FILES",
      ]),
    );
    expect(findings.every(({ path }) => path.startsWith("examples/todo/proto/"))).toBe(true);
  });

  it("stages every plugin output for a generated target", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "generated");

    mkdirSync(stageRoot, { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n" +
        "  - local: protoc-gen-spine-rejections\n    out: packages/proto/generated\n",
    );

    const stagedTemplate = writeStagedTemplate(
      { displayPath: "packages/proto/generated", templatePath: "buf.gen.yaml" },
      stagedOutputRoot,
      stageRoot,
      repoRoot,
    );

    expect(readFileSync(stagedTemplate, "utf8")).not.toContain("packages/proto/generated");
    expect(readFileSync(stagedTemplate, "utf8").match(/out: .*generated/g)).toHaveLength(2);
  });

  it("refuses to prepare generated output through a symlinked ancestor", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const linkedProtoRoot = mkdtempSync(join(tmpdir(), "spine-linked-proto-"));
    const externalGenerated = join(linkedProtoRoot, "generated");

    mkdirSync(join(repoRoot, "packages"), { recursive: true });
    mkdirSync(externalGenerated, { recursive: true });
    writeFileSync(join(externalGenerated, "keep.txt"), "external output\n");
    symlinkSync(linkedProtoRoot, join(repoRoot, "packages/proto"), "dir");

    expect(prepareGeneratedOutput(repoRoot)).toBe(1);
    expect(existsSync(externalGenerated)).toBe(true);
    expect(readFileSync(join(externalGenerated, "keep.txt"), "utf8")).toBe("external output\n");
  });

  it("keeps live generated output until replacement output is ready", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    writeFileSync(join(packageGenerated, "keep.txt"), "package output\n");
    writeFileSync(join(todoGenerated, "keep.txt"), "todo output\n");

    expect(prepareGeneratedOutput(repoRoot)).toBe(0);
    expect(readFileSync(join(packageGenerated, "keep.txt"), "utf8")).toBe("package output\n");
    expect(readFileSync(join(todoGenerated, "keep.txt"), "utf8")).toBe("todo output\n");
  });

  it("publishes staged generated files by same-parent rename without exposing a partial tree", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const orphanedDirectory = join(generatedRoot, "orphaned");
    let observedGeneratedRootDuringPublish = true;

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(orphanedDirectory, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(orphanedDirectory, "stale.txt"), "orphaned output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    publishGeneratedTargets(
      [
        {
          generatedRoot,
          stagedOutputRoot,
          stageRoot,
          target: {
            displayPath: "packages/proto/generated",
          },
        },
      ],
      repoRoot,
      {
        afterBackup: () => {
          observedGeneratedRootDuringPublish = existsSync(generatedRoot);
        },
      },
    );

    expect(observedGeneratedRootDuringPublish).toBe(false);
    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(existsSync(orphanedDirectory)).toBe(false);
    expect(readdirSync(join(repoRoot, "packages/proto"))).not.toContain(
      expect.stringMatching(/^\.generated\.backup-/u),
    );
  });

  it("rejects staged generated modules that do not exactly match owned Proto sources", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-artifacts-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const protoRoot = join(packageRoot, "proto");
    const generatedRoot = join(packageRoot, "generated");
    mkdirSync(join(protoRoot, "model"), { recursive: true });
    mkdirSync(join(generatedRoot, "model"), { recursive: true });
    writeFileSync(
      join(packageRoot, "spine-proto.json"),
      JSON.stringify({
        formatVersion: 1,
        mode: "model",
        protoRoot: "proto",
        exportRoot: "generated",
        dependencies: [],
        moduleExport: "spineProtoModule",
      }),
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "@example/proto", version: "1.0.0" }),
    );
    writeFileSync(join(protoRoot, "model/value.proto"), 'syntax = "proto3";');
    writeFileSync(join(generatedRoot, "model/extra_pb.ts"), "export {};\n");

    expect(() =>
      writeSpineProtoArtifacts(repoRoot, generatedRoot, join(packageRoot, "manifest.json")),
    ).toThrow("generated Protobuf modules must exactly match owned Proto sources");
    expect(existsSync(join(packageRoot, "manifest.json"))).toBe(false);
    expect(existsSync(join(generatedRoot, "proto-module.ts"))).toBe(false);
  });

  it("writes a noticed Proto module and manifest for owned generated schemas", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-artifacts-happy-"));
    try {
      const packageRoot = join(repoRoot, "packages/proto");
      const generatedRoot = join(packageRoot, "generated");
      mkdirSync(join(packageRoot, "proto", "model"), { recursive: true });
      mkdirSync(join(generatedRoot, "model"), { recursive: true });
      writeFileSync(
        join(packageRoot, "spine-proto.json"),
        JSON.stringify({ protoRoot: "proto", dependencies: [], moduleExport: "spineProtoModule" }),
      );
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: "@example/proto", version: "1.0.0" }),
      );
      writeFileSync(join(packageRoot, "proto", "model", "value.proto"), 'syntax = "proto3";');
      writeFileSync(join(generatedRoot, "model", "value_pb.ts"), "export const value = true;\n");
      const manifest = join(packageRoot, "manifest.json");
      writeSpineProtoArtifacts(repoRoot, generatedRoot, manifest);
      expect(readFileSync(join(generatedRoot, "proto-module.ts"), "utf8")).toContain(
        "Generated from Proto: model/value.proto.",
      );
      expect(JSON.parse(readFileSync(manifest, "utf8"))).toMatchObject({
        packageName: "@example/proto",
      });
      const firstManifest = readFileSync(manifest, "utf8");
      writeSpineProtoArtifacts(repoRoot, generatedRoot, manifest);
      expect(readFileSync(manifest, "utf8")).toBe(firstManifest);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps live generated output when replacement output is not ready", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stageRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow();

    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
  });

  it("restores generated output when final publication fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          beforeFinalize: () => {
            throw new Error("manifest replacement failed");
          },
        },
      ),
    ).toThrow("manifest replacement failed");

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
  });

  it("restores prior output when the staged-root rename fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          operations: {
            rename(from, to) {
              if (from === stagedOutputRoot && to === generatedRoot)
                throw new Error("staged rename failed");
              renameSync(from, to);
            },
          },
        },
      ),
    ).toThrow("staged rename failed");
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("retains aggregate rollback evidence until a later recovery succeeds", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");
    let backup;

    try {
      let failure;
      try {
        publishGeneratedTargets(
          [
            {
              generatedRoot,
              stagedOutputRoot,
              stageRoot,
              target: { displayPath: "packages/proto/generated" },
            },
          ],
          repoRoot,
          {
            operations: {
              rename(from, to) {
                if (from === stagedOutputRoot && to === generatedRoot)
                  throw new Error("primary staged rename failed");
                if (from === backup && to === generatedRoot)
                  throw new Error("recovery restore failed");
                renameSync(from, to);
              },
            },
            afterBackup(target) {
              backup = target.backup;
            },
          },
        );
      } catch (caught) {
        failure = caught;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors.map((error) => String(error))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("primary staged rename failed"),
          expect.stringContaining("recovery restore failed"),
        ]),
      );
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(true);
      expect(existsSync(backup)).toBe(true);
      expect(existsSync(stagedOutputRoot)).toBe(true);

      publishGeneratedTargets([], repoRoot);
      expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
      expect(existsSync(backup)).toBe(false);
      expect(existsSync(stagedOutputRoot)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("retains the MessageBoard registry stage only while a failed publication journal owns it", () => {
    const repoRoot = messageBoardRegistryFixture();
    const registryDirectory = join(repoRoot, "examples/message-board/app/src");
    const rootGenerated = join(repoRoot, "packages/proto/generated");
    let backup;

    try {
      const status = generateTargets({
        repoRoot,
        runCommand: rootStageCommand,
        runModelCommand: todoStageCommand(),
        runCompositionCommand: messageBoardCompositionCommand(false),
        publicationOperations: {
          rename(from, to) {
            if (from === rootGenerated && basename(to).startsWith(".generated.backup-")) {
              backup = to;
            }
            if (from.includes(".generated-") && to === rootGenerated)
              throw new Error("primary staged rename failed");
            if (from === backup && to === rootGenerated) throw new Error("recovery restore failed");
            renameSync(from, to);
          },
        },
      });

      expect(status).toBe(1);
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(true);
      expect(
        readdirSync(registryDirectory).filter((entry) => entry.startsWith(".generated-")),
      ).toHaveLength(1);

      const journal = JSON.parse(
        readFileSync(join(repoRoot, ".spine-proto-publication.json"), "utf8"),
      );
      backup = journal.targets.find((target) => target.target === rootGenerated).backup;
      expect(existsSync(backup)).toBe(true);

      publishGeneratedTargets([], repoRoot);

      expect(readFileSync(join(rootGenerated, "previous.txt"), "utf8")).toBe(
        "packages/proto/generated\n",
      );
      expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
      expect(
        readdirSync(registryDirectory).filter((entry) => entry.startsWith(".generated-")),
      ).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("removes first-publication output when finalization fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(stagedOutputRoot, "message.txt"), "first output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          beforeFinalize: () => {
            throw new Error("finalization failed");
          },
        },
      ),
    ).toThrow("finalization failed");
    expect(existsSync(generatedRoot)).toBe(false);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("retains a committed publication journal when cleanup fails and completes it on recovery", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const manifest = join(repoRoot, "packages/proto/spine-proto-manifest.json");
    const stagedManifest = join(stageRoot, "spine-proto-manifest.json");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");
    writeFileSync(manifest, "previous manifest\n");
    writeFileSync(stagedManifest, "next manifest\n");
    let failCleanup = true;

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          files: [
            {
              target: manifest,
              staged: stagedManifest,
              backup: join(repoRoot, "packages/proto/.spine-proto-manifest.backup-test"),
              hadPrevious: true,
              contents: "next manifest\n",
            },
          ],
          operations: {
            remove(path) {
              if (failCleanup && path.includes(".generated.backup-"))
                throw new Error("cleanup failed");
              rmSync(path, { recursive: true, force: true });
            },
          },
        },
      ),
    ).toThrow("cleanup failed");

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(readFileSync(manifest, "utf8")).toBe("next manifest\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(true);

    failCleanup = false;
    publishGeneratedTargets([], repoRoot);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(readFileSync(manifest, "utf8")).toBe("next manifest\n");
  });

  it("rolls back a preparing partial swap even when the deterministic manifest is unchanged", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const generatedRoot = join(packageRoot, "generated");
    const stageRoot = join(packageRoot, ".generated-interrupted");
    const stagedOutputRoot = join(stageRoot, "generated");
    const backup = join(packageRoot, ".generated.backup-interrupted");
    const manifest = join(packageRoot, "spine-proto-manifest.json");
    const stagedManifest = join(stageRoot, "spine-proto-manifest.json");
    const manifestBackup = join(packageRoot, ".spine-proto-manifest.backup-interrupted");
    const contents = "unchanged manifest\n";
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(backup, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "new output\n");
    writeFileSync(join(backup, "message.txt"), "previous output\n");
    writeFileSync(manifest, contents);
    writeFileSync(stagedManifest, contents);
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "preparing",
        targets: [{ target: generatedRoot, staged: stagedOutputRoot, backup, hadPrevious: true }],
        manifest: {
          target: manifest,
          staged: stagedManifest,
          backup: manifestBackup,
          hadPrevious: true,
          contents,
        },
      })}\n`,
    );

    publishGeneratedTargets([], repoRoot);

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
    expect(readFileSync(manifest, "utf8")).toBe(contents);
  });

  it("rejects a forged journal before it can touch paths outside generated targets", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const outside = join(repoRoot, "outside.txt");
    writeFileSync(outside, "keep\n");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "committed",
        targets: [
          {
            target: outside,
            staged: join(repoRoot, "staged"),
            backup: join(repoRoot, "backup"),
            hadPrevious: true,
          },
        ],
      })}\n`,
    );

    expect(() => publishGeneratedTargets([], repoRoot)).toThrow("invalid publication journal");
    expect(readFileSync(outside, "utf8")).toBe("keep\n");
  });

  it("rejects a live second generator before it can touch its journal or staging", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claims = new Map([
      [
        ".spine-proto-workflow.lock.live",
        { content: JSON.stringify({ pid: 77, token: "live" }), kind: "regular" },
      ],
    ]);
    writeFileSync(join(repoRoot, ".spine-proto-publication.json"), "first writer journal\n");

    expect(
      generateTargets({
        repoRoot,
        lockOperations: workflowClaimOperations(claims, () => "alive"),
      }),
    ).toBe(1);
    expect(readFileSync(join(repoRoot, ".spine-proto-publication.json"), "utf8")).toBe(
      "first writer journal\n",
    );
    expect(existsSync(join(repoRoot, "packages/proto/generated"))).toBe(false);
    expect([...claims.keys()]).toHaveLength(1);
    expect([...claims.keys()][0]).toMatch(/^\.spine-proto-workflow\.lock\.live\.quarantine-/);
  });

  it("rejects a FIFO workflow claim without blocking or preparing generated output", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claim = join(repoRoot, ".spine-proto-workflow.lock.fifo");
    const created = spawnSync("mkfifo", [claim]);
    if (created.status !== 0) throw new Error(created.stderr.toString());

    expect(generateTargets({ repoRoot })).toBe(1);
    expect(existsSync(claim)).toBe(false);
    expect(
      readdirSync(repoRoot).some((name) =>
        name.startsWith(".spine-proto-workflow.lock.fifo.quarantine-"),
      ),
    ).toBe(true);
    expect(existsSync(join(repoRoot, "packages/proto/generated"))).toBe(false);
  });

  it("does not delete a same-content workflow quarantine replacement after descriptor close", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claims = new Map();
    const operations = workflowClaimOperations(claims, () => "dead");
    const snapshot = operations.snapshot;
    let replaced = false;

    expect(
      generateTargets({
        repoRoot,
        lockOperations: {
          ...operations,
          snapshot(path) {
            const observed = snapshot(path);
            if (!replaced && basename(path).includes(".quarantine-")) {
              claims.set(basename(path), {
                content: observed.content,
                kind: "regular",
                identity: "replacement",
              });
              replaced = true;
            }
            return observed;
          },
        },
      }),
    ).toBe(1);
    expect(replaced).toBe(true);
    expect(
      [...claims.values()].some(
        (claim) => claim.identity === "replacement" && claim.content.includes('"token"'),
      ),
    ).toBe(true);
  });

  it.each(["symlink", "fifo"])(
    "retains an unsafe %s workflow-lock replacement during release",
    (kind) => {
      const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
      const sentinel = join(repoRoot, "sentinel.txt");
      writeFileSync(sentinel, "keep\n");

      expect(
        generateTargets({
          repoRoot,
          prepareBootstrap: () => {
            const lock = readdirSync(repoRoot).find((name) =>
              name.startsWith(".spine-proto-workflow.lock."),
            );
            if (lock === undefined) throw new Error("workflow lock was not created");
            rmSync(join(repoRoot, lock));
            if (kind === "symlink") symlinkSync("sentinel.txt", join(repoRoot, lock));
            else {
              const created = spawnSync("mkfifo", [join(repoRoot, lock)]);
              if (created.status !== 0) throw new Error(created.stderr.toString());
            }
            throw new Error("stop after lock replacement");
          },
        }),
      ).toBe(1);
      expect(readFileSync(sentinel, "utf8")).toBe("keep\n");
      expect(
        readdirSync(repoRoot).some(
          (name) => name.startsWith(".spine-proto-workflow.lock.") && name.includes(".quarantine-"),
        ),
      ).toBe(true);
    },
  );

  it("acquires generate ownership before preparing live generated roots", () => {
    const source = readFileSync(new URL("./proto-workflow.mjs", import.meta.url), "utf8");
    const ownership = source.indexOf("lock = acquireWorkflowLock(root, options.lockOperations)");
    const preparation = source.indexOf("const prepareStatus = prepareGeneratedOutput(root);");

    expect(source).not.toContain("prepareProtoToolsBootstrap(repoRoot);");
    expect(ownership).toBeGreaterThanOrEqual(0);
    expect(preparation).toBeGreaterThan(ownership);
  });

  it.each([
    ["dead", "dead", "regular"],
    ["indeterminate", "indeterminate", "regular"],
    ["unsafe", "dead", "symlink"],
  ])("handles a %s workflow claim without touching another claim", (_name, liveness, kind) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claims = new Map([
      [
        ".spine-proto-workflow.lock.existing",
        { content: JSON.stringify({ pid: 78, token: "existing" }), kind },
      ],
    ]);

    const status = generateTargets({
      repoRoot,
      lockOperations: workflowClaimOperations(claims, () => liveness),
    });

    if (liveness === "dead" && kind === "regular") expect([...claims.keys()]).toEqual([]);
    else {
      expect([...claims.keys()]).toHaveLength(1);
      expect([...claims.keys()][0]).toMatch(/^\.spine-proto-workflow\.lock\.existing\.quarantine-/);
    }
    expect(status).toBe(1);
  });

  it("rejects a symlinked recovery backup before mutating a journal target", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const generatedRoot = join(packageRoot, "generated");
    const stageRoot = join(packageRoot, ".generated-poisoned");
    const stagedOutputRoot = join(stageRoot, "generated");
    const backup = join(packageRoot, ".generated.backup-poisoned");
    const external = mkdtempSync(join(tmpdir(), "spine-external-generated-"));
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "new output\n");
    symlinkSync(external, backup, "dir");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "preparing",
        targets: [{ target: generatedRoot, staged: stagedOutputRoot, backup, hadPrevious: true }],
      })}\n`,
    );

    expect(() => publishGeneratedTargets([], repoRoot)).toThrow(
      "unsafe publication recovery entry",
    );
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("new output\n");
    rmSync(external, { recursive: true, force: true });
  });

  it("does not publish staged protobuf output when its staged manifest is unavailable", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const projectGenerated = join(repoRoot, "examples/projects/generated");
    const datastoreOrdersGenerated = join(repoRoot, "examples/orders/generated");
    const commands = [];

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(projectGenerated, { recursive: true });
    mkdirSync(datastoreOrdersGenerated, { recursive: true });
    mkdirSync(join(repoRoot, "examples/todo"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/projects"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/orders"), { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/todo/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/todo/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/projects/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/projects/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/orders/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/orders/generated\n",
    );
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");

    const status = generateTargets({
      repoRoot,
      runCommand(label, _executable, args) {
        commands.push(label);

        if (label.startsWith("buf generate")) {
          const templatePath = args.at(-1);
          const outputPath = readFileSync(templatePath, "utf8").match(/^\s*out:\s*(.+)$/mu)?.[1];

          if (outputPath === undefined) {
            return 1;
          }

          mkdirSync(outputPath, { recursive: true });
          writeFileSync(join(outputPath, "message.txt"), `${label} staged output\n`);
          return 0;
        }

        return 1;
      },
    });

    expect(status).toBe(1);
    expect(commands).toEqual(["buf generate packages/proto/generated"]);
    expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
      "previous package output\n",
    );
    expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe("previous todo output\n");
  });

  it("stages the legacy root output without publishing it", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const projectGenerated = join(repoRoot, "examples/projects/generated");
    const datastoreOrdersGenerated = join(repoRoot, "examples/orders/generated");
    const commands = [];

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(projectGenerated, { recursive: true });
    mkdirSync(datastoreOrdersGenerated, { recursive: true });
    mkdirSync(join(repoRoot, "examples/todo"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/projects"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/orders"), { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/todo/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/todo/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/projects/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/projects/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/orders/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/orders/generated\n",
    );
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");

    const staged = stageGeneratedTargets({
      repoRoot,
      runCommand(label, _executable, args) {
        commands.push(label);

        if (label.startsWith("buf generate")) {
          const templatePath = args.at(-1);
          const outputPath = readFileSync(templatePath, "utf8").match(/^\s*out:\s*(.+)$/mu)?.[1];

          if (outputPath === undefined) {
            return 1;
          }

          mkdirSync(outputPath, { recursive: true });
          writeFileSync(join(outputPath, "message.txt"), `${label} staged output\n`);
          return 0;
        }

        const outputPath = args[args.indexOf("--out") + 1];

        if (outputPath === undefined) {
          return 1;
        }

        mkdirSync(join(outputPath, ".."), { recursive: true });
        writeFileSync(outputPath, "export const generatedHandlerRegistry = { version: 1 };\n");
        return 0;
      },
    });

    try {
      expect(staged.status).toBe(0);
      expect(commands).toEqual(["buf generate packages/proto/generated"]);
      expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
        "previous package output\n",
      );
      expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe(
        "previous todo output\n",
      );
      expect(
        readFileSync(join(staged.stagedTargets[0].stagedOutputRoot, "message.txt"), "utf8"),
      ).toBe("buf generate packages/proto/generated staged output\n");
    } finally {
      cleanupStagedTargets(staged.stagedTargets);
    }
  });

  it("restores already-published roots when a later publish fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const packageStageRoot = join(repoRoot, "packages/proto/.generated-test");
    const todoStageRoot = join(repoRoot, "examples/todo/.generated-test");
    const packageStagedOutputRoot = join(packageStageRoot, "output");
    const todoStagedOutputRoot = join(todoStageRoot, "output");

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(packageStagedOutputRoot, { recursive: true });
    mkdirSync(todoStageRoot, { recursive: true });
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");
    writeFileSync(join(packageStagedOutputRoot, "message.txt"), "next package output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot: packageGenerated,
            stagedOutputRoot: packageStagedOutputRoot,
            stageRoot: packageStageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
          {
            generatedRoot: todoGenerated,
            stagedOutputRoot: todoStagedOutputRoot,
            stageRoot: todoStageRoot,
            target: {
              displayPath: "examples/todo/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow();

    expect(existsSync(packageGenerated)).toBe(true);
    expect(existsSync(todoGenerated)).toBe(true);
    expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
      "previous package output\n",
    );
    expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe("previous todo output\n");
  });

  it("refuses staged generated output containing symlinks", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const externalRoot = mkdtempSync(join(tmpdir(), "spine-external-generated-"));

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(externalRoot, "message.txt"), "external output\n");
    symlinkSync(join(externalRoot, "message.txt"), join(stagedOutputRoot, "message.txt"));

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow("Staged generated output must not contain symlinks");

    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");

    rmSync(externalRoot, { recursive: true, force: true });
  });
});
