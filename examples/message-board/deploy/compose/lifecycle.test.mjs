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

test("Compose readiness ignores a prior container incarnation's readiness log", () => {
  const startedAt = "2026-08-03T12:00:00.000Z";
  const readiness = /MessageBoard gateway ready/u;

  assert.equal(
    hasReadinessLog(
      "2026-08-03T11:59:59.999Z MessageBoard gateway ready at http://0.0.0.0:8080\n",
      startedAt,
      readiness,
    ),
    false,
  );
  assert.equal(
    hasReadinessLog(
      "2026-08-03T12:00:00.000Z MessageBoard gateway ready at http://0.0.0.0:8080\n",
      startedAt,
      readiness,
    ),
    true,
  );
});

test("combined Compose serves signed MessageBoard behavior through Envoy", () => {
  const project = projectName();
  try {
    run(project, combined, ["up", "--detach"]);
    waitFor(
      project,
      combined,
      ["combined", "delivery", "envoy"],
      new Map([["combined", /MessageBoard combined server ready/u]]),
    );
    const output = client(project, "envoy", "distributed-full");
    assert.match(output, /query-ok/u);
    assert.match(output, /full-ok/u);
    assert.equal(
      envoyMethodStatus(project, "GET", "/spine.client.CommandService/Post"),
      404,
      "Envoy must reject a non-POST reserved RPC path before upstream work.",
    );
    run(project, combined, ["kill", "--signal", "SIGTERM", "combined"]);
    waitStopped(project, combined, "combined");
    const combinedState = status(project, combined, true).get("combined");
    assert.equal(combinedState?.state, "exited");
    assert.equal(combinedState.exitCode, 0);
  } finally {
    cleanup(project, combined);
  }
});

test("standalone Compose recovers its one Gateway from an expected client interruption", () => {
  const project = projectName();
  try {
    run(project, standalone, ["up", "--detach"]);
    waitFor(
      project,
      standalone,
      ["application-node", "gateway", "delivery", "envoy"],
      new Map([
        ["application-node", /MessageBoard managed coordinator ready/u],
        ["gateway", /MessageBoard gateway ready/u],
      ]),
    );

    let output;
    try {
      output = client(project, "envoy", "distributed-full");
    } catch (error) {
      throw new Error(
        `Standalone public subscription failed. ${String(error)}\n${serviceLogs(project, standalone, ["gateway", "application-node", "envoy"])}`,
        { cause: error },
      );
    }
    assert.match(output, /full-ok/u);
    const subscription = client(project, "gateway", "subscribe").trim();
    assert.notEqual(subscription, "");

    run(project, standalone, ["kill", "--signal", "SIGKILL", "gateway"]);
    waitStopped(project, standalone, "gateway");

    run(project, standalone, ["up", "--detach", "gateway"]);
    waitFor(
      project,
      standalone,
      ["gateway"],
      new Map([["gateway", /MessageBoard gateway ready/u]]),
    );
    assert.match(client(project, "gateway", "cancel", subscription), /cancel-ok/u);
    assert.match(client(project, "gateway", "assert-cancelled", subscription), /cancelled-ok/u);
    assert.match(client(project, "envoy", "query"), /query-ok/u);

    run(project, standalone, ["kill", "--signal", "SIGTERM", "gateway"]);
    waitStopped(project, standalone, "gateway");
    assert.equal(status(project, standalone, true).get("gateway")?.exitCode, 0);
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
      { id: record.ID, state: record.State, exitCode: Number(record.ExitCode) },
    ]),
  );
}

function waitFor(project, compose, services, readiness = new Map()) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = status(project, compose);
    if (
      services.every((service) => state.get(service)?.state === "running") &&
      [...readiness].every(([service, expected]) => serviceIsReady(state.get(service), expected))
    ) {
      return;
    }
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`Compose topology did not start: ${diagnostics(project, compose)}`);
}

function serviceIsReady(service, expected) {
  if (service?.id === undefined) return false;
  const startedAt = execFileSync(
    "docker",
    ["inspect", service.id, "--format", "{{.State.StartedAt}}"],
    { encoding: "utf8", timeout: 30_000 },
  ).trim();
  const logs = execFileSync("docker", ["logs", "--timestamps", service.id], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return hasReadinessLog(logs, startedAt, expected);
}

function hasReadinessLog(logs, startedAt, expected) {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return false;
  return logs.split("\n").some((line) => {
    const separator = line.indexOf(" ");
    if (separator === -1) return false;
    const timestamp = Date.parse(line.slice(0, separator));
    return (
      !Number.isNaN(timestamp) && timestamp >= start && expected.test(line.slice(separator + 1))
    );
  });
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

function serviceLogs(project, compose, services) {
  try {
    return run(project, compose, ["logs", "--tail", "200", ...services]);
  } catch (error) {
    return `Could not collect service logs: ${String(error)}`;
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

function envoyMethodStatus(project, method, path) {
  const program = `
    import http from "node:http";
    const request = http.request({ hostname: "envoy", port: 8080, path: process.env.PATHNAME, method: process.env.METHOD }, (response) => {
      console.log(response.statusCode);
      response.resume();
    });
    request.on("error", (error) => { throw error; });
    request.end();
  `;
  return Number(
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        `${project}_default`,
        "--env",
        `METHOD=${method}`,
        "--env",
        `PATHNAME=${path}`,
        "--entrypoint",
        "node",
        "spine-ts/message-board:local",
        "--input-type=module",
        "--eval",
        program,
      ],
      { encoding: "utf8", timeout: 30_000 },
    ).trim(),
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
