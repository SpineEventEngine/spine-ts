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

  const releaseOf = (packages) => ({ tag: "snapshot", version: artifact.version, packages });
  const absentRegistry = async (kind) => (kind === "artifact" ? undefined : {});
  const noOpPoll = async () => {};

  it("publishes dependencies first with the exact npm arguments", async () => {
    const proto = { ...artifact, name: "@spine-event-engine/proto", tarball: "proto.tgz" };
    const core = { ...artifact, dependencies: [proto.name] };
    const calls = [];
    const visible = new Set();
    await publishRelease({
      release: releaseOf([core, proto]),
      checksum: () => artifact.integrity,
      registry: async (kind, entry) =>
        kind === "tags"
          ? visible.has(entry.name)
            ? { snapshot: artifact.version }
            : {}
          : visible.has(entry.name)
            ? { integrity: artifact.integrity }
            : undefined,
      publish: async (entry, args) => {
        visible.add(entry.name);
        calls.push([entry.name, args]);
      },
      poll: noOpPoll,
    });
    expect(calls).toEqual([
      [
        proto.name,
        ["--access", "public", "--tag", "snapshot", "--registry=https://registry.npmjs.org/"],
      ],
      [
        core.name,
        ["--access", "public", "--tag", "snapshot", "--registry=https://registry.npmjs.org/"],
      ],
    ]);
  });

  it("fails before publishing when every artifact is already present", async () => {
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) =>
          kind === "artifact" ? { integrity: artifact.integrity } : { snapshot: artifact.version },
        publish: async () => {},
        poll: noOpPoll,
      }),
    ).rejects.toThrow("already published");
  });

  it("rejects absent and wrong selected tags for an existing artifact", async () => {
    for (const tags of [{}, { snapshot: "2.0.0-snapshot.3" }])
      await expect(
        publishRelease({
          release: releaseOf([artifact]),
          checksum: () => artifact.integrity,
          registry: async (kind) =>
            kind === "artifact" ? { integrity: artifact.integrity } : tags,
          publish: async () => {},
          poll: noOpPoll,
        }),
      ).rejects.toThrow("Selected tag mismatch");
  });

  it("blocks selected tag rollback from a newer snapshot", async () => {
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) =>
          kind === "artifact" ? undefined : { snapshot: "2.0.0-snapshot.5" },
        publish: async () => {},
        poll: noOpPoll,
      }),
    ).rejects.toThrow("rollback");
  });

  it("rejects selected tag movement immediately before publication without mutation", async () => {
    let reads = 0;
    const published = [];
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) =>
          kind === "artifact" ? undefined : reads++ === 0 ? {} : { snapshot: "2.0.0-snapshot.3" },
        publish: async (entry) => published.push(entry.name),
        poll: noOpPoll,
      }),
    ).rejects.toThrow("Selected tag changed before publication");
    expect(published).toEqual([]);
  });

  it("rejects a selected tag disappearing before publication without mutation", async () => {
    let tagReads = 0;
    const published = [];
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) =>
          kind === "artifact" ? undefined : tagReads++ === 0 ? { snapshot: artifact.version } : {},
        publish: async (entry) => published.push(entry.name),
        poll: noOpPoll,
      }),
    ).rejects.toThrow("Selected tag changed before publication");
    expect(published).toEqual([]);
  });

  it("rejects a selected tag lost after visibility polling during finalization", async () => {
    let polled = false;
    const published = [];
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) => (kind === "artifact" ? undefined : {}),
        publish: async (entry) => published.push(entry.name),
        poll: async () => {
          polled = true;
        },
      }),
    ).rejects.toThrow("Selected tag did not reach release version");
    expect(published).toEqual([artifact.name]);
    expect(polled).toBe(true);
  });

  it("rejects opposite tag movement after visibility polling during finalization", async () => {
    let polled = false;
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: async (kind) =>
          kind === "artifact"
            ? undefined
            : polled
              ? { snapshot: artifact.version, latest: "2.0.0" }
              : { latest: "1.0.0" },
        publish: async () => {},
        poll: async () => {
          polled = true;
        },
      }),
    ).rejects.toThrow("Opposite tag moved");
    expect(polled).toBe(true);
  });

  it("rejects a tarball changed after preflight", async () => {
    let calls = 0;
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => (++calls === 1 ? artifact.integrity : "sha512-other"),
        registry: absentRegistry,
        publish: async () => {},
        poll: noOpPoll,
      }),
    ).rejects.toThrow("changed before publication");
  });

  it("fails before a dependent when its dependency is absent or mismatched", async () => {
    const proto = { ...artifact, name: "@spine-event-engine/proto" };
    const core = { ...artifact, dependencies: [proto.name] };
    for (const value of [undefined, { integrity: "sha512-other" }])
      await expect(
        publishRelease({
          release: releaseOf([proto, core]),
          checksum: () => artifact.integrity,
          registry: async (kind, entry) =>
            kind === "tags" ? {} : entry.name === proto.name ? value : undefined,
          publish: async () => {},
          poll: noOpPoll,
        }),
      ).rejects.toThrow(/Dependency is not visible|Integrity mismatch/u);
  });

  it("requires a poller", async () => {
    await expect(
      publishRelease({
        release: releaseOf([artifact]),
        checksum: () => artifact.integrity,
        registry: absentRegistry,
        publish: async () => {},
      }),
    ).rejects.toThrow("poller");
  });

  it("propagates publication interruption and resumes a now-visible first artifact", async () => {
    const second = { ...artifact, name: "@spine-event-engine/proto" };
    const visible = new Set();
    const registry = async (kind, entry) =>
      kind === "tags"
        ? visible.has(entry.name)
          ? { snapshot: artifact.version }
          : {}
        : visible.has(entry.name)
          ? { integrity: artifact.integrity }
          : undefined;
    await expect(
      publishRelease({
        release: releaseOf([artifact, second]),
        checksum: () => artifact.integrity,
        registry,
        publish: async () => {
          visible.add(artifact.name);
          throw new Error("interrupted");
        },
        poll: noOpPoll,
      }),
    ).rejects.toThrow("interrupted");
    const published = [];
    await publishRelease({
      release: releaseOf([artifact, second]),
      checksum: () => artifact.integrity,
      registry,
      publish: async (entry) => {
        visible.add(entry.name);
        published.push(entry.name);
      },
      poll: noOpPoll,
    });
    expect(published).toEqual([second.name]);
  });

  it("rejects invalid dist-tags payloads", async () => {
    const registry = createPublicRegistry({
      fetch: async () => response(200, []),
    });
    await expect(registry("tags", artifact)).rejects.toThrow("dist-tags");
  });

  it("reads tags from npm's dedicated dist-tags endpoint", async () => {
    const paths = [];
    const registry = createPublicRegistry({
      fetch: async (url) => {
        paths.push(url);
        return response(200, { snapshot: artifact.version });
      },
    });
    await expect(registry("tags", artifact)).resolves.toEqual({ snapshot: artifact.version });
    expect(paths).toEqual([
      "https://registry.npmjs.org/-/package/%40spine-event-engine%2Fcore/dist-tags",
    ]);
  });

  it.each(["fetch", "body"])("fails clearly when %s never settles until abort", async (phase) => {
    const abort = () => {
      const controller = new globalThis.AbortController();
      globalThis.queueMicrotask(() => controller.abort(new Error("timeout")));
      return controller.signal;
    };
    const fetch = async (_url, { signal }) =>
      phase === "fetch"
        ? new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          )
        : {
            status: 200,
            ok: true,
            json: () =>
              new Promise((_resolve, reject) =>
                signal.aborted
                  ? reject(signal.reason)
                  : signal.addEventListener("abort", () => reject(signal.reason)),
              ),
          };
    const registry = createPublicRegistry({ fetch, timeoutMs: 1, abort });
    await expect(registry("artifact", artifact)).rejects.toThrow(/timed out|body is invalid/u);
  });
});
