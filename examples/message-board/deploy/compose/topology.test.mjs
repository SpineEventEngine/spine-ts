// Checks that Compose files describe the services beginners start together.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";

const composeRoot = dirname(fileURLToPath(import.meta.url));
const combined = join(composeRoot, "combined.compose.yaml");
const standalone = join(composeRoot, "standalone.compose.yaml");
const combinedEnvoy = join(composeRoot, "combined-envoy.yaml");
const standaloneEnvoy = join(composeRoot, "standalone-envoy.yaml");

test("declares a combined topology with its durable registry and one delivery server", () => {
  assert.equal(existsSync(combined), true, "combined Compose reference must exist");
  const document = readFileSync(combined, "utf8");

  assert.match(document, /^services:/mu);
  assert.match(document, /^ {2}combined:/mu);
  assert.match(document, /^ {2}envoy:/mu);
  assert.match(document, /^ {2}web:/mu);
  assert.match(document, /^ {2}delivery:/mu);
  assert.match(document, /^ {2}datastore:/mu);
  assert.match(document, /SUBSCRIPTION_REGISTRY_NAMESPACE: message-board-combined/mu);
  assert.match(document, /spine-ts\/simple-delivery-server:local/u);
  assert.doesNotMatch(document, /MESSAGE_BOARD_SESSION_/u);
  assert.doesNotMatch(document, /replicas:/u);
});

test("declares one local-fixture gateway and one managed complete-replica node", () => {
  assert.equal(existsSync(standalone), true, "standalone Compose reference must exist");
  const document = readFileSync(standalone, "utf8");

  assert.match(document, /^ {2}application-node:/mu);
  assert.match(document, /^ {2}gateway:/mu);
  assert.doesNotMatch(document, /^ {2}gateway-[0-9]+:/mu);
  assert.match(document, /^ {2}envoy:/mu);
  assert.match(document, /^ {2}web:/mu);
  assert.match(document, /^ {2}delivery:/mu);
  assert.match(document, /BACKEND_URLS: http:\/\/application-node:8080/mu);
  assert.match(document, /PROCESS_COUNT: "2"/u);
  assert.match(document, /DELIVERY_SHARD_COUNT: "2"/u);
  assert.match(document, /multi-process-app\.js/u);
  assert.doesNotMatch(document, /SPINE_IPC_DIRECTORY/u);
  assert.doesNotMatch(document, /LOCAL_STATIC_BACKENDS/u);
  assert.match(document, /SUBSCRIPTION_REGISTRY_NAMESPACE: message-board-standalone/mu);
  assert.match(document, /DATASTORE_EMULATOR_HOST: datastore:8081/mu);
  assert.match(
    document,
    /application-node:[\s\S]*?depends_on:[\s\S]*?delivery:[\s\S]*?condition: service_healthy/mu,
  );
  assert.doesNotMatch(document, /MESSAGE_BOARD_SESSION_/u);
  assert.equal((document.match(/spine-ts\/simple-delivery-server:local/gu) ?? []).length, 1);
});

for (const envoy of [combinedEnvoy, standaloneEnvoy]) {
  test(`${envoy.split("/").at(-1)} serves the stock UI and admits browser RPCs`, () => {
    const configuration = parseDocument(readFileSync(envoy, "utf8")).toJSON();
    const httpConnectionManager = httpConnectionManagers(configuration).at(0);
    assert.notEqual(httpConnectionManager, undefined, "missing HTTP connection manager");
    assert.equal(httpConnectionManager.stream_idle_timeout, "0s");
    assert.deepEqual(routes(httpConnectionManager), [...browserRoutes, ["/", "30s"]]);
  });
}

const browserRoutes = [
  ["/spine.auth.AuthenticationService/ResolveContext", "30s"],
  ["/spine.client.CommandService/Post", "30s"],
  ["/spine.client.QueryService/Read", "30s"],
  ["/spine.client.SubscriptionService/Subscribe", "30s"],
  ["/spine.client.SubscriptionService/Activate", "0s"],
  ["/spine.client.SubscriptionService/Cancel", "30s"],
];

function httpConnectionManagers(configuration) {
  return (configuration.static_resources?.listeners ?? []).flatMap((listener) =>
    (listener.filter_chains ?? [])
      .flatMap((chain) => chain.filters ?? [])
      .map((filter) => filter.typed_config)
      .filter(
        (typedConfig) =>
          typedConfig?.["@type"] ===
          "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
      ),
  );
}

function routes(httpConnectionManager) {
  return (httpConnectionManager.route_config?.virtual_hosts ?? []).flatMap((host) =>
    (host.routes ?? []).map((route) => {
      if (route.match?.prefix === "/") return ["/", route.route?.timeout];
      assert.deepEqual(Object.keys(route.match ?? {}), ["path", "headers"]);
      assert.deepEqual(route.match.headers, [{ name: ":method", exact_match: "POST" }]);
      return [route.match.path, route.route?.timeout];
    }),
  );
}
