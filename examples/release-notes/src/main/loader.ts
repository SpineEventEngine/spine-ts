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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { app } from "@mobrowser/api";

const packaged = join(app.getPath("appResources"), "studio/main/index.js");
const development = join(
  fileURLToPath(new URL("../..", import.meta.url)),
  ".studio-build/index.js",
);
const entry = existsSync(packaged) ? packaged : development;
if (!existsSync(entry)) throw new Error("Studio runtime resources are missing.");
await import(pathToFileURL(entry).href);
