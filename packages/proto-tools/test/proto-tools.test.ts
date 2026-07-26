import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeManifestAtomically } from "../src/io/atomic-manifest.js";
import { createManifest, readConfig, readManifest } from "../src/index.js";
import {
  composeApplication,
  generateModel,
  type GenerationLockOperations,
  type GenerationOperations,
  probeGenerationClaimLiveness,
} from "../src/generation/generator.js";
import { resolveModelGraph } from "../src/model/model-graph.js";

function packageDirectory(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "spine-proto-tools-"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name,
      version: "1.2.3",
      exports: {
        "./generated/*.js": {
          types: "./dist/generated/*.d.ts",
          default: "./dist/generated/*.js",
        },
      },
    }),
  );
  return realpathSync(directory);
}

function writeJson(directory: string, path: string, value: unknown): void {
  const target = join(directory, path);
  mkdirSync(join(target, ".."), { recursive: true });
  const packageValue =
    path === "package.json" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("exports" in value)
      ? {
          ...value,
          exports: {
            "./spine-proto-manifest.json": "./spine-proto-manifest.json",
            "./generated/*.js": {
              types: "./dist/generated/*.d.ts",
              default: "./dist/generated/*.js",
            },
          },
        }
      : value;
  writeFileSync(target, `${JSON.stringify(packageValue, null, 2)}\n`);
}

function modelConfig(name: string, dependencies: readonly string[] = []) {
  return {
    formatVersion: 1,
    mode: "model",
    packageName: name,
    protoRoot: "proto",
    generatedRoot: "src/generated",
    exportRoot: "generated",
    dependencies,
    moduleExport: "modelProtoModule",
  };
}

function installModel(
  requester: string,
  name: string,
  dependencies: readonly string[] = [],
  protoFile = `${name.replaceAll("@", "").replaceAll("/", "-")}.proto`,
): string {
  const directory = join(requester, "node_modules", ...name.split("/"));
  mkdirSync(directory, { recursive: true });
  writeJson(directory, "package.json", {
    name,
    version: "1.2.3",
    dependencies: Object.fromEntries(dependencies.map((dependency) => [dependency, "^1.2.3"])),
    exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
  });
  writeJson(directory, "spine-proto-manifest.json", {
    formatVersion: 1,
    packageName: name,
    packageVersion: "1.2.3",
    protoFiles: [protoFile],
    generatedExports: { [protoFile]: `generated/${protoFile.replace(/\.proto$/, "_pb.js")}` },
    dependencies,
    moduleExport: "modelProtoModule",
  });
  return directory;
}

interface Claim {
  readonly content: string;
  readonly kind?: "regular" | "symlink" | "other";
}

function claimOperations(
  claims: Map<string, Claim>,
  alive: ReadonlySet<number> = new Set(),
  removed: string[] = [],
): GenerationLockOperations {
  return {
    create: (path, content) => {
      const name = basename(path);
      if (claims.has(name)) {
        const error = new Error("exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      claims.set(name, { content });
    },
    list: () => [...claims.keys()],
    read: (path) => {
      const claim = claims.get(basename(path));
      if (claim === undefined) throw new Error("missing claim");
      return claim.content;
    },
    inspect: (path) => claims.get(basename(path))?.kind ?? "regular",
    remove: (path) => {
      const name = basename(path);
      removed.push(name);
      claims.delete(name);
    },
    liveness: (pid) => (alive.has(pid) ? "alive" : "dead"),
  };
}

function generatedOutput(_: string, output: string): void {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "model_pb.ts"), "export {};\n");
}

function packedHandlerTarballs(): readonly string[] {
  const destination = mkdtempSync(join(tmpdir(), "spine-handler-tarballs-"));
  const packages = [
    "packages/proto-tools",
    "packages/server",
    "packages/proto",
    "packages/core",
    "packages/storage",
    "packages/transport",
    "examples/users-model",
    "examples/chat-model",
  ];
  for (const packagePath of packages) {
    execFileSync(
      "pnpm",
      [
        "--dir",
        packagePath,
        "pack",
        "--config.ignore-scripts=true",
        "--pack-destination",
        destination,
      ],
      {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 30_000,
      },
    );
  }
  createHandlerModelTarball(destination);
  return readdirSync(destination).map((name) => join(destination, name));
}

function createHandlerModelTarball(destination: string): void {
  const model = packageDirectory("@acme/handler-model");
  writeJson(model, "package.json", {
    name: "@acme/handler-model",
    version: "1.0.0",
    type: "module",
    files: ["dist"],
    exports: {
      "./generated/*.js": { types: "./dist/generated/*.d.ts", default: "./dist/generated/*.js" },
    },
  });
  writeJson(model, "spine-proto.json", {
    ...modelConfig("@acme/handler-model"),
    generatedRoot: "generated",
    exportRoot: "generated",
  });
  writeJson(model, "tsconfig.json", {
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
  mkdirSync(join(model, "proto/chat/v1"), { recursive: true });
  writeFileSync(
    join(model, "proto/chat/v1/chat.proto"),
    'syntax = "proto3"; package chat.v1;\nmessage Message { string text = 1; }\n',
  );
  writeFileSync(
    join(model, "proto/chat/v1/commands.proto"),
    'syntax = "proto3"; package chat.v1;\nmessage PostMessage { string text = 1; }\n',
  );
  writeFileSync(
    join(model, "proto/chat/v1/events.proto"),
    'syntax = "proto3"; package chat.v1;\nmessage MessagePosted { string text = 1; }\n',
  );
  const modules = join(model, "node_modules");
  mkdirSync(join(modules, "@bufbuild"), { recursive: true });
  mkdirSync(join(modules, "@spine-event-engine"), { recursive: true });
  symlinkSync(
    join(process.cwd(), "packages/proto-tools/node_modules/@bufbuild/protobuf"),
    join(modules, "@bufbuild/protobuf"),
  );
  symlinkSync(join(process.cwd(), "packages/proto"), join(modules, "@spine-event-engine/proto"));
  generateModel(model);
  execFileSync(
    process.execPath,
    [join(process.cwd(), "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: model, timeout: 30_000 },
  );
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", destination], {
    cwd: model,
    timeout: 30_000,
    env: { ...process.env, npm_config_cache: mkdtempSync(join(tmpdir(), "spine-npm-pack-cache-")) },
  });
}

function installTarballs(app: string, tarballs: readonly string[]): void {
  const modules = join(app, "node_modules");
  mkdirSync(modules);
  for (const tarball of tarballs) extractTarball(tarball, modules);
  linkThirdParty(app);
}

function extractTarball(tarball: string, modules: string): void {
  const stage = mkdtempSync(join(tmpdir(), "spine-handler-extract-"));
  execFileSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", stage], { timeout: 30_000 });
  const packageName = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (
    typeof packageName.name !== "string" ||
    (!packageName.name.startsWith("@spine-event-engine/") &&
      packageName.name !== "@acme/handler-model")
  )
    throw new Error(`Unexpected packed package: ${tarball}`);
  const target = join(modules, ...packageName.name.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  renameSync(stage, target);
}

function linkThirdParty(app: string): void {
  const modules = join(app, "node_modules");
  for (const [name, source] of [
    ["@bufbuild", join(process.cwd(), "packages/proto-tools/node_modules/@bufbuild")],
    ["@connectrpc", join(process.cwd(), "packages/server/node_modules/@connectrpc")],
    ["typescript", join(process.cwd(), "node_modules/typescript")],
    ["zeromq", join(process.cwd(), "node_modules/zeromq")],
    ["semver", join(process.cwd(), "packages/proto-tools/node_modules/semver")],
    [
      "@spine-event-engine/validation-ts",
      join(process.cwd(), "packages/core/node_modules/@spine-event-engine/validation-ts"),
    ],
  ] as const) {
    const target = join(modules, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target);
  }
}

describe("spine proto model tooling", () => {
  it("runs installed handler tooling against packed Server and model packages", () => {
    const tarballs = packedHandlerTarballs();
    const app = packageDirectory("@acme/packed-handler-app");
    installTarballs(app, tarballs);
    writeJson(app, "tsconfig.json", {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2024",
        lib: ["ES2024", "DOM", "decorators"],
        skipLibCheck: true,
        strict: true,
      },
      include: ["src/**/*.ts", "generated/**/*.ts"],
    });
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(
      join(app, "src/chat.ts"),
      [
        'import { Aggregate, Assign } from "@spine-event-engine/server";',
        'import { type Message, MessageSchema } from "@acme/handler-model/generated/chat/v1/chat_pb.js";',
        'import { type PostMessage } from "@acme/handler-model/generated/chat/v1/commands_pb.js";',
        'import { type MessagePosted } from "@acme/handler-model/generated/chat/v1/events_pb.js";',
        "",
        "export class Chat extends Aggregate<string, typeof MessageSchema, bigint> {",
        "  @Assign post(command: PostMessage): MessagePosted { return {} as MessagePosted; }",
        "}",
        "",
      ].join("\n"),
    );
    execFileSync(
      process.execPath,
      [
        join(app, "node_modules/@spine-event-engine/proto-tools/dist/src/cli/spine-proto.js"),
        "handlers",
      ],
      {
        cwd: app,
        timeout: 30_000,
      },
    );
    const registry = join(app, "generated/handler/generated-handler-registry.ts");
    const source = readFileSync(registry, "utf8");
    expect(source).toContain("@acme/handler-model/generated/chat/v1/chat_pb.js");
    expect(source).toContain("@spine-event-engine/server/internal/generated-handler-registry");
    execFileSync(
      process.execPath,
      [join(app, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"],
      {
        cwd: app,
        timeout: 30_000,
      },
    );
    const require = createRequire(join(app, "package.json"));
    expect(
      require.resolve("@spine-event-engine/server/internal/generated-handler-registry"),
    ).toContain("generated-handler-registry.js");
    expect(require.resolve("@acme/handler-model/generated/chat/v1/chat_pb.js")).toContain(
      "chat_pb.js",
    );
  }, 120_000);
  it("runs packaged Buf to generate only a model's owned source and module", () => {
    const model = packageDirectory("@example/users-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/users-model"));
    mkdirSync(join(model, "proto/users/v1"), { recursive: true });
    writeFileSync(
      join(model, "proto/users/v1/user.proto"),
      'syntax = "proto3";\npackage users.v1;\nmessage User { string id = 1; }\n',
    );

    generateModel(model);

    expect(readFileSync(join(model, "src/generated/users/v1/user_pb.ts"), "utf8")).toContain(
      "UserSchema",
    );
    expect(readFileSync(join(model, "src/generated/proto-module.ts"), "utf8")).toContain(
      "modelProtoModule",
    );
    expect(readManifest(model).protoFiles).toEqual(["users/v1/user.proto"]);
  });

  it("links a cross-model Proto import to the dependency's manifest npm export without duplicating output", () => {
    const chat = packageDirectory("@example/chat-model");
    const users = installModel(chat, "@example/users-model", [], "users/v1/user.proto");
    mkdirSync(join(users, "proto/users/v1"), { recursive: true });
    writeFileSync(
      join(users, "proto/users/v1/user.proto"),
      'syntax = "proto3";\npackage users.v1;\nmessage UserId { string value = 1; }\n',
    );
    writeJson(users, "package.json", {
      name: "@example/users-model",
      version: "1.2.3",
      exports: {
        "./spine-proto-manifest.json": "./spine-proto-manifest.json",
        "./proto/users/v1/user.proto": "./proto/users/v1/user.proto",
      },
    });
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(
      chat,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );
    mkdirSync(join(chat, "proto/chat/v1"), { recursive: true });
    writeFileSync(
      join(chat, "proto/chat/v1/message.proto"),
      [
        'syntax = "proto3";\npackage chat.v1;\nimport "users/v1/user.proto";\n',
        "message Chat { users.v1.UserId author = 1; }\n",
      ].join(""),
    );

    generateModel(chat);

    expect(readFileSync(join(chat, "src/generated/chat/v1/message_pb.ts"), "utf8")).toContain(
      'from "@example/users-model/generated/users/v1/user_pb.js"',
    );
    expect(existsSync(join(chat, "src/generated/users/v1/user_pb.ts"))).toBe(false);
  });

  it("uses each direct dependency manifest's module export in the generated model module", () => {
    const chat = packageDirectory("@example/chat-model");
    const users = installModel(chat, "@example/users-model", [], "users/v1/user.proto");
    mkdirSync(join(users, "proto/users/v1"), { recursive: true });
    writeFileSync(
      join(users, "proto/users/v1/user.proto"),
      'syntax = "proto3"; package users.v1; message UserId { string value = 1; }\n',
    );
    writeJson(users, "package.json", {
      name: "@example/users-model",
      version: "1.2.3",
      exports: {
        "./spine-proto-manifest.json": "./spine-proto-manifest.json",
        "./proto/users/v1/user.proto": "./proto/users/v1/user.proto",
      },
    });
    writeJson(users, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/v1/user.proto"],
      generatedExports: { "users/v1/user.proto": "generated/users/v1/user_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(
      chat,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );
    mkdirSync(join(chat, "proto/chat/v1"), { recursive: true });
    writeFileSync(
      join(chat, "proto/chat/v1/message.proto"),
      [
        'syntax = "proto3"; package chat.v1; import "users/v1/user.proto"; ',
        "message Chat { users.v1.UserId author = 1; }\n",
      ].join(""),
    );

    generateModel(chat);

    expect(readFileSync(join(chat, "src/generated/proto-module.ts"), "utf8")).toContain(
      'import { usersProtoModule as dependency0 } from "@example/users-model";',
    );
  });

  it("typechecks a generated model package with resolved Protobuf and dependency module imports", () => {
    const chat = packageDirectory("@example/chat-model");
    const users = installModel(chat, "@example/users-model", [], "users/v1/user.proto");
    mkdirSync(join(users, "proto/users/v1"), { recursive: true });
    writeFileSync(
      join(users, "proto/users/v1/user.proto"),
      'syntax = "proto3"; package users.v1; message UserId { string value = 1; }\n',
    );
    writeJson(users, "package.json", {
      name: "@example/users-model",
      version: "1.2.3",
      exports: {
        "./spine-proto-manifest.json": "./spine-proto-manifest.json",
        "./proto/users/v1/user.proto": "./proto/users/v1/user.proto",
        "./generated/users/v1/user_pb.js": "./generated/users/v1/user_pb.d.ts",
        ".": "./index.d.ts",
      },
    });
    writeJson(users, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/v1/user.proto"],
      generatedExports: { "users/v1/user.proto": "generated/users/v1/user_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    mkdirSync(join(users, "generated/users/v1"), { recursive: true });
    writeFileSync(
      join(users, "generated/users/v1/user_pb.d.ts"),
      [
        "export interface UserId {}\nexport declare const UserIdSchema: any;\n",
        "export declare const file_users_v1_user: any;\n",
      ].join(""),
    );
    writeFileSync(
      join(users, "index.d.ts"),
      [
        'import type { ProtoModule } from "@spine-event-engine/proto"; ',
        "export declare const usersProtoModule: ProtoModule;\n",
      ].join(""),
    );
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(
      chat,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );
    mkdirSync(join(chat, "proto/chat/v1"), { recursive: true });
    writeFileSync(
      join(chat, "proto/chat/v1/message.proto"),
      [
        'syntax = "proto3"; package chat.v1; import "users/v1/user.proto"; ',
        "message Chat { users.v1.UserId author = 1; }\n",
      ].join(""),
    );
    const moduleDirectory = join(chat, "node_modules");
    mkdirSync(join(moduleDirectory, "@spine-event-engine"), { recursive: true });
    mkdirSync(join(moduleDirectory, "@bufbuild"), { recursive: true });
    symlinkSync(
      join(process.cwd(), "packages/proto"),
      join(moduleDirectory, "@spine-event-engine/proto"),
    );
    symlinkSync(
      join(process.cwd(), "packages/proto-tools/node_modules/@bufbuild/protobuf"),
      join(moduleDirectory, "@bufbuild/protobuf"),
    );

    generateModel(chat);
    writeJson(chat, "tsconfig.json", {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
      },
      include: ["src/generated/**/*.ts"],
    });
    const checked = spawnSync(
      process.execPath,
      [join(process.cwd(), "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      { cwd: chat, encoding: "utf8" },
    );
    expect(`${checked.stdout}${checked.stderr}`).toBe("");
    expect(checked.status).toBe(0);
  });

  it("rejects a declared dependency whose canonical Proto source is not exported", () => {
    const chat = packageDirectory("@example/chat-model");
    installModel(chat, "@example/users-model", [], "users/v1/user.proto");
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(
      chat,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );
    mkdirSync(join(chat, "proto"), { recursive: true });
    writeFileSync(join(chat, "proto/chat.proto"), 'syntax = "proto3"; message Chat {}\n');

    expect(() => {
      generateModel(chat);
    }).toThrow(
      "spine-proto: @example/users-model: cannot resolve exported Proto source users/v1/user.proto",
    );
  });

  it("rejects duplicate fully-qualified generated messages before replacing prior output", () => {
    const model = packageDirectory("@example/conflict-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/conflict-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(
      join(model, "proto/first.proto"),
      'syntax = "proto3"; package example.v1; message Duplicate {}\n',
    );
    writeFileSync(
      join(model, "proto/second.proto"),
      'syntax = "proto3"; package example.v1; message Duplicate {}\n',
    );
    mkdirSync(join(model, "src/generated"), { recursive: true });
    writeFileSync(join(model, "src/generated/prior.ts"), "prior\n");

    expect(() => {
      generateModel(model);
    }).toThrow(/Buf (generation|validation) failed/);
    expect(readFileSync(join(model, "src/generated/prior.ts"), "utf8")).toBe("prior\n");
  });

  it("rejects undeclared and unowned canonical Proto imports before publication", () => {
    for (const dependency of [false, true]) {
      const model = packageDirectory(
        `@example/import-${dependency ? "unowned" : "undeclared"}-model`,
      );
      const dependencyName = "@example/users-model";
      if (dependency) {
        const users = installModel(model, dependencyName, [], "users/v1/other.proto");
        mkdirSync(join(users, "proto/users/v1"), { recursive: true });
        writeFileSync(
          join(users, "proto/users/v1/other.proto"),
          'syntax = "proto3"; package users.v1; message Other {}\n',
        );
        writeJson(users, "package.json", {
          name: dependencyName,
          version: "1.2.3",
          exports: {
            "./spine-proto-manifest.json": "./spine-proto-manifest.json",
            "./proto/users/v1/other.proto": "./proto/users/v1/other.proto",
          },
        });
      }
      writeJson(model, "package.json", {
        name: dependency ? "@example/import-unowned-model" : "@example/import-undeclared-model",
        version: "1.2.3",
        dependencies: dependency ? { [dependencyName]: "^1.2.3" } : {},
      });
      writeJson(
        model,
        "spine-proto.json",
        modelConfig(
          dependency ? "@example/import-unowned-model" : "@example/import-undeclared-model",
          dependency ? [dependencyName] : [],
        ),
      );
      mkdirSync(join(model, "proto"), { recursive: true });
      writeFileSync(
        join(model, "proto/model.proto"),
        'syntax = "proto3"; import "users/v1/user.proto"; message Model {}\n',
      );
      mkdirSync(join(model, "src/generated"), { recursive: true });
      writeFileSync(join(model, "src/generated/prior.ts"), "prior\n");
      writeFileSync(join(model, "spine-proto-manifest.json"), "prior manifest\n");

      let error: unknown;
      try {
        generateModel(model);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(
        `spine-proto: ${dependency ? "@example/import-unowned-model" : "@example/import-undeclared-model"}:`,
      );
      expect(message).toContain("model.proto");
      expect(message).not.toContain(".stage-");
      expect(message).not.toContain(model);
      expect(readFileSync(join(model, "src/generated/prior.ts"), "utf8")).toBe("prior\n");
      expect(readFileSync(join(model, "spine-proto-manifest.json"), "utf8")).toBe(
        "prior manifest\n",
      );
    }
  });

  it("preserves prior generated output and manifest when a generation boundary fails", () => {
    const model = packageDirectory("@example/failure-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/failure-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, "proto/model.proto"), 'syntax = "proto3"; message Model {}\n');
    mkdirSync(join(model, "src/generated"), { recursive: true });
    writeFileSync(join(model, "src/generated/prior.ts"), "prior output\n");
    writeFileSync(join(model, "spine-proto-manifest.json"), "prior manifest\n");

    const failures: Readonly<Record<string, GenerationOperations>> = {
      command: {
        runBuf: () => {
          throw new Error("command failed");
        },
      },
      rewrite: {
        rewriteImports: () => {
          throw new Error("rewrite failed");
        },
      },
      module: {
        writeModule: () => {
          throw new Error("module failed");
        },
      },
      publish: {
        rename: () => {
          throw new Error("rename failed");
        },
      },
    };
    for (const [boundary, operations] of Object.entries(failures)) {
      expect(() => {
        generateModel(model, operations);
      }).toThrow(`${boundary === "publish" ? "rename" : boundary} failed`);
      expect(readFileSync(join(model, "src/generated/prior.ts"), "utf8")).toBe("prior output\n");
      expect(readFileSync(join(model, "spine-proto-manifest.json"), "utf8")).toBe(
        "prior manifest\n",
      );
    }
  });

  it("rejects active unique claims and cleans a contender claim without touching the owner", () => {
    const model = packageDirectory("@example/active-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/active-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    const claims = new Map<string, Claim>([
      [
        ".spine-proto-generate.lock.active",
        { content: JSON.stringify({ pid: 41, token: "active" }) },
      ],
    ]);
    const removed: string[] = [];

    expect(() => {
      generateModel(model, {
        runBuf: generatedOutput,
        lockOperations: claimOperations(claims, new Set([41]), removed),
      });
    }).toThrow(
      "spine-proto: @example/active-claim-model: generation already in progress for this package",
    );
    expect([...claims.keys()]).toEqual([".spine-proto-generate.lock.active"]);
    expect(removed).toHaveLength(1);
  });

  it("removes only dead unique claims and its exact own claim after successful recovery", () => {
    const model = packageDirectory("@example/dead-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/dead-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    const claims = new Map<string, Claim>([
      [".spine-proto-generate.lock.dead", { content: JSON.stringify({ pid: 42, token: "dead" }) }],
    ]);
    const removed: string[] = [];

    generateModel(model, {
      runBuf: generatedOutput,
      lockOperations: claimOperations(claims, new Set(), removed),
    });
    expect(claims).toEqual(new Map());
    expect(removed).toContain(".spine-proto-generate.lock.dead");
    expect(removed).toHaveLength(2);
  });

  it("removes a claim only after an explicit dead liveness result", () => {
    const model = packageDirectory("@example/explicit-dead-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/explicit-dead-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    const claims = new Map<string, Claim>([
      [".spine-proto-generate.lock.dead", { content: JSON.stringify({ pid: 43, token: "dead" }) }],
    ]);
    const operations = claimOperations(claims);

    generateModel(model, {
      runBuf: generatedOutput,
      lockOperations: { ...operations, liveness: () => "dead" },
    });
    expect(claims).toEqual(new Map());
  });

  it("rejects an indeterminate liveness result without removing its claim", () => {
    const model = packageDirectory("@example/indeterminate-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/indeterminate-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    const claim = ".spine-proto-generate.lock.indeterminate";
    const claims = new Map<string, Claim>([
      [claim, { content: JSON.stringify({ pid: 44, token: "indeterminate" }) }],
    ]);
    const operations = claimOperations(claims);

    expect(() => {
      generateModel(model, {
        runBuf: generatedOutput,
        lockOperations: { ...operations, liveness: () => "indeterminate" },
      });
    }).toThrow(
      "spine-proto: @example/indeterminate-claim-model: generation already in progress for this package",
    );
    expect([...claims.keys()]).toEqual([claim]);
  });

  it("classifies only ESRCH as dead when probing a generation claim owner", () => {
    const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });
    expect(probeGenerationClaimLiveness(1, () => undefined)).toBe("alive");
    expect(
      probeGenerationClaimLiveness(1, () => {
        throw errno("ESRCH");
      }),
    ).toBe("dead");
    expect(
      probeGenerationClaimLiveness(1, () => {
        throw errno("EPERM");
      }),
    ).toBe("indeterminate");
    expect(
      probeGenerationClaimLiveness(1, () => {
        throw errno("EIO");
      }),
    ).toBe("indeterminate");
  });

  it("never lets two claims present before scanning both proceed", () => {
    const model = packageDirectory("@example/two-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/two-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    for (const contender of ["a", "b"]) {
      const claims = new Map<string, Claim>([
        [".spine-proto-generate.lock.a", { content: JSON.stringify({ pid: 51, token: "a" }) }],
        [".spine-proto-generate.lock.b", { content: JSON.stringify({ pid: 52, token: "b" }) }],
      ]);
      expect(() => {
        generateModel(model, {
          runBuf: generatedOutput,
          lockOperations: claimOperations(claims, new Set([51, 52])),
        });
      }).toThrow(
        "spine-proto: @example/two-claim-model: generation already in progress for this package",
      );
      expect(claims.has(`.spine-proto-generate.lock.${contender}`)).toBe(true);
    }
  });

  it("never removes another contender's live replacement while cleaning a stale unique claim", () => {
    const model = packageDirectory("@example/interleaved-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/interleaved-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    for (const replacement of ["a", "b"]) {
      const claims = new Map<string, Claim>([
        [
          ".spine-proto-generate.lock.stale",
          { content: JSON.stringify({ pid: 71, token: "stale" }) },
        ],
      ]);
      const operations = claimOperations(claims, new Set([72]));
      const originalRemove = operations.remove;
      const replacementName = `.spine-proto-generate.lock.${replacement}`;
      const interleaved: GenerationLockOperations = {
        ...operations,
        remove: (path) => {
          originalRemove(path);
          if (basename(path) === ".spine-proto-generate.lock.stale") {
            claims.set(replacementName, {
              content: JSON.stringify({ pid: 72, token: replacement }),
            });
          }
        },
      };

      expect(() => {
        generateModel(model, { runBuf: generatedOutput, lockOperations: interleaved });
      }).toThrow(
        "spine-proto: @example/interleaved-claim-model: generation already in progress for this package",
      );
      expect(claims.has(replacementName)).toBe(true);
      expect([...claims.keys()]).toEqual([replacementName]);
    }
  });

  it("refuses malformed, nonregular, and over-budget unique claims", () => {
    const model = packageDirectory("@example/invalid-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/invalid-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    for (const kind of ["symlink", "other"] as const) {
      const claims = new Map<string, Claim>([
        [".spine-proto-generate.lock.bad", { content: JSON.stringify({ pid: 61 }), kind }],
      ]);
      expect(() => {
        generateModel(model, { runBuf: generatedOutput, lockOperations: claimOperations(claims) });
      }).toThrow(
        "spine-proto: @example/invalid-claim-model: generation claim is not a regular file",
      );
    }
    const oversized = new Map<string, Claim>();
    for (let index = 0; index <= 1000; index += 1)
      oversized.set(`.spine-proto-generate.lock.${String(index)}`, {
        content: JSON.stringify({ pid: 62, token: String(index) }),
      });
    expect(() => {
      generateModel(model, { runBuf: generatedOutput, lockOperations: claimOperations(oversized) });
    }).toThrow("spine-proto: @example/invalid-claim-model: generation claim count exceeds 1000");
  });

  it("surfaces own-claim release failure without masking a primary generation error", () => {
    const model = packageDirectory("@example/release-claim-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/release-claim-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    const claims = new Map<string, Claim>();
    const operations = claimOperations(claims);
    const release = (): never => {
      throw new Error("forced release failure");
    };

    expect(() => {
      generateModel(model, {
        runBuf: generatedOutput,
        lockOperations: { ...operations, remove: release },
      });
    }).toThrow("spine-proto: @example/release-claim-model: cannot clean up generation lock");
    claims.clear();
    expect(() => {
      generateModel(model, {
        runBuf: () => {
          throw new Error("primary generation failure");
        },
        lockOperations: { ...operations, remove: release },
      });
    }).toThrow("primary generation failure");
  });

  it("rejects an owned Proto import from a nested transitive model before publication", () => {
    const current = packageDirectory("@example/current-model");
    const direct = installModel(
      current,
      "@example/direct-model",
      ["@example/transitive-model"],
      "direct/v1/direct.proto",
    );
    const transitive = installModel(
      direct,
      "@example/transitive-model",
      [],
      "transitive/v1/shared.proto",
    );
    for (const [root, path] of [
      [direct, "direct/v1/direct.proto"],
      [transitive, "transitive/v1/shared.proto"],
    ] as const) {
      mkdirSync(join(root, "proto", dirname(path)), { recursive: true });
      writeFileSync(join(root, "proto", path), 'syntax = "proto3";\n');
      writeJson(root, "package.json", {
        name: root === direct ? "@example/direct-model" : "@example/transitive-model",
        version: "1.2.3",
        dependencies: root === direct ? { "@example/transitive-model": "^1.2.3" } : {},
        exports: {
          "./spine-proto-manifest.json": "./spine-proto-manifest.json",
          [`./proto/${path}`]: `./proto/${path}`,
        },
      });
    }
    writeJson(current, "package.json", {
      name: "@example/current-model",
      version: "1.2.3",
      dependencies: { "@example/direct-model": "^1.2.3" },
    });
    writeJson(
      current,
      "spine-proto.json",
      modelConfig("@example/current-model", ["@example/direct-model"]),
    );
    mkdirSync(join(current, "proto/app/v1"), { recursive: true });
    writeFileSync(join(current, "proto/app/v1/current.proto"), 'syntax = "proto3";\n');
    mkdirSync(join(current, "src/generated"), { recursive: true });
    writeFileSync(join(current, "src/generated/prior.ts"), "prior output\n");
    writeFileSync(join(current, "spine-proto-manifest.json"), "prior manifest\n");

    const transitiveImportError =
      "spine-proto: @example/current-model: generated import " +
      "transitive/v1/shared.proto is owned by transitive dependency " +
      "@example/transitive-model";
    expect(() => {
      generateModel(current, {
        runBuf: (_, output) => {
          mkdirSync(join(output, "app/v1"), { recursive: true });
          writeFileSync(
            join(output, "app/v1/current_pb.ts"),
            'import {} from "../../transitive/v1/shared_pb.js";\nexport {};\n',
          );
        },
      });
    }).toThrow(transitiveImportError);
    expect(readFileSync(join(current, "src/generated/prior.ts"), "utf8")).toBe("prior output\n");
    expect(readFileSync(join(current, "spine-proto-manifest.json"), "utf8")).toBe(
      "prior manifest\n",
    );
  });

  it("JSON-escapes a hostile installed generated export without injecting generated source", () => {
    const current = packageDirectory("@example/escaped-import-model");
    const dependency = installModel(current, "@example/escaped-dependency", [], "dependency.proto");
    const hostileExport = 'generated/quote";throw new Error("injected");_pb.js';
    writeJson(dependency, "package.json", {
      name: "@example/escaped-dependency",
      version: "1.2.3",
      exports: {
        "./spine-proto-manifest.json": "./spine-proto-manifest.json",
        "./proto/dependency.proto": "./proto/dependency.proto",
        [`./${hostileExport}`]: `./${hostileExport.replace(/\.js$/, ".d.ts")}`,
      },
    });
    writeJson(dependency, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/escaped-dependency",
      packageVersion: "1.2.3",
      protoFiles: ["dependency.proto"],
      generatedExports: { "dependency.proto": hostileExport },
      dependencies: [],
      moduleExport: "dependencyProtoModule",
    });
    mkdirSync(join(dependency, "proto"), { recursive: true });
    writeFileSync(join(dependency, "proto/dependency.proto"), 'syntax = "proto3";\n');
    mkdirSync(join(dependency, dirname(hostileExport)), { recursive: true });
    writeFileSync(join(dependency, hostileExport.replace(/\.js$/, ".d.ts")), "export {};\n");
    writeJson(current, "package.json", {
      name: "@example/escaped-import-model",
      version: "1.2.3",
      dependencies: { "@example/escaped-dependency": "^1.2.3" },
    });
    writeJson(
      current,
      "spine-proto.json",
      modelConfig("@example/escaped-import-model", ["@example/escaped-dependency"]),
    );
    mkdirSync(join(current, "proto"), { recursive: true });
    writeFileSync(join(current, "proto/current.proto"), 'syntax = "proto3";\n');

    generateModel(current, {
      runBuf: (_, output) => {
        mkdirSync(output, { recursive: true });
        writeFileSync(
          join(output, "current_pb.ts"),
          'import {} from "./dependency_pb.js";\nexport {};\n',
        );
      },
      writeModule: () => undefined,
    });

    const source = readFileSync(join(current, "src/generated/current_pb.ts"), "utf8");
    expect(source).toContain(JSON.stringify(`@example/escaped-dependency/${hostileExport}`));
    expect(source).not.toContain(';throw new Error("injected");";');
    const checked = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "src/generated/current_pb.ts",
      ],
      { cwd: current, encoding: "utf8" },
    );
    expect(`${checked.stdout}${checked.stderr}`).toBe("");
    expect(checked.status).toBe(0);
  });

  it("JSON-escapes quoted owned Proto filenames in generated local module imports", () => {
    const model = packageDirectory("@example/quoted-owned-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/quoted-owned-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, 'proto/quote".proto'), 'syntax = "proto3";\n');
    const moduleDirectory = join(model, "node_modules");
    mkdirSync(join(moduleDirectory, "@spine-event-engine"), { recursive: true });
    mkdirSync(join(moduleDirectory, "@bufbuild"), { recursive: true });
    symlinkSync(
      join(process.cwd(), "packages/proto"),
      join(moduleDirectory, "@spine-event-engine/proto"),
    );
    symlinkSync(
      join(process.cwd(), "packages/proto-tools/node_modules/@bufbuild/protobuf"),
      join(moduleDirectory, "@bufbuild/protobuf"),
    );

    generateModel(model, {
      runBuf: (_, output) => {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, 'quote"_pb.ts'), "export {};\n");
      },
    });

    const source = readFileSync(join(model, "src/generated/proto-module.ts"), "utf8");
    expect(source).toContain('from "./quote\\"_pb.js"');
    const checked = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "src/generated/proto-module.ts",
      ],
      { cwd: model, encoding: "utf8" },
    );
    expect(`${checked.stdout}${checked.stderr}`).toBe("");
    expect(checked.status).toBe(0);
  });

  it("uses a bounded injected Buf runner and labels timeout failures by package", () => {
    const model = packageDirectory("@example/runner-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/runner-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, "proto/model.proto"), 'syntax = "proto3"; message Model {}\n');
    const options: { timeout: number; maxBuffer: number }[] = [];
    expect(() => {
      generateModel(model, {
        runProcess: (_, arguments_, processOptions) => {
          options.push(processOptions);
          if (arguments_[0] === "generate")
            return {
              pid: 1,
              output: [],
              stdout: "",
              stderr: "",
              status: null,
              signal: null,
              error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
            };
          return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null };
        },
      });
    }).toThrow("spine-proto: @example/runner-model: Buf generation timed out");
    expect(options.map(({ timeout, maxBuffer }) => ({ timeout, maxBuffer }))).toEqual([
      { timeout: 300000, maxBuffer: 1048576 },
    ]);
  });

  it("rolls back generated output when staged manifest publication fails and removes its sibling stage", () => {
    const model = packageDirectory("@example/manifest-failure-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/manifest-failure-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, "proto/model.proto"), 'syntax = "proto3"; message Model {}\n');
    mkdirSync(join(model, "src/generated"), { recursive: true });
    writeFileSync(join(model, "src/generated/prior.ts"), "prior output\n");
    writeFileSync(join(model, "spine-proto-manifest.json"), "prior manifest\n");

    expect(() => {
      generateModel(model, {
        manifestOperations: {
          rename: () => {
            throw new Error("manifest rename failed");
          },
        },
      });
    }).toThrow("manifest rename failed");
    expect(readFileSync(join(model, "src/generated/prior.ts"), "utf8")).toBe("prior output\n");
    expect(readFileSync(join(model, "spine-proto-manifest.json"), "utf8")).toBe("prior manifest\n");
    expect(readdirSync(model).filter((name) => name.includes("spine-proto-manifest.json"))).toEqual(
      ["spine-proto-manifest.json"],
    );
  });

  it("leaves no generated output, manifest, backup, or stage when first manifest publication fails", () => {
    const model = packageDirectory("@example/first-manifest-failure-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/first-manifest-failure-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, "proto/model.proto"), 'syntax = "proto3"; message Model {}\n');

    expect(() => {
      generateModel(model, {
        manifestOperations: {
          rename: () => {
            throw new Error("manifest rename failed");
          },
        },
      });
    }).toThrow("manifest rename failed");
    expect(existsSync(join(model, "src/generated"))).toBe(false);
    expect(existsSync(join(model, "spine-proto-manifest.json"))).toBe(false);
    expect(readdirSync(join(model, "src")).filter((name) => name.includes("generated"))).toEqual(
      [],
    );
    expect(readdirSync(model).filter((name) => name.includes("spine-proto-manifest.json"))).toEqual(
      [],
    );
  });

  it("composes a deterministic registry source from configured top-level model modules", () => {
    const application = packageDirectory("@example/chat-application");
    writeJson(application, "package.json", {
      name: "@example/chat-application",
      version: "1.2.3",
      dependencies: {
        "@example/chat-model": "^1.2.3",
        "@example/users-model": "^1.2.3",
      },
    });
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@example/users-model", "@example/chat-model"],
      registryOutput: "src/model-registry.ts",
    });
    installModel(application, "@example/chat-model");
    installModel(application, "@example/users-model");

    composeApplication(application);

    expect(readFileSync(join(application, "src/model-registry.ts"), "utf8")).toBe(
      'import { TypeRegistry } from "@spine-event-engine/core";\n' +
        'import { modelProtoModule as model0 } from "@example/chat-model";\n' +
        'import { modelProtoModule as model1 } from "@example/users-model";\n\n' +
        "/** Registry of every model package declared by this application. */\n" +
        "export const typeRegistry: TypeRegistry = TypeRegistry.from(model0, model1);\n",
    );
  });

  it("composes scoped packages with identical leaves using deterministic collision-free aliases", () => {
    const application = packageDirectory("@example/application");
    writeJson(application, "package.json", {
      name: "@example/application",
      version: "1.2.3",
      dependencies: { "@a/users-model": "^1.2.3", "@b/users-model": "^1.2.3" },
    });
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@b/users-model", "@a/users-model"],
      registryOutput: "src/registry.ts",
    });
    installModel(application, "@a/users-model");
    installModel(application, "@b/users-model");

    composeApplication(application);

    expect(readFileSync(join(application, "src/registry.ts"), "utf8")).toContain(
      [
        'import { modelProtoModule as model0 } from "@a/users-model";\n',
        'import { modelProtoModule as model1 } from "@b/users-model";',
      ].join(""),
    );
  });
  it("composes through each installed manifest's declared module export and atomically replaces its output", () => {
    const application = packageDirectory("@example/application");
    writeJson(application, "package.json", {
      name: "@example/application",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@example/users-model"],
      registryOutput: "src/model-registry.ts",
    });
    const users = installModel(application, "@example/users-model");
    writeJson(users, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users.proto"],
      generatedExports: { "users.proto": "generated/users_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    mkdirSync(join(application, "src"), { recursive: true });
    writeFileSync(join(application, "src/model-registry.ts"), "old registry\n");

    composeApplication(application);

    expect(readFileSync(join(application, "src/model-registry.ts"), "utf8")).toContain(
      'import { usersProtoModule as model0 } from "@example/users-model";',
    );
    expect(
      readdirSync(join(application, "src")).filter((name) => name.includes("model-registry.ts")),
    ).toEqual(["model-registry.ts"]);
  });

  it("preserves a prior registry and removes its sibling stage on compose write and rename failures", () => {
    const application = packageDirectory("@example/application");
    writeJson(application, "package.json", { name: "@example/application", version: "1.2.3" });
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: [],
      registryOutput: "src/model-registry.ts",
    });
    mkdirSync(join(application, "src"), { recursive: true });
    const target = join(application, "src/model-registry.ts");
    writeFileSync(target, "prior registry\n");
    for (const failure of ["write", "rename"] as const) {
      expect(() => {
        composeApplication(application, {
          registryOperations: {
            writeFile: (stage, content) => {
              writeFileSync(stage, content);
              if (failure === "write") throw new Error("write failed");
            },
            rename: (stage, destination) => {
              if (failure === "rename") throw new Error("rename failed");
              renameSync(stage, destination);
            },
          },
        });
      }).toThrow(`${failure} failed`);
      expect(readFileSync(target, "utf8")).toBe("prior registry\n");
      expect(
        readdirSync(dirname(target)).filter((name) => name.includes("model-registry.ts")),
      ).toEqual(["model-registry.ts"]);
    }
  });

  it("stages model output beside its destination and never falls back to PATH for protoc-gen-es", () => {
    const model = packageDirectory("@example/staged-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/staged-model"));
    mkdirSync(join(model, "proto"), { recursive: true });
    writeFileSync(join(model, "proto/model.proto"), 'syntax = "proto3"; message Model {}\n');
    const previousPath = process.env.PATH;
    process.env.PATH = dirname(process.execPath);
    try {
      generateModel(model);
    } finally {
      process.env.PATH = previousPath;
    }
    expect(readdirSync(join(model, "src")).filter((name) => name.includes("generated"))).toEqual([
      "generated",
    ]);
    expect(readFileSync(join(model, "src/generated/model_pb.ts"), "utf8")).toContain("ModelSchema");
  });
  it("resolves nested installed dependencies dependency-first with canonical Proto ownership", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    installModel(chat, "@example/users-model", [], "users/v1/user.proto");

    expect(resolveModelGraph(application, ["@example/chat-model"])).toEqual({
      models: [
        {
          name: "@example/users-model",
          version: "1.2.3",
          moduleExport: "modelProtoModule",
          root: realpathSync(join(chat, "node_modules", "@example", "users-model")),
        },
        {
          name: "@example/chat-model",
          version: "1.2.3",
          moduleExport: "modelProtoModule",
          root: realpathSync(chat),
        },
      ],
      protoOwners: {
        "example-chat-model.proto": {
          packageName: "@example/chat-model",
          generatedExport: "generated/example-chat-model_pb.js",
        },
        "users/v1/user.proto": {
          packageName: "@example/users-model",
          generatedExport: "generated/users/v1/user_pb.js",
        },
      },
    });
  });

  it("resolves an exported non-root manifest and hoisted dependency from its requester context", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    const users = installModel(application, "@example/users-model", [], "users/v1/user.proto");
    mkdirSync(join(chat, "dist"));
    writeJson(chat, "dist/package.json", { type: "module" });
    renameSync(
      join(chat, "spine-proto-manifest.json"),
      join(chat, "dist", "spine-proto-manifest.json"),
    );
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
      exports: { "./spine-proto-manifest.json": "./dist/spine-proto-manifest.json" },
    });

    const graph = resolveModelGraph(application, ["@example/chat-model"]);
    expect(graph.models.map((model) => model.name)).toEqual([
      "@example/users-model",
      "@example/chat-model",
    ]);
    expect(graph.models[0]?.root).toBe(realpathSync(users));
    expect(graph.models[1]?.root).toBe(realpathSync(chat));

    writeJson(chat, "dist/package.json", { name: "@example/not-chat-model", type: "module" });
    expect(resolveModelGraph(application, ["@example/chat-model"]).models[1]?.root).toBe(
      realpathSync(chat),
    );
  });

  it("rejects more than 10,000 direct model roots before traversal allocation", () => {
    const application = packageDirectory("@example/application");
    expect(() =>
      resolveModelGraph(
        application,
        Array.from({ length: 10001 }, () => "@example/x"),
      ),
    ).toThrow("spine-proto: @example/application: model dependency graph exceeds 10000 packages");
  });

  it("rejects unsafe model package names before resolution or generation", () => {
    const application = packageDirectory("@example/application");
    for (const modelPackage of [
      "../outside",
      "/absolute",
      "@scope",
      "model\\path",
      "https://host/x",
    ]) {
      expect(() => resolveModelGraph(application, [modelPackage])).toThrow(
        `spine-proto: @example/application: model package ${modelPackage} must be a valid npm package name`,
      );
    }

    const model = packageDirectory("@example/model");
    writeJson(model, "spine-proto.json", modelConfig("@example/model", ["../../outside"]));
    expect(() => {
      generateModel(model);
    }).toThrow("spine-proto: @example/model: dependencies must be a valid npm package name");
    expect(existsSync(join(model, "src", "generated"))).toBe(false);

    writeJson(model, "package.json", { name: "../outside", version: "1.2.3" });
    expect(() => readConfig(model)).toThrow("package.json name must be a valid npm package name");
  });

  it("bounds config and manifest collection inputs before copying or sorting", () => {
    const application = packageDirectory("@example/bounded-application");
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: Array.from({ length: 10001 }, () => "@example/model"),
      registryOutput: "src/registry.ts",
    });
    expect(() => readConfig(application)).toThrow(
      "spine-proto: @example/bounded-application: modelPackages exceeds 10000 entries",
    );

    const model = packageDirectory("@example/bounded-model");
    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/bounded-model",
      packageVersion: "1.2.3",
      protoFiles: Array.from({ length: 10001 }, (_, index) => `proto/${String(index)}.proto`),
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/bounded-model: manifest protoFiles exceeds 10000 entries",
    );

    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/bounded-model",
      packageVersion: "1.2.3",
      protoFiles: [],
      generatedExports: Object.fromEntries(
        Array.from({ length: 10001 }, (_, index) => [
          `proto/${String(index)}.proto`,
          "generated/x.js",
        ]),
      ),
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/bounded-model: manifest generatedExports exceeds 10000 entries",
    );
  });

  it("bounds aggregate owned Proto paths while composing a model graph", () => {
    const application = packageDirectory("@example/path-budget-application");
    const dependency = installModel(application, "@example/path-budget-dependency");
    const root = installModel(application, "@example/path-budget-root", [
      "@example/path-budget-dependency",
    ]);
    const writeManifest = (
      directory: string,
      name: string,
      count: number,
      dependencies: string[],
      prefix: string,
    ) => {
      const protoFiles = Array.from(
        { length: count },
        (_, index) => `${prefix}/${String(index)}.proto`,
      );
      writeJson(directory, "spine-proto-manifest.json", {
        formatVersion: 1,
        packageName: name,
        packageVersion: "1.2.3",
        protoFiles,
        generatedExports: Object.fromEntries(
          protoFiles.map((protoFile) => [protoFile, `generated/${protoFile}.js`]),
        ),
        dependencies,
        moduleExport: "modelProtoModule",
      });
    };
    writeManifest(dependency, "@example/path-budget-dependency", 5001, [], "dependency");
    writeManifest(
      root,
      "@example/path-budget-root",
      5000,
      ["@example/path-budget-dependency"],
      "root",
    );

    expect(() => resolveModelGraph(application, ["@example/path-budget-root"])).toThrow(
      "spine-proto: @example/path-budget-root: resolved model graph exceeds 10000 owned Proto paths",
    );
  });

  it("rejects 10,001 raw manifest dependencies before normalization", () => {
    const directory = packageDirectory("@example/oversized-model");
    writeJson(directory, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/oversized-model",
      packageVersion: "1.2.3",
      protoFiles: [],
      generatedExports: {},
      dependencies: Array.from({ length: 10001 }, () => "@example/users-model"),
      moduleExport: "modelProtoModule",
    });

    expect(() => readManifest(directory)).toThrow(
      "spine-proto: @example/oversized-model: manifest dependencies exceeds 10000 entries",
    );
  });

  it("rejects a manifest whose direct dependencies exceed remaining scheduled work", () => {
    const application = packageDirectory("@example/application");
    const dependencies = Array.from(
      { length: 10000 },
      (_, index) => `@example/model-${String(index)}`,
    );
    const root = installModel(application, "@example/root-model", dependencies);
    writeJson(root, "package.json", {
      name: "@example/root-model",
      version: "1.2.3",
      dependencies: Object.fromEntries(dependencies.map((name) => [name, "^1.0.0"])),
      exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
    });
    expect(() => resolveModelGraph(application, ["@example/root-model"])).toThrow(
      "spine-proto: @example/root-model: model dependency graph exceeds 10000 scheduled dependency edges",
    );
  });

  it("rejects invalid installed graph dependencies and manifest ownership", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    installModel(chat, "@example/users-model");
    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "npm:not/a@^1.2.3" },
    });
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model must use a registry version",
    );

    writeJson(chat, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "^1.2.3" },
    });
    writeJson(join(chat, "node_modules", "@example", "users-model"), "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["example-chat-model.proto"],
      generatedExports: { "example-chat-model.proto": "generated/users_pb.js" },
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      "spine-proto: @example/chat-model: Proto path example-chat-model.proto is already owned by @example/users-model",
    );
  });

  it("rejects an installed dependency outside its requester-declared version range", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    const users = installModel(chat, "@example/users-model");
    writeJson(users, "package.json", {
      name: "@example/users-model",
      version: "2.0.0",
      exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
    });
    writeJson(users, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "2.0.0",
      protoFiles: ["users.proto"],
      generatedExports: { "users.proto": "generated/users_pb.js" },
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model version 2.0.0 does not satisfy ^1.2.3",
    );
  });

  it("applies zero-major caret, comparator, alias, and mutable-tag dependency specifiers", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    const users = installModel(chat, "@example/users-model");
    const setUsersVersion = (version: string): void => {
      writeJson(users, "package.json", {
        name: "@example/users-model",
        version,
        exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
      });
      writeJson(users, "spine-proto-manifest.json", {
        formatVersion: 1,
        packageName: "@example/users-model",
        packageVersion: version,
        protoFiles: ["users.proto"],
        generatedExports: { "users.proto": "generated/users_pb.js" },
        dependencies: [],
        moduleExport: "modelProtoModule",
      });
    };
    const setSpecifier = (specifier: string): void => {
      writeJson(chat, "package.json", {
        name: "@example/chat-model",
        version: "1.2.3",
        dependencies: { "@example/users-model": specifier },
        exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
      });
    };

    setSpecifier("^0.2.3");
    setUsersVersion("0.3.0");
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model version 0.3.0 does not satisfy ^0.2.3",
    );

    setSpecifier(">=1.2.3 <2.0.0");
    setUsersVersion("2.0.0");
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model version 2.0.0 does not satisfy >=1.2.3 <2.0.0",
    );
    setUsersVersion("1.7.0");
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).not.toThrow();

    setSpecifier("npm:@example/users-model@^1.2.3");
    setUsersVersion("2.0.0");
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
      [
        "spine-proto: @example/chat-model: dependency @example/users-model ",
        "version 2.0.0 does not satisfy npm:@example/users-model@^1.2.3",
      ].join(""),
    );

    setSpecifier("latest");
    expect(() => resolveModelGraph(application, ["@example/chat-model"])).not.toThrow();
  });

  it("rejects malformed ordinary and npm-alias dependency ranges as non-registry", () => {
    const application = packageDirectory("@example/application");
    const chat = installModel(application, "@example/chat-model", ["@example/users-model"]);
    installModel(chat, "@example/users-model");

    for (const specifier of ["1..2", "npm:@example/users-model@1..2"]) {
      writeJson(chat, "package.json", {
        name: "@example/chat-model",
        version: "1.2.3",
        dependencies: { "@example/users-model": specifier },
        exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
      });
      expect(() => resolveModelGraph(application, ["@example/chat-model"])).toThrow(
        "spine-proto: @example/chat-model: dependency @example/users-model must use a registry version",
      );
    }
  });

  it("rejects missing manifests, identity mismatches, cycles, and duplicate package roots", () => {
    const missing = packageDirectory("@example/missing-application");
    expect(() => resolveModelGraph(missing, ["@example/no-model"])).toThrow(
      "spine-proto: @example/no-model: cannot resolve manifest from",
    );

    const identity = packageDirectory("@example/identity-application");
    const identityModel = installModel(identity, "@example/identity-model");
    writeJson(identityModel, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/other-model",
      packageVersion: "1.2.3",
      protoFiles: [],
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => resolveModelGraph(identity, ["@example/identity-model"])).toThrow(
      "spine-proto: @example/identity-model: manifest packageName must match package.json name",
    );

    const cycle = packageDirectory("@example/cycle-application");
    const first = installModel(cycle, "@example/first-model", ["@example/second-model"]);
    const second = installModel(first, "@example/second-model", ["@example/first-model"]);
    writeJson(second, "package.json", {
      name: "@example/second-model",
      version: "1.2.3",
      dependencies: { "@example/first-model": "^1.2.3" },
    });
    expect(() => resolveModelGraph(cycle, ["@example/first-model"])).toThrow(
      "spine-proto: @example/first-model: dependency cycle",
    );

    const duplicates = packageDirectory("@example/duplicate-application");
    const left = installModel(duplicates, "@example/left-model", ["@example/shared-model"]);
    const right = installModel(duplicates, "@example/right-model", ["@example/shared-model"]);
    installModel(left, "@example/shared-model");
    installModel(right, "@example/shared-model");
    expect(() =>
      resolveModelGraph(duplicates, ["@example/left-model", "@example/right-model"]),
    ).toThrow(
      "spine-proto: @example/shared-model: package @example/shared-model resolves to multiple installed roots",
    );
  });
  it("creates a deterministic version-one manifest for a model package", () => {
    const directory = packageDirectory("@example/users-model");
    writeJson(directory, "spine-proto.json", modelConfig("@example/users-model"));

    expect(createManifest(directory, ["users/v1/user.proto", "users/v1/id.proto"])).toEqual({
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/v1/id.proto", "users/v1/user.proto"],
      generatedExports: {
        "users/v1/id.proto": "generated/users/v1/id_pb.js",
        "users/v1/user.proto": "generated/users/v1/user_pb.js",
      },
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
  });

  it("requires one exact mode and matching ordinary package identity", () => {
    const directory = packageDirectory("@example/users-model");
    writeJson(directory, "spine-proto.json", { ...modelConfig("@example/other"), mode: "invalid" });

    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/users-model: mode must be model or application",
    );

    writeJson(directory, "spine-proto.json", modelConfig("@example/other"));
    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/users-model: packageName must match package.json name",
    );

    writeJson(directory, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@example/users-model"],
      registryOutput: "src/registry.ts",
      protoRoot: "proto",
    });
    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/users-model: application mode must not declare protoRoot",
    );
  });

  it("rejects malformed configuration and manifest contracts before filesystem work", () => {
    const application = packageDirectory("@example/contract-application");
    writeJson(application, "spine-proto.json", {
      formatVersion: 2,
      mode: "application",
      modelPackages: [],
      registryOutput: "src/registry.ts",
    });
    expect(() => readConfig(application)).toThrow(
      "spine-proto: @example/contract-application: formatVersion must be 1",
    );

    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: "@example/model",
      registryOutput: "src/registry.ts",
    });
    expect(() => readConfig(application)).toThrow(
      "spine-proto: @example/contract-application: modelPackages must be an array of non-empty strings",
    );

    const model = packageDirectory("@example/contract-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/contract-model"));
    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 2,
      packageName: "@example/contract-model",
      packageVersion: "1.2.3",
      protoFiles: [],
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/contract-model: manifest formatVersion must be 1",
    );

    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/contract-model",
      packageVersion: "1.2.3",
      protoFiles: ["model.proto"],
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/contract-model: manifest generatedExports must map every proto file exactly once",
    );

    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/contract-model",
      packageVersion: "9.9.9",
      protoFiles: [],
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/contract-model: manifest packageVersion must match package.json version",
    );
  });

  it("distinguishes model-only and application-only operations and validates supplied ownership", () => {
    const application = packageDirectory("@example/operation-application");
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: [],
      registryOutput: "src/registry.ts",
    });
    expect(() => createManifest(application)).toThrow(
      "spine-proto: @example/operation-application: manifest requires model mode",
    );
    expect(() => {
      generateModel(application);
    }).toThrow("generate requires model mode");

    const model = packageDirectory("@example/operation-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/operation-model"));
    expect(() => {
      composeApplication(model);
    }).toThrow("compose requires application mode");
    expect(createManifest(model, ["id.proto"]).protoFiles).toEqual(["id.proto"]);
    expect(() => createManifest(model, ["id.proto", "id.proto"])).toThrow(
      "spine-proto: @example/operation-model: duplicate proto path",
    );
    expect(() =>
      createManifest(
        model,
        Array.from({ length: 10001 }, () => "id.proto"),
      ),
    ).toThrow("spine-proto: @example/operation-model: owned Proto paths exceeds 10000 entries");
  });

  it("keeps graph resolution idempotent for a repeated direct model root", () => {
    const application = packageDirectory("@example/repeated-root-application");
    installModel(application, "@example/repeated-root-model");
    expect(
      resolveModelGraph(application, [
        "@example/repeated-root-model",
        "@example/repeated-root-model",
      ]).models,
    ).toHaveLength(1);
  });

  it("rejects malformed JSON and value shapes at package boundaries", () => {
    const malformed = packageDirectory("@example/malformed-json");
    writeFileSync(join(malformed, "spine-proto.json"), "{");
    expect(() => readConfig(malformed)).toThrow(
      "spine-proto: @example/malformed-json: cannot read spine-proto.json",
    );

    const shape = packageDirectory("@example/shape-model");
    writeJson(shape, "spine-proto.json", "not an object");
    expect(() => readConfig(shape)).toThrow(
      "spine-proto: @example/shape-model: configuration must be an object",
    );

    writeJson(shape, "package.json", {
      name: "@example/shape-model",
      version: "1.2.3",
      dependencies: { "@example/dependency": 3 },
    });
    expect(() => readConfig(shape)).toThrow(
      "spine-proto: @example/shape-model: package.json dependencies must contain string versions",
    );

    const manifest = packageDirectory("@example/list-model");
    writeJson(manifest, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/list-model",
      packageVersion: "1.2.3",
      protoFiles: [""],
      generatedExports: {},
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(manifest)).toThrow(
      "spine-proto: @example/list-model: manifest protoFiles must be an array of non-empty strings",
    );
  });

  it("wraps non-Error generation failures after releasing its claim", () => {
    const model = packageDirectory("@example/non-error-generation");
    writeJson(model, "spine-proto.json", modelConfig("@example/non-error-generation"));
    mkdirSync(join(model, "proto"));
    writeFileSync(join(model, "proto", "model.proto"), 'syntax = "proto3"; message Model {}\n');

    expect(() => {
      generateModel(model, {
        runBuf: () => {
          throw Object.create(null);
        },
      });
    }).toThrow("spine-proto: @example/non-error-generation: generation failed");
    expect(readdirSync(model).some((name) => name.startsWith(".spine-proto-generate.lock."))).toBe(
      false,
    );
  });

  it("rejects normalized-path, empty-value, and missing-export configuration variants", () => {
    const model = packageDirectory("@example/validation-variants");
    writeJson(model, "spine-proto.json", {
      ...modelConfig("@example/validation-variants"),
      packageName: "",
    });
    expect(() => readConfig(model)).toThrow(
      "spine-proto: @example/validation-variants: packageName must be a non-empty string",
    );

    writeFileSync(
      join(model, "package.json"),
      JSON.stringify({ name: "@example/validation-variants", version: "1.2.3" }),
    );
    writeJson(model, "spine-proto.json", modelConfig("@example/validation-variants"));
    expect(() => readConfig(model)).toThrow("package.json exports must expose ./generated/*.js");

    writeJson(model, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/validation-variants",
      packageVersion: "1.2.3",
      protoFiles: ["nested//model.proto"],
      generatedExports: { "nested//model.proto": "generated/nested/model_pb.js" },
      dependencies: [],
      moduleExport: "modelProtoModule",
    });
    expect(() => readManifest(model)).toThrow(
      "spine-proto: @example/validation-variants: manifest protoFiles must be a normalized contained relative path",
    );
  });

  it("rejects malformed graph requester package metadata before resolution", () => {
    const requester = packageDirectory("@example/graph-metadata");
    writeFileSync(join(requester, "package.json"), "[]");
    expect(() => resolveModelGraph(requester, [])).toThrow("cannot read package.json");

    writeJson(requester, "package.json", { name: "InvalidName", version: "1.2.3" });
    expect(() => resolveModelGraph(requester, [])).toThrow(
      "package.json name must be a valid npm package name",
    );

    writeJson(requester, "package.json", {
      name: "@example/graph-metadata",
      version: "1.2.3",
      dependencies: [],
    });
    expect(() => resolveModelGraph(requester, [])).toThrow(
      "package.json dependencies must contain string versions",
    );
  });

  it("rejects invalid claim ownership and every bounded Buf failure result", () => {
    const claimModel = packageDirectory("@example/claim-variants");
    writeJson(claimModel, "spine-proto.json", modelConfig("@example/claim-variants"));
    mkdirSync(join(claimModel, "proto"));
    const malformedClaims = new Map<string, Claim>([
      [".spine-proto-generate.lock.invalid", { content: JSON.stringify({ pid: 0 }) }],
    ]);
    expect(() => {
      generateModel(claimModel, {
        runBuf: generatedOutput,
        lockOperations: claimOperations(malformedClaims),
      });
    }).toThrow("spine-proto: @example/claim-variants: generation claim has invalid owner metadata");

    const releaseClaims = new Map<string, Claim>();
    const operations = claimOperations(releaseClaims);
    expect(() => {
      generateModel(claimModel, {
        runBuf: generatedOutput,
        lockOperations: {
          ...operations,
          read: (path) => {
            const owner = JSON.parse(operations.read(path)) as { token?: string };
            return JSON.stringify({ ...owner, token: "replaced" });
          },
        },
      });
    }).toThrow("spine-proto: @example/claim-variants: cannot clean up generation lock");

    const failure = (
      name: string,
      result: "start" | "signal" | "no-status" | "status" | "stdout" | "missing",
    ) => {
      const model = packageDirectory(`@example/buf-${name}`);
      writeJson(model, "spine-proto.json", modelConfig(`@example/buf-${name}`));
      mkdirSync(join(model, "proto"));
      writeFileSync(join(model, "proto", "model.proto"), 'syntax = "proto3"; message Model {}\n');
      expect(() => {
        generateModel(model, {
          runProcess: () => {
            if (result === "start")
              return {
                pid: 1,
                output: [],
                stdout: "",
                stderr: "",
                status: null,
                signal: null,
                error: new Error("unavailable"),
              };
            if (result === "signal")
              return {
                pid: 1,
                output: [],
                stdout: "",
                stderr: "",
                status: null,
                signal: "SIGTERM",
              };
            if (result === "no-status")
              return { pid: 1, output: [], stdout: "", stderr: "", status: null, signal: null };
            if (result === "status")
              return { pid: 1, output: [], stdout: "", stderr: "failure", status: 1, signal: null };
            if (result === "stdout")
              return {
                pid: 1,
                output: [],
                stdout: "diagnostic",
                stderr: "",
                status: 1,
                signal: null,
              };
            return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null };
          },
        });
      }).toThrow(
        result === "start"
          ? "Buf generation could not start: unavailable"
          : result === "signal"
            ? "Buf generation ended by signal SIGTERM"
            : result === "no-status"
              ? "Buf generation ended without an exit status"
              : result === "status"
                ? "Buf generation failed: failure"
                : result === "stdout"
                  ? "Buf generation failed: diagnostic"
                  : "Buf generated no owned output",
      );
    };
    failure("start", "start");
    failure("signal", "signal");
    failure("no-status", "no-status");
    failure("status", "status");
    failure("stdout", "stdout");
    failure("missing", "missing");
  });

  it("canonicalizes exported Proto symlinks and rejects exported non-files", () => {
    const source = (kind: "symlink" | "directory") => {
      const model = packageDirectory(`@example/unsafe-${kind}-source`);
      const dependencyName = `@example/${kind}-source-dependency`;
      const dependency = installModel(model, dependencyName, [], "dependency.proto");
      mkdirSync(join(model, "proto"));
      writeFileSync(join(model, "proto", "model.proto"), 'syntax = "proto3"; message Model {}\n');
      mkdirSync(join(dependency, "proto"));
      writeFileSync(
        join(dependency, "proto", "dependency.proto"),
        'syntax = "proto3"; message Dependency {}\n',
      );
      if (kind === "symlink") {
        writeFileSync(join(dependency, "source.proto"), 'syntax = "proto3"; message Source {}\n');
        symlinkSync("source.proto", join(dependency, "exported.proto"));
      } else {
        mkdirSync(join(dependency, "exported.proto"));
      }
      writeJson(dependency, "package.json", {
        name: dependencyName,
        version: "1.2.3",
        exports: {
          "./spine-proto-manifest.json": "./spine-proto-manifest.json",
          "./proto/dependency.proto": "./exported.proto",
        },
      });
      writeJson(model, "package.json", {
        name: `@example/unsafe-${kind}-source`,
        version: "1.2.3",
        dependencies: { [dependencyName]: "^1.2.3" },
      });
      writeJson(
        model,
        "spine-proto.json",
        modelConfig(`@example/unsafe-${kind}-source`, [dependencyName]),
      );
      if (kind === "symlink") {
        generateModel(model, { runBuf: generatedOutput });
        return;
      }
      expect(() => {
        generateModel(model, { runBuf: generatedOutput });
      }).toThrow(
        `spine-proto: ${dependencyName}: cannot resolve exported Proto source dependency.proto`,
      );
    };
    source("symlink");
    source("directory");
  });

  it("rejects default live and non-regular claims, including release-time replacement", () => {
    const live = packageDirectory("@example/default-live-claim");
    writeJson(live, "spine-proto.json", modelConfig("@example/default-live-claim"));
    mkdirSync(join(live, "proto"));
    writeFileSync(
      join(live, `.spine-proto-generate.lock.${String(process.pid)}`),
      JSON.stringify({ pid: process.pid }),
    );
    expect(() => {
      generateModel(live, { runBuf: generatedOutput });
    }).toThrow("spine-proto: @example/default-live-claim: generation already in progress");

    const symlinked = packageDirectory("@example/symlink-claim");
    writeJson(symlinked, "spine-proto.json", modelConfig("@example/symlink-claim"));
    mkdirSync(join(symlinked, "proto"));
    symlinkSync("package.json", join(symlinked, ".spine-proto-generate.lock.link"));
    expect(() => {
      generateModel(symlinked, { runBuf: generatedOutput });
    }).toThrow("spine-proto: @example/symlink-claim: generation claim is not a regular file");

    const replacement = packageDirectory("@example/replaced-release-claim");
    writeJson(replacement, "spine-proto.json", modelConfig("@example/replaced-release-claim"));
    mkdirSync(join(replacement, "proto"));
    const claims = new Map<string, Claim>();
    const operations = claimOperations(claims);
    expect(() => {
      generateModel(replacement, {
        runBuf: generatedOutput,
        lockOperations: { ...operations, inspect: () => "other" },
      });
    }).toThrow("spine-proto: @example/replaced-release-claim: cannot clean up generation lock");
  });

  it("fails default cleanup when its own lock is replaced by a directory", () => {
    const model = packageDirectory("@example/default-directory-release");
    writeJson(model, "spine-proto.json", modelConfig("@example/default-directory-release"));
    mkdirSync(join(model, "proto"));
    expect(() => {
      generateModel(model, {
        runBuf: (_, output) => {
          generatedOutput("", output);
          const lock = readdirSync(model).find((name) =>
            name.startsWith(".spine-proto-generate.lock."),
          );
          if (lock === undefined) throw new Error("generation lock was not created");
          rmSync(join(model, lock));
          mkdirSync(join(model, lock));
        },
      });
    }).toThrow("spine-proto: @example/default-directory-release: cannot clean up generation lock");
    const replacedLock = readdirSync(model).find((name) =>
      name.startsWith(".spine-proto-generate.lock."),
    );
    expect(replacedLock).toBeDefined();
    if (replacedLock !== undefined)
      rmSync(join(model, replacedLock), { recursive: true, force: true });
  });

  it("preserves local and unknown generated imports while ignoring non-TypeScript output", () => {
    const model = packageDirectory("@example/local-generated-imports");
    writeJson(model, "spine-proto.json", modelConfig("@example/local-generated-imports"));
    mkdirSync(join(model, "proto"));
    writeFileSync(join(model, "proto", "model.proto"), 'syntax = "proto3"; message Model {}\n');
    writeFileSync(join(model, "proto", "other.proto"), 'syntax = "proto3"; message Other {}\n');

    generateModel(model, {
      runBuf: (_, output) => {
        mkdirSync(output, { recursive: true });
        writeFileSync(
          join(output, "model_pb.ts"),
          [
            'import {} from "./other_pb.js";',
            'import {} from "./unknown_pb.js";',
            "export {};",
            "",
          ].join("\n"),
        );
        writeFileSync(join(output, "generated.txt"), "not TypeScript\n");
      },
    });
    const generated = readFileSync(join(model, "src/generated/model_pb.ts"), "utf8");
    expect(generated).toContain('from "./other_pb.js"');
    expect(generated).toContain('from "./unknown_pb.js"');
    expect(readFileSync(join(model, "src/generated/generated.txt"), "utf8")).toBe(
      "not TypeScript\n",
    );
  });

  it("fails graph resolution when an exported manifest has no owning package metadata", () => {
    const application = packageDirectory("@example/owner-search-application");
    const model = installModel(application, "@example/owner-search-model");
    writeJson(model, "package.json", {
      name: "@example/different-model",
      version: "1.2.3",
      exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
    });
    expect(() => resolveModelGraph(application, ["@example/owner-search-model"])).toThrow(
      "spine-proto: @example/owner-search-model: cannot locate owning package.json",
    );
  });

  it("requires each installed manifest dependency to be declared by its owning package", () => {
    const application = packageDirectory("@example/graph-declaration-application");
    const model = installModel(application, "@example/graph-declaration-model", [
      "@example/missing-declaration",
    ]);
    writeJson(model, "package.json", {
      name: "@example/graph-declaration-model",
      version: "1.2.3",
      dependencies: {},
      exports: { "./spine-proto-manifest.json": "./spine-proto-manifest.json" },
    });
    expect(() => resolveModelGraph(application, ["@example/graph-declaration-model"])).toThrow(
      "spine-proto: @example/graph-declaration-model: dependency " +
        "@example/missing-declaration must be declared in package.json dependencies",
    );
  });

  it("requires model packages to export compiled generated schema subpaths", () => {
    const directory = packageDirectory("@example/export-model");
    writeJson(directory, "package.json", {
      name: "@example/export-model",
      version: "1.2.3",
      exports: {},
    });
    writeJson(directory, "spine-proto.json", modelConfig("@example/export-model"));

    expect(() => readConfig(directory)).toThrow(
      [
        "spine-proto: @example/export-model: package.json exports must expose ./generated/*.js",
        "with default ./dist/generated/*.js and types ./dist/generated/*.d.ts",
      ].join(" "),
    );
  });

  it("requires declared model dependencies to be ordinary npm dependencies", () => {
    const directory = packageDirectory("@example/chat-model");
    writeJson(
      directory,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );

    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model must be declared in package.json dependencies",
    );
  });

  it("requires model and application package names to be direct registry dependencies", () => {
    const directory = packageDirectory("@example/chat-model");
    writeJson(directory, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "workspace:*" },
    });
    writeJson(
      directory,
      "spine-proto.json",
      modelConfig("@example/chat-model", ["@example/users-model"]),
    );
    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/chat-model: dependency @example/users-model must use a registry version",
    );

    writeJson(directory, "package.json", {
      name: "@example/chat-model",
      version: "1.2.3",
      dependencies: { "@example/users-model": "file:../users-model" },
    });
    writeJson(directory, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@example/users-model"],
      registryOutput: "src/registry.ts",
    });
    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/chat-model: model package @example/users-model must use a registry version",
    );
  });

  it("allows only registry versions and npm aliases for model and application dependencies", () => {
    const invalidSpecifiers = [
      "link:../users-model",
      "portal:../users-model",
      "git+https://github.com/example/users-model.git",
      "git+ssh://git@github.com/example/users-model.git",
      "https://example.test/users-model.tgz",
      "example/users-model",
      "file:../users-model",
      "workspace:*",
      "/tmp/users-model",
      "../users-model",
    ];
    const validSpecifiers = [
      "^1.2.3",
      ">=1.2.3 <2.0.0",
      "latest",
      "npm:@example/users-model@^1.2.3",
    ];

    for (const mode of ["model", "application"] as const) {
      for (const [index, specifier] of validSpecifiers.entries()) {
        const suffix = String(index);
        const name = `@example/${mode}-${suffix}`;
        const directory = packageDirectory(name);
        writeJson(directory, "package.json", {
          name,
          version: "1.2.3",
          dependencies: { "@example/users-model": specifier },
        });
        writeJson(
          directory,
          "spine-proto.json",
          mode === "model"
            ? modelConfig(name, ["@example/users-model"])
            : {
                formatVersion: 1,
                mode,
                modelPackages: ["@example/users-model"],
                registryOutput: "src/registry.ts",
              },
        );
        expect(() => readConfig(directory)).not.toThrow();
      }

      for (const [index, specifier] of invalidSpecifiers.entries()) {
        const suffix = String(index);
        const name = `@example/${mode}-invalid-${suffix}`;
        const directory = packageDirectory(name);
        writeJson(directory, "package.json", {
          name,
          version: "1.2.3",
          dependencies: { "@example/users-model": specifier },
        });
        writeJson(
          directory,
          "spine-proto.json",
          mode === "model"
            ? modelConfig(name, ["@example/users-model"])
            : {
                formatVersion: 1,
                mode,
                modelPackages: ["@example/users-model"],
                registryOutput: "src/registry.ts",
              },
        );
        expect(() => readConfig(directory)).toThrow(
          [
            `spine-proto: ${name}: ${mode === "model" ? "dependency" : "model package"} `,
            "@example/users-model must use a registry version",
          ].join(""),
        );
      }
    }
  });

  it("rejects unsafe paths and symlink ancestors", () => {
    const directory = packageDirectory("@example/chat-model");
    writeJson(directory, "spine-proto.json", modelConfig("@example/chat-model"));
    expect(() => createManifest(directory, ["chat/../message.proto"])).toThrow(
      "spine-proto: @example/chat-model: proto path must not contain traversal",
    );
    expect(() => createManifest(directory, ["/tmp/message.proto"])).toThrow(
      "spine-proto: @example/chat-model: proto path must be relative",
    );

    const outside = mkdtempSync(join(tmpdir(), "spine-proto-outside-"));
    symlinkSync(outside, join(directory, "src"));
    expect(() => readConfig(directory)).toThrow(
      "spine-proto: @example/chat-model: generatedRoot must not pass through a symlink",
    );
  });

  it("rejects duplicate Proto ownership in a manifest", () => {
    const directory = packageDirectory("@example/users-model");
    writeJson(directory, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/id.proto", "users/id.proto"],
      generatedExports: { "users/id.proto": "/dist/generated/users/id_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });

    expect(() => readManifest(directory)).toThrow(
      "spine-proto: @example/users-model: manifest protoFiles must not contain duplicates",
    );
  });

  it("rejects unsafe generated export mappings in a manifest", () => {
    const directory = packageDirectory("@example/users-model");
    writeJson(directory, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/id.proto"],
      generatedExports: { "users/id.proto": "/generated/users/id_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    expect(() => readManifest(directory)).toThrow(
      "spine-proto: @example/users-model: manifest generated export for users/id.proto must be relative",
    );
  });

  it("rejects real and dangling symlink ancestors in manifest paths", () => {
    const directory = packageDirectory("@example/users-model");
    const outside = mkdtempSync(join(tmpdir(), "spine-proto-outside-"));
    symlinkSync(outside, join(directory, "users"));
    writeJson(directory, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/users-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/id.proto"],
      generatedExports: { "users/id.proto": "generated/users/id_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    expect(() => readManifest(directory)).toThrow(
      "spine-proto: @example/users-model: manifest protoFiles must not pass through a symlink",
    );

    const dangling = packageDirectory("@example/dangling-model");
    symlinkSync(join(outside, "missing"), join(dangling, "generated"));
    writeJson(dangling, "spine-proto-manifest.json", {
      formatVersion: 1,
      packageName: "@example/dangling-model",
      packageVersion: "1.2.3",
      protoFiles: ["users/id.proto"],
      generatedExports: { "users/id.proto": "generated/users/id_pb.js" },
      dependencies: [],
      moduleExport: "usersProtoModule",
    });
    expect(() => readManifest(dangling)).toThrow(
      [
        "spine-proto: @example/dangling-model: manifest generated export for ",
        "users/id.proto must not pass through a symlink",
      ].join(""),
    );
  });

  it("atomically replaces a manifest through a unique sibling staging file", () => {
    const directory = packageDirectory("@example/users-model");
    const target = join(directory, "spine-proto-manifest.json");
    writeFileSync(target, "old");
    const calls: string[] = [];
    writeManifestAtomically(target, "new", {
      writeFile: (staging, content) => {
        calls.push(`write:${staging}:${content}`);
        writeFileSync(staging, content);
      },
      rename: (staging, destination) => {
        calls.push(`rename:${staging}:${destination}`);
        renameSync(staging, destination);
      },
      remove: (staging) => calls.push(`remove:${staging}`),
    });
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(calls).toHaveLength(2);
    const [write] = calls;
    if (write === undefined) throw new Error("expected staging write");
    const [, staging] = write.split(":");
    if (staging === undefined) throw new Error("expected staging path");
    expect(staging).toMatch(new RegExp(`^${directory}/\\.spine-proto-manifest\\.json\\.`));
    expect(existsSync(staging)).toBe(false);
    expect(calls).toEqual([`write:${staging}:new`, `rename:${staging}:${target}`]);
  });

  it("preserves an existing manifest and removes its sibling staging file on a forced write failure", () => {
    const directory = packageDirectory("@example/users-model");
    const target = join(directory, "spine-proto-manifest.json");
    writeFileSync(target, "old");
    const calls: string[] = [];
    expect(() => {
      writeManifestAtomically(target, "new", {
        writeFile: (staging, content) => {
          calls.push(`write:${staging}`);
          writeFileSync(staging, content.slice(0, 1));
          throw new Error("forced write failure");
        },
        remove: (staging) => {
          calls.push(`remove:${staging}`);
          rmSync(staging, { force: true });
        },
      });
    }).toThrow("forced write failure");
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(calls).toHaveLength(2);
    const [write, remove] = calls;
    if (write === undefined || remove === undefined) throw new Error("expected staging cleanup");
    const staging = write.slice("write:".length);
    expect(remove).toBe(`remove:${staging}`);
    expect(existsSync(staging)).toBe(false);
  });

  it("preserves an existing manifest and removes its sibling staging file on a forced rename failure", () => {
    const directory = packageDirectory("@example/users-model");
    const target = join(directory, "spine-proto-manifest.json");
    writeFileSync(target, "old");
    const calls: string[] = [];
    expect(() => {
      writeManifestAtomically(target, "new", {
        writeFile: (staging, content) => {
          calls.push(`write:${staging}`);
          writeFileSync(staging, content);
        },
        rename: (staging, destination) => {
          calls.push(`rename:${staging}:${destination}`);
          throw new Error("forced rename failure");
        },
        remove: (staging) => {
          calls.push(`remove:${staging}`);
          rmSync(staging, { force: true });
        },
      });
    }).toThrow("forced rename failure");
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(calls).toHaveLength(3);
    const [write, , remove] = calls;
    if (write === undefined || remove === undefined) throw new Error("expected staging cleanup");
    const staging = write.slice("write:".length);
    expect(remove).toBe(`remove:${staging}`);
    expect(existsSync(staging)).toBe(false);
  });

  it("walks Proto files iteratively with labelled missing and depth failures", () => {
    const missing = packageDirectory("@example/missing-model");
    writeJson(missing, "spine-proto.json", modelConfig("@example/missing-model"));
    expect(() => createManifest(missing)).toThrow(
      "spine-proto: @example/missing-model: proto root is missing or inaccessible",
    );

    const deep = packageDirectory("@example/deep-model");
    writeJson(deep, "spine-proto.json", modelConfig("@example/deep-model"));
    let nested = join(deep, "proto");
    for (let level = 0; level <= 100; level += 1) {
      nested = join(nested, "nested");
      mkdirSync(nested, { recursive: true });
    }
    expect(() => createManifest(deep)).toThrow(
      "spine-proto: @example/deep-model: proto source exceeds 100 directory levels",
    );
  });

  it("labels inaccessible roots and rejects a 10,001st Proto file", () => {
    const inaccessible = packageDirectory("@example/inaccessible-model");
    const inaccessibleRoot = join(inaccessible, "proto");
    mkdirSync(inaccessibleRoot);
    chmodSync(inaccessibleRoot, 0o000);
    writeJson(inaccessible, "spine-proto.json", modelConfig("@example/inaccessible-model"));
    try {
      expect(() => createManifest(inaccessible)).toThrow(
        "spine-proto: @example/inaccessible-model: proto root is missing or inaccessible",
      );
    } finally {
      chmodSync(inaccessibleRoot, 0o755);
    }

    const large = packageDirectory("@example/large-model");
    const largeRoot = join(large, "proto");
    mkdirSync(largeRoot);
    writeJson(large, "spine-proto.json", modelConfig("@example/large-model"));
    for (let file = 0; file <= 10000; file += 1)
      writeFileSync(join(largeRoot, `${String(file)}.proto`), "");
    expect(() => createManifest(large)).toThrow(
      "spine-proto: @example/large-model: proto source exceeds 10000 entries",
    );
    let generationStarted = false;
    expect(() => {
      generateModel(large, {
        runBuf: () => {
          generationStarted = true;
        },
      });
    }).toThrow("spine-proto: @example/large-model: proto source exceeds 10000 entries");
    expect(generationStarted).toBe(false);
    expect(existsSync(join(large, "src"))).toBe(false);
  }, 120_000);

  it("bounds every encountered Proto-root entry before collecting non-Proto content", () => {
    const directory = packageDirectory("@example/non-proto-budget-model");
    const root = join(directory, "proto");
    mkdirSync(root);
    writeJson(directory, "spine-proto.json", modelConfig("@example/non-proto-budget-model"));
    for (let entry = 0; entry <= 10000; entry += 1)
      writeFileSync(join(root, `${String(entry)}.txt`), "");

    expect(() => createManifest(directory)).toThrow(
      "spine-proto: @example/non-proto-budget-model: proto source exceeds 10000 entries",
    );
  }, 120_000);

  it("rejects generation beyond the Proto directory-depth bound before staging", () => {
    const deep = packageDirectory("@example/deep-generation-model");
    writeJson(deep, "spine-proto.json", modelConfig("@example/deep-generation-model"));
    let nested = join(deep, "proto");
    for (let level = 0; level <= 100; level += 1) {
      nested = join(nested, "nested");
      mkdirSync(nested, { recursive: true });
    }
    let generationStarted = false;

    expect(() => {
      generateModel(deep, {
        runBuf: () => {
          generationStarted = true;
        },
      });
    }).toThrow(
      "spine-proto: @example/deep-generation-model: proto source exceeds 100 directory levels",
    );
    expect(generationStarted).toBe(false);
    expect(existsSync(join(deep, "src"))).toBe(false);
  });

  it("generates only Proto files and never stages non-Proto source content", () => {
    const model = packageDirectory("@example/proto-only-model");
    writeJson(model, "spine-proto.json", modelConfig("@example/proto-only-model"));
    mkdirSync(join(model, "proto/model/v1"), { recursive: true });
    writeFileSync(join(model, "proto/model/v1/value.proto"), 'syntax = "proto3";\n');
    writeFileSync(join(model, "proto/model/v1/notes.txt"), "not protobuf\n");
    writeFileSync(join(model, "proto/unrelated.json"), "{}\n");
    let staged: string[] = [];

    generateModel(model, {
      runBuf: (moduleRoot, output, owned) => {
        staged = readdirSync(join(moduleRoot, "model/v1"));
        expect(owned).toEqual(["model/v1/value.proto"]);
        mkdirSync(join(output, "model/v1"), { recursive: true });
        writeFileSync(join(output, "model/v1/value_pb.ts"), "export {};\n");
      },
    });

    expect(staged).toEqual(["value.proto"]);
    expect(existsSync(join(model, "src/generated/model/v1/notes.txt"))).toBe(false);
    expect(existsSync(join(model, "src/generated/unrelated.json"))).toBe(false);
  });

  it("rejects model generated roots that could overwrite metadata or Proto sources", () => {
    const directory = packageDirectory("@example/unsafe-model-output");
    for (const { generatedRoot, protoRoot = "proto" } of [
      { generatedRoot: "." },
      { generatedRoot: "package.json" },
      { generatedRoot: "spine-proto.json" },
      { generatedRoot: "spine-proto-manifest.json" },
      { generatedRoot: "proto" },
      { generatedRoot: "proto/generated" },
      { generatedRoot: "src", protoRoot: "src/proto" },
    ]) {
      writeJson(directory, "spine-proto.json", {
        ...modelConfig("@example/unsafe-model-output"),
        generatedRoot,
        protoRoot,
      });
      expect(() => readConfig(directory)).toThrow(
        "spine-proto: @example/unsafe-model-output: generatedRoot must not overlap protoRoot or package root",
      );
    }
  });

  it("rejects application registry outputs that could overwrite package metadata", () => {
    const directory = packageDirectory("@example/unsafe-application-output");
    for (const registryOutput of [
      ".",
      "package.json",
      "spine-proto.json",
      "spine-proto-manifest.json",
    ]) {
      writeJson(directory, "spine-proto.json", {
        formatVersion: 1,
        mode: "application",
        modelPackages: [],
        registryOutput,
      });
      expect(() => readConfig(directory)).toThrow(
        "spine-proto: @example/unsafe-application-output: registryOutput must name a safe source file",
      );
    }
  });

  it("rejects invalid and reserved local module-export bindings", () => {
    const directory = packageDirectory("@example/invalid-local-module-export");
    for (const moduleExport of ["not-valid", "class"]) {
      writeJson(directory, "spine-proto.json", {
        ...modelConfig("@example/invalid-local-module-export"),
        moduleExport,
      });
      expect(() => readConfig(directory)).toThrow(
        "spine-proto: @example/invalid-local-module-export: moduleExport must be a legal ESM binding identifier",
      );
    }
  });

  it("rejects invalid and reserved installed manifest module-export bindings before emission", () => {
    const application = packageDirectory("@example/manifest-binding-application");
    const model = installModel(application, "@example/manifest-binding-model");
    writeJson(application, "package.json", {
      name: "@example/manifest-binding-application",
      version: "1.2.3",
      dependencies: { "@example/manifest-binding-model": "^1.2.3" },
    });
    writeJson(application, "spine-proto.json", {
      formatVersion: 1,
      mode: "application",
      modelPackages: ["@example/manifest-binding-model"],
      registryOutput: "src/model-registry.ts",
    });
    for (const moduleExport of ["not-valid", "await"]) {
      writeJson(model, "spine-proto-manifest.json", {
        formatVersion: 1,
        packageName: "@example/manifest-binding-model",
        packageVersion: "1.2.3",
        protoFiles: [],
        generatedExports: {},
        dependencies: [],
        moduleExport,
      });
      expect(() => {
        composeApplication(application);
      }).toThrow(
        "spine-proto: @example/manifest-binding-model: manifest moduleExport must be a legal ESM binding identifier",
      );
      expect(existsSync(join(application, "src/model-registry.ts"))).toBe(false);
    }
  });
});
