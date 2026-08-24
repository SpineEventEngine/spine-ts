import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { packFrameworkArtifacts, proveExactTarballConsumer } from "./snapshot-artifacts.mjs";
import { readReleaseManifests, releaseDependencyOrder, validateReleasePolicy } from "./release-policy.mjs";
import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import { createPublicRegistry, publishRelease, waitForRegistryVisibility } from "./release-publisher.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(command + " failed");
};
const option = (argv, name) => argv[argv.indexOf(name) + 1];

function prepare(output) {
  const release = validateReleasePolicy(readReleaseManifests(root));
  const destination = resolve(output);
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  const packages = packFrameworkArtifacts({ root, destination, run });
  proveExactTarballConsumer({ root, destination, run, packages });
  const manifest = createReleaseManifest({
    release,
    packages: packages.map((entry) => ({ ...entry, version: release.version })),
    order: releaseDependencyOrder(readReleaseManifests(root)),
    destination,
  });
  writeFileSync(join(destination, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export async function main({ argv = process.argv, environment = process.env } = {}) {
  if (argv[2] === "prepare") return prepare(option(argv, "--output") ?? "release");
  if (argv[2] !== "publish" || environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_EVENT_NAME !== "push" || environment.GITHUB_REPOSITORY !== "SpineEventEngine/spine-ts" || environment.GITHUB_REF !== "refs/heads/master")
    throw new Error("Publication is permitted only from the official GitHub Actions master workflow");
  const input = resolve(option(argv, "--input"));
  const release = JSON.parse(readFileSync(join(input, "release-manifest.json"), "utf8"));
  const checksum = (tarball) => "sha512-" + createHash("sha512").update(readFileSync(join(input, tarball))).digest("base64");
  validateReleaseManifest(release, checksum);
  const registry = createPublicRegistry({ fetch: globalThis.fetch });
  await publishRelease({
    release: { ...release, packages: release.packages.map((entry) => ({ ...entry, tarball: join(input, entry.tarball) })) },
    checksum: (tarball) => "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64"),
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
