import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compose = join(root, "deploy", "compose.yaml");

test("declares one Gateway, two identical applications, shared storage, and simple delivery", () => {
  assert.equal(existsSync(compose), true, "the distributed Compose topology must exist");
  const source = readFileSync(compose, "utf8");

  for (const service of ["application-1", "application-2", "datastore", "delivery", "gateway"])
    assert.match(source, new RegExp(`^  ${service}:`, "mu"));
  assert.doesNotMatch(source, /^  gateway-[0-9]+:/mu);
  assert.match(source, /spine-ts\/simple-delivery-server:local/u);
  assert.match(source, /DATASTORE_EMULATOR_HOST: datastore:8081/u);
  assert.match(source, /BACKEND_URLS: http:\/\/application-1:8080,http:\/\/application-2:8080/u);
});
