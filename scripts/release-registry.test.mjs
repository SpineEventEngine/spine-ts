import { describe, expect, it } from "vitest";

import { assertRegistryReleaseState, verifyRegistryReleaseState } from "./release-registry.mjs";

const release = {
  tag: "snapshot",
  version: "2.0.0-snapshot.5",
  packages: [{ name: "@synthetic/base" }, { name: "@synthetic/dependent" }],
};

describe("release registry preflight", () => {
  it("permits an absent or partial release and rejects a fully published release", () => {
    expect(() => assertRegistryReleaseState(release, new Map())).not.toThrow();
    expect(() =>
      assertRegistryReleaseState(
        release,
        new Map([
          [
            "@synthetic/base",
            { versions: { [release.version]: {} }, "dist-tags": { snapshot: release.version } },
          ],
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      assertRegistryReleaseState(
        release,
        new Map([
          [
            "@synthetic/base",
            { versions: { [release.version]: {} }, "dist-tags": { snapshot: "2.0.0-snapshot.4" } },
          ],
        ]),
      ),
    ).toThrow("selected tag");
    expect(() =>
      assertRegistryReleaseState(
        release,
        new Map(
          release.packages.map(({ name }) => [
            name,
            {
              versions: { [release.version]: {} },
              "dist-tags": { snapshot: release.version },
            },
          ]),
        ),
      ),
    ).toThrow("already fully published");
  });

  it("fails closed for ambiguous registry metadata and verifies the selected tag after publication", () => {
    expect(() => assertRegistryReleaseState(release, new Map([["@synthetic/base", null]]))).toThrow(
      "ambiguous",
    );
    const complete = new Map(
      release.packages.map(({ name }) => [
        name,
        { versions: { [release.version]: {} }, "dist-tags": { snapshot: release.version } },
      ]),
    );
    expect(() => assertRegistryReleaseState(release, complete, { complete: true })).not.toThrow();
    expect(() => assertRegistryReleaseState(release, new Map([["@synthetic/base", []]]))).toThrow(
      "ambiguous",
    );
    expect(() => assertRegistryReleaseState(release, new Map(), { complete: true })).toThrow(
      "missing",
    );
  });

  it("rejects final completeness when all versions exist but a selected tag is missing", () => {
    expect(() =>
      assertRegistryReleaseState(
        release,
        new Map(
          release.packages.map(({ name }) => [
            name,
            {
              versions: { [release.version]: {} },
              "dist-tags": name === "@synthetic/base" ? {} : { snapshot: release.version },
            },
          ]),
        ),
        { complete: true },
      ),
    ).toThrow("selected tag");
  });

  it("fails closed when a registry read does not settle before its bounded timeout", async () => {
    await expect(
      verifyRegistryReleaseState(release, () => new Promise(() => {}), { timeoutMs: 5 }),
    ).rejects.toThrow("timed out");
  });

  it("does not start another package read after the total verification deadline", async () => {
    let currentTime = 0;
    const calls = [];
    await expect(
      verifyRegistryReleaseState(
        release,
        async (url) => {
          calls.push(url);
          currentTime = 101;
          return { status: 404, ok: false };
        },
        { deadlineAt: 100, now: () => currentTime },
      ),
    ).rejects.toThrow("deadline");
    expect(calls).toHaveLength(1);
  });

  it("aborts an active package read when the total verification deadline expires", async () => {
    const calls = [];
    let signal;
    await expect(
      verifyRegistryReleaseState(
        release,
        async (url, options) => {
          calls.push(url);
          signal = options.signal;
          return new Promise(() => {});
        },
        { deadlineAt: Date.now() + 5, timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("deadline");
    expect(calls).toHaveLength(1);
    expect(signal.aborted).toBe(true);
  });

  it("uses default GET registry reads with no body and handles registry responses", async () => {
    const calls = [];
    const responses = [
      { status: 404, ok: false },
      { status: 200, ok: true, json: async () => ({ versions: {}, "dist-tags": {} }) },
    ];
    await expect(
      verifyRegistryReleaseState(release, async (url, options) => {
        calls.push({ url, options });
        return responses.shift();
      }),
    ).resolves.toEqual(["@synthetic/base", "@synthetic/dependent"]);
    expect(calls).toHaveLength(2);
    for (const { options } of calls) {
      expect(options.method ?? "GET").toBe("GET");
      expect(options.body).toBeUndefined();
    }
    await expect(
      verifyRegistryReleaseState(release, async () => ({ status: 500, ok: false })),
    ).rejects.toThrow("ambiguous");
    await expect(
      verifyRegistryReleaseState(release, async () => ({
        status: 200,
        ok: true,
        json: async () => [],
      })),
    ).rejects.toThrow("ambiguous");
    await expect(
      verifyRegistryReleaseState(
        release,
        async () => ({
          status: 200,
          ok: true,
          json: async () => ({
            versions: { [release.version]: {} },
            "dist-tags": { snapshot: release.version },
          }),
        }),
        { complete: true },
      ),
    ).resolves.toEqual([]);
  });
});
