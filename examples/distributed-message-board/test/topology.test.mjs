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

test("declares one Gateway, two identical applications, shared storage, and simple delivery", () => {
  assert.equal(existsSync(compose), true, "the distributed Compose topology must exist");
  const source = readFileSync(compose, "utf8");

  for (const service of ["application-1", "application-2", "datastore", "delivery", "gateway"])
    assert.match(source, new RegExp(`^ {2}${service}:`, "mu"));
  assert.doesNotMatch(source, /^  gateway-[0-9]+:/mu);
  assert.match(source, /spine-ts\/simple-delivery-server:local/u);
  assert.match(source, /DATASTORE_EMULATOR_HOST: datastore:8081/u);
  assert.match(source, /BACKEND_URLS: http:\/\/application-1:8080,http:\/\/application-2:8080/u);
  assert.match(source, /condition: service_healthy/u);
});

test("creates a local development signing key instead of referring to an absent fixture", () => {
  const source = readFileSync(readme, "utf8");

  assert.match(source, /openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256/u);
  assert.match(source, /fixture-private-key\.pem/u);
  assert.doesNotMatch(source, /BEGIN PRIVATE KEY/u);
  assert.match(readFileSync(gitignore, "utf8"), /^fixture-private-key\.pem$/mu);
  const lines = source.split("\n");
  for (const line of [lines[19], lines[21], lines[28]])
    assert.equal(line.match(/\\+$/u)?.[0].length, 1);
});

test("documents the reuse boundary and finite operator lifecycle", () => {
  assert.equal(existsSync(reference), true, "the distributed example reference must exist");
  const source = readFileSync(reference, "utf8");

  assert.match(source, /examples\/message-board\/model/u);
  assert.match(source, /examples\/message-board\/app/u);
  assert.match(source, /examples\/message-board\/web/u);
  assert.match(source, /docker compose --file deploy\/compose\.yaml down/u);
});
