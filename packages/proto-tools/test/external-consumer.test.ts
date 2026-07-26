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

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const processTimeoutMs = 30_000;

interface PackedPackage {
  readonly name: string;
  readonly tarball: string;
}

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
  const sources = [
    "packages/proto-tools",
    "packages/server",
    "packages/proto",
    "packages/core",
    "packages/storage",
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
      const packageName = readPackedName(tarball);
      return { name: packageName, tarball };
    });
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
  for (const packed of packages) extractTarball(packed.tarball, modules);
  linkRuntimeDependencies(directory);
}

function linkRuntimeDependencies(directory: string): void {
  const modules = join(directory, "node_modules");
  const dependencies = [
    ["@bufbuild", join(repositoryRoot, "packages/proto-tools/node_modules/@bufbuild")],
    [
      "@bufbuild/protoplugin",
      join(
        repositoryRoot,
        "node_modules/.pnpm/@bufbuild+protoplugin@2.12.1/node_modules/@bufbuild/protoplugin",
      ),
    ],
    ["@connectrpc", join(repositoryRoot, "packages/server/node_modules/@connectrpc")],
    ["typescript", join(repositoryRoot, "node_modules/typescript")],
    ["semver", join(repositoryRoot, "packages/proto-tools/node_modules/semver")],
    [
      "@spine-event-engine/validation-ts",
      join(repositoryRoot, "packages/core/node_modules/@spine-event-engine/validation-ts"),
    ],
  ] as const;
  for (const [name, source] of dependencies) {
    const target = join(modules, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    run("cp", ["-RL", realpathSync(source), target], directory);
  }
}

function assertIsolatedInstalledTree(directory: string): void {
  const pending = [join(directory, "node_modules")];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      expect(lstatSync(path).isSymbolicLink(), relative(directory, path)).toBe(false);
      expect(resolve(path).startsWith(resolve(repositoryRoot)), relative(directory, path)).toBe(
        false,
      );
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

function modelPackage(name: string, dependencies: Record<string, string>): Record<string, unknown> {
  return {
    name,
    version: "1.0.0",
    type: "module",
    files: ["dist", "proto", "spine-proto.json", "spine-proto-manifest.json"],
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
      join(directory, "node_modules/@spine-event-engine/proto-tools/dist/src/cli/spine-proto.js"),
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

      const users = join(root, "users-model");
      mkdirSync(users);
      installTarballs(users, spinePackages);
      assertIsolatedInstalledTree(users);
      writeJson(
        users,
        "package.json",
        modelPackage("@external/users-model", {
          "@bufbuild/protobuf": "2.12.1",
          "@spine-event-engine/proto": "0.0.0",
        }),
      );
      writeJson(
        users,
        "spine-proto.json",
        modelConfig("@external/users-model", ["@spine-event-engine/proto"], "usersProtoModule"),
      );
      writeModelTsconfig(users);
      mkdirSync(join(users, "proto/external/users/v1"), { recursive: true });
      writeFileSync(
        join(users, "proto/external/users/v1/users.proto"),
        'syntax = "proto3"; package external.users.v1; message UserId { string value = 1; }\n',
      );
      const usersTarballs = join(root, "users-tarballs");
      mkdirSync(usersTarballs);
      const usersPacked = generateBuildAndPack(users, usersTarballs);
      assertPortableModel(users);

      const chat = join(root, "chat-model");
      mkdirSync(chat);
      installTarballs(chat, [...spinePackages, usersPacked]);
      assertIsolatedInstalledTree(chat);
      writeJson(
        chat,
        "package.json",
        modelPackage("@external/chat-model", {
          "@bufbuild/protobuf": "2.12.1",
          "@spine-event-engine/proto": "0.0.0",
          "@external/users-model": "1.0.0",
        }),
      );
      writeJson(
        chat,
        "spine-proto.json",
        modelConfig(
          "@external/chat-model",
          ["@spine-event-engine/proto", "@external/users-model"],
          "chatProtoModule",
        ),
      );
      writeModelTsconfig(chat);
      mkdirSync(join(chat, "proto/external/chat/v1"), { recursive: true });
      writeFileSync(
        join(chat, "proto/external/chat/v1/chat.proto"),
        [
          'syntax = "proto3";',
          "package external.chat.v1;",
          'import "external/users/v1/users.proto";',
          "message Chat { external.users.v1.UserId author = 1; string text = 2; }",
          "",
        ].join("\n"),
      );
      const chatTarballs = join(root, "chat-tarballs");
      mkdirSync(chatTarballs);
      const chatPacked = generateBuildAndPack(chat, chatTarballs);
      assertPortableModel(chat);
      expect(existsSync(join(chat, "generated/external/users/v1/users_pb.ts"))).toBe(false);
      expect(existsSync(join(chat, "dist/generated/external/users/v1/users_pb.js"))).toBe(false);

      const app = join(root, "chat-app");
      mkdirSync(app);
      installTarballs(app, [...spinePackages, usersPacked, chatPacked]);
      assertIsolatedInstalledTree(app);
      writeJson(app, "package.json", {
        name: "@external/chat-app",
        version: "1.0.0",
        type: "module",
        dependencies: { "@external/chat-model": "1.0.0", "@external/users-model": "1.0.0" },
      });
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
        [
          join(app, "node_modules/@spine-event-engine/proto-tools/dist/src/cli/spine-proto.js"),
          "compose",
        ],
        app,
      );
      writeFileSync(
        join(app, "src/index.ts"),
        [
          'import { create } from "@bufbuild/protobuf";',
          'import { packAny, unpackAny, unpackAnyUsing } from "@spine-event-engine/core";',
          'import { CommandIdSchema } from "@spine-event-engine/proto";',
          'import { UserIdSchema } from "@external/users-model/generated/external/users/v1/users_pb.js";',
          'import { ChatSchema } from "@external/chat-model/generated/external/chat/v1/chat_pb.js";',
          'import { typeRegistry } from "./model-registry.js";',
          "",
          'const user = create(UserIdSchema, { value: "author-1" });',
          'const chat = create(ChatSchema, { author: user, text: "Hello" });',
          'const commandId = create(CommandIdSchema, { uuid: "spine-1" });',
          "for (const [schema, value] of [[UserIdSchema, user], [ChatSchema, chat], [CommandIdSchema, commandId]] as const) {",
          "  const packed = packAny(schema, value);",
          "  if (unpackAny(packed, schema) === undefined || unpackAnyUsing(typeRegistry, packed) === undefined) {",
          "    throw new Error(`Registry/Any round trip failed for ${schema.typeName}.`);",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      run(
        process.execPath,
        [join(app, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
        app,
      );
      run(process.execPath, [join(app, "dist/index.js")], app);
      assertPortableModel(app);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
