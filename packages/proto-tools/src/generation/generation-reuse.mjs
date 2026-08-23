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

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const generationMarkerFile = ".spine-proto-generation.json";

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  return value;
}

function markerId(root) {
  try {
    const marker = JSON.parse(readFileSync(join(root, generationMarkerFile), "utf8"));
    return typeof marker.generationId === "string" && marker.generationId.length > 0
      ? marker.generationId
      : undefined;
  } catch {
    return undefined;
  }
}

function treeContents(root) {
  const files = [];
  const pending = [[root, 0]];
  let entries = 0;
  while (pending.length > 0) {
    const [directory, depth] = pending.pop();
    if (depth > 64) throw new Error("generated TypeScript traversal exceeds bounded inventory");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > 1_000)
        throw new Error("generated TypeScript traversal exceeds bounded inventory");
      const path = join(directory, entry.name);
      if (lstatSync(path).isSymbolicLink())
        throw new Error("generated TypeScript traversal must not contain symlinks");
      if (entry.isDirectory()) pending.push([path, depth + 1]);
      else if (entry.isFile() && entry.name !== generationMarkerFile)
        files.push([relative(root, path).split(sep).join("/"), readFileSync(path, "utf8")]);
    }
  }
  return files.sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Creates a stable ID from a generation manifest contract and complete generated output.
 *
 * @param {Readonly<Record<string, unknown>>} manifest Generation manifest contract.
 * @param {string} root Generated-output root.
 * @returns {string} Stable content-derived generation identifier.
 */
export function generationIdForContents(manifest, root) {
  const contents = { ...manifest };
  delete contents.generationId;
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(contents)))
    .update("\n")
    .update(JSON.stringify(treeContents(root)))
    .digest("hex");
}

export function reusableGenerationId(liveManifestPath, liveRoot, stagedManifest, stagedRoot) {
  try {
    const liveManifest = JSON.parse(readFileSync(liveManifestPath, "utf8"));
    const { generationId: liveGenerationId, ...liveContents } = liveManifest;
    const { generationId: stagedGenerationId, ...stagedContents } = stagedManifest;
    const liveTree = treeContents(liveRoot);
    const stagedTree = treeContents(stagedRoot);
    if (
      liveManifest.formatVersion !== 2 ||
      typeof liveGenerationId !== "string" ||
      liveGenerationId.length === 0 ||
      markerId(liveRoot) !== liveGenerationId ||
      markerId(stagedRoot) !== stagedGenerationId ||
      JSON.stringify(canonicalJson(liveContents)) !==
        JSON.stringify(canonicalJson(stagedContents)) ||
      (liveTree.length > 0 && JSON.stringify(liveTree) !== JSON.stringify(stagedTree))
    )
      return undefined;
    return liveTree.length === 0
      ? generationIdForContents(stagedManifest, stagedRoot)
      : liveGenerationId;
  } catch {
    return undefined;
  }
}
