// Builds the local application, Gateway, Delivery, and stock-UI images used by Compose.
import { execFileSync } from "node:child_process";
import console from "node:console";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { BuildContextCleanup } from "./build-context-cleanup.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const containerRoot = dirname(fileURLToPath(import.meta.url));
const subprocessTimeoutMs = 120_000;
const packageManager = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
).packageManager;
const context = mkdtempSync(join(tmpdir(), "spine-message-board-images-"));
const tarballs = join(context, "tarballs");
const store = join(context, "pnpm-store");
const packages = [
  "packages/auth",
  "packages/client-node",
  "packages/client-react",
  "packages/client-web",
  "packages/core",
  "packages/delivery-client",
  "packages/delivery-server",
  "packages/deployment",
  "packages/deployment-gke",
  "packages/proto",
  "packages/server",
  "packages/storage",
  "packages/storage-datastore",
  "packages/transport",
  "examples/message-board/model",
  "examples/message-board/app",
  "examples/message-board/web",
];
const targets = [
  "message-board",
  "standalone-gateway",
  "simple-delivery-server",
  "message-board-web",
];
const cleanup = new BuildContextCleanup(context);

cleanup.install();
try {
  mkdirSync(tarballs);
  phase("build Message Board application");
  run("pnpm", ["typecheck:build"]);
  phase("build stock browser UI");
  run("pnpm", ["--dir", "examples/message-board/web", "build"], {
    VITE_MESSAGE_BOARD_GATEWAY_URL: "http://localhost:18080",
  });
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
  cleanup.clean();
  cleanup.uninstall();
}

function phase(name) {
  console.log(`Local image phase: ${name} at ${new Date().toISOString()}.`);
}

function run(command, arguments_, environment = {}) {
  execute(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
}

function execute(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    timeout: subprocessTimeoutMs,
    ...options,
  });
}

function stageOfflineInstaller() {
  const dependencies = Object.fromEntries(
    readdirSync(tarballs)
      .filter((name) => name.endsWith(".tgz"))
      .map((name) => {
        const manifest = JSON.parse(
          execute("tar", ["-xOf", join(tarballs, name), "package/package.json"], {
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
        packageManager,
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
  execute("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: context,
    stdio: "inherit",
  });
  assertPortableLock(Object.keys(dependencies));
  execute("pnpm", ["fetch", "--prod", "--store-dir", store], {
    cwd: context,
    stdio: "inherit",
  });
  rmSync(join(context, "node_modules"), { force: true, recursive: true });
  archiveStore();
  guardContext();
  execute("corepack", ["pack", packageManager, "--output", join(context, "pnpm.tgz")], {
    cwd: context,
    stdio: "inherit",
  });
}

function archiveStore() {
  const list = join(context, "pnpm-store.files");
  // The store is transient staging data. Clear Finder/provenance attributes before
  // archiving it so Linux tar extraction does not receive macOS PAX metadata.
  execute("find", [store, "-type", "f", "-exec", "xattr", "-c", "{}", "+"]);
  execute("find", [store, "-type", "d", "-exec", "xattr", "-c", "{}", "+"]);
  execute("find", [store, "-type", "l", "-exec", "xattr", "-s", "-c", "{}", "+"]);
  execute("sh", [
    "-c",
    `cd ${JSON.stringify(store)} && find . -print | LC_ALL=C sort > ${JSON.stringify(list)}`,
  ]);
  execute(
    "tar",
    [
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
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  rmSync(store, { force: true, recursive: true });
  rmSync(list, { force: true });
}

function guardContext() {
  const files = Number(
    execute("sh", ["-c", `find ${JSON.stringify(context)} -type f | wc -l`], {
      encoding: "utf8",
    }),
  );
  const kilobytes = Number(
    execute("du", ["-sk", context], { encoding: "utf8" }).split(/\s/u, 1)[0],
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
  execute("docker", arguments_, {
    cwd: repositoryRoot,
    stdio: "inherit",
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
