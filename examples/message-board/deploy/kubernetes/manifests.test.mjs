// Checks that the static Kubernetes reference keeps its documented topology.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, parseDocument } from "yaml";

const root = dirname(fileURLToPath(import.meta.url));
const browserRoutes = [
  ["/spine.auth.AuthenticationService/ResolveContext", "30s"],
  ["/spine.client.CommandService/Post", "30s"],
  ["/spine.client.QueryService/Read", "30s"],
  ["/spine.client.SubscriptionService/Subscribe", "30s"],
  ["/spine.client.SubscriptionService/Activate", "0s"],
  ["/spine.client.SubscriptionService/Cancel", "30s"],
];

for (const mode of ["combined", "standalone"]) {
  test(`${mode} reference is storage-neutral and uses listener-only probes`, () => {
    const manifest = join(root, `${mode}.yaml`);
    assert.equal(existsSync(manifest), true, `${mode} Kubernetes reference must exist`);
    const document = readFileSync(manifest, "utf8");

    assert.match(document, /startupProbe:[\s\S]*tcpSocket:/u);
    assert.match(document, /readinessProbe:[\s\S]*tcpSocket:/u);
    assert.doesNotMatch(document, /livenessProbe:/u);
    assert.match(document, /terminationGracePeriodSeconds:/u);
    assert.match(document, /secretRef:/u);
    assert.match(document, /configMapRef:/u);
    assert.doesNotMatch(document, /MESSAGE_BOARD_SESSION_/u);
    assert.match(document, /secretRef: \{ name: message-board-runtime \}/u);
    assert.doesNotMatch(document, /kind: Secret[\s\S]*name: message-board-runtime/u);
    assert.match(document, /name: message-board-envoy-config/u);
    assert.match(document, /mountPath: \/etc\/envoy\/envoy.yaml/u);
    assert.match(document, /kind: Service[\s\S]*name: message-board-envoy/u);
    assert.match(document, /secretName: message-board-envoy-tls/u);
    assertEnvoy(document, "https://message-board.example.test");
    assert.doesNotMatch(document, /kind: (Datastore|MySQL|Postgres|Redis|Hazelcast)/u);
    assert.doesNotMatch(document, /helm|operator/iu);
  });
}

test("standalone reference uses one dynamically discovering Gateway", () => {
  const document = readFileSync(join(root, "standalone.yaml"), "utf8");
  const application = statefulSet(document, "message-board-application");
  const gateway = deployment(document, "message-board-gateway");
  assert.match(application, /replicas: 2/u);
  assert.match(application, /managed-entry\.js/u);
  assert.match(application, /name: PROCESS_COUNT[\s\S]*?value: "2"/u);
  assert.match(application, /name: DELIVERY_SHARD_COUNT[\s\S]*?value: "2"/u);
  assert.doesNotMatch(application, /SPINE_IPC_DIRECTORY/u);
  assert.match(gateway, /replicas: 1/u);
  assert.match(application, /initContainers:[\s\S]*name: wait-for-delivery/u);
  assert.doesNotMatch(gateway, /wait-for-delivery|DELIVERY_SERVER_URL/u);
  assert.match(document, /lb_policy: RING_HASH/u);
  assert.match(document, /clusterIP: None/u);
  assert.match(gateway, /name: BACKEND_DISCOVERY_SERVICE/u);
  assert.match(gateway, /value: message-board-application-headless/u);
  assert.match(gateway, /name: BACKEND_DISCOVERY_PORT/u);
  assert.doesNotMatch(gateway, /name: BACKEND_URLS/u);
  assert.doesNotMatch(document, /message-board-gateway-headless/u);
});

test("Envoy policy rejects non-path and duplicate route items", () => {
  assert.throws(
    () =>
      envoyRoutes(
        envoyWithRoutes('- name: x\n  match: { prefix: "/" }\n  route: { timeout: 30s }'),
      ),
    /must use an approved match\.path/u,
  );
  assert.throws(
    () =>
      assert.deepEqual(
        envoyRoutes(
          envoyWithRoutes(
            '- match: { path: "/spine.client.CommandService/Post", headers: [{ name: ":method", exact_match: POST }] }\n  route: { timeout: 30s }\n- match: { path: "/spine.client.CommandService/Post", headers: [{ name: ":method", exact_match: POST }] }\n  route: { timeout: 30s }',
          ),
        ),
        browserRoutes,
      ),
    /strictly deep-equal/u,
  );
});

function assertEnvoy(document, origin) {
  const manifests = parseAllDocuments(document).map((manifest) => manifest.toJSON());
  const configMap = manifests.find(
    (manifest) =>
      manifest?.kind === "ConfigMap" && manifest.metadata?.name === "message-board-envoy-config",
  );
  assert.notEqual(configMap, undefined, "missing Envoy ConfigMap");
  const routes = envoyRoutes(configMap.data?.["envoy.yaml"]);
  assert.deepEqual(routes, browserRoutes);
  assert.equal(
    httpConnectionManagers(configMap.data?.["envoy.yaml"]).at(0)?.stream_idle_timeout,
    "0s",
  );
  assert.match(document, new RegExp(`exact: ${origin}`, "u"));
  assert.match(document, /envoy\.filters\.http\.cors/u);
  assert.match(document, /allow_methods: "POST, OPTIONS"/u);
}

function envoyRoutes(document) {
  const envoy = parseDocument(document).toJSON();
  const routes = [];
  for (const listener of envoy.static_resources?.listeners ?? []) {
    for (const chain of listener.filter_chains ?? []) {
      for (const filter of chain.filters ?? []) {
        const hosts = filter.typed_config?.route_config?.virtual_hosts ?? [];
        for (const host of hosts) {
          for (const item of host.routes ?? []) {
            if (
              Object.keys(item.match ?? {}).join(",") !== "path,headers" ||
              typeof item.match.path !== "string"
            ) {
              assert.fail("Envoy route must use an approved match.path and :method POST.");
            }
            assert.deepEqual(item.match.headers, [{ name: ":method", exact_match: "POST" }]);
            assert.equal(
              typeof item.route?.timeout,
              "string",
              `route ${item.match.path} must declare a timeout`,
            );
            routes.push([item.match.path, item.route.timeout]);
          }
        }
      }
    }
  }
  return routes;
}

function httpConnectionManagers(document) {
  const envoy = parseDocument(document).toJSON();
  return (envoy.static_resources?.listeners ?? []).flatMap((listener) =>
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

function envoyWithRoutes(routes) {
  return `static_resources:\n  listeners:\n    - filter_chains:\n        - filters:\n            - typed_config:\n                route_config:\n                  virtual_hosts:\n                    - routes:\n                        ${routes.replaceAll("\n", "\n                        ")}`;
}

function deployment(document, name) {
  const match = new RegExp(
    `kind: Deployment[\\s\\S]*?name: ${name}([\\s\\S]*?)(?=---|$)`,
    "u",
  ).exec(document);
  assert.notEqual(match, null, `missing ${name} deployment`);
  return match[1];
}

function statefulSet(document, name) {
  const match = new RegExp(
    `kind: StatefulSet[\\s\\S]*?name: ${name}([\\s\\S]*?)(?=---|$)`,
    "u",
  ).exec(document);
  assert.notEqual(match, null, `missing ${name} stateful set`);
  return match[1];
}
