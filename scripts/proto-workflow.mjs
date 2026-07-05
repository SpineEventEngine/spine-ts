import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";

const protoRoot = fileURLToPath(new URL("../proto", import.meta.url));
const todoProtoRoot = fileURLToPath(new URL("../examples/todo/proto", import.meta.url));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedTargets = [
  {
    displayPath: "packages/proto/generated",
    templatePath: "buf.gen.yaml",
  },
  {
    displayPath: "examples/todo/generated",
    templatePath: "examples/todo/buf.gen.yaml",
  },
];

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTemplatePath(path) {
  return path.split(sep).join("/");
}

function writeStagedTemplate(target, stagedOutputRoot, stageRoot) {
  const sourceTemplatePath = join(repoRoot, target.templatePath);
  const stagedTemplatePath = join(stageRoot, "buf.gen.yaml");
  const sourceTemplate = readFileSync(sourceTemplatePath, "utf8");
  const outputPattern = new RegExp(`(^\\s*out:\\s*)${escapeRegExp(target.displayPath)}\\s*$`, "m");
  const stagedTemplate = sourceTemplate.replace(
    outputPattern,
    `$1${toTemplatePath(stagedOutputRoot)}`,
  );

  if (stagedTemplate === sourceTemplate) {
    throw new Error(
      `Unable to find generated output path ${target.displayPath} in ${target.templatePath}.`,
    );
  }

  writeFileSync(stagedTemplatePath, stagedTemplate);
  return stagedTemplatePath;
}

function assertGeneratedPathSafe(root, generatedPath) {
  const generatedRoot = join(root, generatedPath);
  const ancestorFailures = findSymlinkedAncestors(root, generatedPath);

  if (ancestorFailures.length > 0) {
    for (const failure of ancestorFailures) {
      console.error(`Generated path ancestor must not be a symlink: ${failure}`);
    }

    return false;
  }

  const generatedStat = lstatIfPresent(generatedRoot);

  if (generatedStat !== undefined && generatedStat.isSymbolicLink()) {
    console.error(`Generated directory must not be a symlink: ${generatedPath}`);
    return false;
  }

  return true;
}

export function prepareGeneratedOutput(root = repoRoot) {
  for (const target of generatedTargets) {
    if (!assertGeneratedPathSafe(root, target.displayPath)) {
      return 1;
    }

    mkdirSync(join(root, target.displayPath), { recursive: true });
  }

  return 0;
}

function replaceGeneratedRoot(generatedRoot, stagedOutputRoot, stageRoot) {
  const backupRoot = join(stageRoot, "previous");
  let backupCreated = false;

  try {
    if (existsSync(generatedRoot)) {
      renameSync(generatedRoot, backupRoot);
      backupCreated = true;
    }

    renameSync(stagedOutputRoot, generatedRoot);
  } catch (error) {
    if (backupCreated && !existsSync(generatedRoot)) {
      renameSync(backupRoot, generatedRoot);
      backupCreated = false;
    }

    throw error;
  }

  if (backupCreated) {
    rmSync(backupRoot, { recursive: true, force: true });
  }
}

function generateTarget(target) {
  const generatedRoot = join(repoRoot, target.displayPath);
  const generatedParent = dirname(generatedRoot);

  if (!assertGeneratedPathSafe(repoRoot, target.displayPath)) {
    return 1;
  }

  mkdirSync(generatedParent, { recursive: true });

  const stageRoot = mkdtempSync(join(generatedParent, ".generated-"));
  const stagedOutputRoot = join(stageRoot, "output");

  try {
    mkdirSync(stagedOutputRoot, { recursive: true });

    const stagedTemplatePath = writeStagedTemplate(target, stagedOutputRoot, stageRoot);
    const generateStatus = runCommand(
      `buf generate ${target.displayPath}`,
      resolveBufExecutable(),
      ["generate", "--template", stagedTemplatePath],
    );

    if (generateStatus !== 0) {
      return generateStatus;
    }

    if (!assertGeneratedPathSafe(repoRoot, target.displayPath)) {
      return 1;
    }

    replaceGeneratedRoot(generatedRoot, stagedOutputRoot, stageRoot);
    return 0;
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
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
    const prepareStatus = prepareGeneratedOutput();

    if (prepareStatus !== 0) {
      return prepareStatus;
    }

    for (const target of generatedTargets) {
      const generateStatus = generateTarget(target);

      if (generateStatus !== 0) {
        return generateStatus;
      }
    }

    return 0;
  }

  return runCommand("buf lint", resolveBufExecutable(), ["lint"]);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
