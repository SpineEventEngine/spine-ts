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
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  packedArchiveProblems,
  packedManifestProblems,
  publicManifestProblems,
} from "../../../scripts/package-artifacts.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const spineVersion = (
  JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { version: string }
).version;
const processTimeoutMs = 30_000;
const frameworkPackageRoots = [
  "@spine-event-engine/auth",
  "@spine-event-engine/client-node",
  "@spine-event-engine/client-react",
  "@spine-event-engine/client-web",
  "@spine-event-engine/core",
  "@spine-event-engine/delivery-client",
  "@spine-event-engine/delivery-server",
  "@spine-event-engine/deployment",
  "@spine-event-engine/deployment-gce",
  "@spine-event-engine/deployment-gke",
  "@spine-event-engine/proto",
  "@spine-event-engine/proto-tools",
  "@spine-event-engine/server",
  "@spine-event-engine/storage",
  "@spine-event-engine/storage-datastore",
  "@spine-event-engine/storage-rdbms",
  "@spine-event-engine/testing",
  "@spine-event-engine/transport",
] as const;

interface PackedPackage {
  readonly name: string;
  readonly tarball: string;
}

describe("Windows spine-proto shim", () => {
  it("requires one quoted command string for a shim path containing spaces", () => {
    const shim = "C:\\temporary files\\node_modules\\.bin\\spine-proto.cmd";
    const command = ["/d", "/s", "/c", windowsShimCommand(shim)];

    expect(command).toEqual(["/d", "/s", "/c", `"${shim}" unsupported-command`]);
  });
});

function writeJson(directory: string, path: string, value: unknown): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string, args: readonly string[], cwd: string): void {
  const npmCache = join(cwd, ".npm-cache");
  mkdirSync(npmCache, { recursive: true });
  try {
    execFileSync(command, args, {
      cwd,
      stdio: "pipe",
      timeout: processTimeoutMs,
      env: { ...process.env, npm_config_cache: npmCache },
    });
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${output}`, { cause: error });
  }
}

function packSpinePackages(destination: string): readonly PackedPackage[] {
  run("pnpm", ["--dir", "packages/proto-tools", "exec", "tsc", "-b"], repositoryRoot);
  const sources = [
    "packages/auth",
    "packages/client-node",
    "packages/client-react",
    "packages/client-web",
    "packages/core",
    "packages/delivery-client",
    "packages/delivery-server",
    "packages/deployment",
    "packages/deployment-gce",
    "packages/deployment-gke",
    "packages/proto",
    "packages/proto-tools",
    "packages/server",
    "packages/storage",
    "packages/storage-datastore",
    "packages/storage-rdbms",
    "packages/testing",
    "packages/transport",
  ];
  for (const source of sources) {
    run(
      "pnpm",
      ["--dir", source, "pack", "--config.ignore-scripts=true", "--pack-destination", destination],
      repositoryRoot,
    );
  }

  return readdirSync(destination)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => {
      const tarball = join(destination, name);
      assertPackedArtifact(tarball);
      const packageName = readPackedName(tarball);
      return { name: packageName, tarball };
    });
}

function installTarballsWithPnpm(directory: string, packages: readonly PackedPackage[]): void {
  const dependencies = {
    "@bufbuild/protobuf": "2.12.1",
    ...Object.fromEntries(packages.map(({ name, tarball }) => [name, `file:${tarball}`])),
  };
  const overrides = {
    ...dependencies,
  };
  writeJson(directory, "package.json", {
    name: "@external/proto-tools-cli",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies,
    devDependencies: { typescript: "6.0.3" },
  });
  writeFileSync(
    join(directory, "pnpm-workspace.yaml"),
    `overrides:\n${Object.entries(overrides)
      .map(([name, tarball]) => `  ${JSON.stringify(name)}: ${JSON.stringify(tarball)}`)
      .join("\n")}\n`,
  );
  run("pnpm", ["install", "--prod=false", "--ignore-scripts"], directory);
}

function windowsShimCommand(shim: string): string {
  return `"${shim.replaceAll('"', '""')}" unsupported-command`;
}

function runInstalledShim(directory: string): void {
  const shim = join(
    directory,
    "node_modules/.bin",
    process.platform === "win32" ? "spine-proto.cmd" : "spine-proto",
  );
  expect(existsSync(shim)).toBe(true);
  if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/s", "/c", windowsShimCommand(shim)], directory);
  } else {
    run(shim, ["unsupported-command"], directory);
  }
}

function readPackedName(tarball: string): string {
  const stage = mkdtempSync(join(tmpdir(), "spine-external-read-"));
  try {
    run("tar", ["-xzf", tarball, "--strip-components=1", "-C", stage], repositoryRoot);
    const packageJson = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")) as {
      name?: unknown;
    };
    if (typeof packageJson.name !== "string") {
      throw new Error(`Packed artifact has no package name: ${tarball}`);
    }
    return packageJson.name;
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}

function assertPackedArtifact(tarball: string): void {
  const stage = mkdtempSync(join(tmpdir(), "spine-packed-policy-"));
  try {
    run("tar", ["-xzf", tarball, "--strip-components=1", "-C", stage], repositoryRoot);
    const manifest = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
    const entries = readdirSync(stage, { recursive: true }).map((entry) => String(entry));
    expect(publicManifestProblems(manifest)).toEqual([]);
    expect(packedManifestProblems(manifest)).toEqual([]);
    expect(packedArchiveProblems(manifest, entries)).toEqual([]);
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}

function extractTarball(tarball: string, modules: string): void {
  const stage = mkdtempSync(join(tmpdir(), "spine-external-extract-"));
  run("tar", ["-xzf", tarball, "--strip-components=1", "-C", stage], repositoryRoot);
  const name = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")) as { name?: unknown };
  if (typeof name.name !== "string") {
    throw new Error(`Packed artifact has no package name: ${tarball}`);
  }
  const target = join(modules, ...name.name.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  renameSync(stage, target);
}

function installTarballs(directory: string, packages: readonly PackedPackage[]): void {
  const modules = join(directory, "node_modules");
  mkdirSync(modules, { recursive: true });
  const packed = new Map(packages.map((entry) => [entry.name, entry]));
  const packageJson: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const dependencies =
    packageJson !== null && typeof packageJson === "object"
      ? (packageJson as Record<string, unknown>).dependencies
      : undefined;
  const pending = Object.keys(
    dependencies !== null && typeof dependencies === "object" ? dependencies : {},
  );
  const installed = new Set<string>();
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || installed.has(name)) continue;
    installed.add(name);
    const artifact = packed.get(name);
    if (artifact === undefined) continue;
    extractTarball(artifact.tarball, modules);
    const manifest = JSON.parse(
      readFileSync(join(modules, ...name.split("/"), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    pending.push(...Object.keys(manifest.dependencies ?? {}));
  }
  linkRuntimeDependencies(directory, installed);
}

function linkRuntimeDependencies(directory: string, declared: ReadonlySet<string>): void {
  const modules = join(directory, "node_modules");
  const required = new Set(declared);
  if (required.has("@spine-event-engine/validation")) {
    required.add("temporal-polyfill");
    required.add("temporal-spec");
    required.add("temporal-utils");
  }
  if (required.has("@bufbuild/protoplugin")) {
    required.add("@typescript/vfs");
    required.add("typescript");
  }
  const dependencies = [
    ["@bufbuild", join(repositoryRoot, "packages/proto-tools/node_modules/@bufbuild")],
    [
      "@bufbuild/protoplugin",
      join(
        repositoryRoot,
        "node_modules/.pnpm/@bufbuild+protoplugin@2.12.1/node_modules/@bufbuild/protoplugin",
      ),
    ],
    [
      "@typescript/vfs",
      join(
        repositoryRoot,
        "node_modules/.pnpm/@bufbuild+protoplugin@2.12.1/node_modules/@typescript/vfs",
      ),
    ],
    ["@connectrpc", join(repositoryRoot, "packages/server/node_modules/@connectrpc")],
    ["typescript", join(repositoryRoot, "node_modules/typescript")],
    ["semver", join(repositoryRoot, "packages/proto-tools/node_modules/semver")],
    [
      "@spine-event-engine/validation",
      join(repositoryRoot, "packages/core/node_modules/@spine-event-engine/validation"),
    ],
    [
      "temporal-polyfill",
      join(
        repositoryRoot,
        "node_modules/.pnpm/temporal-polyfill@1.0.1/node_modules/temporal-polyfill",
      ),
    ],
    [
      "temporal-spec",
      join(repositoryRoot, "node_modules/.pnpm/temporal-spec@1.0.0/node_modules/temporal-spec"),
    ],
    [
      "temporal-utils",
      join(repositoryRoot, "node_modules/.pnpm/temporal-utils@1.0.1/node_modules/temporal-utils"),
    ],
  ] as const;
  for (const [name, source] of dependencies) {
    if (
      ![...required].some((dependency) => dependency === name || dependency.startsWith(`${name}/`))
    )
      continue;
    const target = join(modules, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    run("cp", ["-RL", realpathSync(source), target], directory);
  }
}

function assertIsolatedInstalledTree(directory: string, allowLocalSymlinks = false): void {
  const pending = [join(directory, "node_modules")];
  const resolvedDirectory = realpathSync(directory);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (allowLocalSymlinks) {
        expect(realpathSync(path).startsWith(resolvedDirectory), relative(directory, path)).toBe(
          true,
        );
      } else {
        expect(lstatSync(path).isSymbolicLink(), relative(directory, path)).toBe(false);
        expect(resolve(path).startsWith(resolve(repositoryRoot)), relative(directory, path)).toBe(
          false,
        );
      }
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

function modelPackage(name: string, dependencies: Record<string, string>): Record<string, unknown> {
  return {
    name,
    version: "1.0.0",
    type: "module",
    files: ["dist", "generated", "proto", "spine-proto.json", "spine-proto-manifest.json"],
    exports: {
      ".": {
        types: "./dist/generated/proto-module.d.ts",
        default: "./dist/generated/proto-module.js",
      },
      "./spine-proto-manifest.json": "./spine-proto-manifest.json",
      "./proto/*": "./proto/*",
      "./generated/*.js": {
        types: "./dist/generated/*.d.ts",
        default: "./dist/generated/*.js",
      },
    },
    dependencies,
  };
}

function modelConfig(name: string, dependencies: readonly string[], moduleExport: string) {
  return {
    formatVersion: 1,
    mode: "model",
    packageName: name,
    protoRoot: "proto",
    generatedRoot: "generated",
    exportRoot: "generated",
    dependencies,
    moduleExport,
  };
}

function writeModelTsconfig(directory: string): void {
  writeJson(directory, "tsconfig.json", {
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2024",
      declaration: true,
      outDir: "dist",
      rootDir: ".",
      strict: true,
    },
    include: ["generated/**/*.ts"],
  });
}

function generateBuildAndPack(directory: string, destination: string): PackedPackage {
  run(
    process.execPath,
    [
      join(directory, "node_modules/@spine-event-engine/proto-tools/bin/spine-proto.mjs"),
      "generate",
    ],
    directory,
  );
  run(
    process.execPath,
    [join(directory, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    directory,
  );
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", destination], directory);
  const tarball = join(
    destination,
    readdirSync(destination).find((name) => name.endsWith(".tgz")) ?? "",
  );
  if (!existsSync(tarball)) throw new Error(`No model tarball was created for ${directory}.`);
  return { name: readPackedName(tarball), tarball };
}

function portableFiles(directory: string): readonly string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, name.name);
      if (name.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(directory);
  return files;
}

function assertPortableModel(directory: string): void {
  const relevant = (file: string): boolean => {
    const path = relative(directory, file);
    return (
      path === "package.json" ||
      path === "tsconfig.json" ||
      path === "spine-proto.json" ||
      path === "spine-proto-manifest.json" ||
      path.startsWith("generated/") ||
      path.startsWith("dist/generated/")
    );
  };
  for (const file of portableFiles(directory).filter(
    (path) => relevant(path) && /\.(?:json|ts|js|d\.ts)$/u.test(path),
  )) {
    const text = readFileSync(file, "utf8");
    expect(text, relative(directory, file)).not.toMatch(/(?:workspace:|file:|"paths"\s*:)/u);
    expect(text, relative(directory, file)).not.toContain(repositoryRoot);
  }
}

describe("packed external model consumer", () => {
  it("builds, packs, and executes composed Spine and application Proto modules without workspace links", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-external-consumer-"));
    try {
      const tarballs = join(root, "tarballs");
      mkdirSync(tarballs);
      const spinePackages = packSpinePackages(tarballs);

      const cli = join(root, "proto-tools-cli");
      mkdirSync(cli);
      installTarballsWithPnpm(cli, spinePackages);
      expect(() => {
        runInstalledShim(cli);
      }).toThrow("spine-proto: unsupported command unsupported-command");

      const users = join(root, "users-model");
      mkdirSync(users);
      writeJson(
        users,
        "package.json",
        modelPackage("@external/users-model", {
          "@bufbuild/protobuf": "2.12.1",
          "@spine-event-engine/proto": spineVersion,
          "@spine-event-engine/proto-tools": spineVersion,
        }),
      );
      installTarballs(users, spinePackages);
      assertIsolatedInstalledTree(users);
      writeJson(
        users,
        "spine-proto.json",
        modelConfig("@external/users-model", ["@spine-event-engine/proto"], "usersProtoModule"),
      );
      writeModelTsconfig(users);
      mkdirSync(join(users, "proto/external/users/v1"), { recursive: true });
      writeFileSync(
        join(users, "proto/external/users/v1/user.proto"),
        'syntax = "proto3"; package external.users.v1; message UserId { string value = 1; }\n',
      );
      const usersTarballs = join(root, "users-tarballs");
      mkdirSync(usersTarballs);
      const usersPacked = generateBuildAndPack(users, usersTarballs);
      assertPortableModel(users);

      const chat = join(root, "chat-model");
      mkdirSync(chat);
      writeJson(
        chat,
        "package.json",
        modelPackage("@external/chat-model", {
          "@bufbuild/protobuf": "2.12.1",
          "@spine-event-engine/core": spineVersion,
          "@spine-event-engine/proto": spineVersion,
          "@spine-event-engine/proto-tools": spineVersion,
          "@external/users-model": "1.0.0",
        }),
      );
      installTarballs(chat, [...spinePackages, usersPacked]);
      assertIsolatedInstalledTree(chat);
      writeJson(
        chat,
        "spine-proto.json",
        modelConfig(
          "@external/chat-model",
          ["@spine-event-engine/proto", "@external/users-model"],
          "messageBoardProtoModule",
        ),
      );
      writeModelTsconfig(chat);
      mkdirSync(join(chat, "proto/external/chat/v1"), { recursive: true });
      writeFileSync(
        join(chat, "proto/external/chat/v1/message_board.proto"),
        [
          'syntax = "proto3";',
          "package external.chat.v1;",
          'import "spine/options.proto";',
          'import "external/users/v1/user.proto";',
          "option (every_is).generate = true;",
          'option (every_is).ts_type = "ChatSignal";',
          "message Chat { external.users.v1.UserId author = 1; string text = 2; }",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(chat, "proto/external/chat/v1/task_rejections.proto"),
        [
          'syntax = "proto3";',
          "package external.chat.v1;",
          "// Explains why the requested chat task cannot continue.",
          "message TaskRejected { message NestedDetail {} }",
          "// Explains why a chat task remains blocked.",
          "message TaskBlocked {}",
          "",
        ].join("\n"),
      );
      run(
        process.execPath,
        [
          join(chat, "node_modules/@spine-event-engine/proto-tools/bin/spine-proto.mjs"),
          "generate",
        ],
        chat,
      );
      const firstInterfaceOutput = readFileSync(
        join(chat, "generated/interfaces/chat-signal.ts"),
        "utf8",
      );
      const messageBoardSource = join(chat, "proto/external/chat/v1/message_board.proto");
      const validMessageBoard = readFileSync(messageBoardSource, "utf8");
      writeFileSync(messageBoardSource, validMessageBoard.replace("ChatSignal", "Outer.Inner"));
      expect(() => {
        run(
          process.execPath,
          [
            join(chat, "node_modules/@spine-event-engine/proto-tools/bin/spine-proto.mjs"),
            "generate",
          ],
          chat,
        );
      }).toThrow("ts_type must be a non-empty TypeScript identifier");
      expect(readFileSync(join(chat, "generated/interfaces/chat-signal.ts"), "utf8")).toBe(
        firstInterfaceOutput,
      );
      expect(
        readdirSync(join(chat, "generated")).some((name) =>
          /^\.generated\.(?:stage|.+\.backup)-/u.test(name),
        ),
      ).toBe(false);
      writeFileSync(messageBoardSource, validMessageBoard);
      const chatTarballs = join(root, "chat-tarballs");
      mkdirSync(chatTarballs);
      const chatPacked = generateBuildAndPack(chat, chatTarballs);
      assertPortableModel(chat);
      const rejectionCompanion = join(chat, "generated/external/chat/v1/task_rejections.ts");
      expect(readFileSync(rejectionCompanion, "utf8")).toContain(
        "Explains why the requested chat task cannot continue.",
      );
      expect(readFileSync(rejectionCompanion, "utf8")).toContain("TaskRejected");
      const companionSource = readFileSync(rejectionCompanion, "utf8");
      expect(companionSource).toContain("TaskBlocked");
      expect(companionSource).not.toContain("NestedDetail");
      expect(companionSource.match(/export const TaskRejected/g)).toHaveLength(1);
      expect(companionSource.match(/export const TaskBlocked/g)).toHaveLength(1);
      expect(existsSync(join(chat, "generated/external/users/v1/user_pb.ts"))).toBe(false);
      expect(existsSync(join(chat, "dist/generated/external/users/v1/user_pb.js"))).toBe(false);
      const interfaceCompanion = join(chat, "generated/interfaces/chat-signal.ts");
      expect(readFileSync(interfaceCompanion, "utf8")).toBe(firstInterfaceOutput);
      const interfaceDeclaration = join(chat, "dist/generated/interfaces/chat-signal.d.ts");
      expect(readFileSync(interfaceCompanion, "utf8")).toContain(
        "Generated by Spine TypeScript. Do not edit manually.",
      );
      expect(readFileSync(interfaceCompanion, "utf8")).not.toMatch(/copyright|license/iu);
      expect(readFileSync(interfaceDeclaration, "utf8")).toContain(
        "export declare const ChatSignal",
      );

      const app = join(root, "chat-app");
      mkdirSync(app);
      writeJson(app, "package.json", {
        name: "@external/chat-app",
        version: "1.0.0",
        type: "module",
        dependencies: {
          "@bufbuild/protobuf": "2.12.1",
          "@external/chat-model": "1.0.0",
          "@external/users-model": "1.0.0",
          "@spine-event-engine/proto-tools": spineVersion,
          react: "19.2.8",
        },
        devDependencies: { typescript: "6.0.3" },
      });
      installTarballsWithPnpm(app, [...spinePackages, usersPacked, chatPacked]);
      writeJson(app, "package.json", {
        name: "@external/chat-app",
        version: "1.0.0",
        type: "module",
        dependencies: {
          "@bufbuild/protobuf": "2.12.1",
          ...Object.fromEntries(
            frameworkPackageRoots.map((packageName) => [packageName, spineVersion]),
          ),
          "@external/chat-model": "1.0.0",
          "@external/users-model": "1.0.0",
          "@spine-event-engine/proto-tools": spineVersion,
          react: "19.2.8",
        },
        devDependencies: { typescript: "6.0.3" },
      });
      assertIsolatedInstalledTree(app, true);
      writeJson(app, "spine-proto.json", {
        formatVersion: 1,
        mode: "application",
        modelPackages: ["@external/chat-model"],
        registryOutput: "src/model-registry.ts",
      });
      writeJson(app, "tsconfig.json", {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2024",
          outDir: "dist",
          rootDir: "src",
          strict: true,
        },
        include: ["src/**/*.ts"],
      });
      mkdirSync(join(app, "src"));
      run(
        process.execPath,
        [join(app, "node_modules/@spine-event-engine/proto-tools/bin/spine-proto.mjs"), "compose"],
        app,
      );
      writeFileSync(
        join(app, "src/index.ts"),
        [
          'import { create } from "@bufbuild/protobuf";',
          'import { AnyMessages } from "@spine-event-engine/core";',
          'import { MessageInterfaces } from "@spine-event-engine/core";',
          'import { CommandIdSchema } from "@spine-event-engine/proto";',
          'import { UserIdSchema } from "@external/users-model/generated/external/users/v1/user_pb.js";',
          'import { ChatSchema } from "@external/chat-model/generated/external/chat/v1/message_board_pb.js";',
          'import { TaskRejected } from "@external/chat-model/generated/external/chat/v1/task_rejections.js";',
          'import { ChatSignal } from "@external/chat-model/generated/interfaces/chat-signal.js";',
          "import type { ChatSignal as ChatSignalType }",
          'from "@external/chat-model/generated/interfaces/chat-signal.js";',
          'import { typeRegistry } from "./model-registry.js";',
          "",
          'const user = create(UserIdSchema, { value: "author-1" });',
          'const chat = create(ChatSchema, { author: user, text: "Hello" });',
          'const commandId = create(CommandIdSchema, { uuid: "spine-1" });',
          "TaskRejected.create({});",
          "const token: ChatSignalType = ChatSignal;",
          "if (!MessageInterfaces.is(token) || token.schemas[0] !== ChatSchema) {",
          '  throw new Error("Generated interface token was not retained.");',
          "}",
          "const values = [[UserIdSchema, user], [ChatSchema, chat], " +
            "[CommandIdSchema, commandId]] as const;",
          "for (const [schema, value] of values) {",
          "  const packed = AnyMessages.pack(schema, value);",
          "  if (",
          "    AnyMessages.unpack(packed, schema) === undefined ||",
          "    AnyMessages.unpackUsing(typeRegistry, packed) === undefined",
          "  ) {",
          "    throw new Error(`Registry/Any round trip failed for ${schema.typeName}.`);",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      run(
        process.execPath,
        [join(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
        app,
      );
      for (const packageName of frameworkPackageRoots) {
        run(
          process.execPath,
          ["--input-type=module", "--eval", "await import(process.argv[1])", packageName],
          app,
        );
      }
      run(process.execPath, [join(app, "dist/index.js")], app);
      assertPortableModel(app);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
