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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { generatedTypeScript } from "./generated-source-policy.mjs";

const roots = [
  "packages/proto",
  "examples/todo",
  "examples/projects",
  "examples/orders",
  "examples/message-board/model",
];

function declarationFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (
        entry.isFile() &&
        /(?:_pb|rejections|_columns|proto-module|generated-handler-registry)\.d\.ts$/u.test(path)
      )
        files.push(path);
    }
  }
  return files;
}

function sources(source) {
  return [...source.matchAll(/^ \* Source Proto: (.+)$/gmu)].map((match) => match[1]);
}

for (const root of roots) {
  const dist = join(root, "dist", "generated");
  const generated = join(root, "generated");
  if (!existsSync(dist) || !existsSync(generated)) continue;
  for (const declaration of declarationFiles(dist)) {
    const sourcePath = join(generated, relative(dist, declaration).replace(/\.d\.ts$/u, ".ts"));
    if (!existsSync(sourcePath)) continue;
    const provenance = sources(readFileSync(sourcePath, "utf8"));
    if (provenance.length > 0)
      writeFileSync(
        declaration,
        generatedTypeScript(readFileSync(declaration, "utf8"), provenance),
        "utf8",
      );
  }
}
