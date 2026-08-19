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
  assert.match(source, /managed-entry\.js/u);
  assert.doesNotMatch(source, /SPINE_IPC_DIRECTORY/u);
  assert.match(source, /condition: service_healthy/u);
});

test("creates a local development signing key instead of referring to an absent fixture", () => {
  const source = readFileSync(readme, "utf8");

  assert.match(source, /openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256/u);
  assert.match(source, /fixture-private-key\.pem/u);
  assert.doesNotMatch(source, /BEGIN PRIVATE KEY/u);
  assert.match(readFileSync(gitignore, "utf8"), /^fixture-private-key\.pem$/mu);
  const command = source.match(
    /openssl genpkey[^\n]*\\\n\s+-out examples\/distributed-message-board\/fixture-private-key\.pem\nMESSAGE_BOARD_SESSION_PRIVATE_KEY=[^\n]*\\\n\s+pnpm --dir examples\/distributed-message-board start/u,
  );
  assert.notEqual(command, null, "the key and startup command must retain their continuations");
  assert.equal(command[0].match(/\\+$/gmu)?.length, 2);
});

test("documents the reuse boundary and finite operator lifecycle", () => {
  assert.equal(existsSync(reference), true, "the distributed example reference must exist");
  const source = readFileSync(reference, "utf8");

  assert.match(source, /examples\/message-board\/model/u);
  assert.match(source, /examples\/message-board\/app/u);
  assert.match(source, /examples\/message-board\/web/u);
  assert.match(source, /docker compose --file deploy\/compose\.yaml down/u);
});
