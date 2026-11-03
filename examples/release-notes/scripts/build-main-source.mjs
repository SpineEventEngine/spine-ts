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

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
await build({
  entryPoints: {
    index: resolve(directory, "src/main.ts"),
    "generated/spine-bootstrap": resolve(directory, "generated/spine-bootstrap.ts"),
  },
  outdir: resolve(directory, ".studio-build"),
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);',
  },
  outExtension: { ".js": ".js" },
});
await writeFile(resolve(directory, ".studio-build/package.json"), '{"type":"module"}\n');
