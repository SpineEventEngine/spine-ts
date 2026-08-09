import { create } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory, DefaultNamespaceConverter } from "../src/index.js";
import { DatastoreTenantCatalog } from "../src/datastore/tenant-catalog.js";

describe("DatastoreTenantCatalog", () => {
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

  it("rejects namespace collisions from a custom converter", async () => {
    const client = new NamespaceClient(["one", "two"]);
    const catalog = new DatastoreTenantCatalog(client as never, {
      toNamespace: () => "same",
      fromNamespace: () => tenant("same-tenant"),
    });

    await expect(catalog.all()).rejects.toThrow("same tenant boundary");

    const kept = new DatastoreTenantCatalog(new NamespaceClient([]) as never, {
      toNamespace: () => "same",
      fromNamespace: () => undefined,
    });
    await kept.keep(TenantBoundary.from(tenant("first")));
    await expect(kept.keep(TenantBoundary.from(tenant("second")))).rejects.toThrow(
      "already assigned",
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
    return {
      select: (property: string) => {
        this.selected = property;
        return this;
      },
    };
  }

  runQuery(): Promise<unknown> {
    return this.failure === undefined
      ? Promise.resolve(this.response)
      : Promise.reject(this.failure);
  }
}
