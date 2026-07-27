import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../packages/client-web", import.meta.url));
const forbidden = [
  /(?:from\s+|import\s*\()?["']node:/u,
  /@connectrpc\/connect-node/u,
  /(?:from\s+|import\s*\()?["']react(?:["'/])/u,
  /(?:from\s+|import\s*\()?["'](?:fs|path|process)(?:["'/])/u,
  /entity-column|generate-entity-columns/u,
];

for (const path of await files(root)) {
  const source = await readFile(path, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source))
      throw new Error(`client-web forbidden dependency ${String(pattern)} in ${path}`);
  }
}

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory() && entry.name !== "dist" && entry.name !== "node_modules")
      found.push(...(await files(child)));
    else if (entry.isFile() && /\.(?:ts|mts|cts|js|mjs|cjs)$/u.test(entry.name)) found.push(child);
  }
  return found;
}
