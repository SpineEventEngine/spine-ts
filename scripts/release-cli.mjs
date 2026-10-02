import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import {
  createPublicationReport,
  createPublicRegistry,
  confirmPrepared,
  publishPrepared,
  validatePriorReport,
  npmPublishArgs,
} from "./release-publication.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";
import { verifyRegistryReleaseState } from "./release-registry.mjs";
import {
  inspectPackedArtifact,
  packFrameworkArtifacts,
  proveExactTarballConsumer,
} from "./snapshot-artifacts.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifestName = "release-manifest.json";

/**
 * Runs a local preparation command and fails if it exits unsuccessfully.
 *
 * @param command Executable to run.
 * @param args Command arguments.
 * @param cwd Working directory.
 */
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(command + " failed");
}

/**
 * Reads a named option without interpreting it as a command.
 *
 * @param argv Command arguments.
 * @param name Option to locate.
 * @returns Option value, when supplied.
 */
function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 || argv[index + 1]?.startsWith("--") ? undefined : argv[index + 1];
}

/**
 * Reads the checkout commit and rejects a mismatched GitHub publication source.
 *
 * @returns Full lowercase Git commit SHA.
 */
function sourceCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const sha = result.stdout?.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error("Invalid source commit");
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha)
    throw new Error("GitHub source commit differs from checkout");
  return sha;
}

/**
 * Packs, proves, and records exact archives in a persistent or temporary directory.
 *
 * @param destination Persistent release directory.
 * @param check Whether to use a temporary verification directory.
 * @param expected Current release policy.
 * @param sourceSha Commit that prepared the archive.
 * @param pack Archive packing callback.
 * @param prove External consumer proof callback.
 * @param persist Manifest writer.
 * @param load Saved archive validator used before preparation succeeds.
 * @param registerSignal Interruption registration callback.
 * @param exit Process exit callback.
 * @param createDirectory Persistent output creation callback.
 * @returns Validated release manifest.
 */
export function prepareRelease({
  destination,
  check = false,
  expected,
  sourceSha,
  pack,
  prove,
  persist,
  load = loadPrepared,
  registerSignal = (signal, handler) => {
    process.once(signal, handler);
    return () => process.off(signal, handler);
  },
  exit = process.exit,
  createDirectory = (directory) => mkdirSync(directory),
}) {
  if (!check && existsSync(destination))
    throw new Error("Release output already exists: " + destination);
  const output = check ? mkdtempSync(join(tmpdir(), "spine-release-")) : destination;
  const state = { created: check };
  let complete = false;
  const cleanup = () => {
    if (state.created) rmSync(output, { force: true, recursive: true });
  };
  try {
    const manifest = withPreparationSignals(cleanup, registerSignal, exit, () => {
      if (!check) createPreparationOutput(output, createDirectory, state);
      return recordPreparedRelease(output, expected, sourceSha, pack, prove, persist, load);
    });
    complete = true;
    return manifest;
  } finally {
    if (check || !complete) cleanup();
  }
}

/**
 * Creates persistent output after interruption handlers are registered.
 *
 * @param output New release directory.
 * @param createDirectory Directory creation callback.
 * @param state Tracks whether interruption cleanup may remove the directory.
 */
function createPreparationOutput(output, createDirectory, state) {
  state.created = true;
  try {
    createDirectory(output);
  } catch (error) {
    if (error.code === "EEXIST") state.created = false;
    throw error;
  }
}

/**
 * Packs and proves archives before recording their release manifest.
 *
 * @param output Preparation directory.
 * @param expected Current release policy.
 * @param sourceSha Source commit.
 * @param pack Archive packing callback.
 * @param prove External consumer proof callback.
 * @param persist Manifest writer.
 * @param load Saved archive validator.
 * @returns Prepared release manifest.
 */
function recordPreparedRelease(output, expected, sourceSha, pack, prove, persist, load) {
  const packages = pack({ root, destination: output });
  prove({ root, destination: output, packages });
  const value = createReleaseManifest({ expected, packages, sourceSha });
  persist(join(output, manifestName), value);
  load(output, expected, sourceSha);
  return value;
}

/**
 * Removes incomplete archives on SIGINT or SIGTERM during preparation.
 *
 * @param cleanup Removes the created preparation directory on interruption.
 * @param registerSignal Signal registration callback.
 * @param exit Process exit callback.
 * @param work Synchronous packing and proof operation.
 * @returns Result of completed preparation work.
 */
function withPreparationSignals(cleanup, registerSignal, exit, work) {
  const interrupt = (code) => {
    cleanup();
    exit(code);
  };
  const removeInterrupt = registerSignal("SIGINT", () => interrupt(130));
  const removeTerminate = registerSignal("SIGTERM", () => interrupt(143));
  try {
    return work();
  } finally {
    removeInterrupt();
    removeTerminate();
  }
}

/**
 * Writes a release or attempt report atomically.
 *
 * @param path Destination JSON path.
 * @param value Serializable report.
 */
function writeReport(path, value) {
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * Validates archive bytes, content, inventory, version, and source before publication.
 *
 * @param directory Saved release directory.
 * @param expected Current checkout release policy.
 * @param sourceSha Current checkout commit.
 * @returns Validated manifest with archive paths local to the saved directory.
 */
export function loadPrepared(directory, expected, sourceSha) {
  const manifest = JSON.parse(readFileSync(join(directory, manifestName), "utf8"));
  const checksum = (file) =>
    "sha512-" +
    createHash("sha512")
      .update(readFileSync(join(directory, file)))
      .digest("base64");
  validateReleaseManifest(manifest, expected, checksum, sourceSha);
  const archives = readdirSync(directory)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (
    JSON.stringify(archives) !==
    JSON.stringify(manifest.packages.map(({ tarball }) => tarball).sort())
  )
    throw new Error("Saved release contains extra or missing archives");
  for (const entry of manifest.packages) {
    const actual = inspectPackedArtifact({ root, tarball: join(directory, entry.tarball), run });
    if (
      actual.name !== entry.name ||
      actual.version !== entry.version ||
      actual.integrity !== entry.integrity ||
      JSON.stringify(actual.dependencies) !== JSON.stringify(entry.dependencies)
    )
      throw new Error("Archive content differs from release manifest: " + entry.name);
  }
  return manifest;
}

/**
 * Creates distinct empty npm configuration files without inherited credentials.
 *
 * @param directory Temporary directory for both empty configuration files.
 * @returns Environment for a token-free npm invocation.
 */
export function npmEnvironment(directory) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:NPM_TOKEN|NODE_AUTH_TOKEN|npm_config_.*(?:token|password|auth|userconfig|globalconfig))$/iu.test(
          key,
        ),
    ),
  );
  env.NPM_CONFIG_USERCONFIG = join(directory, "user.npmrc");
  env.NPM_CONFIG_GLOBALCONFIG = join(directory, "global.npmrc");
  writeFileSync(env.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
  writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });
  return env;
}

/**
 * Publishes one archive through npm with isolated empty config files.
 *
 * @param archive Prepared archive path.
 * @param tag Validated release tag.
 * @param spawn Process runner for the network-producing npm command.
 * @returns npm exit status and captured JSON diagnostics.
 */
function invokeNpm(archive, tag, spawn = spawnSync) {
  const directory = mkdtempSync(join(tmpdir(), "spine-npm-config-"));
  try {
    const result = spawn("npm", npmPublishArgs(archive, tag), {
      cwd: root,
      encoding: "utf8",
      env: npmEnvironment(directory),
      maxBuffer: 1024 * 1024,
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * Executes publication or read-only confirmation over a saved release.
 *
 * @param input Saved release directory.
 * @param reportPath Durable attempt report path.
 * @param priorPath Previous attempt report path, required for a writing rerun.
 * @param verifyOnly Whether to perform read-only confirmation.
 * @param dependencies Focused-test collaborators.
 * @returns Final package report.
 */
export async function executeRelease({
  input,
  reportPath,
  priorPath,
  verifyOnly = false,
  dependencies = {},
}) {
  const expected = dependencies.expected ?? expectedReleaseModel(readReleaseManifests(root));
  const release =
    dependencies.load?.(input, expected, sourceCommit()) ??
    loadPrepared(input, expected, sourceCommit());
  const prior = priorPath ? JSON.parse(readFileSync(priorPath, "utf8")) : undefined;
  if (!verifyOnly && Number(process.env.GITHUB_RUN_ATTEMPT ?? 1) > 1 && prior === undefined)
    throw new Error("A rerun requires its previous publication report");
  if (prior !== undefined) validatePriorReport(prior, release, !verifyOnly);
  const save = dependencies.save ?? ((value) => writeReport(reportPath, value));
  const registry =
    dependencies.registry ?? createPublicRegistry(dependencies.fetch ?? globalThis.fetch);
  const invoke =
    dependencies.invoke ??
    ((tarball, tag) => invokeNpm(join(input, tarball), tag, dependencies.spawn ?? spawnSync));
  let report;
  if (verifyOnly) {
    report = prior ?? createPublicationReport(release);
    for (const record of report.packages) record.status = "unconfirmed";
    await save(report);
  } else report = await publishPrepared({ release, registry, invoke, save, prior });
  report = await confirmPrepared({ release, report, registry, save, ...dependencies.confirmation });
  if (report.packages.some(({ status }) => status !== "published" && status !== "already present"))
    throw new Error("Publication confirmation remains unconfirmed");
  return report;
}

/**
 * Dispatches release preparation, preflight, publication, and read-only verification.
 *
 * @param argv Command arguments.
 * @param dependencies Focused-test collaborators.
 * @returns Command result.
 */
export async function main({ argv = process.argv, dependencies = {} } = {}) {
  const command = argv[2];
  const expected = dependencies.expected ?? expectedReleaseModel(readReleaseManifests(root));
  if (command === "tag") {
    (dependencies.write ?? process.stdout.write.bind(process.stdout))(expected.tag + "\n");
    return;
  }
  if (command === "preflight")
    return (dependencies.preflight ?? verifyRegistryReleaseState)(
      expected,
      dependencies.fetch ?? globalThis.fetch,
    );
  if (command === "prepare") return prepareCommand(argv, expected, dependencies);
  if (command === "publish" || command === "verify-registry") {
    const input = option(argv, "--input");
    const reportPath = option(argv, "--report");
    if (!input || !reportPath) throw new Error(command + " requires --input and --report");
    return (dependencies.execute ?? executeRelease)({
      input: resolve(input),
      reportPath: resolve(reportPath),
      priorPath: option(argv, "--prior-report"),
      verifyOnly: command === "verify-registry",
      dependencies,
    });
  }
  throw new Error("Supported commands: prepare, tag, preflight, publish, verify-registry");
}

/**
 * Runs the archive preparation command with the current checkout policy.
 *
 * @param argv Command arguments.
 * @param expected Current release model.
 * @param dependencies Focused-test collaborators.
 * @returns Prepared release manifest.
 */
function prepareCommand(argv, expected, dependencies) {
  const check = argv.includes("--check");
  const output = option(argv, "--output");
  if (!check && !output) throw new Error("prepare requires --check or --output");
  return (dependencies.prepare ?? prepareRelease)({
    destination: output && resolve(output),
    check,
    expected,
    sourceSha: sourceCommit(),
    pack: ({ destination }) => packFrameworkArtifacts({ root, destination, run }),
    prove: ({ destination, packages }) =>
      proveExactTarballConsumer({ root, destination, packages, run }),
    persist: writeReport,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
