/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Schema } from "@bufbuild/protoplugin";
import { describe, expect, it } from "vitest";

import { AppQueryGenerator } from "../src/generation/app-query-generator.js";

function fixture(name = "issue_queries.proto", response = true): Schema {
  const query = { name: "Query", typeName: "example.issues.SummarizeTopIssues.Query" };
  const result = { name: "Response", typeName: "example.issues.SummarizeTopIssues.Response" };
  const operation = {
    name: "SummarizeTopIssues",
    typeName: "example.issues.SummarizeTopIssues",
    nestedMessages: response ? [query, result] : [query],
  };
  const printed: string[] = [];
  const generated: string[] = [];
  return {
    files: [{ name: "example/issues/issue_queries", proto: { name }, messages: [operation] }],
    generateFile: (path: string) => {
      generated.push(path);
      return {
        preamble: () => undefined,
        importShape: (message: { readonly name: string }) => `SummarizeTopIssues_${message.name}`,
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
      AppQueryGenerator.generate(fixture("issue_queries.proto", false));
    }).toThrow(/SummarizeTopIssues.*Response/u);
  });

  it("leaves neutral Proto files alone", () => {
    const schema = fixture("issue_messages.proto") as Schema & { generated: string[] };
    AppQueryGenerator.generate(schema);
    expect(schema.generated).toEqual([]);
  });
});
