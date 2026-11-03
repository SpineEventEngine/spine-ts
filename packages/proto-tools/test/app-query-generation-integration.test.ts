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

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { ProtoGeneration } from "../src/generation/generator.js";
import { HandlerGeneration } from "../src/generation/handler-generator.js";

const root = resolve(".");
const frameworkVersion = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { readonly version: string }
).version;

/**
 * Writes a temporary package source or configuration file.
 *
 * @param directory Temporary package directory.
 * @param path Path relative to that package.
 * @param source Source text to write.
 */
function write(directory: string, path: string, source: string): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

/**
 * Links a workspace dependency into a temporary package for real generation and compilation.
 *
 * @param directory Temporary package directory.
 * @param name Package import name.
 * @param source Existing package directory.
 */
function link(directory: string, name: string, source: string): void {
  const target = join(directory, "node_modules", ...name.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, "dir");
}

/**
 * Compiles generated and authored package TypeScript with NodeNext resolution.
 *
 * @param directory Package with a tsconfig.json and linked TypeScript.
 */
function compile(directory: string): void {
  try {
    execFileSync(
      process.execPath,
      [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      { cwd: directory, stdio: "pipe" },
    );
  } catch (error) {
    const failure = error as Error & { readonly stdout?: Buffer; readonly stderr?: Buffer };
    throw new Error(
      `${directory} compilation failed:\n${failure.stdout?.toString() ?? ""}${failure.stderr?.toString() ?? ""}`,
      { cause: error },
    );
  }
}

describe("real App Query generation", () => {
  it("keeps same-basename modules and full-type handler associations distinct", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "spine-app-query-generation-")));
    const model = join(temporary, "model");
    const application = join(temporary, "application");
    try {
      mkdirSync(model);
      mkdirSync(application);
      write(
        model,
        "package.json",
        JSON.stringify({
          name: "@example/mixed-query-model",
          version: "1.0.0",
          type: "module",
          dependencies: { "@spine-event-engine/core": frameworkVersion },
          exports: {
            "./spine-proto-manifest.json": "./spine-proto-manifest.json",
            "./generated/*.js": {
              types: "./dist/generated/*.d.ts",
              default: "./dist/generated/*.js",
            },
          },
        }),
      );
      write(
        model,
        "spine-proto.json",
        JSON.stringify({
          formatVersion: 1,
          mode: "model",
          packageName: "@example/mixed-query-model",
          protoRoot: "proto",
          generatedRoot: "src/generated",
          exportRoot: "generated",
          dependencies: [],
          moduleExport: "modelProtoModule",
        }),
      );
      write(
        model,
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2024",
            rootDir: "src",
            outDir: "dist",
            strict: true,
            skipLibCheck: true,
            declaration: true,
            paths: { "@spine-event-engine/core": [join(root, "packages/core/dist/index.d.ts")] },
          },
          include: ["src/**/*.ts"],
        }),
      );
      write(
        model,
        "proto/issues/app_queries.proto",
        [
          'syntax = "proto3";',
          "package example.issues;",
          "",
          "// Summarizes issue activity.",
          "message Summary {",
          "  // Selects the issue scope.",
          "  message Query {",
          "    // Scope to summarize.",
          "    string scope = 1;",
          "  }",
          "",
          "  // Returns the issue count.",
          "  message Response {",
          "    // Number of matching issues.",
          "    int32 count = 1;",
          "  }",
          "}",
          "",
          "// Lists recent issue identifiers.",
          "message Recent {",
          "  // Selects a recent issue page.",
          "  message Query {",
          "    // Maximum issue count.",
          "    int32 limit = 1;",
          "  }",
          "",
          "  // Returns a recent issue page.",
          "  message Response {",
          "    // Matching issue identifiers.",
          "    repeated string ids = 1;",
          "  }",
          "}",
          "",
          "// Reusable issue criteria, not an application operation.",
          "message IssueCriteria {",
          "  // Whether closed issues are included.",
          "  bool include_closed = 1;",
          "}",
          "",
        ].join("\n"),
      );
      write(
        model,
        "proto/projects/app_queries.proto",
        [
          'syntax = "proto3";',
          "package example.projects;",
          "",
          "// Summarizes project activity.",
          "message Summary {",
          "  // Selects the project scope.",
          "  message Query {",
          "    // Scope to summarize.",
          "    string scope = 1;",
          "  }",
          "",
          "  // Returns the project count.",
          "  message Response {",
          "    // Number of matching projects.",
          "    int32 count = 1;",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      write(
        model,
        "proto/helpers/filter_queries.proto",
        [
          'syntax = "proto3";',
          "package example.helpers;",
          "",
          "// Reusable filter input without an application operation.",
          "message FilterCriteria {",
          "  // Filter label.",
          "  string label = 1;",
          "}",
          "",
        ].join("\n"),
      );
      link(
        model,
        "@bufbuild/protobuf",
        join(root, "packages/proto-tools/node_modules/@bufbuild/protobuf"),
      );
      link(model, "@spine-event-engine/proto", join(root, "packages/proto"));
      link(model, "@spine-event-engine/core", join(root, "packages/core"));
      write(
        model,
        "src/core-contract.ts",
        [
          'import type { AppQueryResponses } from "@spine-event-engine/core";',
          "",
          "/** Response associations supplied by generated application query companions. */",
          "export type RegisteredResponses = AppQueryResponses;",
          "",
        ].join("\n"),
      );

      ProtoGeneration.generate(model);
      expect(existsSync(join(model, "src/generated/issues/app_queries_app_query.ts"))).toBe(true);
      expect(existsSync(join(model, "src/generated/projects/app_queries_app_query.ts"))).toBe(true);
      expect(existsSync(join(model, "src/generated/helpers/filter_queries_app_query.ts"))).toBe(
        false,
      );
      expect(existsSync(join(model, "src/generated/helpers/filter_queries_pb.ts"))).toBe(true);
      compile(model);

      const { modelProtoModule } = (await import(
        pathToFileURL(join(model, "dist/generated/proto-module.js")).href
      )) as unknown as {
        readonly modelProtoModule: { readonly schemas: readonly { readonly typeName: string }[] };
      };
      const names = modelProtoModule.schemas.map((schema) => schema.typeName);
      for (const name of [
        "example.issues.Summary.Query",
        "example.issues.Summary.Response",
        "example.issues.Recent.Query",
        "example.issues.Recent.Response",
        "example.issues.IssueCriteria",
        "example.projects.Summary.Query",
        "example.projects.Summary.Response",
        "example.helpers.FilterCriteria",
      ])
        expect(names).toContain(name);
      expect(names.filter((name: string) => name.endsWith("Summary.Query"))).toHaveLength(2);
      const { TypeRegistry } = (await import(
        pathToFileURL(join(root, "packages/core/dist/index.js")).href
      )) as unknown as {
        readonly TypeRegistry: {
          from(module: unknown): {
            findByFullName(name: string): { readonly fullTypeName: string } | undefined;
          };
        };
      };
      const registry = TypeRegistry.from(modelProtoModule);
      for (const name of names) expect(registry.findByFullName(name)?.fullTypeName).toBe(name);

      write(
        application,
        "package.json",
        JSON.stringify({
          name: "@example/mixed-query-application",
          version: "1.0.0",
          type: "module",
          dependencies: { "@example/mixed-query-model": "1.0.0" },
        }),
      );
      write(
        application,
        "spine-proto.json",
        JSON.stringify({
          formatVersion: 1,
          mode: "application",
          modelPackages: ["@example/mixed-query-model"],
          registryOutput: "generated/spine-metadata.ts",
        }),
      );
      write(
        application,
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2024",
            rootDir: ".",
            outDir: "dist",
            strict: true,
            skipLibCheck: true,
            paths: { "@spine-event-engine/core": [join(root, "packages/core/dist/index.d.ts")] },
          },
          include: ["src/**/*.ts", "generated/**/*.ts"],
        }),
      );
      write(
        application,
        "src/handlers.ts",
        [
          'import { AppQueryHandler } from "@spine-event-engine/server";',
          "import { Summary as IssueSummary, Recent } from " +
            '"@example/mixed-query-model/generated/issues/app_queries_app_query.js";',
          "import { Summary as ProjectSummary } from " +
            '"@example/mixed-query-model/generated/projects/app_queries_app_query.js";',
          "",
          "/** Handles issue summary requests. */",
          "export class IssueSummaryHandler extends AppQueryHandler<IssueSummary.Query, IssueSummary.Response> {",
          "  /**",
          "   * Computes an issue summary.",
          "   * @param query Issue scope.",
          "   * @returns Matching issue count.",
          "   */",
          "  execute(query: IssueSummary.Query): IssueSummary.Response { throw Error(String(query)); }",
          "}",
          "",
          "/** Handles recent issue requests. */",
          "export class RecentIssuesHandler extends AppQueryHandler<Recent.Query, Recent.Response> {",
          "  /**",
          "   * Lists recent issues.",
          "   * @param query Page limit.",
          "   * @returns Matching issue identifiers.",
          "   */",
          "  execute(query: Recent.Query): Recent.Response { throw Error(String(query)); }",
          "}",
          "",
          "/** Handles project summary requests. */",
          "export class ProjectSummaryHandler extends AppQueryHandler<ProjectSummary.Query, ProjectSummary.Response> {",
          "  /**",
          "   * Computes a project summary.",
          "   * @param query Project scope.",
          "   * @returns Matching project count.",
          "   */",
          "  execute(query: ProjectSummary.Query): ProjectSummary.Response { throw Error(String(query)); }",
          "}",
          "",
        ].join("\n"),
      );
      link(application, "@example/mixed-query-model", model);
      link(
        application,
        "@bufbuild/protobuf",
        join(root, "packages/proto-tools/node_modules/@bufbuild/protobuf"),
      );
      link(application, "@spine-event-engine/proto", join(root, "packages/proto"));
      link(application, "@spine-event-engine/core", join(root, "packages/core"));
      link(application, "@spine-event-engine/server", join(root, "packages/server"));

      HandlerGeneration.generate(application);
      compile(application);
      const { spineMetadata } = (await import(
        pathToFileURL(join(application, "dist/generated/spine-metadata.js")).href
      )) as unknown as {
        readonly spineMetadata: {
          readonly appQueries: readonly {
            readonly queryTypeName: string;
            readonly responseSchema: { readonly typeName: string };
            readonly handlerType: { readonly name: string };
          }[];
        };
      };
      expect(
        spineMetadata.appQueries.map(
          (query: { readonly queryTypeName: string }) => query.queryTypeName,
        ),
      ).toEqual([
        "example.issues.Summary.Query",
        "example.issues.Recent.Query",
        "example.projects.Summary.Query",
      ]);
      expect(
        spineMetadata.appQueries.map(
          (query: { readonly responseSchema: { readonly typeName: string } }) =>
            query.responseSchema.typeName,
        ),
      ).toEqual([
        "example.issues.Summary.Response",
        "example.issues.Recent.Response",
        "example.projects.Summary.Response",
      ]);
      expect(
        spineMetadata.appQueries.map(
          (query: { readonly handlerType: { readonly name: string } }) => query.handlerType.name,
        ),
      ).toEqual(["IssueSummaryHandler", "RecentIssuesHandler", "ProjectSummaryHandler"]);
      const generated = readFileSync(join(application, "generated/spine-metadata.ts"), "utf8");
      expect(generated).toContain("issues/app_queries_pb.js");
      expect(generated).toContain("projects/app_queries_pb.js");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
