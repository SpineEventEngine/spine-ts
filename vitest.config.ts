import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "examples/*/src/**/*.test.ts",
      "examples/*/src/**/*.test.tsx",
      "examples/*/test/**/*.test.ts",
      "examples/*/test/**/*.test.tsx",
      "examples/*/*/src/**/*.test.ts",
      "examples/*/*/src/**/*.test.tsx",
      "examples/*/*/test/**/*.test.ts",
      "examples/*/*/test/**/*.test.tsx",
      "scripts/**/*.test.mjs",
      "interop/jvm/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
        "examples/*/src/**/*.ts",
        "examples/*/src/**/*.tsx",
        "examples/*/*/src/**/*.ts",
        "examples/*/*/src/**/*.tsx",
      ],
      exclude: [
        "**/*.test.ts",
        "packages/*/generated/**",
        "examples/*/generated/**",
        "examples/*/*/generated/**",
        // The build-time handler analyzer is a TypeScript compiler integration
        // with focused tests; keep global thresholds centered on runtime code.
        "packages/server/src/handler/build-time-handler-analyzer.ts",
        // Vitest cannot execute raw TypeScript standard decorators here; the
        // example test covers this source through its `tsc` output.
        "examples/todo/src/index.ts",
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
