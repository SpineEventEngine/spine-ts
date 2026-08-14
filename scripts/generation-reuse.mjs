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

export function reusableGenerationId(liveManifestPath, liveRoot, stagedManifest, stagedRoot) {
  try {
    const liveManifest = JSON.parse(readFileSync(liveManifestPath, "utf8"));
    const { generationId: liveGenerationId, ...liveContents } = liveManifest;
    const { generationId: stagedGenerationId, ...stagedContents } = stagedManifest;
    if (
      liveManifest.formatVersion !== 2 ||
      typeof liveGenerationId !== "string" ||
      liveGenerationId.length === 0 ||
      markerId(liveRoot) !== liveGenerationId ||
      markerId(stagedRoot) !== stagedGenerationId ||
      JSON.stringify(canonicalJson(liveContents)) !==
        JSON.stringify(canonicalJson(stagedContents)) ||
      JSON.stringify(treeContents(liveRoot)) !== JSON.stringify(treeContents(stagedRoot))
    )
      return undefined;
    return liveGenerationId;
  } catch {
    return undefined;
  }
}
