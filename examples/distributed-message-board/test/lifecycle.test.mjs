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

test(
  "runs two application nodes behind one Gateway and shuts them down",
  { timeout: 90_000 },
  () => {
    const project = `t0111-${Date.now()}`;
    try {
      composeRun(project, ["up", "--detach"]);
      waitFor(project, ["datastore", "delivery", "application-1", "application-2", "gateway"]);
      assert.match(clientRun(project, "first"), /full-ok/u);
      assert.match(clientRun(project, "second"), /full-ok/u);
      composeRun(project, ["kill", "--signal", "SIGTERM", "gateway"]);
      waitStopped(project, "gateway");
    } finally {
      composeRun(project, ["down", "--volumes", "--remove-orphans"], true);
      assertNoLeaks(project);
    }
  },
);

function composeRun(project, arguments_, ignoreFailure = false) {
  try {
    return execFileSync(
      "docker",
      ["compose", "--project-name", project, "--file", compose, ...arguments_],
      {
        encoding: "utf8",
        env: { ...process.env, MESSAGE_BOARD_SESSION_PRIVATE_KEY: key },
        timeout: 90_000,
      },
    );
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}

function waitFor(project, services) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = states(composeRun(project, ["ps", "--format", "json"]));
    if (
      services.every(
        (service) => state.get(service)?.State === "running" && ready(project, state.get(service)),
      )
    )
      return;
    execFileSync("sleep", ["1"]);
  }
  assert.fail(
    `distributed topology did not become ready: ${composeRun(project, ["ps", "--all"])} `,
  );
}

function waitStopped(project, service) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = states(composeRun(project, ["ps", "--all", "--format", "json"])).get(service);
    if (record?.State === "exited") {
      assert.equal(Number(record.ExitCode), 0);
      return;
    }
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`${service} did not exit after SIGTERM`);
}

function states(output) {
  return new Map(
    output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const record = JSON.parse(line);
        return [record.Service, record];
      }),
  );
}

function ready(project, service) {
  if (service?.Service === "datastore" || service?.Service === "delivery")
    return service.Health === "healthy";
  if (service?.ID === undefined) return false;
  const logs = execFileSync("docker", ["logs", service.ID], { encoding: "utf8" });
  return /MessageBoard (application|gateway) ready/u.test(logs);
}

function assertNoLeaks(project) {
  for (const [command, arguments_] of [
    ["ps", ["--all", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
    ["network", ["ls", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
    ["volume", ["ls", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
  ])
    assert.equal(execFileSync("docker", [command, ...arguments_], { encoding: "utf8" }).trim(), "");
}

function clientRun(project, runId) {
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      `${project}_default`,
      "--volume",
      `${client}:/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs:ro`,
      "--env",
      "TARGET=http://gateway:8080",
      "--env",
      "ORIGIN=http://127.0.0.1:5173",
      "--env",
      "MODE=full",
      "--env",
      `RUN_ID=${runId}`,
      "--env",
      `MESSAGE_BOARD_SESSION_PRIVATE_KEY=${key}`,
      "--entrypoint",
      "node",
      "spine-ts/message-board:local",
      "/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
}
