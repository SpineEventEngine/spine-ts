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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "vitest";
import { typescriptVitestPlugin } from "./vitest-typescript.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = [
  "packages/server/src/agent/agent-ai-runtime.ts",
  "packages/testing/src/ai-test/ai-test-backend.ts",
  "packages/testing/src/ai-test/scripted-attempts.ts",
  "packages/testing/src/black-box/black-box.ts",
];

function coverageFor(mode, directory) {
  const compiled = runtime.map((file) => file.replace("/src/", "/dist/").replace(/\.ts$/, ".js"));
  const include =
    mode === "source" ? runtime : mode === "compiled" ? compiled : [...runtime, ...compiled];
  const report = path.join(directory, mode);
  const configuration = path.join(directory, `${mode}.config.mjs`);
  const plugin = pathToFileURL(path.join(root, "scripts/vitest-typescript.mjs")).href;
  const configText = `import { typescriptVitestPlugin } from ${JSON.stringify(plugin)};
export default { root: ${JSON.stringify(root)}, oxc: false, esbuild: false,
  plugins: [typescriptVitestPlugin()], test: {
    include: ["packages/testing/test/agent-ai-blackbox.test.ts",
      "packages/server/test/agent/agent-ai-runtime.test.ts"], pool: "threads", maxWorkers: 1,
    coverage: { provider: "v8", reporter: ["json"], reportsDirectory: ${JSON.stringify(report)},
      include: ${JSON.stringify(include)}, exclude: ["**/*.test.ts"],
      excludeAfterRemap: ${mode !== "compiled"} } } };\n`;
  writeFileSync(configuration, configText);
  const run = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      configuration,
      "--coverage",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 25_000,
    },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return JSON.parse(readFileSync(path.join(report, "coverage-final.json"), "utf8"));
}

function assertCounterUnion(source, compiled, combined) {
  assert.deepEqual(Object.keys(combined).sort(), Object.keys(source).sort());
  for (const key of Object.keys(combined))
    assert.equal(combined[key] > 0, source[key] > 0 || compiled[key] > 0);
}

function assertHitUnion(source, compiled, combined) {
  assert.deepEqual(Object.keys(combined).sort(), Object.keys(source).sort());
  for (const file of Object.keys(source)) {
    const direct = source[file];
    const built = compiled[file];
    const merged = combined[file];
    assert.ok(built && merged, `Missing coverage for ${file}`);
    for (const map of ["branchMap", "statementMap", "fnMap"]) {
      assert.deepEqual(built[map], direct[map]);
      assert.deepEqual(merged[map], direct[map]);
    }
    for (const branch of Object.keys(merged.b)) {
      const actual = merged.b[branch];
      const directHits = direct.b[branch];
      const builtHits = built.b[branch];
      for (let index = 0; index < actual.length; index++)
        assert.equal(actual[index] > 0, directHits[index] > 0 || builtHits[index] > 0);
    }
    assertCounterUnion(direct.s, built.s, merged.s);
    assertCounterUnion(direct.f, built.f, merged.f);
  }
}

function assertDistinctAgentRuntimeHits(source, compiled, combined) {
  const file = Object.keys(source).find((name) => name.endsWith("/agent-ai-runtime.ts"));
  assert.ok(file, "Expected authored Agent AI runtime coverage.");
  const direct = source[file];
  const built = compiled[file];
  const merged = combined[file];
  let sourceOnly = 0;
  let compiledOnly = 0;
  for (const branch of Object.keys(direct.b)) {
    for (let index = 0; index < direct.b[branch].length; index++) {
      const sourceHit = direct.b[branch][index] > 0;
      const compiledHit = built.b[branch][index] > 0;
      if (sourceHit && !compiledHit) sourceOnly++;
      if (compiledHit && !sourceHit) {
        compiledOnly++;
        assert.ok(merged.b[branch][index] > 0);
      }
    }
  }
  assert.ok(sourceOnly > 0, "Direct Agent execution contributed no distinct branch hits.");
  assert.ok(compiledOnly > 0, "Compiled Agent execution contributed no distinct branch hits.");
}

it("transpiles TSX with its nearest package JSX setting and original source map", () => {
  const plugin = typescriptVitestPlugin();
  const source = 'export const example = <span title="hello">Hello</span>;';
  const file = path.join(root, "packages/client-react/src/coverage-example.tsx");
  const result = plugin.transform(source, `${file}?v=1`);
  assert.ok(result);
  assert.match(result.code, /jsx\(/);
  assert.deepEqual(result.map.sources, [file]);
  assert.deepEqual(result.map.sourcesContent, [source]);
  assert.doesNotMatch(result.code, /sourceMappingURL/);
});

it("preserves standard decorator emit and ignores JavaScript and virtual modules", () => {
  const plugin = typescriptVitestPlugin();
  const file = path.join(root, "packages/server/src/agent/coverage-example.ts");
  const result = plugin.transform("@sealed export class Ticket {}", file);
  assert.ok(result);
  assert.match(result.code, /__esDecorate/);
  assert.equal(plugin.transform("export const a = 1;", `${file}?raw`), undefined);
  assert.equal(plugin.transform("export const a = 1;", `${file.slice(0, -2)}js`), undefined);
  assert.equal(plugin.transform("export const a = 1;", "\0virtual.ts"), undefined);
});

it("emits the same Agent runtime JavaScript as the package compiler", () => {
  const source = path.join(root, "packages/server/src/agent/agent-ai-runtime.ts");
  const compiled = path.join(root, "packages/server/dist/agent/agent-ai-runtime.js");
  const transformed = typescriptVitestPlugin().transform(readFileSync(source, "utf8"), source);
  assert.ok(transformed);
  const built = readFileSync(compiled, "utf8").replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
  assert.equal(transformed.code, built);
});

it("rejects unsupported module and malformed TypeScript input", () => {
  const plugin = typescriptVitestPlugin();
  const file = path.join(root, "packages/server/src/agent/coverage-example.ts");
  assert.throws(
    () => plugin.transform("export const value = 1;", `${file.slice(0, -2)}cts`),
    /CommonJS/,
  );
  assert.throws(() => plugin.transform("export const = ;", file), /transform failed/);
});

it("merges authored and compiled runtime hits without crediting unexecuted compiled modules", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spine-typescript-coverage-"));
  try {
    const source = coverageFor("source", directory);
    const compiled = coverageFor("compiled", directory);
    const combined = coverageFor("combined", directory);
    assertHitUnion(source, compiled, combined);
    assertDistinctAgentRuntimeHits(source, compiled, combined);
    const unexecuted = Object.entries(compiled).find(
      ([file, value]) =>
        file.endsWith("/ai-test-backend.ts") &&
        Object.values(value.b)
          .flat()
          .every((hit) => hit === 0),
    );
    assert.ok(unexecuted, "Expected an unexecuted compiled counterpart in the control report.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
