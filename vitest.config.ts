import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "examples/*/src/**/*.test.ts",
      "examples/*/test/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts", "examples/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "packages/*/generated/**",
        "examples/*/generated/**",
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
