import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const typedFiles = ["**/*.ts", "examples/release-notes/{src,test}/**/*.tsx"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      ".worktrees/**",
      "docs/api/reference/**",
      "packages/*/generated/**",
      "packages/*/test-fixtures/generated/**",
      "examples/*/generated/**",
      "examples/*/*/generated/**",
      "eslint.config.mjs",
      "vitest.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/ai-vercel-ax/{src,test}/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: [
          "./packages/ai-vercel-ax/tsconfig.tooling.json",
          "./packages/ai-vercel-ax/tsconfig.provider-boundary.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      "examples/release-notes/{src,test}/**/*.ts",
      "examples/release-notes/{src,test}/**/*.tsx",
    ],
    languageOptions: {
      parserOptions: {
        project: "./examples/release-notes/tsconfig.tooling.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/server-blackbox-tests/test/agent-vercel-mcp-blackbox.test.ts"],
    languageOptions: {
      parserOptions: {
        project: "./packages/server-blackbox-tests/tsconfig.provider-tests.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["scripts/**/*.mjs", "examples/release-notes/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["examples/message-board/web/test/interop/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["compatibility-tests/jvm/**/*.mjs", "interop/envoy/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
