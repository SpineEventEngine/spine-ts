import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

const familyPackages = [
  ["app", "@spine-event-engine/example-chat-app"],
  ["model", "@spine-event-engine/example-chat-model"],
  ["users-model", "@spine-event-engine/example-chat-users-model"],
  ["web", "@spine-event-engine/example-chat-web"],
];

describe("Chat family workspace migration", () => {
  it("discovers the nested Chat packages without retaining their former top-level paths", () => {
    const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const references = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")).references;
    const vitestConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");
    const eslintConfig = readFileSync(join(root, "eslint.config.mjs"), "utf8");
    const protoWorkflow = readFileSync(join(root, "scripts/proto-workflow.mjs"), "utf8");
    const eslintTypeScript = readFileSync(join(root, "tsconfig.eslint.json"), "utf8");
    const browserHarness = readFileSync(
      join(root, "examples/chat/web/test/interop/harness.mjs"),
      "utf8",
    );
    const browserTypeScript = readFileSync(
      join(root, "examples/chat/web/test/browser/tsconfig.json"),
      "utf8",
    );
    const interopBrowserTypeScript = readFileSync(
      join(root, "examples/chat/web/test/interop/browser/tsconfig.json"),
      "utf8",
    );
    const familyReadme = readFileSync(join(root, "examples/chat/README.md"), "utf8");

    expect(workspace).toContain('  - "examples/*/*"');
    expect(workspace).not.toContain('  - "examples/**"');
    expect(vitestConfig).toContain('"examples/*/*/test/**/*.test.ts"');
    expect(vitestConfig).toContain('"examples/*/*/test/**/*.test.tsx"');
    expect(vitestConfig).toContain('"examples/*/*/src/**/*.ts"');
    expect(vitestConfig).toContain('"examples/*/*/src/**/*.tsx"');
    expect(eslintTypeScript).toContain('"examples/*/*/src/**/*.ts"');
    expect(eslintTypeScript).toContain('"examples/*/*/test/**/*.ts"');
    expect(eslintConfig).toContain('"examples/*/*/generated/**"');
    expect(protoWorkflow).toContain('join(root, "examples/chat/app")');
    expect(protoWorkflow).toContain('join(root, "examples/chat/app/src/model-registry.ts")');
    expect(protoWorkflow).not.toContain('join(root, "examples/chat/src/model-registry.ts")');
    expect(browserHarness).toContain('from "../../../../../interop/envoy/render.mjs"');
    expect(browserTypeScript).toContain('"extends": "../../../../../tsconfig.base.json"');
    expect(interopBrowserTypeScript).toContain('"extends": "../../../../../../tsconfig.base.json"');
    expect(familyReadme).toContain(
      "[browser client, authentication, and gateway extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)",
    );
    expect(familyReadme).toContain("The app directly depends on `users-model` and `model`");
    expect(references.map(({ path }) => path)).toEqual(
      expect.arrayContaining(familyPackages.map(([directory]) => `./examples/chat/${directory}`)),
    );

    for (const [directory, packageName] of familyPackages) {
      const packagePath = join(root, "examples/chat", directory, "package.json");
      expect(existsSync(packagePath)).toBe(true);
      expect(JSON.parse(readFileSync(packagePath, "utf8")).name).toBe(packageName);
    }

    for (const legacyPath of ["examples/chat-model", "examples/chat-web", "examples/users-model"]) {
      expect(existsSync(join(root, legacyPath))).toBe(false);
    }
  });
});
