// Checks the files that describe the separate two-node Message Board example.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compose = join(root, "deploy", "compose.yaml");
const reference = join(root, "REFERENCE.md");
const readme = join(root, "README.md");
const gitignore = join(root, ".gitignore");

test("declares one Gateway, two managed complete-replica nodes, shared storage, and simple delivery", () => {
  assert.equal(existsSync(compose), true, "the distributed Compose topology must exist");
  const source = readFileSync(compose, "utf8");

  for (const service of [
    "application-node-1",
    "application-node-2",
    "datastore",
    "delivery",
    "gateway",
  ])
    assert.match(source, new RegExp(`^ {2}${service}:`, "mu"));
  assert.doesNotMatch(source, /^ {2}gateway-[0-9]+:/mu);
  assert.match(source, /spine-ts\/simple-delivery-server:local/u);
  assert.match(source, /DATASTORE_EMULATOR_HOST: datastore:8081/u);
  assert.match(
    source,
    /BACKEND_URLS: http:\/\/application-node-1:8080,http:\/\/application-node-2:8080/u,
  );
  assert.match(source, /PROCESS_COUNT: "2"/u);
  assert.match(source, /DELIVERY_SHARD_COUNT: "2"/u);
  assert.match(source, /multi-process-app\.js/u);
  assert.doesNotMatch(source, /MESSAGE_BOARD_SESSION_|PRIVATE KEY|signing|bearer|cookie|token/iu);
  assert.doesNotMatch(source, /SPINE_IPC_DIRECTORY/u);
  assert.match(source, /condition: service_healthy/u);
});

test("starts without creating or supplying browser credentials", () => {
  const source = readFileSync(readme, "utf8");

  assert.match(source, /pnpm --dir examples\/distributed-message-board start/u);
  assert.doesNotMatch(source, /key|credential|session|bearer|cookie|token|signing/iu);
});

test("documents the reuse boundary and finite operator lifecycle", () => {
  assert.equal(existsSync(reference), true, "the distributed example reference must exist");
  const source = readFileSync(reference, "utf8");

  assert.match(source, /examples\/message-board\/model/u);
  assert.match(source, /examples\/message-board\/app/u);
  assert.match(source, /examples\/message-board\/web/u);
  assert.match(source, /docker compose --file deploy\/compose\.yaml down/u);
});
