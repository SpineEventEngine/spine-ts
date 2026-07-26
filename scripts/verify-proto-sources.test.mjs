import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("./verify-proto-sources.mjs", import.meta.url).pathname;
const copiedProtoContents = 'syntax = "proto3";\npackage spine.test;\nmessage Present {}\n';
const copiedProtoSha = "4952a97f8d4161592137c66d0a649d6e949ef78089e6d1df642008becbea6ca1";

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-verify-"));
  mkdirSync(join(repoRoot, "packages/proto/proto/spine"), { recursive: true });

  return repoRoot;
}

function manifestSource(localPath) {
  return {
    localPath,
    repository: "SpineEventEngine/base",
    commit: "43b55858c410eaf79fc594ca6f3f3eab0daca027",
    upstreamPath: "base/src/main/proto/spine/present.proto",
    sourceUrl:
      "https://github.com/SpineEventEngine/base/blob/43b55858c410eaf79fc594ca6f3f3eab0daca027/base/src/main/proto/spine/present.proto",
    rawUrl:
      "https://raw.githubusercontent.com/SpineEventEngine/base/43b55858c410eaf79fc594ca6f3f3eab0daca027/base/src/main/proto/spine/present.proto",
    sha256: copiedProtoSha,
  };
}

function runVerifier(repoRoot, manifest) {
  const manifestPath = join(repoRoot, "packages/proto/proto/spine-sources.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return spawnSync(
    process.execPath,
    [scriptPath, "--repo-root", repoRoot, "--manifest", manifestPath],
    {
      encoding: "utf8",
    },
  );
}

describe("verify-proto-sources", () => {
  it("accepts frozen non-Spine service contracts under the canonical package Proto root", () => {
    const repoRoot = createFixture();
    const localPath = "packages/proto/proto/grpc/health/v1/health.proto";
    const filePath = join(repoRoot, localPath);
    mkdirSync(join(repoRoot, "packages/proto/proto/grpc/health/v1"), { recursive: true });
    writeFileSync(filePath, copiedProtoContents);

    const source = manifestSource(localPath);
    source.repository = "SpineEventEngine/delivery-server";
    source.upstreamPath = "grpc-api/src/main/proto/grpc/health/v1/health.proto";
    source.sourceUrl =
      "https://github.com/SpineEventEngine/delivery-server/blob/43b55858c410eaf79fc594ca6f3f3eab0daca027/grpc-api/src/main/proto/grpc/health/v1/health.proto";
    source.rawUrl =
      "https://raw.githubusercontent.com/SpineEventEngine/delivery-server/43b55858c410eaf79fc594ca6f3f3eab0daca027/grpc-api/src/main/proto/grpc/health/v1/health.proto";

    const result = runVerifier(repoRoot, { schemaVersion: 1, sources: [source] });

    expect(result.status).toBe(0);
  });

  it("rejects copied proto files missing from the manifest", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, "packages/proto/proto/spine/present.proto"), copiedProtoContents);

    const result = runVerifier(repoRoot, {
      schemaVersion: 1,
      sources: [],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/proto/proto/spine/present.proto: copied proto file is missing from manifest",
    );
  });

  it("rejects duplicate manifest localPath entries", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, "packages/proto/proto/spine/present.proto"), copiedProtoContents);

    const result = runVerifier(repoRoot, {
      schemaVersion: 1,
      sources: [
        manifestSource("packages/proto/proto/spine/present.proto"),
        manifestSource("packages/proto/proto/spine/present.proto"),
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/proto/proto/spine/present.proto: duplicate manifest localPath",
    );
  });

  it("rejects manifest paths containing traversal", () => {
    const repoRoot = createFixture();

    const result = runVerifier(repoRoot, {
      schemaVersion: 1,
      sources: [manifestSource("packages/proto/proto/spine/../escape.proto")],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "localPath must be a relative packages/proto/proto/**/*.proto path without '..'",
    );
  });

  it("rejects provenance URLs for a different repository", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, "packages/proto/proto/spine/present.proto"), copiedProtoContents);
    const source = manifestSource("packages/proto/proto/spine/present.proto");
    source.repository = "SpineEventEngine/core-java";

    const result = runVerifier(repoRoot, { schemaVersion: 1, sources: [source] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "sourceUrl must exactly match repository, commit, and upstreamPath",
    );
    expect(result.stderr).toContain(
      "rawUrl must exactly match repository, commit, and upstreamPath",
    );
  });

  it("rejects provenance URLs for a different upstream path", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, "packages/proto/proto/spine/present.proto"), copiedProtoContents);
    const source = manifestSource("packages/proto/proto/spine/present.proto");
    source.upstreamPath = "base/src/main/proto/spine/other.proto";

    const result = runVerifier(repoRoot, { schemaVersion: 1, sources: [source] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "sourceUrl must exactly match repository, commit, and upstreamPath",
    );
    expect(result.stderr).toContain(
      "rawUrl must exactly match repository, commit, and upstreamPath",
    );
  });
});
