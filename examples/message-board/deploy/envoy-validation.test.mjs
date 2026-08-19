// Loads each Envoy example in the pinned image before readers copy its configuration.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const root = dirname(fileURLToPath(import.meta.url));
const envoyImage =
  "envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb";

test("the pinned Envoy image validates every deployment configuration", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "spine-envoy-validation-"));
  try {
    const tlsDirectory = join(temporaryDirectory, "tls");
    createTlsFixture(tlsDirectory);
    for (const [name, configuration] of envoyConfigurations()) {
      const path = join(temporaryDirectory, `${name}.yaml`);
      writeFileSync(path, configuration);
      assert.doesNotThrow(
        () =>
          execFileSync(
            "docker",
            [
              "run",
              "--rm",
              "--volume",
              `${path}:/etc/envoy/envoy.yaml:ro`,
              "--volume",
              `${tlsDirectory}:/run/tls:ro`,
              envoyImage,
              "envoy",
              "--mode",
              "validate",
              "--config-path",
              "/etc/envoy/envoy.yaml",
            ],
            { encoding: "utf8", timeout: 30_000 },
          ),
        `${name} must be accepted by the pinned Envoy image`,
      );
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

function createTlsFixture(directory) {
  mkdirSync(directory);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      join(directory, "tls.key"),
      "-out",
      join(directory, "tls.crt"),
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=message-board.example.test",
    ],
    { stdio: "ignore", timeout: 30_000 },
  );
}

function envoyConfigurations() {
  return [
    ["compose-combined", readFileSync(join(root, "compose", "combined-envoy.yaml"), "utf8")],
    ["compose-standalone", readFileSync(join(root, "compose", "standalone-envoy.yaml"), "utf8")],
    ...["combined", "standalone"].map((mode) => [
      `kubernetes-${mode}`,
      kubernetesEnvoyConfiguration(mode),
    ]),
  ];
}

function kubernetesEnvoyConfiguration(mode) {
  const manifest = readFileSync(join(root, "kubernetes", `${mode}.yaml`), "utf8");
  const configMap = parseAllDocuments(manifest)
    .map((document) => document.toJSON())
    .find(
      (document) =>
        document?.kind === "ConfigMap" && document.metadata?.name === "message-board-envoy-config",
    );
  assert.equal(typeof configMap?.data?.["envoy.yaml"], "string", "missing Envoy configuration");
  return configMap.data["envoy.yaml"];
}
