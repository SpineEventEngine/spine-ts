import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { createHistoryCache } from "../../src/repository/repository.js";

const record = (version: bigint) =>
  Object.freeze({
    entityId: "task",
    state: create(StringValueSchema, { value: String(version) }),
    version,
    createdAt: create(TimestampSchema, { seconds: version }),
  });

describe("repository state-history cache", () => {
  it("does not retain a shallow partial event-version group before a deeper read", async () => {
    const calls: { readonly depth: number; readonly startingFromVersion: bigint | undefined }[] =
      [];
    const first = Object.freeze({ id: "first", version: 5n });
    const second = Object.freeze({ id: "second", version: 5n });
    const older = Object.freeze({ id: "older", version: 4n });
    const cache = createHistoryCache(
      (depth, startingFromVersion) => {
        calls.push({ depth, startingFromVersion });
        return Promise.resolve(
          startingFromVersion === undefined ? [first, second, older].slice(0, depth) : [older],
        );
      },
      (value) => value.version,
      { cacheCompleteVersionGroups: true },
    );

    await expect(cache.read(1)).resolves.toEqual([first]);
    await expect(cache.read(3)).resolves.toEqual([first, second, older]);
    expect(calls).toEqual([
      { depth: 2, startingFromVersion: undefined },
      { depth: 4, startingFromVersion: undefined },
    ]);
  });

  it("continues exclusively from the oldest complete version", async () => {
    const calls: (bigint | undefined)[] = [];
    const cache = createHistoryCache(
      (_depth, startingFromVersion) => {
        calls.push(startingFromVersion);
        return Promise.resolve(
          startingFromVersion === undefined ? [record(5n), record(4n)] : [record(3n)],
        );
      },
      (value) => value.version,
      { requireContiguousVersions: true },
    );

    await expect(cache.read(2)).resolves.toHaveLength(2);
    await expect(cache.read(3)).resolves.toHaveLength(3);
    expect(calls).toEqual([undefined, 4n]);
  });

  it("does not reread after a short provider result", async () => {
    let calls = 0;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return Promise.resolve([record(5n)]);
      },
      (value) => value.version,
      { requireContiguousVersions: true },
    );

    await expect(cache.read(2)).resolves.toHaveLength(1);
    await expect(cache.read(4)).resolves.toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("clears cached records on a discontinuous continuation", async () => {
    const cache = createHistoryCache(
      (_depth, startingFromVersion) =>
        Promise.resolve(
          startingFromVersion === undefined ? [record(5n), record(4n)] : [record(2n)],
        ),
      (value) => value.version,
      { requireContiguousVersions: true },
    );

    await cache.read(2);
    await expect(cache.read(3)).resolves.toEqual([]);
  });

  it("does not let a stale deferred read repopulate an invalidated cache", async () => {
    let resolve: ((records: readonly ReturnType<typeof record>[]) => void) | undefined;
    const cache = createHistoryCache(
      () =>
        new Promise<readonly ReturnType<typeof record>[]>((complete) => {
          resolve = complete;
        }),
      (value) => value.version,
      { requireContiguousVersions: true },
    );

    const reading = cache.read(1);
    await Promise.resolve();
    await Promise.resolve();
    cache.clear();
    resolve?.([record(5n)]);
    await expect(reading).resolves.toEqual([]);
  });

  it("uses the default policy and caches an exhausted empty result", async () => {
    let calls = 0;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return Promise.resolve([]);
      },
      () => undefined,
    );

    await expect(cache.read(3)).resolves.toEqual([]);
    await expect(cache.read(1)).resolves.toEqual([]);
    expect(calls).toBe(1);
  });

  it("serializes concurrent reads behind the first cache fill", async () => {
    let calls = 0;
    let resolve: ((records: readonly ReturnType<typeof record>[]) => void) | undefined;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return new Promise<readonly ReturnType<typeof record>[]>((complete) => {
          resolve = complete;
        });
      },
      (value) => value.version,
    );

    const first = cache.read(2);
    const second = cache.read(1);
    await Promise.resolve();
    await Promise.resolve();
    resolve?.([record(5n), record(4n)]);

    await expect(first).resolves.toHaveLength(2);
    await expect(second).resolves.toEqual([record(5n)]);
    expect(calls).toBe(1);
  });

  it("retries after a rejected provider read", async () => {
    let calls = 0;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("history unavailable")) : Promise.resolve([]);
      },
      (value: ReturnType<typeof record>) => value.version,
    );

    await expect(cache.read(1)).rejects.toThrow("history unavailable");
    await expect(cache.read(1)).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it("refreshes from the newest page when continuation observes a newer version", async () => {
    const calls: (bigint | undefined)[] = [];
    const cache = createHistoryCache(
      (depth, startingFromVersion) => {
        calls.push(startingFromVersion);
        if (calls.length === 1) return Promise.resolve([record(5n), record(4n)]);
        if (startingFromVersion !== undefined) return Promise.resolve([record(6n)]);
        return Promise.resolve([record(6n), record(5n), record(4n)].slice(0, depth));
      },
      (value) => value.version,
    );

    await expect(cache.read(2)).resolves.toEqual([record(5n), record(4n)]);
    await expect(cache.read(3)).resolves.toEqual([record(6n), record(5n), record(4n)]);
    expect(calls).toEqual([undefined, 4n, undefined]);
  });

  it("does not retain a refreshed page invalidated while it is loading", async () => {
    let calls = 0;
    let resolveRefresh: ((records: readonly ReturnType<typeof record>[]) => void) | undefined;
    const cache = createHistoryCache(
      (_depth, startingFromVersion) => {
        calls += 1;
        if (calls === 1) return Promise.resolve([record(5n), record(4n)]);
        if (startingFromVersion !== undefined) return Promise.resolve([record(6n)]);
        return new Promise<readonly ReturnType<typeof record>[]>((complete) => {
          resolveRefresh = complete;
        });
      },
      (value) => value.version,
    );

    await cache.read(2);
    const refreshing = cache.read(3);
    while (resolveRefresh === undefined) await Promise.resolve();
    cache.clear();
    resolveRefresh([record(6n), record(5n), record(4n)]);

    await expect(refreshing).resolves.toEqual([]);
    expect(calls).toBe(3);
  });

  it("caches versionless complete-group results without inventing a continuation", async () => {
    const first = Object.freeze({ id: "first" });
    const second = Object.freeze({ id: "second" });
    let calls = 0;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return Promise.resolve([first, second]);
      },
      () => undefined,
      { cacheCompleteVersionGroups: true },
    );

    await expect(cache.read(1)).resolves.toEqual([first]);
    await expect(cache.read(2)).resolves.toEqual([first, second]);
    expect(calls).toBe(1);
  });

  it("excludes only the incomplete terminal version group from the cache", async () => {
    const calls: (bigint | undefined)[] = [];
    const cache = createHistoryCache(
      (_depth, startingFromVersion) => {
        calls.push(startingFromVersion);
        return Promise.resolve(
          startingFromVersion === undefined
            ? [record(5n), record(4n), record(4n)]
            : [record(4n), record(4n), record(3n)],
        );
      },
      (value) => value.version,
      { cacheCompleteVersionGroups: true },
    );

    await expect(cache.read(2)).resolves.toEqual([record(5n), record(4n)]);
    await expect(cache.read(3)).resolves.toEqual([record(5n), record(4n), record(4n)]);
    expect(calls).toEqual([undefined, 5n]);
  });

  it("serializes queued cache extensions without a redundant provider read", async () => {
    let calls = 0;
    let resolveFirst: ((records: readonly ReturnType<typeof record>[]) => void) | undefined;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        if (calls === 1)
          return new Promise<readonly ReturnType<typeof record>[]>((complete) => {
            resolveFirst = complete;
          });
        return Promise.resolve([record(4n)]);
      },
      (value) => value.version,
    );

    const first = cache.read(1);
    const second = cache.read(2);
    const sameDepth = cache.read(2);
    await Promise.resolve();
    await Promise.resolve();
    resolveFirst?.([record(5n)]);

    await expect(first).resolves.toEqual([record(5n)]);
    await expect(second).resolves.toEqual([record(5n), record(4n)]);
    await expect(sameDepth).resolves.toEqual([record(5n), record(4n)]);
    expect(calls).toBe(2);
  });

  it("drops a complete-group page invalidated while it is loading", async () => {
    let resolve: ((records: readonly ReturnType<typeof record>[]) => void) | undefined;
    const cache = createHistoryCache(
      () =>
        new Promise<readonly ReturnType<typeof record>[]>((complete) => {
          resolve = complete;
        }),
      (value) => value.version,
      { cacheCompleteVersionGroups: true },
    );

    const reading = cache.read(1);
    await Promise.resolve();
    await Promise.resolve();
    cache.clear();
    resolve?.([record(5n), record(4n)]);

    await expect(reading).resolves.toEqual([]);
  });

  it("treats an empty complete-group page as exhausted history", async () => {
    let calls = 0;
    const cache = createHistoryCache(
      () => {
        calls += 1;
        return Promise.resolve([]);
      },
      (value: ReturnType<typeof record>) => value.version,
      { cacheCompleteVersionGroups: true },
    );

    await expect(cache.read(2)).resolves.toEqual([]);
    await expect(cache.read(3)).resolves.toEqual([]);
    expect(calls).toBe(1);
  });

  it("accepts an empty newest-page refresh", async () => {
    let calls = 0;
    const cache = createHistoryCache(
      (_depth, startingFromVersion) => {
        calls += 1;
        if (calls === 1) return Promise.resolve([record(5n), record(4n)]);
        if (startingFromVersion !== undefined) return Promise.resolve([record(6n)]);
        return Promise.resolve([]);
      },
      (value) => value.version,
    );

    await cache.read(2);
    await expect(cache.read(3)).resolves.toEqual([]);
    await expect(cache.read(1)).resolves.toEqual([]);
    expect(calls).toBe(3);
  });
});
