import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { renderEnvoy } from "./render.mjs";

const envoyImage =
  "envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb";

test(
  "the pinned Envoy image accepts rendered configuration and rejects invalid configuration",
  { timeout: 120_000 },
  async (t) => {
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
      t.skip("Docker is unavailable; run this gate where the pinned image can execute.");
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "spine-ts-envoy-"));
    try {
      const certificate = join(directory, "cert.pem");
      const key = join(directory, "key.pem");
      const configuration = join(directory, "envoy.yaml");
      const certificateResult = spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          certificate,
          "-subj",
          "/CN=localhost",
          "-days",
          "1",
        ],
        { encoding: "utf8" },
      );
      assert.equal(certificateResult.status, 0, certificateResult.stderr);
      await writeFile(
        configuration,
        renderEnvoy({
          browserOrigin: "https://chat.example.test",
          tlsCertificate: "/run/tls/cert.pem",
          tlsKey: "/run/tls/key.pem",
          authRoutes: [
            { method: "POST", path: "/auth/exchange", timeoutMs: 1200, maxRequestBytes: 4096 },
          ],
        }),
      );
      const validation = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${configuration}:/etc/envoy/envoy.yaml:ro`,
          "-v",
          `${directory}:/run/tls:ro`,
          envoyImage,
          "-c",
          "/etc/envoy/envoy.yaml",
          "--mode",
          "validate",
        ],
        { encoding: "utf8" },
      );
      assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
      await writeFile(configuration, "this is not a valid Envoy configuration: [");
      const invalid = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${configuration}:/etc/envoy/envoy.yaml:ro`,
          "-v",
          `${directory}:/run/tls:ro`,
          envoyImage,
          "-c",
          "/etc/envoy/envoy.yaml",
          "--mode",
          "validate",
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(
        invalid.status,
        0,
        "pinned Envoy unexpectedly accepted invalid configuration",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
