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

import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
execFileSync("pnpm", ["exec", "tsc", "-b"], { cwd: directory, stdio: "inherit" });
await mkdir(resolve(directory, "dist"), { recursive: true });
await Promise.all([
  build({
    entryPoints: [resolve(directory, "src/preload.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: resolve(directory, "dist/preload.cjs"),
  }),
  build({
    entryPoints: [resolve(directory, "src/renderer.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: resolve(directory, "dist/renderer.js"),
  }),
  build({
    entryPoints: [
      resolve(directory, "src/main.ts"),
      resolve(directory, "src/trusted/studio-service.ts"),
      resolve(directory, "src/trusted/plan-model-selection.ts"),
      resolve(directory, "src/trusted/studio-desktop.ts"),
      resolve(directory, "src/trusted/studio-ipc.ts"),
      resolve(directory, "src/trusted/window-options.ts"),
      resolve(directory, "generated/handler/generated-handler-registry.ts"),
    ],
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron"],
    banner: {
      js: 'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);',
    },
    outdir: resolve(directory, "dist/app"),
    outbase: directory,
    entryNames: "[dir]/[name]",
    chunkNames: "chunks/[name]-[hash]",
    outExtension: { ".js": ".mjs" },
  }),
  build({
    entryPoints: [resolve(directory, "src/trusted/git-worker-main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: resolve(directory, "dist/src/git-worker.mjs"),
  }),
  copyFile(resolve(directory, "src/renderer.html"), resolve(directory, "dist/renderer.html")),
  copyFile(resolve(directory, "src/renderer.css"), resolve(directory, "dist/renderer.css")),
]);
await Promise.all([
  copyFile(
    resolve(directory, "dist/src/git-worker.mjs"),
    resolve(directory, "dist/app/src/git-worker.mjs"),
  ),
  copyFile(
    resolve(directory, "dist/app/generated/handler/generated-handler-registry.mjs"),
    resolve(directory, "dist/app/generated/handler/generated-handler-registry.js"),
  ),
  ...["preload.cjs", "renderer.html", "renderer.js", "renderer.css"].map((name) =>
    copyFile(resolve(directory, "dist", name), resolve(directory, "dist/app", name)),
  ),
]);
