import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const compose = join(root, "standalone.compose.yaml");

test("standalone Compose keeps the second gateway available after the first is terminated", () => {
  const project = `spine-t0096-${String(process.pid)}-${String(Date.now())}`;
  try {
    run(project, ["up", "--detach"]);
    waitFor(project, ["application-1", "application-2", "gateway-1", "gateway-2", "delivery"]);

    run(project, ["kill", "gateway-1"]);
    waitFor(project, ["gateway-2"]);
    const state = status(project);
    assert.equal(state.has("gateway-1"), false);
    assert.equal(state.get("gateway-2"), "running");

    run(project, ["up", "--detach", "gateway-1"]);
    waitFor(project, ["gateway-1"]);
  } finally {
    run(project, ["down", "--volumes"], true);
  }
});

function run(project, arguments_, ignoreFailure = false) {
  try {
    return execFileSync(
      "docker",
      ["compose", "--project-name", project, "--file", compose, ...arguments_],
      {
        encoding: "utf8",
        timeout: 90_000,
      },
    );
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}

function status(project) {
  const records = run(project, ["ps", "--format", "json"])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  return new Map(records.map((record) => [record.Service, record.State]));
}

function waitFor(project, services) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = status(project);
    if (services.every((service) => state.get(service) === "running")) return;
    execFileSync("sleep", ["1"]);
  }
  assert.fail(`Compose topology did not start: ${diagnostics(project)}`);
}

function diagnostics(project) {
  try {
    return run(project, ["ps", "--all", "--format", "json"]);
  } catch (error) {
    return `Could not collect running-service diagnostics: ${String(error)}`;
  }
}
