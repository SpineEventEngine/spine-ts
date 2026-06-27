import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const command = process.argv[2];

if (command !== "lint" && command !== "generate") {
  console.error("Usage: node scripts/proto-workflow.mjs <lint|generate>");
  process.exit(1);
}

const protoRoot = fileURLToPath(new URL("../proto", import.meta.url));

function findProtoFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return findProtoFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".proto") ? [entryPath] : [];
  });
}

const protoFiles = findProtoFiles(protoRoot);

if (protoFiles.length === 0) {
  console.log(`No .proto files found under proto; buf ${command} is deferred until proto intake.`);
  process.exit(0);
}

const bufArgs = command === "lint" ? ["lint"] : ["generate"];
const result = spawnSync("buf", bufArgs, { stdio: "inherit" });

process.exit(result.status ?? 1);
