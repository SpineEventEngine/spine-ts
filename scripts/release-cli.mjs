import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { packFrameworkArtifacts, proveExactTarballConsumer } from "./snapshot-artifacts.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";
import { verifyRegistryReleaseState } from "./release-registry.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(command + " failed");
};
const option = (argv, name) => {
  const index = argv.indexOf(name);
  if (index === -1 || argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
    return undefined;
  return argv[index + 1];
};

export function prepareRelease({
  root,
  output,
  check = false,
  mkdtemp,
  exists,
  mkdir,
  remove,
  pack,
  prove,
  registerSignal,
  exit,
  expected,
  stage,
}) {
  const destination = check ? mkdtemp() : output;
  if (!check && exists(destination))
    throw new Error("Release output already exists: " + destination);
  let completed = false;
  let owned = check;
  let cleaned = false;
  const cleanup = () => {
    if (owned && !completed && !cleaned) {
      cleaned = true;
      remove(destination);
    }
  };
  const unregister = ["SIGINT", "SIGTERM"].map(
    (signal) =>
      registerSignal?.(signal, () => {
        cleanup();
        exit?.(signal === "SIGINT" ? 130 : 143);
      }) ?? (() => {}),
  );
  try {
    if (!check) {
      mkdir(destination);
      owned = true;
    }
    const packages = pack({ root, destination });
    prove({ root, destination, packages });
    stage?.({ destination, packages });
    completed = true;
    return { ...expected, packages };
  } finally {
    for (const removeHandler of unregister) removeHandler();
    if (owned && check && !cleaned) {
      cleaned = true;
      remove(destination);
    } else if (owned && !completed) cleanup();
  }
}

export function stageReleaseContents({ destination, packages, run }) {
  for (const { name, tarball } of packages) {
    const directory = join(destination, "packages", name.split("/")[1], ".publish");
    mkdirSync(directory, { recursive: true });
    run("tar", ["-xzf", tarball, "--strip-components=1", "-C", directory]);
  }
}

export function createPublicationWorkspace({
  destination,
  entries,
  selectedNames,
  copy,
  mkdir,
  write,
}) {
  const byName = new Map(
    entries
      .filter(({ path }) => path.startsWith("packages/"))
      .map(({ path, manifest }) => [manifest.name, { manifest, path }]),
  );
  if (!selectedNames.length || new Set(selectedNames).size !== selectedNames.length)
    throw new Error("Publication workspace requires a non-empty unique selection");
  if (selectedNames.some((name) => !byName.has(name)))
    throw new Error("Publication workspace selection is outside the release inventory");
  mkdir(join(destination, "packages"));
  write(
    join(destination, "package.json"),
    JSON.stringify({ name: "spine-lerna-publication", private: true, version: "0.0.0" }) + "\n",
  );
  write(join(destination, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  write(
    join(destination, "lerna.json"),
    JSON.stringify({ version: "independent", npmClient: "pnpm", useNx: false }) + "\n",
  );
  for (const name of selectedNames) {
    const { manifest, path } = byName.get(name);
    const directory = join(destination, "packages", path.split("/")[1]);
    mkdir(directory);
    write(join(directory, "package.json"), JSON.stringify(manifest) + "\n");
    copy(join(path.slice(0, -"package.json".length), ".publish"), join(directory, ".publish"));
  }
}

export async function main({ argv = process.argv, dependencies = {} } = {}) {
  const {
    createWorkspace = createPublicationWorkspace,
    expectedModel = expectedReleaseModel,
    fetchResponse = globalThis.fetch,
    prepare = prepareRelease,
    readManifests = readReleaseManifests,
    verifyRegistry = verifyRegistryReleaseState,
    write = (text) => process.stdout.write(text),
  } = dependencies;
  if (argv[2] === "prepare") {
    const check = argv.includes("--check");
    const output = check ? undefined : option(argv, "--output");
    if (!check && output === undefined) throw new Error("prepare requires --check or --output");
    if (dependencies.prepare !== undefined) return prepare({ check, output });
    return prepare({
      root,
      output: check ? undefined : resolve(output),
      check,
      mkdtemp: () => mkdtempSync(join(tmpdir(), "spine-release-")),
      exists: existsSync,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      remove: (path) => rmSync(path, { force: true, recursive: true }),
      pack: ({ destination }) => packFrameworkArtifacts({ root, destination, run }),
      prove: ({ destination, packages }) =>
        proveExactTarballConsumer({ root, destination, run, packages }),
      stage: ({ destination, packages }) => stageReleaseContents({ destination, packages, run }),
      registerSignal: (signal, handler) => {
        process.once(signal, handler);
        return () => process.off(signal, handler);
      },
      exit: (code) => process.exit(code),
      expected: expectedModel(readManifests(root)),
    });
  }
  const release = expectedModel(readManifests(root));
  if (argv[2] === "tag") {
    write(release.tag + "\n");
    return;
  }
  if (argv[2] === "preflight") return verifyRegistry(release, fetchResponse);
  if (argv[2] === "prepare-publication-workspace") {
    const output = option(argv, "--output");
    if (output === undefined) throw new Error("prepare-publication-workspace requires --output");
    const scopes = await verifyRegistry(release, fetchResponse);
    const packageNames = new Set(release.packages.map(({ name }) => name));
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      new Set(scopes).size !== scopes.length ||
      scopes.some((name) => !packageNames.has(name))
    )
      throw new Error("Strict registry selection did not produce exact missing package scopes");
    const destination = resolve(output);
    if (existsSync(destination))
      throw new Error("Publication workspace already exists: " + destination);
    try {
      createWorkspace({
        destination,
        entries: readManifests(root),
        selectedNames: scopes,
        copy: (source, target) => cpSync(join(root, source), target, { recursive: true }),
        mkdir: (path) => mkdirSync(path, { recursive: true }),
        write: writeFileSync,
      });
    } catch (error) {
      rmSync(destination, { force: true, recursive: true });
      throw error;
    }
    return;
  }
  throw new Error(
    "Supported commands are prepare, tag, preflight, and prepare-publication-workspace",
  );
}
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
