import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";

const protoRoot = fileURLToPath(new URL("../proto", import.meta.url));
const todoProtoRoot = fileURLToPath(new URL("../examples/todo/proto", import.meta.url));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPaths = ["packages/proto/generated", "examples/todo/generated"];

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

export function cleanGeneratedOutput(root = repoRoot) {
  for (const generatedPath of generatedPaths) {
    const generatedRoot = join(root, generatedPath);
    const ancestorFailures = findSymlinkedAncestors(root, generatedPath);

    if (ancestorFailures.length > 0) {
      for (const failure of ancestorFailures) {
        console.error(`Generated path ancestor must not be a symlink: ${failure}`);
      }

      return 1;
    }

    const generatedStat = lstatIfPresent(generatedRoot);

    if (generatedStat !== undefined) {
      if (generatedStat.isSymbolicLink()) {
        console.error(`Generated directory must not be a symlink: ${generatedPath}`);
        return 1;
      }

      rmSync(generatedRoot, { recursive: true });
    }

    mkdirSync(generatedRoot, { recursive: true });
  }

  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (command !== "lint" && command !== "generate") {
    console.error("Usage: node scripts/proto-workflow.mjs <lint|generate>");
    return 1;
  }

  const protoFiles = [...findProtoFiles(protoRoot), ...findProtoFiles(todoProtoRoot)];

  if (protoFiles.length === 0) {
    console.log(
      `No .proto files found under proto; buf ${command} is deferred until proto intake.`,
    );
    return 0;
  }

  const verifyStatus = runCommand("proto source verification", process.execPath, [
    join(repoRoot, "scripts/verify-proto-sources.mjs"),
  ]);

  if (verifyStatus !== 0) {
    return verifyStatus;
  }

  if (command === "generate") {
    const cleanStatus = cleanGeneratedOutput();

    if (cleanStatus !== 0) {
      return cleanStatus;
    }

    const packageStatus = runCommand("buf generate framework proto", resolveBufExecutable(), [
      "generate",
      "--template",
      "buf.gen.yaml",
    ]);

    if (packageStatus !== 0) {
      return packageStatus;
    }

    return runCommand("buf generate todo proto", resolveBufExecutable(), [
      "generate",
      "--template",
      "examples/todo/buf.gen.yaml",
    ]);
  }

  return runCommand("buf lint", resolveBufExecutable(), ["lint"]);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
