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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import ts from "typescript";

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve("eslint"));

function esmEntry(cjsEntry, from, to) {
  const entry = cjsEntry.replace(from, to);
  assert.notEqual(entry, cjsEntry, `Expected ${from} in ${cjsEntry}`);
  return pathToFileURL(entry).href;
}

test("patched minimatch keeps legacy callable imports and named matcher exports", async () => {
  const cjs = eslintRequire("minimatch");
  const esm = await import(esmEntry(eslintRequire.resolve("minimatch"), "/commonjs/", "/esm/"));
  for (const match of [cjs, cjs.default, esm.default, cjs.minimatch, esm.minimatch]) {
    assert.equal(match("src/item.ts", "src/*.ts"), true);
    assert.equal(match("src/item.js", "src/*.ts"), false);
  }
  assert.equal(new cjs.Minimatch("**/*.ts").match("src/item.ts"), true);
  assert.equal(new esm.Minimatch("**/*.ts").match("src/item.ts"), true);
  const compiled = ts.transpileModule(
    'import minimatch from "minimatch"; export const matched = minimatch("src/item.ts", "src/*.ts");',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false } },
  ).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: eslintRequire });
  assert.equal(exports.matched, true);
});

test("ESLint config-array and eslintrc use legacy patterns in both module formats", async () => {
  const configCjs = eslintRequire("@eslint/config-array");
  const configEsm = await import(
    esmEntry(eslintRequire.resolve("@eslint/config-array"), "/cjs/index.cjs", "/esm/index.js")
  );
  for (const implementation of [configCjs, configEsm]) {
    const configs = new implementation.ConfigArray([{ files: ["**/*.ts"] }]);
    configs.normalizeSync();
    assert.ok(configs.getConfig("src/item.ts"));
    assert.equal(configs.getConfig("src/item.js"), undefined);
  }
  const legacyCjs = eslintRequire("@eslint/eslintrc");
  const legacyEsm = await import(
    esmEntry(eslintRequire.resolve("@eslint/eslintrc"), "/dist/eslintrc.cjs", "/lib/index.js")
  );
  for (const implementation of [legacyCjs, legacyEsm]) {
    const factory = new implementation.Legacy.ConfigArrayFactory({ cwd: process.cwd() });
    const configs = factory.create({
      overrides: [{ files: ["**/*.ts"], rules: { "no-undef": "error" } }],
    });
    assert.deepEqual(configs.extractConfig(resolve("src/item.ts")).rules["no-undef"], ["error"]);
  }
});

test("glob and rimraf retain named traversal and deletion APIs", async () => {
  const appRequire = createRequire(resolve("examples/message-board/app/package.json"));
  const datastoreRequire = createRequire(appRequire.resolve("@google-cloud/datastore"));
  const gaxRequire = createRequire(datastoreRequire.resolve("google-gax"));
  const rimrafRequire = createRequire(gaxRequire.resolve("rimraf"));
  const rimraf = rimrafRequire("rimraf");
  const globCjs = rimrafRequire("glob");
  const globEsm = await import(esmEntry(rimrafRequire.resolve("glob"), "/commonjs/", "/esm/"));
  const directory = mkdtempSync(join(tmpdir(), "spine-dependency-"));
  try {
    writeFileSync(join(directory, "remove.tmp"), "remove");
    writeFileSync(join(directory, "retain.txt"), "retain");
    assert.deepEqual(globCjs.globSync("*.tmp", { cwd: directory }), ["remove.tmp"]);
    assert.deepEqual(globEsm.globSync("*.tmp", { cwd: directory }), ["remove.tmp"]);
    rimraf.rimrafSync(join(directory, "*.tmp"), { glob: true });
    assert.equal(existsSync(join(directory, "remove.tmp")), false);
    assert.equal(existsSync(join(directory, "retain.txt")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TypeDoc traverses positive and negative braces, globstars, and node_modules", async () => {
  const typedocPath = require.resolve("typedoc/package.json");
  const { glob } = await import(
    pathToFileURL(join(typedocPath, "..", "dist/lib/utils/fs.js")).href
  );
  const directory = mkdtempSync(join(tmpdir(), "spine-typedoc-glob-"));
  try {
    mkdirSync(join(directory, "src/nested"), { recursive: true });
    mkdirSync(join(directory, "node_modules/pkg"), { recursive: true });
    for (const path of [
      "src/a.ts",
      "src/nested/b.tsx",
      "src/nested/c.js",
      "src/nested/skip.tmp",
      "node_modules/pkg/types.d.ts",
    ]) {
      writeFileSync(join(directory, path), path);
    }
    const found = (pattern) =>
      glob(pattern, directory)
        .map((path) => path.slice(directory.length + 1))
        .sort();
    assert.deepEqual(found(`${directory}/src/**/*.{ts,tsx}`), ["src/a.ts", "src/nested/b.tsx"]);
    assert.deepEqual(found(`!${directory}/**/*.tmp`), [
      "src/a.ts",
      "src/nested/b.tsx",
      "src/nested/c.js",
    ]);
    assert.deepEqual(found(`${directory}/node_modules/**/*.d.ts`), ["node_modules/pkg/types.d.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
