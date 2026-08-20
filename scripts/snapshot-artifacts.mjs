import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  frameworkPackageNames,
  internalRuntimeDependencyProblems,
  packedArchiveProblems,
  packedContentProblems,
  packedManifestProblems,
  publicManifestProblems,
} from "./package-artifacts.mjs";

const packageDirectories = frameworkPackageNames.map((name) => "packages/" + name.split("/")[1]);

/** Packs the public inventory once and derives publication entries from its archives. */
export function packFrameworkArtifacts({ root, destination, run }) {
  run("pnpm", ["--dir", "packages/proto-tools", "exec", "tsc", "-b"], root);
  for (const directory of packageDirectories)
    run("pnpm", ["--dir", directory, "pack", "--config.ignore-scripts=true", "--pack-destination", destination], root);
  const entries = readdirSync(destination)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => inspectPackedArtifact({ root, tarball: join(destination, file), run }));
  if (entries.length !== frameworkPackageNames.length)
    throw new Error("Expected exactly " + frameworkPackageNames.length + " packed artifacts");
  return entries;
}

/** Validates one archive and returns the exact bytes and runtime dependency edges. */
export function inspectPackedArtifact({ root, tarball, run }) {
  const stage = mkdtempSync(join(tmpdir(), "spine-snapshot-artifact-"));
  try {
    run("tar", ["-xzf", tarball, "--strip-components=1", "-C", stage], root);
    const manifest = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
    const entries = readdirSync(stage, { recursive: true }).map(String);
    const sourceDirectory = manifest.repository?.directory;
    const source = JSON.parse(readFileSync(join(root, sourceDirectory, "package.json"), "utf8"));
    const texts = entries
      .filter((entry) => /\.(?:json|js|mjs|cjs|ts|d\.ts)$/u.test(entry))
      .map((entry) => readFileSync(join(stage, entry), "utf8"));
    const problems = [
      ...publicManifestProblems(manifest),
      ...packedManifestProblems(manifest),
      ...packedArchiveProblems(manifest, entries),
      ...packedContentProblems(manifest, entries, texts, source.files ?? []),
      ...internalRuntimeDependencyProblems(manifest),
    ];
    if (problems.length) throw new Error(problems.join("\n"));
    const runtime = ["dependencies", "optionalDependencies", "peerDependencies"]
      .flatMap((group) => Object.keys(manifest[group] ?? {}))
      .filter((name) => frameworkPackageNames.includes(name));
    return {
      name: manifest.name,
      tarball,
      integrity: "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64"),
      dependencies: runtime.sort((left, right) => left.localeCompare(right)),
    };
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}
