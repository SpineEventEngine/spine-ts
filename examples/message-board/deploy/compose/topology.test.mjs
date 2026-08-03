import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const composeRoot = dirname(fileURLToPath(import.meta.url));
const combined = join(composeRoot, "combined.compose.yaml");
const standalone = join(composeRoot, "standalone.compose.yaml");

test("declares a combined topology with its durable registry and one delivery server", () => {
  assert.equal(existsSync(combined), true, "combined Compose reference must exist");
  const document = readFileSync(combined, "utf8");

  assert.match(document, /^services:/mu);
  assert.match(document, /^  combined:/mu);
  assert.match(document, /^  envoy:/mu);
  assert.match(document, /^  delivery:/mu);
  assert.match(document, /^  datastore:/mu);
  assert.match(document, /SUBSCRIPTION_REGISTRY_NAMESPACE: message-board-combined/mu);
  assert.match(document, /spine-ts\/simple-delivery-server:local/u);
  assert.match(
    document,
    /MESSAGE_BOARD_SESSION_PRIVATE_KEY: \$\{MESSAGE_BOARD_SESSION_PRIVATE_KEY:\?/u,
  );
  assert.doesNotMatch(document, /BEGIN PRIVATE KEY/u);
  assert.doesNotMatch(document, /replicas:/u);
});

test("declares a two-gateway and two-application standalone topology", () => {
  assert.equal(existsSync(standalone), true, "standalone Compose reference must exist");
  const document = readFileSync(standalone, "utf8");

  assert.match(document, /^  application-1:/mu);
  assert.match(document, /^  application-2:/mu);
  assert.match(document, /^  gateway-1:/mu);
  assert.match(document, /^  gateway-2:/mu);
  assert.match(document, /^  envoy:/mu);
  assert.match(document, /^  delivery:/mu);
  assert.match(document, /BACKEND_URL: http:\/\/application-1:8080/mu);
  assert.match(document, /BACKEND_URL: http:\/\/application-2:8080/mu);
  assert.match(document, /SUBSCRIPTION_REGISTRY_NAMESPACE: message-board-standalone/mu);
  assert.match(document, /DATASTORE_EMULATOR_HOST: datastore:8081/mu);
  assert.match(document, /MESSAGE_BOARD_SESSION_ISSUER: message-board/mu);
  assert.match(document, /MESSAGE_BOARD_SESSION_AUDIENCE: message-board-web/mu);
  assert.match(document, /MESSAGE_BOARD_SESSION_KEY_ID: compose-fixture/mu);
  assert.match(
    document,
    /MESSAGE_BOARD_SESSION_PRIVATE_KEY: \$\{MESSAGE_BOARD_SESSION_PRIVATE_KEY:\?/u,
  );
  assert.doesNotMatch(document, /BEGIN PRIVATE KEY/u);
  assert.equal((document.match(/spine-ts\/simple-delivery-server:local/gu) ?? []).length, 1);
});
