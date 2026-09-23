import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  expectedReleaseModel,
  publicPackagePaths,
  readReleaseManifests,
} from "./release-policy.mjs";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org/";
const usage = `Usage:
  pnpm release:publish-new-package <package-directory>
  pnpm release:publish-new-package --trust-only <package-directory>

Example:
  pnpm release:publish-new-package packages/storage-postgres

The normal command verifies and prepares all release artifacts, publishes only
the named package, and configures publish.yml as its trusted publisher.
Use --trust-only only if the package was published but trusted-publisher setup
did not finish.`;

/**
 * Resolves a public package directory into an exact first-publication target.
 *
 * @param repoRoot Repository root containing the release inventory.
 * @param packageDirectory Public package directory supplied by the maintainer.
 * @returns Validated package identity, release tag, and archive filename.
 */
export function resolveNewPackageTarget(repoRoot, packageDirectory) {
  const directory = relative(repoRoot, resolve(repoRoot, packageDirectory)).replaceAll("\\", "/");
  const manifestPath = directory + "/package.json";
  if (!publicPackagePaths.includes(manifestPath))
    throw new Error(
      packageDirectory + " is not a public package directory in the release inventory",
    );
  const entries = readReleaseManifests(repoRoot);
  const release = expectedReleaseModel(entries);
  const manifest = entries.find(({ path }) => path === manifestPath)?.manifest;
  const archiveName =
    manifest.name.replace(/^@/u, "").replaceAll("/", "-") + `-${release.version}.tgz`;
  return {
    archiveName,
    directory,
    name: manifest.name,
    tag: release.tag,
    version: release.version,
  };
}

/**
 * Parses command-line arguments for the first-publication tool.
 *
 * @param argv Arguments after the script filename.
 * @returns The requested operation and package directory, or the help request.
 */
export function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const unknown = argv.find((argument) => argument.startsWith("-") && argument !== "--trust-only");
  if (unknown !== undefined) throw new Error("Unknown option: " + unknown);
  const trustOnly = argv.includes("--trust-only");
  const positional = argv.filter((argument) => argument !== "--trust-only");
  if (positional.length !== 1) throw new Error("Specify exactly one public package directory");
  return { help: false, packageDirectory: positional[0], trustOnly };
}

/**
 * Checks whether a package is absent for initial publication or present for recovery.
 *
 * @param packageName Scoped npm package name to inspect.
 * @param expected Whether the package must already exist.
 * @param fetchResponse Fetch implementation used to read the public npm registry.
 * @param timeoutMs Maximum registry response time.
 * @returns Nothing after the required state is confirmed.
 */
export async function assertPackagePresence(
  packageName,
  expected,
  fetchResponse = globalThis.fetch,
  timeoutMs = 10_000,
) {
  const record = await readPackageRecord(packageName, fetchResponse, timeoutMs);
  if (record === undefined) {
    if (expected) throw new Error(packageName + " does not exist on npm");
    return;
  }
  if (!expected) throw new Error(packageName + " already exists on npm");
}

/**
 * Reads and validates one public npm package record within a fixed timeout.
 *
 * @param packageName Scoped npm package name to read.
 * @param fetchResponse Fetch implementation used to read the public npm registry.
 * @param timeoutMs Maximum duration for both the response and its JSON body.
 * @returns The package record, or `undefined` when npm returns 404.
 */
async function readPackageRecord(packageName, fetchResponse, timeoutMs) {
  const controller = new globalThis.AbortController();
  let timeout;
  const timed = new Promise((_, reject) => {
    timeout = globalThis.setTimeout(() => {
      controller.abort();
      reject(new Error("Registry read timed out for " + packageName));
    }, timeoutMs);
  });
  let response;
  try {
    response = await Promise.race([
      fetchResponse(registry + encodeURIComponent(packageName), { signal: controller.signal }),
      timed,
    ]);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("ambiguous registry response for " + packageName);
    const record = await Promise.race([response.json(), timed]);
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      record.versions === null ||
      typeof record.versions !== "object" ||
      Array.isArray(record.versions)
    )
      throw new Error("ambiguous registry response for " + packageName);
    return record;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Registry read timed out") ||
        error.message.startsWith("ambiguous registry response"))
    )
      throw error;
    throw new Error("Registry read failed for " + packageName, { cause: error });
  } finally {
    globalThis.clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * Requires the intended package version before recovery changes npm trust settings.
 *
 * @param target Validated package publication target.
 * @param fetchResponse Fetch implementation used to read the public npm registry.
 * @returns Nothing after the exact version is found.
 */
async function assertPackageVersion(target, fetchResponse) {
  const record = await readPackageRecord(target.name, fetchResponse, 10_000);
  if (record === undefined || !(target.version in record.versions))
    throw new Error(`${target.name}@${target.version} is not published on npm`);
}

/**
 * Runs one child process in the foreground and rejects any unsuccessful exit.
 *
 * @param command Executable name or path.
 * @param args Arguments passed without shell interpretation.
 * @param cwd Working directory for the child process.
 */
function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

/**
 * Runs one child process and returns its standard output for exact verification.
 *
 * @param command Executable name or path.
 * @param args Arguments passed without shell interpretation.
 * @param cwd Working directory for the child process.
 * @returns Captured UTF-8 standard output.
 */
function captureCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
  return result.stdout;
}

/**
 * Asks the maintainer to type the package name before registry mutation.
 *
 * @param packageName Exact package name expected as confirmation.
 * @returns Whether the entered text exactly matches the package name.
 */
async function confirmPackageName(packageName) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(`Type ${packageName} to continue: `);
    return answer.trim() === packageName;
  } finally {
    input.close();
  }
}

/**
 * Supplies the arguments that bind npm trusted publishing to the master workflow.
 *
 * @param packageName Existing npm package to configure.
 * @returns Arguments for `npm trust github`.
 */
function trustArguments(packageName) {
  return [
    "trust",
    "github",
    packageName,
    "--repository",
    "SpineEventEngine/spine-ts",
    "--file",
    "publish.yml",
    "--environment",
    "gh-actions-environment",
    "--allow-publish",
    "--yes",
  ];
}

/**
 * Runs registry mutations after opening a temporary local npm login.
 *
 * @param run Foreground command runner.
 * @param state Mutable resource state used by normal and signal cleanup.
 * @param operation Registry operation performed after login.
 * @returns The operation result.
 */
async function withNpmLogin(run, state, operation) {
  run("npm", ["login", "--registry", registry]);
  state.loggedIn = true;
  return operation();
}

/**
 * Adds the GitHub Actions trusted publisher for an existing package.
 *
 * @param target Validated package publication target.
 * @param run Foreground command runner.
 */
async function addTrustedPublisher(target, run) {
  run("npm", trustArguments(target.name));
}

/**
 * Parses command JSON and reports malformed verification output clearly.
 *
 * @param text JSON text returned by npm.
 * @param description Human-readable value being verified.
 * @returns Parsed JSON value.
 */
function parseCommandJson(text, description) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("npm returned invalid JSON for " + description, { cause: error });
  }
}

/**
 * Verifies the selected release tag and every required GitHub trust claim.
 *
 * @param target Validated package publication target.
 * @param capture Command runner that returns standard output.
 */
function verifyPublishedConfiguration(target, capture) {
  const tags = parseCommandJson(
    capture("npm", ["view", target.name, "dist-tags", "--json", "--registry", registry]),
    "release tags",
  );
  if (tags?.[target.tag] !== target.version)
    throw new Error(
      `${target.name} does not expose ${target.version} at the ${target.tag} release tag`,
    );
  const trust = parseCommandJson(
    capture("npm", ["trust", "list", target.name, "--json", "--registry", registry]),
    "trusted publisher",
  );
  const matches =
    trust?.type === "github" &&
    trust?.repository === "SpineEventEngine/spine-ts" &&
    trust?.file === "publish.yml" &&
    trust?.environment === "gh-actions-environment" &&
    Array.isArray(trust?.permissions) &&
    trust.permissions.includes("createPackage");
  if (!matches) throw new Error(target.name + " has an unexpected trusted publisher configuration");
}

/**
 * Logs out and removes temporary output exactly once.
 *
 * @param state Mutable npm-login and temporary-directory state.
 * @param run Foreground command runner.
 * @param removeDirectory Callback that removes the temporary directory.
 */
function cleanupPublication(state, run, removeDirectory) {
  let failure;
  if (state.loggedIn) {
    state.loggedIn = false;
    try {
      run("npm", ["logout", "--registry", registry]);
    } catch (error) {
      failure = error;
    }
  }
  if (state.temporaryDirectory !== undefined) {
    const directory = state.temporaryDirectory;
    state.temporaryDirectory = undefined;
    try {
      removeDirectory(directory);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

/**
 * Installs signal handlers that clean resources before terminating the process.
 *
 * @param cleanup Idempotent synchronous cleanup callback.
 * @param registerSignal Callback that registers one signal handler and returns its remover.
 * @param exit Callback that terminates with the supplied process exit code.
 * @returns Callback that removes both signal handlers.
 */
function registerCleanupHandlers(cleanup, registerSignal, exit) {
  const removers = [
    registerSignal("SIGINT", () => {
      try {
        cleanup();
      } finally {
        exit(130);
      }
    }),
    registerSignal("SIGTERM", () => {
      try {
        cleanup();
      } finally {
        exit(143);
      }
    }),
  ];
  return () => removers.forEach((remove) => remove());
}

/**
 * Publishes a previously absent package and configures its trusted publisher.
 *
 * @param repoRoot Repository root used for verification and preparation.
 * @param target Validated package and archive identity.
 * @param capture Command runner that returns standard output.
 * @param confirm Confirmation callback that guards registry mutation.
 * @param exit Callback that terminates after signal cleanup.
 * @param fetchResponse Fetch implementation used for registry checks.
 * @param makeTemporaryDirectory Callback that creates an isolated temporary directory.
 * @param removeDirectory Callback that removes the temporary directory.
 * @param pathExists Callback that confirms the prepared archive exists.
 * @param registerSignal Callback that registers signal cleanup.
 * @param run Foreground command runner.
 * @param write Progress output callback.
 * @returns A promise that resolves after publication and trusted-publisher setup finish.
 */
export async function publishNewPackage({
  repoRoot,
  target,
  capture = (command, args) => captureCommand(command, args, repoRoot),
  confirm = confirmPackageName,
  exit = (code) => process.exit(code),
  fetchResponse = globalThis.fetch,
  makeTemporaryDirectory = () => mkdtempSync(join(tmpdir(), "spine-first-publication-")),
  removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
  pathExists = existsSync,
  registerSignal = (signal, handler) => {
    process.once(signal, handler);
    return () => process.off(signal, handler);
  },
  run = (command, args) => runCommand(command, args, repoRoot),
  write = (message) => process.stdout.write(message + "\n"),
}) {
  const state = { loggedIn: false, temporaryDirectory: undefined };
  const cleanup = () => cleanupPublication(state, run, removeDirectory);
  const unregister = registerCleanupHandlers(cleanup, registerSignal, exit);
  try {
    write(`Checking that ${target.name} has not been published.`);
    await assertPackagePresence(target.name, false, fetchResponse);
    write(`This will publish ${target.name}@${target.version} with the ${target.tag} tag.`);
    if (!(await confirm(target.name))) throw new Error("First publication cancelled");
    run("pnpm", ["verify:publish"]);
    state.temporaryDirectory = makeTemporaryDirectory();
    const output = join(state.temporaryDirectory, "release");
    run(process.execPath, ["scripts/release-cli.mjs", "prepare", "--output", output]);
    const archive = join(output, target.archiveName);
    if (!pathExists(archive)) throw new Error("Prepared package archive is missing: " + archive);
    await withNpmLogin(run, state, () => publishAndConfigure({ archive, capture, run, target }));
  } finally {
    try {
      cleanup();
    } finally {
      unregister();
    }
  }
  write(`${target.name}@${target.version} was published and configured for trusted publishing.`);
}

/**
 * Publishes the prepared archive and adds its trusted publisher under one login.
 *
 * @param archive Absolute path to the verified package archive.
 * @param capture Command runner that returns standard output.
 * @param run Foreground command runner.
 * @param target Validated package publication target.
 */
async function publishAndConfigure({ archive, capture, run, target }) {
  let published = false;
  try {
    run("npm", [
      "publish",
      archive,
      "--access",
      "public",
      "--tag",
      target.tag,
      "--registry",
      registry,
    ]);
    published = true;
    await addTrustedPublisher(target, run);
    verifyPublishedConfiguration(target, capture);
  } catch (error) {
    if (!published) throw error;
    throw new Error(
      `${error.message}. The package was published; rerun with --trust-only to finish setup.`,
      { cause: error },
    );
  }
}

/**
 * Sets trusted publishing after a successful publication with incomplete setup.
 *
 * @param target Validated package publication target.
 * @param capture Command runner that returns standard output.
 * @param confirm Confirmation callback that guards the settings change.
 * @param exit Callback that terminates after signal cleanup.
 * @param fetchResponse Fetch implementation used for registry checks.
 * @param registerSignal Callback that registers signal cleanup.
 * @param run Foreground command runner.
 * @param write Progress output callback.
 * @returns A promise that resolves after trusted-publisher setup finishes.
 */
export async function configureTrustedPublisher({
  target,
  capture = (command, args) => captureCommand(command, args, defaultRepoRoot),
  confirm = confirmPackageName,
  exit = (code) => process.exit(code),
  fetchResponse = globalThis.fetch,
  registerSignal = (signal, handler) => {
    process.once(signal, handler);
    return () => process.off(signal, handler);
  },
  run = (command, args) => runCommand(command, args, defaultRepoRoot),
  write = (message) => process.stdout.write(message + "\n"),
}) {
  const state = { loggedIn: false, temporaryDirectory: undefined };
  const cleanup = () => cleanupPublication(state, run, () => {});
  const unregister = registerCleanupHandlers(cleanup, registerSignal, exit);
  try {
    await assertPackageVersion(target, fetchResponse);
    write(`This will configure trusted publishing for ${target.name}.`);
    if (!(await confirm(target.name))) throw new Error("Trusted-publisher setup cancelled");
    await withNpmLogin(run, state, async () => {
      await addTrustedPublisher(target, run);
      verifyPublishedConfiguration(target, capture);
    });
  } finally {
    try {
      cleanup();
    } finally {
      unregister();
    }
  }
  write(`${target.name} is configured for trusted publishing.`);
}

/**
 * Runs the requested first-publication or trusted-publisher recovery command.
 *
 * @param argv Arguments after the script filename.
 */
async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage + "\n");
    return;
  }
  const target = resolveNewPackageTarget(defaultRepoRoot, options.packageDirectory);
  if (options.trustOnly) {
    await configureTrustedPublisher({ target });
  } else {
    await publishNewPackage({ repoRoot: defaultRepoRoot, target });
  }
  process.stdout.write(
    "Open the package settings on npmjs.com, verify the trusted publisher, " +
      "and disallow token-based publishing.\n",
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}
