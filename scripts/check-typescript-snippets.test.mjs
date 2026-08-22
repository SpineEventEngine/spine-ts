import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COPYRIGHT_HEADER } from "./check-copyright.mjs";
import {
  checkTypeScriptSnippets,
  documentationSnippetFile,
  documentedTypeScriptPaths,
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
const beginnerPackageReadmes = [
  "packages/proto/README.md",
  "packages/core/README.md",
  "packages/transport/README.md",
  "packages/storage/README.md",
  "packages/testing/README.md",
  "packages/delivery-client/README.md",
  "packages/delivery-server/README.md",
  "packages/storage-datastore/README.md",
  "packages/storage-rdbms/README.md",
  "packages/deployment/README.md",
];

describe("TypeScript documentation snippets", () => {
  it("uses the complete Wave 10 document list", () => {
    expect(documentedTypeScriptPaths).toEqual([
      "README.md",
      "REFERENCE.md",
      "packages/core/README.md",
      "packages/core/REFERENCE.md",
      "packages/proto/README.md",
      "packages/proto/REFERENCE.md",
      "packages/proto-tools/README.md",
      "packages/proto-tools/REFERENCE.md",
      "packages/server/README.md",
      "packages/server/REFERENCE.md",
      "packages/testing/README.md",
      "packages/testing/REFERENCE.md",
      "packages/transport/README.md",
      "packages/transport/REFERENCE.md",
      "packages/proto/proto/README.md",
      "examples/todo/README.md",
      "examples/todo/REFERENCE.md",
      "examples/todo/USER_GUIDE.md",
      "packages/auth/README.md",
      "packages/auth/REFERENCE.md",
      "packages/client-node/README.md",
      "packages/client-node/REFERENCE.md",
      "packages/client-react/README.md",
      "packages/client-react/REFERENCE.md",
      "packages/client-web/README.md",
      "packages/client-web/REFERENCE.md",
      "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md",
      "examples/message-board/README.md",
      "examples/message-board/REFERENCE.md",
      "examples/message-board/app/README.md",
      "examples/message-board/app/REFERENCE.md",
      "examples/message-board/model/README.md",
      "examples/message-board/model/REFERENCE.md",
      "examples/message-board/web/README.md",
      "examples/message-board/web/REFERENCE.md",
      "examples/message-board/deploy/README.md",
      "examples/message-board/deploy/REFERENCE.md",
      "examples/message-board/deploy/container/README.md",
      "packages/storage/README.md",
      "packages/storage/REFERENCE.md",
      "packages/storage-rdbms/README.md",
      "packages/storage-rdbms/REFERENCE.md",
      "packages/storage-datastore/README.md",
      "packages/storage-datastore/REFERENCE.md",
      "examples/orders/README.md",
      "examples/orders/REFERENCE.md",
      "examples/projects/README.md",
      "examples/projects/REFERENCE.md",
      "packages/delivery-client/README.md",
      "packages/delivery-client/REFERENCE.md",
      "packages/delivery-server/README.md",
      "packages/delivery-server/REFERENCE.md",
      "packages/deployment/README.md",
      "packages/deployment/REFERENCE.md",
      "packages/deployment-gce/README.md",
      "packages/deployment-gce/REFERENCE.md",
      "packages/deployment-gke/README.md",
      "packages/deployment-gke/REFERENCE.md",
      "examples/distributed-message-board/README.md",
      "examples/distributed-message-board/REFERENCE.md",
      "interop/envoy/README.md",
      "docs/api/README.md",
      "docs/architecture/README.md",
      "docs/USER_GUIDE.md",
    ]);
  });

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

  it("keeps every TypeScript fence in documented package READMEs nonempty", () => {
    for (const document of documentedPackageReadmes) {
      const source = readFileSync(resolve(root, document), "utf8");
      const snippets = extractTypeScriptSnippets(source);

      expect(
        snippets.every((snippet) => snippet[1].trim().length > 0),
        document,
      ).toBe(true);
    }
  });

  it("keeps owned package README snippet contexts hidden and beginner entry points explicit", () => {
    for (const document of beginnerPackageReadmes) {
      const source = readFileSync(resolve(root, document), "utf8");

      expect(source, document).not.toMatch(/```(?:ts|typescript)\s*\n\s*\/\/ docs-snippet-path:/iu);
      expect(source, document).toMatch(/\]\(REFERENCE\.md\)/u);
      expect(source, document).toMatch(/@spine-event-engine\/[\w-]+@snapshot/u);
      expect(source, document).toMatch(/experimental snapshot/iu);
    }
  });

  it("does not direct public consumers to an unpublished snapshot version", () => {
    for (const document of [
      "README.md",
      ...documentedPackageReadmes,
      "docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md",
    ]) {
      const source = readFileSync(resolve(root, document), "utf8");
      expect(source, document).not.toMatch(/(?:pnpm add|npm install)[^\n]*@2\.0\.0-snapshot\.3/u);
    }
  });

  it("puts each Wave 14 package install and connected first success before workspace guidance", () => {
    for (const document of [
      "packages/core/README.md",
      "packages/proto/README.md",
      "packages/storage/README.md",
      "packages/testing/README.md",
    ]) {
      const source = readFileSync(resolve(root, document), "utf8");
      const install = source.search(
        new RegExp(`pnpm add(?: -D)? @spine-event-engine/${document.split("/")[1]}@snapshot`, "u"),
      );
      const workspace = source.indexOf("pnpm typecheck:build");
      const firstSuccess = source.indexOf(
        document === "packages/testing/README.md" ? "## ✅" : "## Install",
      );

      expect(install, `${document} needs an external install command`).toBeGreaterThan(-1);
      expect(firstSuccess, `${document} needs a first-success section`).toBeGreaterThan(-1);
      if (workspace >= 0) {
        expect(install, `${document} install must precede workspace guidance`).toBeLessThan(
          workspace,
        );
        expect(firstSuccess, `${document} success must precede workspace guidance`).toBeLessThan(
          workspace,
        );
      }
    }

    const testing = readFileSync(resolve(root, "packages/testing/README.md"), "utf8");
    expect(testing).toContain("const box = await BlackBox.from(");
    expect(testing).toContain("const acknowledgement = await scope.post(");
    expect(testing).toContain('acknowledgement.kind !== "ok"');
    expect(testing).not.toContain("declare const box: BlackBox;");
  });

  it("keeps source-linked beginner snippets free of source copyright headers", () => {
    const snippets = [
      [
        "packages/client-react/README.md",
        "examples/message-board/web/src/docs/client-react-provider-query.ts",
      ],
      [
        "packages/client-react/README.md",
        "examples/message-board/web/src/docs/client-react-subscription.ts",
      ],
      [
        "packages/client-web/README.md",
        "examples/message-board/web/src/docs/client-web-create-client.ts",
      ],
      [
        "packages/client-web/README.md",
        "examples/message-board/web/src/docs/client-web-request-subscription.ts",
      ],
      ["examples/todo/README.md", "examples/todo/src/docs/create-task.ts"],
      ["examples/todo/USER_GUIDE.md", "examples/todo/src/docs/routing.ts"],
    ];

    for (const [document, sourcePath] of snippets) {
      const source = readFileSync(resolve(root, sourcePath), "utf8");
      const markdown = readFileSync(resolve(root, document), "utf8");
      const matchingSnippet = extractTypeScriptSnippets(markdown).find((snippet) =>
        markdown.slice(0, snippet.index).endsWith(`<!-- docs-snippet-path: ${sourcePath} -->\n\n`),
      );

      expect(source.startsWith(COPYRIGHT_HEADER), sourcePath).toBe(true);
      expect(matchingSnippet, `${document}: ${sourcePath}`).toBeDefined();
      expect(matchingSnippet?.[1], `${document}: ${sourcePath}`).not.toContain("Copyright");
    }
  });

  it("keeps the Todo introduction fence as executable domain behavior", () => {
    const source = readFileSync(resolve(root, "examples/todo/README.md"), "utf8");
    const snippet = extractTypeScriptSnippets(source).find((entry) =>
      entry[1].includes("TaskCreatedSchema"),
    );

    expect(snippet?.[1]).toContain("function createTask");
    expect(snippet?.[1]).not.toContain("unknown as");
    expect(snippet?.[1]).not.toContain("undefined as");
  });

  it("keeps the Todo interface-routing journey source-linked and current", () => {
    const guide = readFileSync(resolve(root, "examples/todo/USER_GUIDE.md"), "utf8");
    const frameworkGuide = readFileSync(resolve(root, "docs/USER_GUIDE.md"), "utf8");
    const protoReference = readFileSync(resolve(root, "packages/proto/REFERENCE.md"), "utf8");
    const toolsReference = readFileSync(resolve(root, "packages/proto-tools/REFERENCE.md"), "utf8");
    const rootReadme = readFileSync(resolve(root, "README.md"), "utf8");
    const architecture = readFileSync(resolve(root, "docs/architecture/README.md"), "utf8");

    expect(guide).toContain('option (every_is).ts_type = "TaskEvent";');
    expect(guide).toContain('option (is).ts_type = "TaskAssignmentEvent";');
    expect(guide).toContain("<!-- docs-snippet-path: examples/todo/src/docs/routing.ts -->");
    expect(guide).toContain("TaskReassigned");
    expect(guide).toContain("zero, one, and two");
    expect(guide).toContain(
      "replays a persisted projection Inbox target without rerouting after restart",
    );
    expect(guide).toContain("catchUpReadSide()");
    expect(frameworkGuide).toMatch(/first registered\s+matching token/u);
    expect(frameworkGuide).toContain("stored typed targets");
    expect(protoReference).toContain("top-level named export");
    expect(protoReference).toContain("realpath");
    expect(toolsReference).toContain("top-level named export");
    for (const text of [guide, protoReference, toolsReference]) {
      expect(text).toMatch(/requested authored\s+interface[\s\S]{0,160}top-level named export/iu);
      expect(text).toMatch(/extends` parents[\s\S]{0,120}same model module/u);
      expect(text).toMatch(/(?:need not be|do not need to be)\s+top-level named exports/u);
    }
    expect(rootReadme).toContain("Cloud Run and multiple Gateways are not included");
    expect(architecture).toMatch(
      /Cloud Run and multiple\s+Gateways are outside this deployment model/u,
    );
  });

  it("keeps the Todo rejection companion in its stated source context", () => {
    const source = readFileSync(resolve(root, "packages/core/README.md"), "utf8");
    const rejectionSnippet = extractTypeScriptSnippets(source).find((snippet) =>
      snippet[1].includes("TaskAlreadyDone"),
    );

    expect(source).toContain("<!-- docs-snippet-path: examples/todo/src/index.ts -->");
    expect(rejectionSnippet?.[1]).not.toContain("docs-snippet-path");
    expect(rejectionSnippet?.[1]).toContain("../generated/spine/examples/todo/task_rejections.js");
    expect(documentationSnippetFile("packages/core/README.md", "examples/todo/src/index.ts")).toBe(
      resolve(root, "examples/todo/src/index.ts"),
    );
  });

  it("uses a hidden HTML directive immediately before a TypeScript fence as its source context", () => {
    expect(checkTypeScriptSnippets(["scripts/fixtures/hidden-snippet-context.md"])).toEqual([]);
  });

  it("rejects a visible in-fence snippet control", () => {
    const result = runSnippetChecker(["scripts/fixtures/visible-snippet-context.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "scripts/fixtures/visible-snippet-context.md:3: docs-snippet-path must be a hidden HTML directive immediately before a TypeScript fence.",
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
      "scripts/fixtures/missing-snippet-context.md:4: Missing docs-snippet-path in scripts/fixtures/missing-snippet-context.md: examples/todo/src/missing.ts",
    );
  });

  it("reports explicit missing documents in sorted deterministic diagnostics", () => {
    const result = runSnippetChecker([
      "scripts/fixtures/z-missing-snippet-document.md",
      "scripts/fixtures/a-missing-snippet-document.md",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toEqual([
      "scripts/fixtures/a-missing-snippet-document.md:1: Missing document.",
      "scripts/fixtures/z-missing-snippet-document.md:1: Missing document.",
    ]);
  });

  it("keeps the missing-context fixture diagnostic free of import stubs", () => {
    const diagnostics = checkTypeScriptSnippets(["scripts/fixtures/missing-snippet-context.md"]);

    expect(diagnostics).toEqual([
      {
        document: "scripts/fixtures/missing-snippet-context.md",
        line: 4,
        message:
          "Missing docs-snippet-path in scripts/fixtures/missing-snippet-context.md: examples/todo/src/missing.ts",
      },
    ]);
    expect(readFileSync(resolve(root, "docs/check-typescript-snippets.mjs"), "utf8")).not.toContain(
      "export const ${name}: any",
    );
  });

  it("accepts a source-context import from a real built declaration", () => {
    expect(
      checkTypeScriptSnippets(["scripts/fixtures/valid-built-declaration-snippet.md"]),
    ).toEqual([]);
  });

  it("reports invalid built declaration exports in deterministic order", () => {
    expect(
      checkTypeScriptSnippets([
        "scripts/fixtures/z-missing-snippet-document.md",
        "scripts/fixtures/invalid-built-declaration-snippet.md",
      ]),
    ).toEqual([
      {
        document: "scripts/fixtures/invalid-built-declaration-snippet.md",
        line: 4,
        message:
          "Module '\"@spine-event-engine/core\"' has no exported member 'MissingCoreExport'.",
      },
      {
        document: "scripts/fixtures/z-missing-snippet-document.md",
        line: 1,
        message: "Missing document.",
      },
    ]);
  });
});
