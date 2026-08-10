import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const manifestPath = process.argv[2] ?? "build-protocol/logging/containment-manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = manifest.boundaries ?? [];
const failures = [];
const seen = new Map();

for (const entry of entries) {
  if (!entry.id || !entry.source || !entry.operation || !entry.disposition || !entry.test)
    failures.push(`invalid containment manifest entry: ${JSON.stringify(entry)}`);
  seen.set(entry.id, 0);
}
for (const entry of entries) {
  const file = resolve(dirname(manifestPath), entry.source);
  const text = readFileSync(file, "utf8");
  const matches = [...text.matchAll(/spine-log-boundary:\s*([a-z0-9_.-]+)/g)];
  for (const match of matches) {
    if (!seen.has(match[1])) failures.push(`stale containment boundary ${match[1]} in ${entry.source}`);
    else seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  visit(source, entry.source);
}
for (const [id, count] of seen) {
  if (count !== 1) failures.push(`containment boundary ${id} has ${count} source bindings`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

function visit(node, source) {
  if (ts.isCatchClause(node) && node.block.statements.length === 0)
    failures.push(`empty catch in ${source}`);
  ts.forEachChild(node, (child) => visit(child, source));
}
