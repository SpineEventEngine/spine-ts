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
        new Map([["@synthetic/base", { versions: { [release.version]: {} }, "dist-tags": {} }]]),
      ),
    ).not.toThrow();
    expect(() =>
      assertRegistryReleaseState(
        release,
        new Map(
          release.packages.map(({ name }) => [
            name,
            { versions: { [release.version]: {} }, "dist-tags": {} },
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
  });

  it("fails closed when a registry read does not settle before its bounded timeout", async () => {
    await expect(
      verifyRegistryReleaseState(release, () => new Promise(() => {}), { timeoutMs: 5 }),
    ).rejects.toThrow("timed out");
  });

  it("handles absent, valid, failed, malformed, and complete registry reads without mutation", async () => {
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
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
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
    ).resolves.toBeUndefined();
  });
});
