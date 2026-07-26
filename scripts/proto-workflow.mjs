import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";
import { writeSpineProtoArtifacts } from "./generate-spine-proto-artifacts.mjs";

const protoRoot = fileURLToPath(new URL("../packages/proto/proto", import.meta.url));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const generatedTargets = [
  {
    displayPath: "packages/proto/generated",
    templatePath: "buf.gen.yaml",
    protoRoot,
  },
];
export const modelAtomicTargets = [
  {
    displayPath: "examples/todo/generated",
    packagePath: "examples/todo",
    moduleName: "Todo",
    templatePath: "examples/todo/buf.gen.custom.yaml",
    handlerProjectPath: "examples/todo/tsconfig.json",
  },
  {
    displayPath: "examples/project-management/generated",
    packagePath: "examples/project-management",
    moduleName: "Project Management",
    handlerProjectPath: "examples/project-management/tsconfig.json",
  },
  {
    displayPath: "examples/datastore-orders/generated",
    packagePath: "examples/datastore-orders",
    moduleName: "Datastore Orders",
    handlerProjectPath: "examples/datastore-orders/tsconfig.json",
  },
  {
    displayPath: "examples/users-model/generated",
    packagePath: "examples/users-model",
    moduleName: "Users",
  },
  {
    displayPath: "examples/chat-model/generated",
    packagePath: "examples/chat-model",
    moduleName: "Chat",
  },
];
export const atomicGeneratedTargets = [...generatedTargets, ...modelAtomicTargets];

export function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (command !== "lint" && command !== "generate") {
    console.error("Usage: node scripts/proto-workflow.mjs <lint|generate>");
    return 1;
  }

  const protoFiles = [
    ...generatedTargets.flatMap((target) => findProtoFiles(target.protoRoot)),
    ...modelAtomicTargets.flatMap((target) =>
      findProtoFiles(join(repoRoot, target.packagePath, "proto")),
    ),
  ];

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

  const descriptorStatus = runCommand("frozen descriptor compatibility", process.execPath, [
    join(repoRoot, "packages/proto/scripts/verify-descriptor-compatibility.mjs"),
  ]);

  if (descriptorStatus !== 0) {
    return descriptorStatus;
  }

  if (command === "generate") return generateTargets();

  return runCommand("buf lint", resolveBufExecutable(), ["lint"]);
}

function runCommand(label, executable, args) {
  return runCommandIn(label, executable, args, repoRoot);
}

function runCommandIn(label, executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
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

function publicationJournalPath(root) {
  return join(root, ".spine-proto-publication.json");
}

function writePublicationJournal(path, journal, operations) {
  const replacement = `${path}.next`;
  operations.write(replacement, `${JSON.stringify(journal)}\n`);
  operations.rename(replacement, path);
}

function readPublicationJournal(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isContainedPath(parent, candidate) {
  const path = relative(parent, candidate);
  return path.length > 0 && !path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep);
}

function isStagedSibling(parent, candidate) {
  if (!isContainedPath(parent, candidate)) return false;
  return relative(parent, candidate).split(sep)[0]?.startsWith(".generated-") === true;
}

function validatePublicationJournal(root, journal) {
  if (
    typeof journal !== "object" ||
    journal === null ||
    ![1, 2, 3].includes(journal.version) ||
    !["preparing", "committing", "committed"].includes(journal.state) ||
    !Array.isArray(journal.targets)
  ) {
    throw new Error("invalid publication journal");
  }
  const allowedTargets = new Set(
    atomicGeneratedTargets.map((target) => join(root, target.displayPath)),
  );
  const seenTargets = new Set();
  for (const target of journal.targets) {
    if (
      typeof target !== "object" ||
      target === null ||
      typeof target.target !== "string" ||
      typeof target.staged !== "string" ||
      typeof target.backup !== "string" ||
      typeof target.hadPrevious !== "boolean" ||
      !allowedTargets.has(target.target) ||
      seenTargets.has(target.target)
    ) {
      throw new Error("invalid publication journal");
    }
    const parent = dirname(target.target);
    if (
      !isStagedSibling(parent, target.staged) ||
      dirname(target.backup) !== parent ||
      !basename(target.backup).startsWith(`.${basename(target.target)}.backup-`)
    ) {
      throw new Error("invalid publication journal");
    }
    seenTargets.add(target.target);
  }
  const files = journalFiles(journal);
  const allowedManifests = new Set([
    join(root, "packages/proto/spine-proto-manifest.json"),
    ...modelAtomicTargets.map((target) =>
      join(root, target.packagePath, "spine-proto-manifest.json"),
    ),
  ]);
  const allowedFiles = new Set([
    ...allowedManifests,
    join(root, "examples/chat/src/model-registry.ts"),
  ]);
  if (!Array.isArray(files) || new Set(files.map((entry) => entry?.target)).size !== files.length)
    throw new Error("invalid publication journal");
  if (journal.state === "committing" && files.length === 0)
    throw new Error("invalid publication journal");
  for (const file of files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.target !== "string" ||
      typeof file.staged !== "string" ||
      typeof file.backup !== "string" ||
      typeof file.hadPrevious !== "boolean" ||
      typeof file.contents !== "string" ||
      !allowedFiles.has(file.target) ||
      !isStagedSibling(dirname(file.target), file.staged) ||
      dirname(file.backup) !== dirname(file.target) ||
      !(
        basename(file.backup).startsWith(`.${basename(file.target)}.backup-`) ||
        (basename(file.target) === "spine-proto-manifest.json" &&
          basename(file.backup).startsWith(".spine-proto-manifest.backup-"))
      )
    )
      throw new Error("invalid publication journal");
  }
}

function journalFiles(journal) {
  if (journal.version === 3) return journal.files;
  if (journal.version === 2) return journal.manifests;
  return journal.manifest === undefined ? [] : [journal.manifest];
}

function assertSafeRecoveryEntry(root, path, expectedKind) {
  if (findSymlinkedAncestors(root, relative(root, path)).length > 0)
    throw new Error("unsafe publication recovery entry");
  const entry = lstatIfPresent(path);
  if (entry === undefined) return;
  if (
    entry.isSymbolicLink() ||
    (expectedKind === "directory" && !entry.isDirectory()) ||
    (expectedKind === "file" && !entry.isFile())
  ) {
    throw new Error("unsafe publication recovery entry");
  }
}

function assertSafeRecoveryJournal(root, journal) {
  for (const target of journal.targets) {
    assertSafeRecoveryEntry(root, target.target, "directory");
    assertSafeRecoveryEntry(root, target.staged, "directory");
    assertSafeRecoveryEntry(root, target.backup, "directory");
  }
  for (const file of journalFiles(journal)) {
    assertSafeRecoveryEntry(root, file.target, "file");
    assertSafeRecoveryEntry(root, file.staged, "file");
    assertSafeRecoveryEntry(root, file.backup, "file");
  }
}

function removeEmptyStageParent(path, operations) {
  if (existsSync(path) && readdirSync(path).length === 0) operations.remove(path);
}

function assertPublicationFilesSafe(root, publicationFiles) {
  for (const file of publicationFiles) {
    for (const path of [file.target, file.staged, file.backup]) {
      if (findSymlinkedAncestors(root, relative(root, path)).length > 0)
        throw new Error("unsafe publication file");
    }
    const staged = lstatIfPresent(file.staged);
    const target = lstatIfPresent(file.target);
    if (
      staged === undefined ||
      staged.isSymbolicLink() ||
      !staged.isFile() ||
      (target !== undefined && (target.isSymbolicLink() || !target.isFile()))
    ) {
      throw new Error("unsafe publication file");
    }
  }
}

function recoverPublication(root, operations = defaultPublicationOperations) {
  const journalPath = publicationJournalPath(root);
  if (!existsSync(journalPath)) {
    operations.remove(`${journalPath}.next`);
    return;
  }
  const journal = readPublicationJournal(journalPath);
  validatePublicationJournal(root, journal);
  assertSafeRecoveryJournal(root, journal);
  const committed =
    journal.state === "committed" ||
    (journal.state === "committing" &&
      journalFiles(journal).every(
        (file) => existsSync(file.target) && readFileSync(file.target, "utf8") === file.contents,
      ));

  if (!committed) {
    for (const target of [...journal.targets].reverse()) {
      if (existsSync(target.backup)) {
        operations.remove(target.target);
        operations.rename(target.backup, target.target);
      } else if (!target.hadPrevious) {
        operations.remove(target.target);
      }
    }
    for (const file of journalFiles(journal).reverse()) {
      if (existsSync(file.backup)) {
        operations.remove(file.target);
        operations.rename(file.backup, file.target);
      } else if (!file.hadPrevious) operations.remove(file.target);
    }
  }

  for (const target of journal.targets) {
    operations.remove(target.backup);
    operations.remove(target.staged);
  }
  for (const file of journalFiles(journal)) {
    operations.remove(file.backup);
    operations.remove(file.staged);
    removeEmptyStageParent(dirname(file.staged), operations);
  }
  operations.remove(journalPath);
  operations.remove(`${journalPath}.next`);
}

const defaultPublicationOperations = {
  rename: renameSync,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  write: (path, contents) => writeFileSync(path, contents, "utf8"),
};

function probeWorkflowClaimLiveness(pid, probe = (candidate) => process.kill(candidate, 0)) {
  try {
    probe(pid);
    return "alive";
  } catch (error) {
    return error?.code === "ESRCH" ? "dead" : "indeterminate";
  }
}

const defaultWorkflowLockOperations = {
  create: (path, contents) => writeFileSync(path, contents, { flag: "wx" }),
  list: (directory) => readdirSync(directory),
  read: (path) => readFileSync(path, "utf8"),
  inspect: (path) => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) return "symlink";
    return entry.isFile() ? "regular" : "other";
  },
  remove: (path) => unlinkSync(path),
  liveness: (pid) => probeWorkflowClaimLiveness(pid),
};

function acquireWorkflowLock(root, overrides = {}) {
  const operations = { ...defaultWorkflowLockOperations, ...overrides };
  const token = randomUUID();
  const path = join(root, `.spine-proto-workflow.lock.${token}`);
  try {
    operations.create(path, JSON.stringify({ pid: process.pid, token }));
  } catch {
    throw new Error("cannot acquire workflow generation claim");
  }
  try {
    for (let scan = 0; scan < 2; scan += 1) {
      const claims = operations
        .list(root)
        .filter((name) => name.startsWith(".spine-proto-workflow.lock."))
        .sort();
      if (claims.length > 1000) throw new Error("workflow generation claim count exceeds 1000");
      for (const name of claims) {
        const candidate = join(root, name);
        if (candidate === path) continue;
        if (operations.inspect(candidate) !== "regular")
          throw new Error("workflow generation claim is not a regular file");
        let owner;
        try {
          owner = JSON.parse(operations.read(candidate));
        } catch {
          throw new Error("workflow generation claim has invalid owner metadata");
        }
        if (typeof owner.pid !== "number" || owner.pid <= 0)
          throw new Error("workflow generation claim has invalid owner metadata");
        if (operations.liveness(owner.pid) !== "dead")
          throw new Error("workflow generation already in progress");
        operations.remove(candidate);
      }
    }
  } catch (error) {
    try {
      operations.remove(path);
    } catch {
      // Preserve the primary claim-admission failure.
    }
    throw error;
  }
  return { operations, path, token };
}

function releaseWorkflowLock(lock) {
  try {
    const owner = JSON.parse(lock.operations.read(lock.path));
    if (owner.token !== lock.token || lock.operations.inspect(lock.path) !== "regular")
      throw new Error();
    lock.operations.remove(lock.path);
  } catch {
    throw new Error("cannot clean up workflow generation claim");
  }
}

export function publishGeneratedTargets(stagedTargets, root = repoRoot, options = {}) {
  const operations = { ...defaultPublicationOperations, ...options.operations };
  recoverPublication(root, operations);
  const targets = stagedTargets.map((stagedTarget) => ({
    target: stagedTarget.generatedRoot,
    staged: stagedTarget.stagedOutputRoot,
    backup: join(
      dirname(stagedTarget.generatedRoot),
      `.${basename(stagedTarget.generatedRoot)}.backup-${randomUUID()}`,
    ),
    hadPrevious: existsSync(stagedTarget.generatedRoot),
  }));
  const journalPath = publicationJournalPath(root);
  const publicationFiles = options.files ?? [];
  const journal = { version: 3, state: "preparing", targets, files: publicationFiles };

  try {
    for (const stagedTarget of stagedTargets) {
      if (!assertGeneratedPathSafe(root, stagedTarget.target.displayPath))
        throw new Error(`Generated path is not safe: ${stagedTarget.target.displayPath}`);
      assertNoSymlinksInTree(
        stagedTarget.stagedOutputRoot,
        `${stagedTarget.target.displayPath} staging`,
      );
    }
    validatePublicationJournal(root, journal);
    assertPublicationFilesSafe(root, publicationFiles);
    writePublicationJournal(journalPath, journal, operations);
    for (const target of targets) {
      if (target.hadPrevious) operations.rename(target.target, target.backup);
      options.afterBackup?.(target);
      operations.rename(target.staged, target.target);
    }
    options.beforeFinalize?.();
    if (journalFiles(journal).length > 0) {
      journal.state = "committing";
      writePublicationJournal(journalPath, journal, operations);
      for (const file of journalFiles(journal)) {
        if (file.hadPrevious) operations.rename(file.target, file.backup);
        operations.rename(file.staged, file.target);
      }
    }
    journal.state = "committed";
    writePublicationJournal(journalPath, journal, operations);
    recoverPublication(root, operations);
  } catch (error) {
    try {
      recoverPublication(root, operations);
    } catch {
      // The journal remains the bounded recovery record for the next invocation.
    }
    throw error;
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

    const spineTarget = stagedTargets.find(
      (candidate) => candidate.target.displayPath === "packages/proto/generated",
    );
    if (spineTarget !== undefined && existsSync(join(root, "packages/proto/spine-proto.json"))) {
      const stagedManifest = join(spineTarget.stageRoot, "spine-proto-manifest.json");
      (options.writeSpineArtifacts ?? writeSpineProtoArtifacts)(
        root,
        spineTarget.stagedOutputRoot,
        stagedManifest,
      );
      if (!existsSync(stagedManifest)) throw new Error("Spine staged manifest is missing");
    }

    for (const target of modelAtomicTargets) {
      const modelStage = stageModel(target, root, options);
      if (modelStage.status !== 0) {
        removeStagedTargets(stagedTargets);
        return { stagedTargets: [], status: modelStage.status };
      }
      if (modelStage.stagedTarget !== undefined) stagedTargets.push(modelStage.stagedTarget);
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

function stageModel(target, root, options = {}) {
  const livePackageRoot = join(root, target.packagePath);
  if (!existsSync(join(livePackageRoot, "spine-proto.json"))) return { status: 0 };
  const stageRoot = mkdtempSync(join(livePackageRoot, ".generated-"));
  const packageRoot = stageRoot;
  const output = join(packageRoot, "generated");
  const run = options.runModelCommand ?? runCommandIn;
  try {
    for (const name of ["package.json", "spine-proto.json", "proto"]) {
      cpSync(join(livePackageRoot, name), join(packageRoot, name), {
        recursive: true,
        dereference: false,
      });
    }
    const modelStatus = run(
      `${target.moduleName} model generation`,
      process.execPath,
      [join(root, "packages/proto-tools/dist/src/cli/spine-proto.js")],
      packageRoot,
    );
    if (modelStatus !== 0) throw new Error(`${target.moduleName} model generation failed`);
    if (target.templatePath !== undefined) {
      const template = writeStagedTemplate(target, output, stageRoot, root);
      const companionStatus = run(
        `${target.moduleName} companion generation`,
        resolveBufExecutable(),
        ["generate", "--template", template],
        root,
      );
      if (companionStatus !== 0)
        throw new Error(`${target.moduleName} companion generation failed`);
    }
    const handlerStatus =
      target.handlerProjectPath === undefined
        ? 0
        : run(
            `${target.moduleName} handler registry post-step`,
            process.execPath,
            [
              join(root, "scripts/generate-handler-registry.mjs"),
              "--project",
              join(root, target.handlerProjectPath),
              "--generated-root",
              output,
              "--source-generated-root",
              join(livePackageRoot, "generated"),
              "--out",
              join(output, "handler/generated-handler-registry.ts"),
              "--published-out",
              join(livePackageRoot, "generated/handler/generated-handler-registry.ts"),
            ],
            root,
          );
    if (handlerStatus !== 0)
      throw new Error(`${target.moduleName} handler registry post-step failed`);
    if (!existsSync(join(packageRoot, "spine-proto-manifest.json")))
      throw new Error(`${target.moduleName} staged manifest is missing`);
    return {
      status: 0,
      stagedTarget: {
        generatedRoot: join(livePackageRoot, "generated"),
        stagedOutputRoot: output,
        stageRoot,
        target,
        files: [
          {
            target: join(livePackageRoot, "spine-proto-manifest.json"),
            staged: join(packageRoot, "spine-proto-manifest.json"),
          },
        ],
      },
    };
  } catch (error) {
    console.error(
      `Failed to stage ${target.moduleName} output: ${error instanceof Error ? error.message : String(error)}`,
    );
    rmSync(stageRoot, { recursive: true, force: true });
    return { status: 1 };
  }
}

export function cleanupStagedTargets(stagedTargets) {
  removeStagedTargets(stagedTargets);
}

export function stageChatRegistry(root, options = {}) {
  const liveRoot = join(root, "examples/chat");
  if (!existsSync(join(liveRoot, "spine-proto.json"))) return undefined;
  const stageRoot = mkdtempSync(join(liveRoot, ".generated-"));
  let fileStageRoot;
  try {
    cpSync(join(liveRoot, "package.json"), join(stageRoot, "package.json"), {
      dereference: false,
    });
    cpSync(join(liveRoot, "spine-proto.json"), join(stageRoot, "spine-proto.json"), {
      dereference: false,
    });
    const run = options.runCompositionCommand ?? runCommandIn;
    const status = run(
      "Chat model registry composition",
      process.execPath,
      [join(root, "packages/proto-tools/dist/src/cli/spine-proto.js"), "compose"],
      stageRoot,
    );
    if (status !== 0) throw new Error("Chat model registry composition failed");
    const rendered = join(stageRoot, "src/model-registry.ts");
    if (!existsSync(rendered)) throw new Error("Chat staged registry is missing");
    const target = join(liveRoot, "src/model-registry.ts");
    fileStageRoot = mkdtempSync(join(dirname(target), ".generated-"));
    const staged = join(fileStageRoot, "model-registry.ts");
    cpSync(rendered, staged, { dereference: false });
    return { stageRoot, fileStageRoot, target, staged };
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    if (fileStageRoot !== undefined) rmSync(fileStageRoot, { recursive: true, force: true });
    throw error;
  }
}

export function generateTargets(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  let lock;
  try {
    lock = acquireWorkflowLock(root, options.lockOperations);
  } catch (error) {
    console.error(
      `Failed to acquire generated output ownership: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }
  let status = 1;
  let primaryFailure = false;
  let staged;
  let chatRegistry;
  try {
    recoverPublication(root, { ...defaultPublicationOperations, ...options.publicationOperations });
    const prepareStatus = prepareGeneratedOutput(root);
    if (prepareStatus !== 0) {
      primaryFailure = true;
      status = prepareStatus;
    } else {
      staged = stageGeneratedTargets(options);
      if (staged.status !== 0) {
        primaryFailure = true;
        status = staged.status;
      } else {
        chatRegistry = stageChatRegistry(root, options);
        const spineTarget = staged.stagedTargets.find(
          (candidate) => candidate.target.displayPath === "packages/proto/generated",
        );
        const publicationFiles = [];
        if (spineTarget !== undefined) {
          const stagedManifest = join(spineTarget.stageRoot, "spine-proto-manifest.json");
          if (!existsSync(stagedManifest)) throw new Error("Spine staged manifest is missing");
          const manifest = join(root, "packages/proto/spine-proto-manifest.json");
          publicationFiles.push({
            target: manifest,
            staged: stagedManifest,
            backup: join(dirname(manifest), `.spine-proto-manifest.backup-${randomUUID()}`),
            hadPrevious: existsSync(manifest),
            contents: readFileSync(stagedManifest, "utf8"),
          });
        }
        for (const stagedTarget of staged.stagedTargets) {
          for (const stagedFile of stagedTarget.files ?? []) {
            if (!existsSync(stagedFile.staged)) throw new Error("model staged manifest is missing");
            publicationFiles.push({
              target: stagedFile.target,
              staged: stagedFile.staged,
              backup: join(
                dirname(stagedFile.target),
                `.spine-proto-manifest.backup-${randomUUID()}`,
              ),
              hadPrevious: existsSync(stagedFile.target),
              contents: readFileSync(stagedFile.staged, "utf8"),
            });
          }
        }
        if (chatRegistry !== undefined) {
          publicationFiles.push({
            target: chatRegistry.target,
            staged: chatRegistry.staged,
            backup: join(
              dirname(chatRegistry.target),
              `.${basename(chatRegistry.target)}.backup-${randomUUID()}`,
            ),
            hadPrevious: existsSync(chatRegistry.target),
            contents: readFileSync(chatRegistry.staged, "utf8"),
          });
        }
        publishGeneratedTargets(staged.stagedTargets, root, {
          operations: options.publicationOperations,
          files: publicationFiles,
        });
        status = 0;
      }
    }
  } catch (error) {
    primaryFailure = true;
    console.error(
      `Failed to publish generated output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    try {
      if (staged !== undefined) cleanupStagedTargets(staged.stagedTargets);
    } catch {
      primaryFailure = true;
      status = 1;
    }
    if (chatRegistry !== undefined) {
      rmSync(chatRegistry.stageRoot, { recursive: true, force: true });
      rmSync(chatRegistry.fileStageRoot, { recursive: true, force: true });
    }
    try {
      releaseWorkflowLock(lock);
    } catch (error) {
      if (!primaryFailure) {
        console.error(
          `Failed to release generated output ownership: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        status = 1;
      }
    }
  }
  return status;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
