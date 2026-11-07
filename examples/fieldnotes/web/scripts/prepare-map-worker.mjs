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

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const dist = dirname(fileURLToPath(import.meta.resolve("maplibre-gl")));
const packageRoot = resolve(dist, "..");
const metadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
if (metadata.version !== "6.16.0")
  throw new Error("The Fieldnotes map worker must match pinned MapLibre 6.16.0.");
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
await mkdir(publicDirectory, { recursive: true });
await copyFile(resolve(dist, "maplibre-gl-worker.mjs"),
  resolve(publicDirectory, "maplibre-gl-worker.mjs"));
await copyFile(resolve(packageRoot, "LICENSE.txt"),
  resolve(publicDirectory, "maplibre-gl-LICENSE.txt"));
