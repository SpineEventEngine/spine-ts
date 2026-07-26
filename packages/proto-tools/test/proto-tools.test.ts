import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeManifestAtomically } from "../src/atomic-manifest.js";
import { createManifest, readConfig, readManifest } from "../src/index.js";
import { resolveModelGraph } from "../src/model-graph.js";

function packageDirectory(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "spine-proto-tools-"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1.2.3" }));
  return directory;
}

function writeJson(directory: string, path: string, value: unknown): void {
  const target = join(directory, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
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

describe("spine proto model tooling", () => {
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
      "spine-proto: @example/chat-model: dependency @example/users-model version 2.0.0 does not satisfy npm:@example/users-model@^1.2.3",
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
          `spine-proto: ${name}: ${mode === "model" ? "dependency" : "model package"} @example/users-model must use a registry version`,
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
      "spine-proto: @example/dangling-model: manifest generated export for users/id.proto must not pass through a symlink",
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
      "spine-proto: @example/large-model: proto source exceeds 10000 files",
    );
  }, 120_000);
});
