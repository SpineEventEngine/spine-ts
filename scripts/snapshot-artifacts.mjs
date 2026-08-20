import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  frameworkPackageNames,
  internalRuntimeDependencyProblems,
  packedArchiveProblems,
  packedContentProblems,
  packedManifestProblems,
  publicManifestProblems,
} from "./package-artifacts.mjs";

const packageDirectories = frameworkPackageNames.map((name) => "packages/" + name.split("/")[1]);

/**
 * Packs the public inventory once and derives publication entries from its archives.
 */
export function packFrameworkArtifacts({ root, destination, run }) {
  run("pnpm", ["--dir", "packages/proto-tools", "exec", "tsc", "-b"], root);
  for (const directory of packageDirectories)
    run(
      "pnpm",
      [
        "--dir",
        directory,
        "pack",
        "--config.ignore-scripts=true",
        "--pack-destination",
        destination,
      ],
      root,
    );
  const entries = readdirSync(destination)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => inspectPackedArtifact({ root, tarball: join(destination, file), run }));
  if (entries.length !== frameworkPackageNames.length)
    throw new Error("Expected exactly " + frameworkPackageNames.length + " packed artifacts");
  return entries;
}

/**
 * Validates one archive and returns the exact bytes and runtime dependency edges.
 */
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

/**
 * Proves the exact packed tarballs resolve in a fresh non-workspace consumer.
 */
export function proveExactTarballConsumer({ root, destination, run }) {
  const packages = packFrameworkArtifacts({ root, destination, run });
  const consumer = join(destination, "consumer");
  mkdirSync(consumer);
  const dependencies = Object.fromEntries(
    packages.map(({ name, tarball }) => [name, "file:" + tarball]),
  );
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "@external/snapshot-proof",
      private: true,
      type: "module",
      dependencies,
      devDependencies: { typescript: "6.0.3" },
    }),
  );
  writeFileSync(
    join(consumer, "pnpm-workspace.yaml"),
    "overrides:\n" +
      Object.entries(dependencies)
        .map(([name, value]) => "  " + JSON.stringify(name) + ": " + JSON.stringify(value))
        .join("\n") +
      "\n",
  );
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  assertConsumerIsolation(consumer);
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2024",
        outDir: "dist",
        strict: true,
      },
      include: ["index.ts"],
    }),
  );
  writeFileSync(
    join(consumer, "index.ts"),
    [
      ...frameworkPackageNames.map((name) => "import " + JSON.stringify(name) + ";"),
      "import { BlackBox } from '@spine-event-engine/testing';",
      "import { resetServerEnvironmentForTest } from '@spine-event-engine/server/testing';",
      "if (typeof BlackBox !== 'function') throw new Error('Testing path is unavailable');",
      "if (typeof resetServerEnvironmentForTest !== 'function') " +
        "throw new Error('Server testing path is unavailable');",
      "await resetServerEnvironmentForTest();",
      "",
    ].join("\n"),
  );
  run(
    process.execPath,
    [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    consumer,
  );
  run(process.execPath, ["dist/index.js"], consumer);
  return packages;
}

export function assertConsumerIsolation(consumer) {
  const pending = [join(consumer, "node_modules")];
  const consumerRoot = realpathSync(consumer);
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const actual = realpathSync(path);
      if (!isContainedPath(consumerRoot, actual))
        throw new Error("Consumer resolved repository path: " + relative(consumer, path));
      if (lstatSync(path).isSymbolicLink() && !isContainedPath(consumerRoot, actual))
        throw new Error("Consumer has workspace link");
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

export function isContainedPath(parent, child) {
  return isContainedRelative(relative(parent, child));
}

export function isContainedRelative(path) {
  return (
    path === "" ||
    (path !== ".." && !path.startsWith("../") && !path.startsWith("..\\") && !isAbsolute(path))
  );
}
