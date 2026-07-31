import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  documentationSnippetFile,
  extractTypeScriptSnippets,
  runSnippetChecker,
} from "../docs/check-typescript-snippets.mjs";

const root = resolve(import.meta.dirname, "..");
const documentedPackageReadmes = [
  "packages/core/README.md",
  "packages/proto/README.md",
  "packages/storage/README.md",
  "packages/transport/README.md",
  "packages/storage-datastore/README.md",
  "packages/storage-rdbms/README.md",
  "packages/server/README.md",
  "packages/delivery-server/README.md",
  "packages/delivery-client/README.md",
  "packages/proto-tools/README.md",
  "packages/testing/README.md",
  "packages/auth/README.md",
  "packages/client-node/README.md",
  "packages/client-web/README.md",
  "packages/client-react/README.md",
];

describe("TypeScript documentation snippets", () => {
  it("extracts only TypeScript fences from a narrow Markdown fixture", () => {
    const source = [
      "```ts",
      "const answer: number = 42;",
      "```",
      "",
      "```sh",
      "echo 42",
      "```",
    ].join("\n");

    expect(extractTypeScriptSnippets(source)).toHaveLength(1);
    expect(extractTypeScriptSnippets(source)[0]?.[1]).toContain("answer");
  });

  it("covers every TypeScript fence in each documented package README", () => {
    for (const document of documentedPackageReadmes) {
      const source = readFileSync(resolve(root, document), "utf8");
      const snippets = extractTypeScriptSnippets(source);

      expect(snippets.length, document).toBeGreaterThan(0);
      expect(
        snippets.every((snippet) => snippet[1].trim().length > 0),
        document,
      ).toBe(true);
    }
  });

  it("keeps the Todo rejection companion in its stated source context", () => {
    const source = readFileSync(resolve(root, "packages/core/README.md"), "utf8");
    const rejectionSnippet = extractTypeScriptSnippets(source).find((snippet) =>
      snippet[1].includes("TaskAlreadyDone"),
    );

    expect(rejectionSnippet?.[1]).toContain("// docs-snippet-path: examples/todo/src/index.ts");
    expect(rejectionSnippet?.[1]).toContain("../generated/spine/examples/todo/task_rejections.js");
    expect(documentationSnippetFile("packages/core/README.md", "examples/todo/src/index.ts")).toBe(
      resolve(root, "examples/todo/src/index.ts"),
    );
  });

  it("rejects a missing declared snippet context with its README and path", () => {
    expect(() =>
      documentationSnippetFile("packages/core/README.md", "examples/todo/src/missing.ts"),
    ).toThrow("Missing docs-snippet-path in packages/core/README.md: examples/todo/src/missing.ts");
  });

  it("reports missing contexts through the executable checker loop", () => {
    const result = runSnippetChecker(["scripts/fixtures/missing-snippet-context.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "scripts/fixtures/missing-snippet-context.md:3: Missing docs-snippet-path in scripts/fixtures/missing-snippet-context.md: examples/todo/src/missing.ts",
    );
  });
});
