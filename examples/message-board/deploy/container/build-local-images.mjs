import { execFileSync, spawnSync } from "node:child_process";
import { console } from "node:console";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { process } from "node:process";
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
const localBaseImage = "sha256:9be410e06dadc1794f44aa4c0fd107a7ecb2edb5cb6bcc6a71c7888caf3cfa12";

try {
  phase("verify base image");
  verifyBaseImage();
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
  execFileSync("sh", [
    "-c",
    `cd ${JSON.stringify(store)} && find . -print | LC_ALL=C sort > ${JSON.stringify(list)}`,
  ]);
  execFileSync("tar", [
    "--options",
    "gzip:timestamp=0",
    "-czf",
    join(context, "pnpm-store.tgz"),
    "-C",
    store,
    "-T",
    list,
  ]);
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
    "--build-arg",
    "BASE_IMAGE=node:24.18.0-bookworm-slim",
    "--target",
    target,
    "--tag",
    `spine-ts/${target}:local`,
    context,
  ];
  console.log(`Building local image target: ${target}`);
  const result = spawnSync("docker", arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, DOCKER_BUILDKIT: "0" },
    stdio: "inherit",
    timeout: 120_000,
  });
  if (result.error !== undefined)
    throw new Error(
      `Classic Docker build timed out or failed to start for ${target}: ${result.error.message}`,
      {
        cause: result.error,
      },
    );
  if (result.status !== 0)
    throw new Error(
      `Classic Docker build failed for ${target} with exit status ${String(result.status)}.`,
    );
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

function verifyBaseImage() {
  const image = execFileSync(
    "docker",
    ["image", "inspect", localBaseImage, "--format", "{{.Id}} {{.Os}}/{{.Architecture}}"],
    { encoding: "utf8" },
  ).trim();
  if (image !== `${localBaseImage} linux/arm64`)
    throw new Error("Required local Node image is unavailable.");
  const environment = execFileSync(
    "docker",
    ["image", "inspect", localBaseImage, "--format", "{{json .Config.Env}}"],
    {
      encoding: "utf8",
    },
  );
  if (!JSON.parse(environment).includes("NODE_VERSION=24.18.0"))
    throw new Error("Required local Node image metadata is unavailable.");
  const version = execFileSync("docker", ["run", "--rm", localBaseImage, "node", "--version"], {
    encoding: "utf8",
  }).trim();
  if (version !== "v24.18.0")
    throw new Error("Required local Node runtime version is unavailable.");
}
