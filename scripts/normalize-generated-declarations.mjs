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
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { generatedTypeScript } from "./generated-source-policy.mjs";
import { prepareProtoToolsBootstrap, releaseProtoToolsBootstrap } from "./proto-workflow.mjs";

export const generatedDeclarationRoots = Object.freeze([
  "packages/proto",
  "examples/todo",
  "examples/projects",
  "examples/orders",
  "examples/message-board/model",
  "examples/message-board/app",
]);

export function declarationFiles(root) {
  const pending = [[root, 0]];
  const files = [];
  let entries = 0;
  while (pending.length > 0) {
    if (pending.length > 64 || entries > 1_000)
      throw new Error("generated declaration traversal exceeds bounded inventory");
    const [directory, depth] = pending.pop();
    if (depth > 64) throw new Error("generated declaration traversal exceeds bounded inventory");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > 1_000)
        throw new Error("generated declaration traversal exceeds bounded inventory");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push([path, depth + 1]);
      else if (
        entry.isFile() &&
        /(?:_pb|rejections|_columns|proto-module|generated-handler-registry|model-registry)\.d\.ts$/u.test(
          path,
        )
      )
        files.push(path);
    }
  }
  return files;
}

export function declarationSources(source) {
  return [...source.matchAll(/^ \* Source Proto: (.+)$/gmu)].map((match) => match[1]);
}

export function normalizeGeneratedDeclarations(
  repoRoot = process.cwd(),
  roots = generatedDeclarationRoots,
) {
  for (const root of roots) {
    const packageRoot = resolve(repoRoot, root);
    for (const [dist, generated] of [
      [join(packageRoot, "dist", "generated"), join(packageRoot, "generated")],
      [join(packageRoot, "dist", "src"), join(packageRoot, "src")],
    ]) {
      if (!existsSync(dist) || !existsSync(generated)) continue;
      for (const declaration of declarationFiles(dist)) {
        const sourcePath = join(generated, relative(dist, declaration).replace(/\.d\.ts$/u, ".ts"));
        if (!existsSync(sourcePath)) continue;
        const provenance = declarationSources(readFileSync(sourcePath, "utf8"));
        if (provenance.length > 0)
          writeFileSync(
            declaration,
            generatedTypeScript(readFileSync(declaration, "utf8"), provenance),
            "utf8",
          );
      }
    }
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  prepareProtoToolsBootstrap();
  try {
    normalizeGeneratedDeclarations();
  } finally {
    releaseProtoToolsBootstrap();
  }
}
