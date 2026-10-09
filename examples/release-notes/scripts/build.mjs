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
    entryPoints: [resolve(directory, "src/main.ts")],
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron"],
    outdir: resolve(directory, "dist/src"),
    entryNames: "main",
    chunkNames: "chunks/[name]-[hash]",
    outExtension: { ".js": ".mjs" },
  }),
  copyFile(resolve(directory, "src/renderer.html"), resolve(directory, "dist/renderer.html")),
  copyFile(resolve(directory, "src/renderer.css"), resolve(directory, "dist/renderer.css")),
]);
