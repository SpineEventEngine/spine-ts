import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const standalone = join(root, "standalone.compose.yaml");
const combined = join(root, "combined.compose.yaml");
const rpcClient = join(root, "rpc-client.mjs");
const sessionKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQguffSvDX1/JxpSa58
umttcOhLktfYmydcd8IV4+hm9zGhRANCAASbBkf9sjyAX3qpSQ0s3nh3pIK2IbeY
WOYLX8/ohZI0479Vp6ZOV1NXnKt1c0e9ovpoGmfUuccITMasHL/rbs+3
-----END PRIVATE KEY-----`;

test("combined Compose serves signed MessageBoard behavior through Envoy", () => {
  const project = projectName();
  try {
    run(project, combined, ["up", "--detach"]);
    waitFor(project, combined, ["combined", "delivery", "envoy"]);
    const output = client(project, "envoy", "full");
    assert.match(output, /query-ok/u);
    assert.match(output, /full-ok/u);
    run(project, combined, ["kill", "--signal", "SIGTERM", "combined"]);
    waitStopped(project, combined, "combined");
    const combinedState = status(project, combined, true).get("combined");
    assert.equal(combinedState?.state, "exited");
    assert.equal(combinedState.exitCode, 0);
  } finally {
    cleanup(project, combined);
  }
});

test("standalone Compose preserves public behavior and cancellation across gateway failover", () => {
  const project = projectName();
  try {
    run(project, standalone, ["up", "--detach"]);
    waitFor(project, standalone, [
      "application-1",
      "application-2",
      "gateway-1",
      "gateway-2",
      "delivery",
      "envoy",
    ]);

    assert.match(client(project, "envoy", "full"), /full-ok/u);
    const subscription = client(project, "gateway-1", "subscribe").trim();
    assert.notEqual(subscription, "");

    run(project, standalone, ["kill", "--signal", "SIGKILL", "gateway-1"]);
    waitStopped(project, standalone, "gateway-1");
    waitFor(project, standalone, ["gateway-2"]);
    const state = status(project, standalone);
    assert.equal(state.has("gateway-1"), false);
    assert.equal(state.get("gateway-2")?.state, "running");
    assert.match(client(project, "gateway-2", "cancel", subscription), /cancel-ok/u);

    run(project, standalone, ["up", "--detach", "gateway-1"]);
    waitFor(project, standalone, ["gateway-1"]);
    assert.match(client(project, "gateway-1", "assert-cancelled", subscription), /cancelled-ok/u);
    assert.match(client(project, "envoy", "query"), /query-ok/u);

    run(project, standalone, ["kill", "--signal", "SIGTERM", "gateway-1"]);
    waitStopped(project, standalone, "gateway-1");
    assert.equal(status(project, standalone, true).get("gateway-1")?.exitCode, 0);
    assert.equal(status(project, standalone).get("gateway-2")?.state, "running");
  } finally {
    cleanup(project, standalone);
  }
});

function run(project, compose, arguments_, ignoreFailure = false) {
  try {
    return execFileSync(
      "docker",
      ["compose", "--project-name", project, "--file", compose, ...arguments_],
      {
        encoding: "utf8",
        env: { ...process.env, MESSAGE_BOARD_SESSION_PRIVATE_KEY: sessionKey },
        timeout: 90_000,
      },
    );
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}

function status(project, compose, all = false) {
  const records = run(project, compose, ["ps", ...(all ? ["--all"] : []), "--format", "json"])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  return new Map(
    records.map((record) => [
      record.Service,
      { state: record.State, exitCode: Number(record.ExitCode) },
    ]),
  );
}

function waitFor(project, compose, services) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = status(project, compose);
    if (services.every((service) => state.get(service)?.state === "running")) return;
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`Compose topology did not start: ${diagnostics(project, compose)}`);
}

function waitStopped(project, compose, service) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (status(project, compose, true).get(service)?.state === "exited") return;
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`${service} did not stop after SIGTERM: ${diagnostics(project, compose)}`);
}

function diagnostics(project, compose) {
  try {
    return run(project, compose, ["ps", "--all", "--format", "json"]);
  } catch (error) {
    return `Could not collect running-service diagnostics: ${String(error)}`;
  }
}

function client(project, service, mode, subscription) {
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      `${project}_default`,
      "--volume",
      `${rpcClient}:/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs:ro`,
      "--env",
      `TARGET=http://${service}:8080`,
      "--env",
      "ORIGIN=http://localhost:18080",
      "--env",
      `MODE=${mode}`,
      "--env",
      `RUN_ID=${project}`,
      "--env",
      `MESSAGE_BOARD_SESSION_PRIVATE_KEY=${sessionKey}`,
      ...(subscription === undefined ? [] : ["--env", `SUBSCRIPTION=${subscription}`]),
      "--entrypoint",
      "node",
      "spine-ts/message-board:local",
      "/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
}

function cleanup(project, compose) {
  run(project, compose, ["down", "--volumes", "--remove-orphans"], true);
  for (const resource of ["container", "network", "volume"]) {
    const remaining = execFileSync(
      "docker",
      [resource, "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`],
      { encoding: "utf8" },
    ).trim();
    assert.equal(remaining, "", `Compose ${resource} resources leaked for ${project}.`);
  }
}

function projectName() {
  return `spine-t0096-${String(process.pid)}-${String(Date.now())}`;
}
