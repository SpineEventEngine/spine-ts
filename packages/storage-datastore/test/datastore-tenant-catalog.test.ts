/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import { Readable } from "node:stream";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { DatastoreStorageFactory, DefaultNamespaceConverter } from "../src/index.js";
import { NamespaceAssignments } from "../src/datastore/namespace.js";
import { DatastoreTenantCatalog } from "../src/datastore/tenant-catalog.js";

describe("DatastoreTenantCatalog", () => {
  it("reads bounded native namespace pages including an empty filtered continuation", async () => {
    const client = new NamespaceClient(["external", "Valpha", "Vbeta"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const early = await catalog.page({ count: 1, signal });
    expect(early.boundaries).toEqual([]);
    expect(early.hasMore).toBe(true);
    if (early.after === undefined) throw new Error("Expected early-cache continuation.");
    const filtered = await catalog.page({ count: 1, signal, after: early.after });
    expect(filtered.boundaries).toEqual([]);
    expect(filtered.hasMore).toBe(true);
    if (filtered.after === undefined) throw new Error("Expected native continuation.");
    const found = await catalog.page({ count: 1, signal, after: filtered.after });
    expect(found.boundaries.map((value) => value.tenantId?.kind)).toEqual([
      { case: "value", value: "alpha" },
    ]);
    expect(client.pageLimits).toEqual([1, 1]);
    expect(client.pageStarts).toEqual([undefined, "1"]);
    if (found.after === undefined) throw new Error("Expected final native continuation.");
    await expect(
      catalog.page({
        count: 1,
        signal,
        after: {
          [Symbol.toStringTag]: "TenantCatalogCursor",
        },
      }),
    ).rejects.toThrow(/continuation/);
    const forged = Object.create(Reflect.getPrototypeOf(found.after)) as typeof found.after;
    await expect(catalog.page({ count: 1, signal, after: forged })).rejects.toThrow();
    const constructed = Reflect.construct(found.after.constructor, [
      catalog,
      [],
      "native",
      0,
      "2",
    ]) as typeof found.after;
    await expect(catalog.page({ count: 1, signal, after: constructed })).rejects.toThrow();
    const last = await catalog.page({ count: 1, signal, after: found.after });
    expect(last.boundaries.map((value) => value.tenantId?.kind)).toEqual([
      { case: "value", value: "beta" },
    ]);
    expect(last.hasMore).toBe(false);
    await expect(catalog.page({ count: 0, signal })).rejects.toThrow(/count/);
    const foreign = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    await expect(foreign.page({ count: 1, signal, after: found.after })).rejects.toThrow(
      /continuation/,
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(catalog.page({ count: 1, signal: aborted.signal })).rejects.toThrow();
  });

  it("rejects a native continuation that does not advance", async () => {
    const client = new NamespaceClient(["Va", "Vb", "Vc"]);
    client.repeatCursor = true;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const early = await catalog.page({ count: 1, signal });
    if (early.after === undefined) throw new Error("Expected native phase.");
    const first = await catalog.page({ count: 1, signal, after: early.after });
    if (first.after === undefined) throw new Error("Expected first native cursor.");
    await expect(catalog.page({ count: 1, signal, after: first.after })).rejects.toThrow(
      /nonadvancing/,
    );
  });

  it("ends a native metadata sweep at an empty repeated-cursor tail", async () => {
    const client = new NamespaceClient(["Va"]);
    client.tailAfterLimit = true;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const early = await catalog.page({ count: 1, signal });
    if (early.after === undefined) throw new Error("Expected native phase.");
    const found = await catalog.page({ count: 1, signal, after: early.after });
    if (found.after === undefined) throw new Error("Expected SDK tail cursor.");
    const tail = await catalog.page({ count: 1, signal, after: found.after });
    expect(tail.boundaries).toEqual([]);
    expect(tail.hasMore).toBe(false);
  });

  it("rejects an empty repeated cursor when metadata says results may follow the cursor", async () => {
    const client = new NamespaceClient(["Va"]);
    client.tailAfterCursor = true;
    client.tailAfterLimit = true;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const early = await catalog.page({ count: 1, signal });
    if (early.after === undefined) throw new Error("Expected native phase.");
    const found = await catalog.page({ count: 1, signal, after: early.after });
    if (found.after === undefined) throw new Error("Expected native cursor.");
    await expect(catalog.page({ count: 1, signal, after: found.after })).rejects.toThrow(
      /nonadvancing continuation/,
    );
  });

  it("rejects a continuing native page without a cursor", async () => {
    const client = new NamespaceClient(["Va", "Vb"]);
    client.missingCursor = true;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const early = await catalog.page({ count: 1, signal });
    if (early.after === undefined) throw new Error("Expected native phase.");
    await expect(catalog.page({ count: 1, signal, after: early.after })).rejects.toThrow(
      /continuation/,
    );
  });

  it("pages multiple early admissions before querying native namespaces", async () => {
    const client = new NamespaceClient([]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    for (const value of ["one", "two", "three"])
      await catalog.keep(TenantBoundary.from(tenant(value)));
    const values: string[] = [];
    let after;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page = await catalog.page({
        count: 1,
        signal,
        ...(after === undefined ? {} : { after }),
      });
      const boundary = page.boundaries[0];
      if (boundary?.tenantId?.kind.case !== "value")
        throw new Error("Expected early value tenant.");
      values.push(boundary.tenantId.kind.value);
      after = page.after;
      expect(page.hasMore).toBe(true);
    }
    expect(values).toEqual(["one", "two", "three"]);
    expect(client.pageLimits).toEqual([]);
    if (after === undefined) throw new Error("Expected native phase.");
    expect((await catalog.page({ count: 1, signal, after })).hasMore).toBe(false);
    expect(client.pageLimits).toEqual([1]);
  });

  it("rejects oversized native streams and unrecognized continuation metadata", async () => {
    const oversized = new NamespaceClient([]);
    oversized.runQueryStream = () =>
      Readable.from(
        [{ [oversized.KEY]: { name: "Vone" } }, { [oversized.KEY]: { name: "Vtwo" } }],
        { objectMode: true },
      );
    const signal = new AbortController().signal;
    const large = new DatastoreTenantCatalog(oversized as never, new DefaultNamespaceConverter());
    const largeEarly = await large.page({ count: 1, signal });
    if (largeEarly.after === undefined) throw new Error("Expected native phase.");
    await expect(large.page({ count: 1, signal, after: largeEarly.after })).rejects.toThrow(
      /page limit/,
    );

    const malformed = new NamespaceClient(["Va"]);
    malformed.invalidMetadata = true;
    const invalid = new DatastoreTenantCatalog(malformed as never, new DefaultNamespaceConverter());
    const invalidEarly = await invalid.page({ count: 1, signal });
    if (invalidEarly.after === undefined) throw new Error("Expected native phase.");
    await expect(invalid.page({ count: 1, signal, after: invalidEarly.after })).rejects.toThrow(
      /invalid continuation metadata/,
    );
  });

  it("settles a cancelled native read and ignores late stream events", async () => {
    const client = new NamespaceClient([]);
    const stream = new Readable({
      objectMode: true,
      read() {
        /* Provider never responds. */
      },
    });
    client.runQueryStream = () => stream;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const controller = new AbortController();
    const early = await catalog.page({ count: 1, signal: controller.signal });
    if (early.after === undefined) throw new Error("Expected native phase.");
    const reading = catalog.page({ count: 1, signal: controller.signal, after: early.after });
    controller.abort();
    await expect(reading).rejects.toThrow(/cancelled/);
    expect(() => {
      stream.emit("data", { [client.KEY]: { name: "Vlate" } });
      stream.emit("info", { moreResults: "MORE_RESULTS_AFTER_LIMIT", endCursor: "late" });
      stream.emit("error", new Error("late provider detail"));
    }).not.toThrow();
  });

  it("bounds an unresponsive native page by a total deadline", async () => {
    vi.useFakeTimers();
    try {
      const client = new NamespaceClient([]);
      client.runQueryStream = () =>
        new Readable({
          objectMode: true,
          read() {
            /* Provider never responds. */
          },
        });
      const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
      const signal = new AbortController().signal;
      const early = await catalog.page({ count: 1, signal });
      if (early.after === undefined) throw new Error("Expected native phase.");
      const reading = catalog.page({ count: 1, signal, after: early.after });
      const rejected = expect(reading).rejects.toThrow(/deadline expired/);
      await vi.advanceTimersByTimeAsync(5_001);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
  it("discovers only owned native namespaces without writing tenant records", async () => {
    const client = new NamespaceClient(["", "Vbeta", "external", "Valpha"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());

    const boundaries = await catalog.all();

    expect(boundaries.map((boundary) => boundary.tenantId?.kind)).toEqual([
      { case: "value", value: "alpha" },
      { case: "value", value: "beta" },
    ]);
    expect(client.queryArgs).toEqual(["", "__namespace__"]);
    expect(client.selected).toBe("__key__");
    expect(client.saved).toBe(0);
  });

  it("keeps an admitted tenant only in the early cache", async () => {
    const client = new NamespaceClient([]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const boundary = TenantBoundary.from(tenant("early"));

    await catalog.keep(boundary);

    await expect(catalog.all()).resolves.toMatchObject([{ key: boundary.key }]);
    expect(client.saved).toBe(0);
    await expect(catalog.keep(TenantBoundary.single)).rejects.toThrow("requires a tenant");
  });

  it("is owned once by the factory and closes with it", async () => {
    const client = new NamespaceClient([]);
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const catalog = factory.tenantCatalog();

    expect(factory.tenantCatalog()).toBe(catalog);
    factory.close();
    await expect(catalog.all()).rejects.toThrow("catalog is closed");
  });

  it("fails closed for malformed metadata and provider failures", async () => {
    const malformed = new NamespaceClient([]);
    malformed.response = [{}];
    await expect(
      new DatastoreTenantCatalog(malformed as never, new DefaultNamespaceConverter()).all(),
    ).rejects.toThrow("invalid namespace metadata");

    const failed = new NamespaceClient([]);
    failed.failure = new Error("secret provider detail");
    await expect(
      new DatastoreTenantCatalog(failed as never, new DefaultNamespaceConverter()).all(),
    ).rejects.toThrow("namespace discovery failed");
  });

  it("accepts path-shaped namespace keys and ignores malformed key entries", async () => {
    const client = new NamespaceClient([]);
    client.response = [
      [
        null,
        42,
        { [client.KEY]: null },
        { [client.KEY]: {} },
        { [client.KEY]: { name: 42 } },
        { [client.KEY]: { path: ["Vpath-tenant"] } },
      ],
    ];
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());

    await expect(catalog.all()).resolves.toMatchObject([
      { tenantId: { kind: { case: "value", value: "path-tenant" } } },
    ]);
  });

  it("rejects namespace collisions from a custom converter", async () => {
    const client = new NamespaceClient(["one", "two"]);
    const catalog = new DatastoreTenantCatalog(client as never, {
      toNamespace: () => "same",
      fromNamespace: () => tenant("same-tenant"),
    });

    await expect(catalog.all()).rejects.toThrow(/round trip|same tenant boundary/);

    const kept = new DatastoreTenantCatalog(new NamespaceClient([]) as never, {
      toNamespace: () => "same",
      fromNamespace: () => tenant("first"),
    });
    await kept.keep(TenantBoundary.from(tenant("first")));
    await expect(kept.keep(TenantBoundary.from(tenant("second")))).rejects.toThrow(
      /round trip|already assigned/,
    );
  });

  it("drops observed and expired early admissions and bounds the cache", async () => {
    let now = 100;
    const client = new NamespaceClient([]);
    const catalog = new DatastoreTenantCatalog(
      client as never,
      new NamespaceAssignments(new DefaultNamespaceConverter()),
      { now: () => now, earlyTenantTtlMs: 10, maxEarlyTenants: 2 },
    );
    await catalog.keep(TenantBoundary.from(tenant("one")));
    await catalog.keep(TenantBoundary.from(tenant("two")));
    await expect(catalog.keep(TenantBoundary.from(tenant("three")))).rejects.toThrow(
      /early-admission cache is full/i,
    );

    client.response = [[{ [client.KEY]: { name: "Vone" } }]];
    await expect(catalog.all()).resolves.toHaveLength(2);
    await expect(catalog.keep(TenantBoundary.from(tenant("three")))).resolves.toBeUndefined();

    now = 111;
    await expect(catalog.all()).resolves.toMatchObject([
      { key: TenantBoundary.from(tenant("one")).key },
    ]);
  });

  it("does not allow internal test controls to disable the cache bound", () => {
    expect(
      () =>
        new DatastoreTenantCatalog(
          new NamespaceClient([]) as never,
          new DefaultNamespaceConverter(),
          { earlyTenantTtlMs: Number.POSITIVE_INFINITY },
        ),
    ).toThrow(/TTL must be finite and positive/i);
    expect(
      () =>
        new DatastoreTenantCatalog(
          new NamespaceClient([]) as never,
          new DefaultNamespaceConverter(),
          { maxEarlyTenants: Number.POSITIVE_INFINITY },
        ),
    ).toThrow(/capacity must be a positive safe integer/i);
  });
});

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

class NamespaceClient {
  readonly KEY = Symbol("Datastore key");
  readonly queryArgs: string[] = [];
  selected: string | undefined;
  saved = 0;
  readonly pageLimits: number[] = [];
  readonly pageStarts: (string | undefined)[] = [];
  limitValue = 0;
  startValue: string | undefined;
  repeatCursor = false;
  tailAfterLimit = false;
  tailAfterCursor = false;
  missingCursor = false;
  invalidMetadata = false;
  response: unknown;
  failure: Error | undefined;

  constructor(namespaces: readonly string[]) {
    this.response = [
      namespaces.map((name) => ({
        [this.KEY]: { name },
      })),
    ];
  }

  createQuery(...args: string[]) {
    this.queryArgs.push(...args);
    this.startValue = undefined;
    return {
      select: (property: string) => {
        this.selected = property;
        return {
          limit: (count: number) => {
            this.limitValue = count;
            return {
              start: (cursor: string) => {
                this.startValue = cursor;
              },
            };
          },
        };
      },
    };
  }

  runQueryStream(): Readable {
    const start = Number(this.startValue ?? "0");
    this.pageLimits.push(this.limitValue);
    this.pageStarts.push(this.startValue);
    const values = (this.response as [unknown[]])[0].slice(start, start + this.limitValue);
    const stream = Readable.from(values, { objectMode: true });
    queueMicrotask(() => {
      stream.emit("info", {
        moreResults: this.invalidMetadata
          ? "NOT_FINISHED"
          : this.tailAfterCursor && values.length === 0
            ? "MORE_RESULTS_AFTER_CURSOR"
            : this.tailAfterLimit ||
                start + values.length < (this.response as [unknown[]])[0].length
              ? "MORE_RESULTS_AFTER_LIMIT"
              : "NO_MORE_RESULTS",
        endCursor: this.missingCursor
          ? undefined
          : this.repeatCursor && start > 0
            ? this.startValue
            : String(start + values.length),
      });
    });
    return stream;
  }

  runQuery(): Promise<unknown> {
    return this.failure === undefined
      ? Promise.resolve(this.response)
      : Promise.reject(this.failure);
  }
}
