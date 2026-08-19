// Runs the separate two-node Message Board Compose example and confirms shutdown.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compose = join(root, "deploy", "compose.yaml");
const client = join(root, "..", "message-board", "deploy", "compose", "rpc-client.mjs");
let cleanupDeadlineAt = 0;
let operationDeadlineAt = 0;

test(
  "runs two application nodes behind one Gateway and shuts them down",
  { timeout: 90_000 },
  () => {
    cleanupDeadlineAt = Date.now() + 88_000;
    operationDeadlineAt = cleanupDeadlineAt - 15_000;
    const project = `t0111-${Date.now()}`;
    try {
      composeRun(project, ["up", "--detach"]);
      waitFor(project, ["datastore", "delivery", "application-node-1", "application-node-2", "gateway"]);
      assert.match(clientRun(project, "first"), /full-ok/u);
      assert.match(clientRun(project, "second"), /full-ok/u);
      composeRun(project, ["kill", "--signal", "SIGTERM", "gateway"]);
      waitStopped(project, "gateway");
    } catch (error) {
      process.stderr.write(composeRun(project, ["logs", "--no-color"], true));
      throw error;
    } finally {
      composeRun(project, ["down", "--volumes", "--remove-orphans"], true, true);
      assertNoLeaks(project);
    }
  },
);

function composeRun(project, arguments_, ignoreFailure = false, cleanup = false) {
  try {
    return execFileSync(
      "docker",
      ["compose", "--project-name", project, "--file", compose, ...arguments_],
      {
        encoding: "utf8",
        env: { ...process.env, GATEWAY_PORT: "0" },
        timeout: remaining(cleanup),
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
    execFileSync("sleep", ["1"], { timeout: remaining() });
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
    execFileSync("sleep", ["1"], { timeout: remaining() });
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
  const logs = execFileSync("docker", ["logs", service.ID], {
    encoding: "utf8",
    timeout: remaining(),
  });
  return /MessageBoard (managed coordinator|gateway) ready/u.test(logs);
}

function assertNoLeaks(project) {
  for (const [command, arguments_] of [
    ["ps", ["--all", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
    ["network", ["ls", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
    ["volume", ["ls", "--filter", `label=com.docker.compose.project=${project}`, "--quiet"]],
  ])
    assert.equal(
      execFileSync("docker", [command, ...arguments_], {
        encoding: "utf8",
        timeout: remaining(true),
      }).trim(),
      "",
    );
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
      "MODE=distributed-full",
      "--env",
      `RUN_ID=${runId}`,
      "--entrypoint",
      "node",
      "spine-ts/message-board:local",
      "/app/node_modules/@spine-event-engine/example-message-board-app/compose-rpc-client.mjs",
    ],
    { encoding: "utf8", timeout: remaining() },
  );
}

function remaining(cleanup = false) {
  return Math.max(1, (cleanup ? cleanupDeadlineAt : operationDeadlineAt) - Date.now());
}
