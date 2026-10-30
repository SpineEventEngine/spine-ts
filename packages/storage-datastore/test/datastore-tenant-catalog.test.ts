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
import { DatastoreTenantCatalog } from "../src/datastore/tenant-catalog.js";

describe("DatastoreTenantCatalog", () => {
  it("reads bounded native namespace pages including an empty filtered continuation", async () => {
    const client = new NamespaceClient(["external", "Valpha", "Vbeta"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const filtered = await catalog.page({ count: 1, signal });
    expect(client.pageLimits).toEqual([1]);
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

  it("skips malformed and external native metadata before a valid tenant", async () => {
    const client = new NamespaceClient([]);
    client.response = [
      [
        { [client.KEY]: {} },
        { [client.KEY]: { name: "external" } },
        { [client.KEY]: { name: "Vvalid" } },
      ],
    ];
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const malformed = await catalog.page({ count: 1, signal });
    expect(malformed.boundaries).toEqual([]);
    expect(malformed.hasMore).toBe(true);
    if (malformed.after === undefined) throw new Error("Expected native continuation.");
    const external = await catalog.page({ count: 1, signal, after: malformed.after });
    expect(external.boundaries).toEqual([]);
    expect(external.hasMore).toBe(true);
    if (external.after === undefined) throw new Error("Expected native continuation.");
    const valid = await catalog.page({ count: 1, signal, after: external.after });
    expect(valid.boundaries.map((boundary) => boundary.tenantId?.kind)).toEqual([
      { case: "value", value: "valid" },
    ]);
    expect(valid.hasMore).toBe(false);
    expect(valid.after).toBeUndefined();
  });

  it("reads more than 127 native tenant candidates with a continuation", async () => {
    const client = new NamespaceClient(
      Array.from({ length: 130 }, (_, index) => `Vtenant-${String(index).padStart(3, "0")}`),
    );
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const first = await catalog.page({ count: 129, signal });
    expect(first.boundaries).toHaveLength(129);
    expect(first.hasMore).toBe(true);
    if (first.after === undefined) throw new Error("Expected native continuation.");
    const last = await catalog.page({ count: 129, signal, after: first.after });
    expect(last.boundaries).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(client.pageLimits.length).toBeGreaterThan(0);
    expect(
      client.pageLimits.every(
        (limit) => Number.isSafeInteger(limit) && limit > 0 && limit <= 2 ** 31 - 1,
      ),
    ).toBe(true);
  });

  it("keeps Datastore query limits representable for a safe count above Int32", async () => {
    const client = new NamespaceClient(["Va", "Vb", "Vc"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const native = await catalog.page({ count: 2 ** 31, signal });
    expect(native.boundaries).toHaveLength(3);
    expect(native.hasMore).toBe(false);
    expect(client.pageLimits.length).toBeGreaterThan(0);
    expect(
      client.pageLimits.every(
        (limit) => Number.isSafeInteger(limit) && limit > 0 && limit <= 2 ** 31 - 1,
      ),
    ).toBe(true);
  });

  it("rejects a native continuation that does not advance", async () => {
    const client = new NamespaceClient(["Va", "Vb", "Vc"]);
    client.repeatCursor = true;
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const first = await catalog.page({ count: 1, signal });
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
    const found = await catalog.page({ count: 1, signal });
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
    const found = await catalog.page({ count: 1, signal });
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
    await expect(catalog.page({ count: 1, signal })).rejects.toThrow(/continuation/);
  });

  it("pages only native namespaces without an early admission cache", async () => {
    const client = new NamespaceClient(["Vone", "Vtwo", "Vthree"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const signal = new AbortController().signal;
    const values: string[] = [];
    let after;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page = await catalog.page({
        count: 1,
        signal,
        ...(after === undefined ? {} : { after }),
      });
      const boundary = page.boundaries[0];
      if (boundary?.tenantId?.kind.case === "value") values.push(boundary.tenantId.kind.value);
      after = page.after;
    }
    expect(values).toEqual(["one", "two", "three"]);
    expect(client.pageLimits).toEqual([1, 1, 1]);
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
    await expect(large.page({ count: 1, signal })).rejects.toThrow(/page limit/);

    const malformed = new NamespaceClient(["Va"]);
    malformed.invalidMetadata = true;
    const invalid = new DatastoreTenantCatalog(malformed as never, new DefaultNamespaceConverter());
    await expect(invalid.page({ count: 1, signal })).rejects.toThrow(
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
    const reading = catalog.page({ count: 1, signal: controller.signal });
    controller.abort();
    await expect(reading).rejects.toThrow(/cancelled/);
    expect(() => {
      stream.emit("data", { [client.KEY]: { name: "Vlate" } });
      stream.emit("info", { moreResults: "MORE_RESULTS_AFTER_LIMIT", endCursor: "late" });
      stream.emit("error", new Error("late provider detail"));
    }).not.toThrow();
  });

  it("rejects a native stream that closes without an end or error", async () => {
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
    const reading = catalog.page({ count: 1, signal: controller.signal });
    const outcome = reading.then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const closed = new Promise<void>((resolve) => {
      stream.once("close", () => {
        resolve();
      });
    });
    stream.destroy();
    await closed;
    const result = await Promise.race([
      outcome,
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("pending");
        }, 25);
      }),
    ]);
    controller.abort();
    expect(result).toMatch(/closed before completion/);
    expect(() => stream.emit("error", new Error("late provider detail"))).not.toThrow();
  });

  it("waits for caller cancellation when a native page never responds", async () => {
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
      const controller = new AbortController();
      const reading = catalog.page({ count: 1, signal: controller.signal });
      let settled = false;
      void reading.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(5_001);
      expect(settled).toBe(false);
      controller.abort();
      await expect(reading).rejects.toThrow(/cancelled/);
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

  it("confirms only existing native membership without creating records", async () => {
    const client = new NamespaceClient(["Vpresent"]);
    const catalog = new DatastoreTenantCatalog(client as never, new DefaultNamespaceConverter());
    const present = TenantBoundary.from(tenant("present"));
    const missing = TenantBoundary.from(tenant("missing"));

    await expect(catalog.contains(present)).resolves.toBe(true);
    await expect(catalog.contains(missing)).resolves.toBe(false);
    await catalog.keep(present);
    await catalog.keep(present);
    await expect(catalog.keep(missing)).rejects.toThrow(/not present/);

    await expect(catalog.all()).resolves.toMatchObject([{ key: present.key }]);
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
    await factory.close();
    await expect(catalog.all()).rejects.toThrow("catalog is closed");
  });

  it("fails closed for malformed metadata and provider failures", async () => {
    const malformed = new NamespaceClient([]);
    malformed.response = [{}];
    await expect(
      new DatastoreTenantCatalog(malformed as never, new DefaultNamespaceConverter()).all(),
    ).rejects.toThrow("invalid namespace metadata");
    await expect(
      new DatastoreTenantCatalog(malformed as never, new DefaultNamespaceConverter()).contains(
        TenantBoundary.from(tenant("bad")),
      ),
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

    await expect(catalog.contains(TenantBoundary.from(tenant("first")))).rejects.toThrow(
      /round trip/,
    );
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
  exactNamespace: string | undefined;

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
    this.exactNamespace = undefined;
    return {
      select: (property: string) => {
        this.selected = property;
        return {
          filter: () => {
            this.exactNamespace = this.lastKeyNamespace;
          },
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

  lastKeyNamespace: string | undefined;

  key(options: { path: readonly (string | number)[] }) {
    this.lastKeyNamespace = String(options.path[1]);
    return options;
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
      ? Promise.resolve(
          this.exactNamespace === undefined ||
            !Array.isArray(this.response) ||
            !Array.isArray(this.response[0])
            ? this.response
            : [
                (this.response as [unknown[]])[0].filter(
                  (value) =>
                    (value as Record<symbol, { name?: string }>)[this.KEY]?.name ===
                    this.exactNamespace,
                ),
              ],
        )
      : Promise.reject(this.failure);
  }
}
