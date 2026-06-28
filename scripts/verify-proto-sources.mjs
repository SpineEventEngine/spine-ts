import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "proto/spine-sources.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) {
  console.error("Invalid proto source manifest format.");
  process.exit(1);
}

const failures = [];

for (const source of manifest.sources) {
  const filePath = resolve(repoRoot, source.localPath);
  let contents;

  try {
    contents = readFileSync(filePath);
  } catch (error) {
    failures.push(`${source.localPath}: unable to read copied file (${error.message})`);
    continue;
  }

  const actual = createHash("sha256").update(contents).digest("hex");

  if (actual !== source.sha256) {
    failures.push(`${source.localPath}: expected ${source.sha256}, got ${actual}`);
  }
}

if (failures.length > 0) {
  console.error("Copied Spine proto source verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Verified ${manifest.sources.length} copied Spine proto source file checksums.`);
