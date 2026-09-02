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

import { configDefaults, defineConfig } from "vitest/config";

import { infrastructureTestFiles } from "./scripts/test-inventory.mjs";

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
      "compatibility-tests/jvm/**/*.test.mjs",
    ],
    // Provider tests must be selected only by their explicit package commands;
    // environment variables never broaden the release suite.
    exclude: [...configDefaults.exclude, ...infrastructureTestFiles],
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
        "packages/proto-tools/src/generation/build-time-handler-analyzer.ts",
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
