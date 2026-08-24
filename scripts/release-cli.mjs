import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { packFrameworkArtifacts, proveExactTarballConsumer } from "./snapshot-artifacts.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";
import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import {
  createPublicRegistry,
  publishRelease,
  waitForRegistryVisibility,
} from "./release-publisher.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(command + " failed");
};
const option = (argv, name) => argv[argv.indexOf(name) + 1];

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
  writeManifest,
  registerSignal,
  exit,
  expected,
}) {
  const destination = check ? mkdtemp() : output;
  if (!check && exists(destination))
    throw new Error("Release output already exists: " + destination);
  let completed = false;
  const cleanup = () => {
    if (!completed) remove(destination);
  };
  const unregister = ["SIGINT", "SIGTERM"].map(
    (signal) =>
      registerSignal?.(signal, () => {
        cleanup();
        exit?.(signal === "SIGINT" ? 130 : 143);
      }) ?? (() => {}),
  );
  try {
    mkdir(destination);
    const packages = pack({ root, destination });
    prove({ root, destination, packages });
    const manifest = createReleaseManifest({
      expected,
      packages: packages.map((entry) => ({ ...entry, version: expected.version })),
    });
    validateReleaseManifest(
      manifest,
      expected,
      (tarball) => packages.find((entry) => entry.tarball.endsWith(tarball))?.integrity,
    );
    writeManifest(destination, manifest);
    completed = true;
    return manifest;
  } finally {
    for (const removeHandler of unregister) removeHandler();
    if (check || !completed) remove(destination);
  }
}

export async function main({ argv = process.argv, environment = process.env } = {}) {
  if (argv[2] === "prepare") {
    const check = argv.includes("--check");
    const output = check ? undefined : option(argv, "--output");
    if (!check && output === undefined) throw new Error("prepare requires --check or --output");
    return prepareRelease({
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
      writeManifest: (destination, manifest) =>
        writeFileSync(
          join(destination, "release-manifest.json"),
          JSON.stringify(manifest, null, 2) + "\n",
        ),
      expected: expectedReleaseModel(readReleaseManifests(root)),
    });
  }
  if (
    argv[2] !== "publish" ||
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_EVENT_NAME !== "push" ||
    environment.GITHUB_REPOSITORY !== "SpineEventEngine/spine-ts" ||
    environment.GITHUB_REF !== "refs/heads/master"
  )
    throw new Error(
      "Publication is permitted only from the official GitHub Actions master workflow",
    );
  const input = resolve(option(argv, "--input"));
  const release = JSON.parse(readFileSync(join(input, "release-manifest.json"), "utf8"));
  const expected = expectedReleaseModel(readReleaseManifests(root));
  const checksum = (tarball) =>
    "sha512-" +
    createHash("sha512")
      .update(readFileSync(join(input, tarball)))
      .digest("base64");
  validateReleaseManifest(release, expected, checksum);
  const registry = createPublicRegistry({ fetch: globalThis.fetch });
  await publishRelease({
    release: {
      ...release,
      packages: release.packages.map((entry) => ({
        ...entry,
        tarball: join(input, entry.tarball),
      })),
    },
    checksum: (tarball) =>
      "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64"),
    registry,
    publish: async (entry, args) => run("npm", ["publish", entry.tarball, ...args]),
    poll: async (entry, tag) =>
      waitForRegistryVisibility({
        registry,
        entry,
        tag,
        sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      }),
  });
}
if (import.meta.url === new URL(process.argv[1], "file:").href) await main();
