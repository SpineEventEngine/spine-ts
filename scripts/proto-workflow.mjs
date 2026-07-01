import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const command = process.argv[2];

if (command !== "lint" && command !== "generate") {
  console.error("Usage: node scripts/proto-workflow.mjs <lint|generate>");
  process.exit(1);
}

const protoRoot = fileURLToPath(new URL("../proto", import.meta.url));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(repoRoot, "packages/proto/generated");

function runCommand(label, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(`Failed to start ${label}: ${result.error.message}`);
    return 1;
  }

  if (result.signal !== null) {
    console.error(`${label} terminated by signal ${result.signal}.`);
    return 1;
  }

  return result.status ?? 1;
}

function resolveBufExecutable() {
  const executable = process.platform === "win32" ? "buf.cmd" : "buf";
  const localBuf = join(repoRoot, "node_modules", ".bin", executable);

  return existsSync(localBuf) ? localBuf : executable;
}

function findProtoFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return findProtoFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".proto") ? [entryPath] : [];
  });
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function cleanGeneratedOutput() {
  const generatedStat = lstatIfPresent(generatedRoot);

  if (generatedStat !== undefined) {
    if (generatedStat.isSymbolicLink()) {
      console.error("Generated directory must not be a symlink: packages/proto/generated");
      return 1;
    }

    rmSync(generatedRoot, { recursive: true });
  }

  mkdirSync(generatedRoot, { recursive: true });
  return 0;
}

const protoFiles = findProtoFiles(protoRoot);

if (protoFiles.length === 0) {
  console.log(`No .proto files found under proto; buf ${command} is deferred until proto intake.`);
  process.exit(0);
}

const verifyStatus = runCommand("proto source verification", process.execPath, [
  join(repoRoot, "scripts/verify-proto-sources.mjs"),
]);

if (verifyStatus !== 0) {
  process.exit(verifyStatus);
}

const bufArgs = command === "lint" ? ["lint"] : ["generate"];

if (command === "generate") {
  const cleanStatus = cleanGeneratedOutput();

  if (cleanStatus !== 0) {
    process.exit(cleanStatus);
  }
}

const bufStatus = runCommand(`buf ${command}`, resolveBufExecutable(), bufArgs);

process.exit(bufStatus);
