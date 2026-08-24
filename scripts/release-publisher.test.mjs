import { describe, expect, it } from "vitest";

import {
  compareReleaseVersions,
  createPublicRegistry,
  publishRelease,
  waitForRegistryVisibility,
} from "./release-publisher.mjs";

describe("release publisher", () => {
  const artifact = {
    name: "@spine-event-engine/core",
    version: "2.0.0-snapshot.4",
    integrity: "sha512-a",
    tarball: "core.tgz",
    dependencies: [],
  };
  const response = (status, body = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });

  it("resumes only an identical artifact whose selected tag already points at the version", async () => {
    const calls = [];
    const report = await publishRelease({
      release: {
        tag: "snapshot",
        version: artifact.version,
        packages: [
          artifact,
          { ...artifact, name: "@spine-event-engine/proto", tarball: "proto.tgz" },
        ],
      },
      checksum: () => artifact.integrity,
      registry: async (request, entry) =>
        request === "artifact" && entry.name === artifact.name
          ? { integrity: artifact.integrity }
          : request === "artifact"
            ? undefined
            : { snapshot: artifact.version, latest: "1.0.0" },
      publish: async () => calls.push("publish"),
      poll: async () => {},
    });
    expect(report.skipped).toEqual([artifact.name]);
    expect(calls).toEqual(["publish"]);
  });

  it("fails before mutation when the registry artifact integrity differs", async () => {
    await expect(
      publishRelease({
        release: { tag: "snapshot", version: artifact.version, packages: [artifact] },
        checksum: () => artifact.integrity,
        registry: async (request) =>
          request === "artifact" ? { integrity: "sha512-other" } : { snapshot: artifact.version },
        publish: async () => {},
        poll: async () => {},
      }),
    ).rejects.toThrow("Integrity mismatch");
  });

  it("orders snapshot suffixes and stable releases semantically", () => {
    expect(compareReleaseVersions("2.0.0-snapshot.10", "2.0.0-snapshot.9")).toBeGreaterThan(0);
    expect(compareReleaseVersions("2.0.0", "2.0.0-snapshot.10")).toBeGreaterThan(0);
  });

  it("treats only explicit 404 as absent and rejects malformed registry metadata", async () => {
    const absent = createPublicRegistry({ fetch: async () => response(404) });
    await expect(absent("artifact", artifact)).resolves.toBeUndefined();
    const denied = createPublicRegistry({ fetch: async () => response(401) });
    await expect(denied("artifact", artifact)).rejects.toThrow("401");
    const malformed = createPublicRegistry({ fetch: async () => response(200) });
    await expect(malformed("artifact", artifact)).rejects.toThrow("integrity");
  });

  it("waits for integrity and selected tag visibility with a bounded timeout", async () => {
    let calls = 0;
    const registry = async (kind) => {
      calls += 1;
      return calls < 3
        ? undefined
        : kind === "artifact"
          ? { integrity: artifact.integrity }
          : { snapshot: artifact.version };
    };
    await expect(
      waitForRegistryVisibility({
        registry,
        entry: artifact,
        tag: "snapshot",
        sleep: async () => {},
        attempts: 3,
      }),
    ).resolves.toBeUndefined();
    await expect(
      waitForRegistryVisibility({
        registry: async () => undefined,
        entry: artifact,
        tag: "snapshot",
        sleep: async () => {},
        attempts: 1,
      }),
    ).rejects.toThrow("Timed out");
  });
});
