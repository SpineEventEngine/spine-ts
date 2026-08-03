import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const containerRoot = dirname(fileURLToPath(import.meta.url));
const context = mkdtempSync(join(tmpdir(), "spine-message-board-images-"));
const tarballs = join(context, "tarballs");
const store = join(context, "pnpm-store");
const packages = [
  "packages/auth",
  "packages/client-node",
  "packages/client-web",
  "packages/core",
  "packages/delivery-client",
  "packages/delivery-server",
  "packages/proto",
  "packages/server",
  "packages/storage",
  "packages/storage-datastore",
  "packages/transport",
  "examples/message-board/model",
  "examples/message-board/app",
];
const targets = ["message-board", "standalone-gateway", "simple-delivery-server"];

try {
  mkdirSync(tarballs);
  phase("pack local artifacts");
  for (const source of packages) {
    run("pnpm", [
      "--dir",
      source,
      "pack",
      "--config.ignore-scripts=true",
      "--pack-destination",
      tarballs,
    ]);
  }
  phase("prepare offline installer");
  stageOfflineInstaller();
  for (const target of targets) build(target);
} finally {
  rmSync(context, { force: true, recursive: true });
}

function phase(name) {
  console.log(`Local image phase: ${name} at ${new Date().toISOString()}.`);
}

function run(command, arguments_, environment = {}) {
  execFileSync(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
}

function stageOfflineInstaller() {
  const dependencies = Object.fromEntries(
    readdirSync(tarballs)
      .filter((name) => name.endsWith(".tgz"))
      .map((name) => {
        const manifest = JSON.parse(
          execFileSync("tar", ["-xOf", join(tarballs, name), "package/package.json"], {
            encoding: "utf8",
          }),
        );
        return [manifest.name, `file:tarballs/${name}`];
      }),
  );
  writeFileSync(
    join(context, "package.json"),
    `${JSON.stringify(
      {
        name: "spine-ts-local-images",
        private: true,
        packageManager: "pnpm@11.9.0",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(context, "pnpm-workspace.yaml"),
    `overrides:\n${Object.entries(dependencies)
      .map(([name, target]) => `  ${JSON.stringify(name)}: ${JSON.stringify(target)}`)
      .join("\n")}\n`,
  );
  writeFileSync(
    join(context, ".npmrc"),
    "supportedArchitectures.os[]=darwin\nsupportedArchitectures.os[]=linux\nsupportedArchitectures.cpu[]=arm64\n",
  );
  execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: context,
    stdio: "inherit",
  });
  assertPortableLock(Object.keys(dependencies));
  execFileSync("pnpm", ["fetch", "--prod", "--store-dir", store], {
    cwd: context,
    stdio: "inherit",
  });
  rmSync(join(context, "node_modules"), { force: true, recursive: true });
  archiveStore();
  guardContext();
  execFileSync("corepack", ["pack", "pnpm@11.9.0", "--output", join(context, "pnpm.tgz")], {
    cwd: context,
    stdio: "inherit",
  });
}

function archiveStore() {
  const list = join(context, "pnpm-store.files");
  // The store is transient staging data. Clear Finder/provenance attributes before
  // archiving it so Linux tar extraction does not receive macOS PAX metadata.
  execFileSync("find", [store, "-type", "f", "-exec", "xattr", "-c", "{}", "+"]);
  execFileSync("find", [store, "-type", "d", "-exec", "xattr", "-c", "{}", "+"]);
  execFileSync("find", [store, "-type", "l", "-exec", "xattr", "-s", "-c", "{}", "+"]);
  execFileSync("sh", [
    "-c",
    `cd ${JSON.stringify(store)} && find . -print | LC_ALL=C sort > ${JSON.stringify(list)}`,
  ]);
  execFileSync("tar", [
    "--no-mac-metadata",
    "--disable-copyfile",
    "--options",
    "gzip:timestamp=0",
    "-czf",
    join(context, "pnpm-store.tgz"),
    "-C",
    store,
    "-T",
    list,
  ], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  rmSync(store, { force: true, recursive: true });
  rmSync(list, { force: true });
}

function guardContext() {
  const files = Number(
    execFileSync("sh", ["-c", `find ${JSON.stringify(context)} -type f | wc -l`], {
      encoding: "utf8",
    }),
  );
  const kilobytes = Number(
    execFileSync("du", ["-sk", context], { encoding: "utf8" }).split(/\s/u, 1)[0],
  );
  console.log(`Local image context: ${String(files)} files, ${String(kilobytes)} KiB.`);
  if (files > 100 || kilobytes > 350_000)
    throw new Error(
      `Docker context exceeds fixed bounds: ${String(files)} files, ${String(kilobytes)} KiB.`,
    );
}

function build(target) {
  const arguments_ = [
    "build",
    "--file",
    join(containerRoot, "Dockerfile"),
    "--target",
    target,
    "--tag",
    `spine-ts/${target}:local`,
    context,
  ];
  console.log(`Building local image target: ${target}`);
  execFileSync("docker", arguments_, {
    cwd: repositoryRoot,
    stdio: "inherit",
    timeout: 120_000,
  });
}

function assertPortableLock(localNames) {
  const lock = readFileSync(join(context, "pnpm-lock.yaml"), "utf8");
  for (const name of localNames) {
    if (lock.includes(`registry.npmjs.org/${name.replace("@", "%40").replace("/", "%2F")}`))
      throw new Error(`Local package resolved from registry: ${name}`);
  }
  if (/workspace:|link:|portal:/u.test(lock))
    throw new Error("Staged lock contains a workspace path.");
}
