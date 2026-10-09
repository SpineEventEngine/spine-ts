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

import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
const stage = await mkdtemp(join(tmpdir(), "spine-release-notes-package-"));
const output = join(directory, "out");
try {
  await cp(join(directory, "dist/app/src"), join(stage, "src"), { recursive: true });
  await cp(join(directory, "dist/app/generated"), join(stage, "generated"), { recursive: true });
  await cp(join(directory, "dist/app/chunks"), join(stage, "chunks"), { recursive: true });
  await Promise.all([
    ...["preload.cjs", "renderer.html", "renderer.js", "renderer.css"].map(async (name) =>
      copyFile(join(directory, "dist/app", name), join(stage, name)),
    ),
  ]);
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify({
      name: "release-notes-studio",
      version: manifest.version,
      private: true,
      type: "module",
      main: "src/main.mjs",
    }),
  );
  await rm(output, { recursive: true, force: true });
  const [appPath] = await packager({
    dir: stage,
    out: output,
    overwrite: true,
    asar: true,
    prune: false,
    name: "Release Notes Studio",
    platform: "darwin",
    arch: process.arch,
    electronVersion: "44.7.0",
  });
  if (appPath === undefined) throw new Error("Electron package output is missing.");
  await writeFile(
    join(output, "app-path.txt"),
    join(appPath, "Release Notes Studio.app", "Contents", "MacOS", "Release Notes Studio"),
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
