import { describe, expect, it } from "vitest";

import { publishRelease } from "./release-publisher.mjs";

describe("release publisher", () => {
  const artifact = { name: "@spine-event-engine/core", version: "2.0.0-snapshot.4", integrity: "sha512-a", tarball: "core.tgz", dependencies: [] };

  it("resumes only an identical artifact whose selected tag already points at the version", async () => {
    const calls = [];
    const report = await publishRelease({
      release: { tag: "snapshot", version: artifact.version, packages: [artifact, { ...artifact, name: "@spine-event-engine/proto", tarball: "proto.tgz" }] },
      checksum: () => artifact.integrity,
      registry: async (request, entry) => request === "artifact" && entry.name === artifact.name ? { integrity: artifact.integrity } : request === "artifact" ? undefined : { snapshot: artifact.version, latest: "1.0.0" },
      publish: async () => calls.push("publish"),
      poll: async () => {},
    });
    expect(report.skipped).toEqual([artifact.name]);
    expect(calls).toEqual(["publish"]);
  });

  it("fails before mutation when the registry artifact integrity differs", async () => {
    await expect(publishRelease({
      release: { tag: "snapshot", version: artifact.version, packages: [artifact] }, checksum: () => artifact.integrity,
      registry: async (request) => request === "artifact" ? { integrity: "sha512-other" } : { snapshot: artifact.version }, publish: async () => {}, poll: async () => {},
    })).rejects.toThrow("Integrity mismatch");
  });
});
