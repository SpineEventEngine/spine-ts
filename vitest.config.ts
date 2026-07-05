import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "examples/*/src/**/*.test.ts",
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
