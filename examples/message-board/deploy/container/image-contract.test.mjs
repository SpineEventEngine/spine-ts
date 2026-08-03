import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const containerRoot = new URL(".", import.meta.url);
const datastoreEmulator =
  "gcr.io/google.com/cloudsdktool/google-cloud-cli@sha256:cda01b8c880e9161992c3fd61d7d0e153b4dd073aa4a9d62ad79243907cf8dd4";

test("local images have a fixed build contract", () => {
  assert.equal(existsSync(new URL("Dockerfile", containerRoot)), true);
  assert.equal(existsSync(new URL("build-local-images.mjs", containerRoot)), true);
  assert.equal(
    existsSync(join(process.cwd(), "examples/message-board/app/dist/src/combined-entry.js")),
    true,
  );
  assert.equal(
    existsSync(join(process.cwd(), "examples/message-board/app/dist/src/application-entry.js")),
    true,
  );
  const dockerfile = readFileSync(new URL("Dockerfile", containerRoot), "utf8");
  const helper = readFileSync(new URL("build-local-images.mjs", containerRoot), "utf8");
  assert.match(dockerfile, /corepack pnpm install --offline/u);
  assert.match(dockerfile, /pnpm-workspace\.yaml/u);
  assert.match(dockerfile, /ENTRYPOINT \["node"\]/u);
  assert.match(helper, /COPYFILE_DISABLE/u);
  assert.match(helper, /-exec", "xattr", "-c"/u);
  assert.match(helper, /-exec", "xattr", "-s", "-c"/u);
  assert.match(datastoreEmulator, /@sha256:[a-f0-9]{64}$/u);
});

test("final images contain only runtime artifacts and no runtime secret", () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-t0095-image-inspection-"));
  const sentinel = "spine-t0095-runtime-secret-sentinel";
  const images = ["message-board", "standalone-gateway", "simple-delivery-server"];
  try {
    for (const target of images) {
      const image = `spine-ts/${target}:local`;
      const config = execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" });
      assert.doesNotMatch(config, new RegExp(sentinel, "u"));
      assert.match(config, /"Entrypoint":\s*\[\s*"node"/u);
      assert.match(config, /"NODE_ENV=production"/u);
      const history = execFileSync("docker", ["history", "--no-trunc", image], {
        encoding: "utf8",
      });
      assert.doesNotMatch(history, new RegExp(sentinel, "u"));
      const container = execFileSync(
        "docker",
        ["create", "--env", `T0095_SECRET=${sentinel}`, image],
        {
          encoding: "utf8",
        },
      ).trim();
      const archive = join(directory, `${target}.tar`);
      try {
        execFileSync("sh", ["-c", `docker export ${container} > ${archive}`]);
        const files = execFileSync("tar", ["-tf", archive], { encoding: "utf8" });
        assert.doesNotMatch(
          files,
          /(^|\/)(tarballs|\.git|pnpm-store|tests?)(\/|$)|\.ts(?:$|\n)|\.map(?:$|\n)/u,
        );
        const protos = files.split("\n").filter((file) => file.endsWith(".proto"));
        assert.equal(protos.length > 0, true);
        for (const proto of protos) {
          assert.match(proto, /@google-cloud\/datastore\/build\/protos\//u);
        }
        assert.doesNotMatch(files, new RegExp(sentinel, "u"));
      } finally {
        execFileSync("docker", ["container", "rm", "-f", container]);
      }
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("MessageBoard commands share one artifact and required compiled modules import", () => {
  const messageBoard = "spine-ts/message-board:local";
  const identity = execFileSync(
    "docker",
    ["image", "inspect", messageBoard, "--format", "{{.Id}}"],
    {
      encoding: "utf8",
    },
  ).trim();
  assert.match(identity, /^sha256:[a-f0-9]{64}$/u);
  const hashes = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sha256sum",
      messageBoard,
      "node_modules/@spine-event-engine/example-message-board-app/dist/src/model-registry.js",
      "node_modules/@spine-event-engine/example-message-board-app/dist/generated/handler/generated-handler-registry.js",
    ],
    { encoding: "utf8" },
  );
  assert.equal(hashes.trim().split("\n").length, 2);
  for (const image of [messageBoard, "spine-ts/standalone-gateway:local"]) {
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "node",
        image,
        "--input-type=module",
        "-e",
        "await import('@spine-event-engine/example-message-board-model'); await import('/app/node_modules/@spine-event-engine/example-message-board-app/dist/src/model-registry.js');",
      ],
      { stdio: "inherit" },
    );
  }
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "node",
      "spine-ts/simple-delivery-server:local",
      "--input-type=module",
      "-e",
      "await import('@spine-event-engine/delivery-server');",
    ],
    { stdio: "inherit" },
  );
});

test("runtime commands keep Node as PID 1 and stop cleanly", () => {
  const suffix = `${String(process.pid)}-${String(Date.now())}`;
  const network = `spine-t0095-${suffix}`;
  const emulator = `spine-t0095-emulator-${suffix}`;
  const owned = [emulator];
  const messageBoard = "spine-ts/message-board:local";
  try {
    docker(["network", "create", network]);
    start([
      "--name",
      emulator,
      "--network",
      network,
      "--network-alias",
      "datastore",
      datastoreEmulator,
      "gcloud",
      "emulators",
      "firestore",
      "start",
      "--database-mode=datastore-mode",
      "--host-port=0.0.0.0:8081",
      "--quiet",
    ]);
    waitForLog(emulator, /Dev App Server is now running\./u);
    for (const signal of ["TERM", "INT"]) {
      const containers = startRuntimeMatrix({ messageBoard, network, owned, signal, suffix });
      const identity = docker(["image", "inspect", messageBoard, "--format", "{{.Id}}"]).trim();
      assert.equal(containerImage(containers[0]), identity);
      assert.equal(containerImage(containers[1]), identity);
      for (const name of containers.toReversed()) {
        const executable = docker(["exec", name, "readlink", "/proc/1/exe"]).trim();
        assert.match(executable, /\/node$/u);
        stopWithin(name, signal);
        docker(["container", "rm", name]);
        owned.splice(owned.indexOf(name), 1);
      }
    }
  } finally {
    for (const name of owned) {
      try {
        execFileSync("docker", ["container", "rm", "-f", name], { stdio: "ignore" });
      } catch {
        // The resource may not have been created before a prior step failed.
      }
    }
    try {
      execFileSync("docker", ["network", "rm", network], { stdio: "ignore" });
    } catch {
      // The network may not have been created before a prior step failed.
    }
  }
});

function docker(arguments_) {
  return execFileSync("docker", arguments_, { encoding: "utf8", timeout: 30_000 });
}

function start(arguments_) {
  docker(["run", "--detach", ...arguments_]);
}

function startRuntimeMatrix({ messageBoard, network, owned, signal, suffix }) {
  const application = `spine-t0095-application-${signal}-${suffix}`;
  const combined = `spine-t0095-combined-${signal}-${suffix}`;
  const gateway = `spine-t0095-gateway-${signal}-${suffix}`;
  const delivery = `spine-t0095-delivery-${signal}-${suffix}`;
  owned.unshift(application);
  start([
    "--name",
    application,
    "--network",
    network,
    "--network-alias",
    "backend",
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=18080",
    "--env",
    "DATASTORE_PROJECT_ID=spine-t0095",
    "--env",
    "DATASTORE_EMULATOR_HOST=datastore:8081",
    "--env",
    `SPINE_IPC_DIRECTORY=/tmp/spine-ipc-${signal}`,
    messageBoard,
    "node_modules/@spine-event-engine/example-message-board-app/dist/src/application-entry.js",
  ]);
  waitForLog(application, /MessageBoard application ready/u);
  owned.unshift(combined);
  start([
    "--name",
    combined,
    "--network",
    network,
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=18081",
    "--env",
    "BROWSER_ORIGIN=http://localhost:18081",
    "--env",
    `SUBSCRIPTION_REGISTRY_NAMESPACE=message-board-combined-${signal}`,
    "--env",
    "DATASTORE_PROJECT_ID=spine-t0095",
    "--env",
    "DATASTORE_EMULATOR_HOST=datastore:8081",
    "--env",
    `SPINE_IPC_DIRECTORY=/tmp/spine-ipc-${signal}`,
    messageBoard,
  ]);
  waitForLog(combined, /MessageBoard combined server ready/u);
  owned.unshift(gateway);
  start([
    "--name",
    gateway,
    "--network",
    network,
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=18082",
    "--env",
    "BROWSER_ORIGIN=http://localhost:18082",
    "--env",
    "BACKEND_URL=http://backend:18080",
    "--env",
    "DATASTORE_PROJECT_ID=spine-t0095",
    "--env",
    "DATASTORE_EMULATOR_HOST=datastore:8081",
    "--env",
    `SUBSCRIPTION_REGISTRY_NAMESPACE=message-board-smoke-${signal}`,
    "--env",
    `SPINE_IPC_DIRECTORY=/tmp/spine-ipc-${signal}`,
    "spine-ts/standalone-gateway:local",
  ]);
  waitForLog(gateway, /MessageBoard gateway ready/u);
  owned.unshift(delivery);
  start([
    "--name",
    delivery,
    "--network",
    network,
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=18083",
    "spine-ts/simple-delivery-server:local",
  ]);
  waitForLog(delivery, /Delivery server listening/u);
  return [application, combined, gateway, delivery];
}

function waitForLog(container, expected) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const logs = containerLogs(container);
    if (expected.test(logs)) return;
    const state = docker(["inspect", container, "--format", "{{.State.Status}}"]).trim();
    assert.equal(state, "running", `${container} stopped before readiness.\n${logs}`);
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`${container} did not become ready.\n${containerLogs(container)}`);
}

function containerLogs(container) {
  const result = spawnSync("docker", ["logs", container], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return `${result.stdout}${result.stderr}`;
}

function stopWithin(container, signal) {
  docker(["kill", `--signal=${signal}`, container]);
  try {
    const exitCode = execFileSync("docker", ["wait", container], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    assert.equal(exitCode, "0");
  } catch (error) {
    assert.fail(
      `${container} did not stop successfully within 10 seconds after SIG${signal}.\n` +
        `${containerLogs(container)}\n${String(error)}`,
    );
  }
}

function containerImage(container) {
  return docker(["inspect", container, "--format", "{{.Image}}"]).trim();
}
