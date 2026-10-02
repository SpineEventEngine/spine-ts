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

  it("fails closed for ambiguous registry metadata", () => {
    expect(() => assertRegistryReleaseState(release, new Map([["@synthetic/base", null]]))).toThrow(
      "ambiguous",
    );
    expect(() => assertRegistryReleaseState(release, new Map([["@synthetic/base", []]]))).toThrow(
      "ambiguous",
    );
  });

  it("fails closed when a registry read does not settle before its bounded timeout", async () => {
    await expect(
      verifyRegistryReleaseState(release, () => new Promise(() => {}), { timeoutMs: 5 }),
    ).rejects.toThrow("timed out");
  });

  it("recovers when a delayed response body times out once", async () => {
    let reads = 0;
    const names = await verifyRegistryReleaseState(
      release,
      async () => {
        reads++;
        if (reads === 1) return { status: 200, ok: true, json: () => new Promise(() => {}) };
        return { status: 404, ok: false };
      },
      { timeoutMs: 5 },
    );
    expect(names).toEqual(release.packages.map(({ name }) => name));
    expect(reads).toBe(3);
  });

  it("stops a persistent temporary response after three GETs", async () => {
    let reads = 0;
    await expect(
      verifyRegistryReleaseState(
        release,
        async () => {
          reads++;
          return { status: 503, ok: false };
        },
        { timeoutMs: 5 },
      ),
    ).rejects.toThrow("Registry read failed: 503");
    expect(reads).toBe(3);
  });

  it("retries a rejected fetch and stalled headers without treating either as 404", async () => {
    let reads = 0;
    const names = await verifyRegistryReleaseState(
      release,
      async () => {
        reads++;
        if (reads === 1) throw new TypeError("connection reset");
        if (reads === 2) return new Promise(() => {});
        return { status: 404, ok: false };
      },
      { timeoutMs: 5 },
    );
    expect(names).toEqual(release.packages.map(({ name }) => name));
    expect(reads).toBe(4);
  });

  it("retries when an aborted stalled request rejects before headers", async () => {
    let reads = 0;
    await expect(
      verifyRegistryReleaseState(
        release,
        (_url, { signal }) => {
          reads++;
          if (reads === 1)
            return new Promise((_, reject) => {
              signal.addEventListener("abort", () =>
                reject(new globalThis.DOMException("aborted", "AbortError")),
              );
            });
          return Promise.resolve({ status: 404, ok: false });
        },
        { timeoutMs: 5 },
      ),
    ).resolves.toEqual(release.packages.map(({ name }) => name));
    expect(reads).toBe(3);
  });

  it("does not retry denied metadata", async () => {
    let reads = 0;
    await expect(
      verifyRegistryReleaseState(release, async () => {
        reads++;
        return { status: 401, ok: false };
      }),
    ).rejects.toThrow("Registry read failed: 401");
    expect(reads).toBe(1);
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
    ).rejects.toThrow("Registry read failed: 500");
    await expect(
      verifyRegistryReleaseState(release, async () => ({
        status: 200,
        ok: true,
        json: async () => [],
      })),
    ).rejects.toThrow("ambiguous");
  });
});
