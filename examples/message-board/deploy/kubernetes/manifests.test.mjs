import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    assert.match(document, /MESSAGE_BOARD_SESSION_ISSUER/u);
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

test("standalone reference binds replica count and delivery waits to each Deployment", () => {
  const document = readFileSync(join(root, "standalone.yaml"), "utf8");
  const application = deployment(document, "message-board-application");
  const gateway = deployment(document, "message-board-gateway");
  assert.match(application, /replicas: 2/u);
  assert.match(gateway, /replicas: 2/u);
  assert.match(application, /initContainers:[\s\S]*name: wait-for-delivery/u);
  assert.match(gateway, /initContainers:[\s\S]*name: wait-for-delivery/u);
  assert.match(document, /lb_policy: RING_HASH/u);
  assert.match(document, /clusterIP: None/u);
  assert.match(document, /message-board-gateway-headless, port_value: 8080/u);
});

test("Envoy policy rejects non-path and duplicate route items", () => {
  assert.throws(
    () => envoyRoutes('- match: { prefix: "/" }\n  route: { cluster: gateway, timeout: 30s }'),
    /must use an approved match\.path/u,
  );
  assert.throws(
    () =>
      assert.deepEqual(
        envoyRoutes(
          '- match: { path: "/spine.client.CommandService/Post" }\n' +
            "  route: { cluster: gateway, timeout: 30s }\n" +
            '- match: { path: "/spine.client.CommandService/Post" }\n' +
            "  route: { cluster: gateway, timeout: 30s }",
        ),
        browserRoutes,
      ),
    /strictly deep-equal/u,
  );
});

function assertEnvoy(document, origin) {
  const routes = envoyRoutes(document);
  assert.deepEqual(routes, browserRoutes);
  assert.match(document, new RegExp(`exact: ${origin}`, "u"));
  assert.match(document, /envoy\.filters\.http\.cors/u);
  assert.match(document, /allow_methods: "POST, OPTIONS"/u);
}

function envoyRoutes(document) {
  const lines = document.split("\n");
  const routes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("- match:")) continue;
    const route = /^\s*- match: \{ path: "([^"]+)" \}$/.exec(line);
    if (route === null) assert.fail(`Envoy route ${line.trim()} must use an approved match.path.`);
    const indent = line.length - line.trimStart().length;
    let timeout;
    for (index += 1; index < lines.length; index += 1) {
      const next = lines[index];
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent === indent && next.trimStart().startsWith("- match:")) break;
      const candidate = /(?:^\s*timeout: |\btimeout: )(\S+?)(?: \}|$)/.exec(next);
      if (candidate !== null) timeout = candidate[1];
    }
    assert.notEqual(timeout, undefined, `route ${route[1]} must declare a timeout`);
    routes.push([route[1], timeout]);
    index -= 1;
  }
  return routes;
}

function deployment(document, name) {
  const match = new RegExp(
    `kind: Deployment[\\s\\S]*?name: ${name}([\\s\\S]*?)(?=---|$)`,
    "u",
  ).exec(document);
  assert.notEqual(match, null, `missing ${name} deployment`);
  return match[1];
}
