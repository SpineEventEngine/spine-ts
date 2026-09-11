import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

  it("configures Lerna's resolved Sigstore Rekor witness to fetch an equivalent entry", () => {
    expect(sigstoreConfigPath).toContain("sigstore@4.1.1_patch_hash=");

    const config = require(sigstoreConfigPath);
    const bundleBuilder = config.createBundleBuilder("dsseEnvelope", {});
    const rekorWitness = bundleBuilder.witnesses.find(
      (witness) => witness.constructor.name === "RekorWitness",
    );

    expect(rekorWitness.tlogV1.fetchOnConflict).toBe(true);
  });
});
