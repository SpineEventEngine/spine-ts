import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";

const protoRoot = fileURLToPath(new URL("../proto", import.meta.url));
const todoProtoRoot = fileURLToPath(new URL("../examples/todo/proto", import.meta.url));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const generatedTargets = [
  {
    displayPath: "packages/proto/generated",
    templatePath: "buf.gen.yaml",
  },
  {
    displayPath: "examples/todo/generated",
    templatePath: "examples/todo/buf.gen.yaml",
  },
];

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

    return generateTargets();
  }

  return runCommand("buf lint", resolveBufExecutable(), ["lint"]);
}

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

export function writeStagedTemplate(target, stagedOutputRoot, stageRoot, root) {
  const sourceTemplatePath = join(root, target.templatePath);
  const stagedTemplatePath = join(stageRoot, "buf.gen.yaml");
  const sourceTemplate = readFileSync(sourceTemplatePath, "utf8");
  const outputPattern = new RegExp(`(^\\s*out:\\s*)${escapeRegExp(target.displayPath)}\\s*$`, "gm");
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

function assertNoSymlinksInTree(root, displayPath) {
  const rootStat = lstatIfPresent(root);

  if (rootStat === undefined) {
    throw new Error(`Staged generated output is missing: ${displayPath}`);
  }

  if (rootStat.isSymbolicLink()) {
    throw new Error(`Staged generated output must not contain symlinks: ${displayPath}`);
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Staged generated output must be a directory: ${displayPath}`);
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    const entryDisplayPath = `${displayPath}/${entry.name}`;
    const entryStat = lstatIfPresent(entryPath);

    if (entryStat === undefined) {
      continue;
    }

    if (entryStat.isSymbolicLink()) {
      throw new Error(`Staged generated output must not contain symlinks: ${entryDisplayPath}`);
    }

    if (entryStat.isDirectory()) {
      assertNoSymlinksInTree(entryPath, entryDisplayPath);
    }
  }
}

function clearDirectoryContents(directory) {
  mkdirSync(directory, { recursive: true });

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    rmSync(join(directory, entry.name), { recursive: true, force: true });
  }
}

function copyDirectoryContents(source, destination) {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    cpSync(sourcePath, destinationPath, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
}

function backupGeneratedRoot(generatedRoot, stageRoot) {
  const backupRoot = join(stageRoot, "previous");
  const hadPreviousRoot = existsSync(generatedRoot);

  rmSync(backupRoot, { recursive: true, force: true });

  if (hadPreviousRoot) {
    cpSync(generatedRoot, backupRoot, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }

  return {
    backupRoot,
    generatedRoot,
    hadPreviousRoot,
  };
}

function mirrorStagedOutput(generatedRoot, stagedOutputRoot) {
  clearDirectoryContents(generatedRoot);
  copyDirectoryContents(stagedOutputRoot, generatedRoot);
}

function removePublishedBackup(publishedRoot) {
  rmSync(publishedRoot.backupRoot, { recursive: true, force: true });
}

function restorePublishedRoot(publishedRoot) {
  clearDirectoryContents(publishedRoot.generatedRoot);

  if (publishedRoot.hadPreviousRoot && existsSync(publishedRoot.backupRoot)) {
    copyDirectoryContents(publishedRoot.backupRoot, publishedRoot.generatedRoot);
  }
}

export function publishGeneratedTargets(stagedTargets, root = repoRoot, options = {}) {
  const publishedRoots = [];

  try {
    for (const stagedTarget of stagedTargets) {
      if (!assertGeneratedPathSafe(root, stagedTarget.target.displayPath)) {
        throw new Error(`Generated path is not safe: ${stagedTarget.target.displayPath}`);
      }

      assertNoSymlinksInTree(
        stagedTarget.stagedOutputRoot,
        `${stagedTarget.target.displayPath} staging`,
      );

      const publishedRoot = backupGeneratedRoot(stagedTarget.generatedRoot, stagedTarget.stageRoot);

      publishedRoots.push(publishedRoot);
      options.afterBackup?.(publishedRoot);
      mirrorStagedOutput(stagedTarget.generatedRoot, stagedTarget.stagedOutputRoot);
    }
  } catch (error) {
    for (const publishedRoot of publishedRoots.slice().reverse()) {
      restorePublishedRoot(publishedRoot);
    }

    throw error;
  }

  for (const publishedRoot of publishedRoots) {
    removePublishedBackup(publishedRoot);
  }
}

function removeStagedTargets(stagedTargets) {
  for (const stagedTarget of stagedTargets) {
    rmSync(stagedTarget.stageRoot, { recursive: true, force: true });
  }
}

function createTargetStage(target, root = repoRoot) {
  const generatedRoot = join(root, target.displayPath);
  const generatedParent = dirname(generatedRoot);

  if (!assertGeneratedPathSafe(root, target.displayPath)) {
    return undefined;
  }

  mkdirSync(generatedParent, { recursive: true });

  const stageRoot = mkdtempSync(join(generatedParent, ".generated-"));
  const stagedOutputRoot = join(stageRoot, "generated");

  try {
    mkdirSync(stagedOutputRoot, { recursive: true });

    const stagedTemplatePath = writeStagedTemplate(target, stagedOutputRoot, stageRoot, root);

    return {
      generatedRoot,
      stagedOutputRoot,
      stagedTemplatePath,
      stageRoot,
      target,
    };
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

export function stageGeneratedTargets(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const run = options.runCommand ?? runCommand;
  const stagedTargets = [];

  try {
    for (const target of generatedTargets) {
      const stagedTarget = createTargetStage(target, root);

      if (stagedTarget === undefined) {
        removeStagedTargets(stagedTargets);
        return {
          stagedTargets: [],
          status: 1,
        };
      }

      stagedTargets.push(stagedTarget);

      const generateStatus = run(`buf generate ${target.displayPath}`, resolveBufExecutable(), [
        "generate",
        "--template",
        stagedTarget.stagedTemplatePath,
      ]);

      if (generateStatus !== 0) {
        removeStagedTargets(stagedTargets);
        return {
          stagedTargets: [],
          status: generateStatus,
        };
      }
    }

    const registryStatus = generateTodoHandlerRegistry(stagedTargets, root, run);

    if (registryStatus !== 0) {
      removeStagedTargets(stagedTargets);
      return {
        stagedTargets: [],
        status: registryStatus,
      };
    }

    return {
      stagedTargets,
      status: 0,
    };
  } catch (error) {
    console.error(
      `Failed to stage generated output: ${error instanceof Error ? error.message : String(error)}`,
    );
    removeStagedTargets(stagedTargets);
    return {
      stagedTargets: [],
      status: 1,
    };
  }
}

export function cleanupStagedTargets(stagedTargets) {
  removeStagedTargets(stagedTargets);
}

export function generateTargets(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const staged = stageGeneratedTargets(options);

  if (staged.status !== 0) {
    return staged.status;
  }

  try {
    publishGeneratedTargets(staged.stagedTargets, root);
    return 0;
  } catch (error) {
    console.error(
      `Failed to publish generated output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  } finally {
    cleanupStagedTargets(staged.stagedTargets);
  }
}

function generateTodoHandlerRegistry(stagedTargets, root = repoRoot, run = runCommand) {
  const stagedTodoTarget = stagedTargets.find(
    (stagedTarget) => stagedTarget.target.displayPath === "examples/todo/generated",
  );

  if (stagedTodoTarget === undefined) {
    console.error("Missing staged to-do generated target for handler registry generation.");
    return 1;
  }

  const publishedOutputFile = join(
    stagedTodoTarget.generatedRoot,
    "handler/generated-handler-registry.ts",
  );
  const stagedOutputFile = join(
    stagedTodoTarget.stagedOutputRoot,
    "handler/generated-handler-registry.ts",
  );

  return run("to-do handler registry generation", process.execPath, [
    join(root, "scripts/generate-handler-registry.mjs"),
    "--project",
    join(root, "examples/todo/tsconfig.json"),
    "--generated-root",
    stagedTodoTarget.stagedOutputRoot,
    "--source-generated-root",
    stagedTodoTarget.generatedRoot,
    "--out",
    stagedOutputFile,
    "--published-out",
    publishedOutputFile,
  ]);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
