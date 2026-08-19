import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

const familyPackages = [
  ["app", "@spine-event-engine/example-message-board-app"],
  ["model", "@spine-event-engine/example-message-board-model"],
  ["web", "@spine-event-engine/example-message-board-web"],
];

describe("MessageBoard family workspace migration", () => {
  it("discovers the nested MessageBoard packages without retaining their former top-level paths", () => {
    const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const references = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")).references;
    const vitestConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");
    const eslintConfig = readFileSync(join(root, "eslint.config.mjs"), "utf8");
    const protoWorkflow = readFileSync(join(root, "scripts/proto-workflow.mjs"), "utf8");
    const eslintTypeScript = readFileSync(join(root, "tsconfig.eslint.json"), "utf8");
    const browserHarness = readFileSync(
      join(root, "examples/message-board/web/test/interop/harness.mjs"),
      "utf8",
    );
    const browserTypeScript = readFileSync(
      join(root, "examples/message-board/web/test/browser/tsconfig.json"),
      "utf8",
    );
    const interopBrowserTypeScript = readFileSync(
      join(root, "examples/message-board/web/test/interop/browser/tsconfig.json"),
      "utf8",
    );
    const familyReadme = readFileSync(join(root, "examples/message-board/README.md"), "utf8");

    expect(workspace).toContain('  - "examples/*/*"');
    expect(workspace).not.toContain('  - "examples/**"');
    expect(vitestConfig).toContain('"examples/*/*/test/**/*.test.ts"');
    expect(vitestConfig).toContain('"examples/*/*/test/**/*.test.tsx"');
    expect(vitestConfig).toContain('"examples/*/*/src/**/*.ts"');
    expect(vitestConfig).toContain('"examples/*/*/src/**/*.tsx"');
    expect(eslintTypeScript).toContain('"examples/*/*/src/**/*.ts"');
    expect(eslintTypeScript).toContain('"examples/*/*/test/**/*.ts"');
    expect(eslintConfig).toContain('"examples/*/*/generated/**"');
    expect(protoWorkflow).toContain('join(root, "examples/message-board/app")');
    expect(protoWorkflow).toContain(
      'join(root, "examples/message-board/app/src/model-registry.ts")',
    );
    expect(protoWorkflow).not.toContain(
      'join(root, "examples/message-board/src/model-registry.ts")',
    );
    expect(browserHarness).toContain('from "../../../../../interop/envoy/render.mjs"');
    expect(browserTypeScript).toContain('"extends": "../../../../../tsconfig.base.json"');
    expect(interopBrowserTypeScript).toContain('"extends": "../../../../../../tsconfig.base.json"');
    expect(familyReadme).not.toContain("BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md");
    expect(familyReadme).toContain("[deployment guide](deploy/README.md)");
    expect(familyReadme).toContain("Proto model is shared by the Node application and React UI");
    expect(references.map(({ path }) => path)).toEqual(
      expect.arrayContaining(
        familyPackages.map(([directory]) => `./examples/message-board/${directory}`),
      ),
    );

    for (const [directory, packageName] of familyPackages) {
      const packagePath = join(root, "examples/message-board", directory, "package.json");
      expect(existsSync(packagePath)).toBe(true);
      expect(JSON.parse(readFileSync(packagePath, "utf8")).name).toBe(packageName);
    }

    expect(existsSync(join(root, "examples/message-board/users-model"))).toBe(false);

    for (const legacyPath of [
      "examples/message-board-model",
      "examples/message-board-web",
      "examples/users-model",
    ]) {
      expect(existsSync(join(root, legacyPath))).toBe(false);
    }
  });
});

describe("authored example contract migration", () => {
  const examples = [
    ["todo", "todo"],
    ["projects", "projects"],
    ["orders", "orders"],
    ["message-board/model", "messageboard"],
  ];

  it("keeps every owned example Proto under its final plural namespace without v1", () => {
    for (const [directory, domain] of examples) {
      const protoRoot = join(root, "examples", directory, "proto", "spine", "examples", domain);
      expect(existsSync(protoRoot)).toBe(true);
      for (const file of ["package spine.example", "type.spine.example", "/v1/"])
        expect(
          readFileSync(join(root, "examples", directory, "spine-proto-manifest.json"), "utf8"),
        ).not.toContain(file);
    }
    expect(existsSync(join(root, "examples/project-management"))).toBe(false);
    expect(existsSync(join(root, "examples/datastore-orders"))).toBe(false);
  });
});
