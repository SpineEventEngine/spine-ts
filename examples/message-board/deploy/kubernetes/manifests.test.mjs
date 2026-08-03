import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

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
    assert.match(document, /MESSAGE_BOARD_SESSION_PRIVATE_KEY/u);
    assert.match(document, /name: message-board-envoy-config/u);
    assert.match(document, /mountPath: \/etc\/envoy\/envoy.yaml/u);
    assert.match(document, /kind: Service[\s\S]*name: message-board-envoy/u);
    assert.match(document, /secretName: message-board-envoy-tls/u);
    assert.match(document, /route:(?: \{)?\s*cluster: gateway/u);
    assert.match(document, /path: "\/spine\.client\.CommandService\/Post"[\s\S]*timeout: 30s/u);
    assert.match(document, /path: "\/spine\.client\.QueryService\/Read"[\s\S]*timeout: 30s/u);
    assert.match(
      document,
      /path: "\/spine\.client\.SubscriptionService\/Activate"[\s\S]*timeout: 0s/u,
    );
    assert.doesNotMatch(document, /match: \{ prefix: "\/" \}/u);
    assert.doesNotMatch(document, /kind: (Datastore|MySQL|Postgres|Redis|Hazelcast)/u);
    assert.doesNotMatch(document, /helm|operator/iu);
  });
}

test("standalone reference has two application replicas and a separately scaled gateway", () => {
  const document = readFileSync(join(root, "standalone.yaml"), "utf8");
  assert.match(document, /name: message-board-application/u);
  assert.match(document, /name: message-board-gateway/u);
  assert.match(document, /replicas: 2/u);
  assert.match(document, /name: simple-delivery-server/u);
  assert.match(document, /hash_policy:[\s\S]*header_name: authorization/u);
  assert.match(document, /lb_policy: RING_HASH/u);
  assert.match(document, /clusterIP: None/u);
  assert.match(document, /message-board-gateway-headless/u);
  assert.match(document, /message-board-gateway-headless, port_value: 8080/u);
  assert.match(document, /DELIVERY_SERVER_URL: http:\/\/simple-delivery-server:8484/u);
  assert.match(document, /initContainers:[\s\S]*name: wait-for-delivery/u);
});
