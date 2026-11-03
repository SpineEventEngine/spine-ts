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

import type { Schema } from "@bufbuild/protoplugin";
import { describe, expect, it } from "vitest";

import { AppQueryGenerator } from "../src/generation/app-query-generator.js";

/**
 * Creates a top-level operation or helper descriptor for generator tests.
 *
 * @param name Top-level message name.
 * @param protoPackage Declaring Proto package.
 * @param nested Nested request/result messages to include.
 * @returns A descriptor with the selected nested messages.
 */
function operation(
  name = "SummarizeTopIssues",
  protoPackage = "example.issues",
  nested: readonly ("Query" | "Response")[] = ["Query", "Response"],
) {
  return {
    name,
    typeName: `${protoPackage}.${name}`,
    nestedMessages: nested.map((part) => ({
      name: part,
      typeName: `${protoPackage}.${name}.${part}`,
    })),
  };
}

/**
 * Captures generated companion files and their printed source for assertions.
 *
 * @param files Proto source files visible to the plugin.
 * @returns A minimal schema writer with captured output.
 */
function fixture(
  files: readonly {
    readonly name: string;
    readonly messages: readonly ReturnType<typeof operation>[];
  }[] = [{ name: "example/issues/issue_queries.proto", messages: [operation()] }],
): Schema {
  const printed: string[] = [];
  const generated: string[] = [];
  return {
    files: files.map(({ name, messages }) => ({
      name: name.replace(/\.proto$/u, ""),
      proto: { name },
      messages,
    })),
    generateFile: (path: string) => {
      generated.push(path);
      return {
        preamble: () => undefined,
        importShape: (message: { readonly name: string; readonly typeName: string }) =>
          `${message.typeName.split(".").at(-2) ?? ""}_${message.name}`,
        importSchema: (message: { readonly name: string }) =>
          `SummarizeTopIssues_${message.name}Schema`,
        print: (...parts: readonly string[]) => printed.push(parts.join("")),
      };
    },
    printed,
    generated,
  } as unknown as Schema;
}

describe("AppQueryGenerator", () => {
  it("groups the genuine generated Query/Response aliases and augments their literal type name", () => {
    const schema = fixture() as Schema & { printed: string[]; generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual(["example/issues/issue_queries_app_query.ts"]);
    const source = schema.printed.join("\n");
    expect(source).toContain("export namespace SummarizeTopIssues");
    expect(source).toContain("export type Query = SummarizeTopIssues_Query;");
    expect(source).toContain("export type Response = SummarizeTopIssues_Response;");
    expect(source).toContain(
      "export const querySchema: typeof SummarizeTopIssues_QuerySchema = SummarizeTopIssues_QuerySchema;",
    );
    expect(source).toContain(
      '"example.issues.SummarizeTopIssues.Query": SummarizeTopIssues_Response;',
    );
    expect(source).not.toContain("@spine-event-engine/server");
    expect(source).not.toContain("AppQueryHandler");
  });

  it("rejects an incomplete application query pair", () => {
    expect(() => {
      AppQueryGenerator.generate(
        fixture([
          {
            name: "example/issues/issue_queries.proto",
            messages: [operation("SummarizeTopIssues", "example.issues", ["Query"])],
          },
        ]),
      );
    }).toThrow(/SummarizeTopIssues.*Response/u);
  });

  it.each(["Query", "Response"] as const)(
    "rejects a top-level operation with only %s nested",
    (part) => {
      expect(() => {
        AppQueryGenerator.generate(
          fixture([
            {
              name: "example/issues/issue_queries.proto",
              messages: [operation("Partial", "example.issues", [part])],
            },
          ]),
        );
      }).toThrow(/example\.issues\.Partial.*Query and Response/u);
    },
  );

  it("emits both operations while leaving helper messages passive", () => {
    const schema = fixture([
      {
        name: "example/issues/issue_queries.proto",
        messages: [
          operation("First"),
          operation("Criteria", "example.issues", []),
          operation("Second"),
        ],
      },
    ]) as Schema & { printed: string[]; generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual(["example/issues/issue_queries_app_query.ts"]);
    const source = schema.printed.join("\n");
    expect(source).toContain("export namespace First");
    expect(source).toContain("export namespace Second");
    expect(source).not.toContain("export namespace Criteria");
    expect(source).toContain('"example.issues.First.Query": First_Response;');
    expect(source).toContain('"example.issues.Second.Query": Second_Response;');
  });

  it("does not emit a companion for a helper-only queries file", () => {
    const schema = fixture([
      {
        name: "example/issues/issue_queries.proto",
        messages: [operation("Criteria", "example.issues", [])],
      },
    ]) as Schema & { generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual([]);
  });

  it("keeps same-basename companions in separate folders and Proto packages", () => {
    const schema = fixture([
      { name: "issues/app_queries.proto", messages: [operation("Summary", "example.issues")] },
      { name: "projects/app_queries.proto", messages: [operation("Summary", "example.projects")] },
    ]) as Schema & { printed: string[]; generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual([
      "issues/app_queries_app_query.ts",
      "projects/app_queries_app_query.ts",
    ]);
    const source = schema.printed.join("\n");
    expect(source).toContain('"example.issues.Summary.Query": Summary_Response;');
    expect(source).toContain('"example.projects.Summary.Query": Summary_Response;');
  });

  it("leaves neutral Proto files alone", () => {
    const schema = fixture([
      { name: "example/issues/issue_messages.proto", messages: [operation()] },
    ]) as Schema & { generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual([]);
  });
});
