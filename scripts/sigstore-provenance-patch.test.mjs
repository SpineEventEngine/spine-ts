import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const libnpmpublishRoot = dirname(require.resolve("libnpmpublish/package.json"));
const sigstoreConfigPath = require.resolve("sigstore/dist/config.js", {
  paths: [libnpmpublishRoot],
});

describe("Sigstore provenance patch", () => {
  it("declares and locks the sigstore conflict-recovery patch used by Lerna publication", () => {
    const workspace = parse(readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8"));
    const patchPath = resolve(root, "patches/sigstore@4.1.1.patch");
    const patchHash = createHash("sha256").update(readFileSync(patchPath)).digest("hex");
    const lockfile = parse(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));

    expect(workspace.patchedDependencies).toEqual({
      "sigstore@4.1.1": "patches/sigstore@4.1.1.patch",
    });
    expect(lockfile.patchedDependencies["sigstore@4.1.1"]).toBe(patchHash);
    expect(lockfile.snapshots[`sigstore@4.1.1(patch_hash=${patchHash})`]).toBeDefined();
  });

  it("recovers Lerna's resolved Sigstore provenance from an equivalent Rekor entry", async () => {
    const requests = [];
    const existingEntryId = "existing-entry";
    const entryBody = Buffer.from(JSON.stringify({ apiVersion: "0.0.1", kind: "dsse" })).toString(
      "base64",
    );
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      if (request.method === "POST") {
        response.writeHead(409, {
          Location: `/api/v1/log/entries/${existingEntryId}`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          [existingEntryId]: {
            body: entryBody,
            integratedTime: 1,
            logID: "00".repeat(32),
            logIndex: 1,
          },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected the mock Rekor server to listen on a TCP port.");
    }

    const config = require(sigstoreConfigPath);
    const bundleBuilder = config.createBundleBuilder("dsseEnvelope", {
      rekorURL: `http://127.0.0.1:${address.port}`,
      retry: { retries: 0 },
      timeout: 1_000,
    });
    const [rekorWitness] = Reflect.get(bundleBuilder, "witnesses");
    try {
      const result = await rekorWitness.testify(
        {
          $case: "dsseEnvelope",
          dsseEnvelope: {
            payload: Buffer.from("payload"),
            payloadType: "application/vnd.in-toto+json",
            signatures: [{ keyid: "", sig: Buffer.from("signature") }],
          },
        },
        Buffer.from("public-key"),
      );

      expect(requests).toEqual([
        "POST /api/v1/log/entries",
        `GET /api/v1/log/entries/${existingEntryId}`,
      ]);
      expect(result.tlogEntries).toHaveLength(1);
      expect(result.tlogEntries[0].kindVersion).toEqual({ kind: "dsse", version: "0.0.1" });
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
