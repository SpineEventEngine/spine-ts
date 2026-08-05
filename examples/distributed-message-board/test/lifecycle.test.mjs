import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compose = join(root, "deploy", "compose.yaml");
const client = join(root, "..", "message-board", "deploy", "compose", "rpc-client.mjs");
const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQguffSvDX1/JxpSa58
umttcOhLktfYmydcd8IV4+hm9zGhRANCAASbBkf9sjyAX3qpSQ0s3nh3pIK2IbeY
WOYLX8/ohZI0479Vp6ZOV1NXnKt1c0e9ovpoGmfUuccITMasHL/rbs+3
-----END PRIVATE KEY-----`;

test("runs two application nodes behind one Gateway and shuts them down", { timeout: 90_000 }, () => {
  const project = `t0111-${Date.now()}`;
  try {
    composeRun(project, ["up", "--detach"]);
    waitFor(project, ["application-1", "application-2", "gateway"]);
    assert.match(clientRun(project, "first"), /full-ok/u);
    assert.match(clientRun(project, "second"), /full-ok/u);
    composeRun(project, ["kill", "--signal", "SIGTERM", "gateway"]);
    assert.match(composeRun(project, ["ps", "--all", "--format", "json"]), /gateway/u);
  } finally {
    composeRun(project, ["down", "--volumes", "--remove-orphans"], true);
  }
});

function composeRun(project, arguments_, ignoreFailure = false) {
  try {
    return execFileSync("docker", ["compose", "--project-name", project, "--file", compose, ...arguments_], {
      encoding: "utf8",
      env: { ...process.env, MESSAGE_BOARD_SESSION_PRIVATE_KEY: key },
      timeout: 90_000,
    });
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}

function waitFor(project, services) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = composeRun(project, ["ps", "--format", "json"]);
    if (services.every((service) => state.includes(service) && state.includes("running"))) return;
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`distributed topology did not become ready: ${composeRun(project, ["ps", "--all"])} `);
}

function clientRun(project, runId) {
  return execFileSync(
    "docker",
    [
      "run", "--rm", "--network", `${project}_default`,
      "--volume", `${client}:/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs:ro`,
      "--env", "TARGET=http://gateway:8080", "--env", "ORIGIN=http://127.0.0.1:5173",
      "--env", "MODE=full", "--env", `RUN_ID=${runId}`,
      "--env", `MESSAGE_BOARD_SESSION_PRIVATE_KEY=${key}`,
      "--entrypoint", "node", "spine-ts/message-board:local",
      "/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
}
