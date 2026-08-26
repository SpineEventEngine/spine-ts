import { existsSync, mkdirSync, rmSync } from "node:fs";
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

export async function main({ argv = process.argv, dependencies = {} } = {}) {
  const {
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
  if (argv[2] === "verify-registry")
    return verifyRegistry(release, fetchResponse, { complete: true });
  throw new Error("Supported commands are prepare, tag, preflight, and verify-registry");
}
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
