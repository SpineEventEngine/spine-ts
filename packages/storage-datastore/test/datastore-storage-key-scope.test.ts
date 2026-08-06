import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreRecordStorage } from "../src/datastore/record-storage.js";

describe("DatastoreRecordStorage storage keys", () => {
  it("isolates identical schemas with distinct storage keys", async () => {
    const client = new RecordingClient();
    const first = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("first"),
      client as never,
      10,
    );
    const second = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("second"),
      client as never,
      10,
    );

    await first.read("id");
    await second.read("id");
    expect(client.kinds).toHaveLength(2);
    expect(client.kinds[0]).not.toBe(client.kinds[1]);
  });

  it("shares one exact kind for independent handles with the same storage key", async () => {
    const client = new RecordingClient();
    const first = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("same"),
      client as never,
      10,
    );
    const second = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("same"),
      client as never,
      10,
    );
    await first.read("id");
    await second.read("id");
    expect(client.kinds[0]).toBe(client.kinds[1]);
  });

  it("does not collide delimiter-distinct context and storage-key tuples", async () => {
    const client = new RecordingClient();
    const first = new DatastoreRecordStorage(
      { name: "a:b", multitenant: false },
      spec("c"),
      client as never,
      10,
    );
    const second = new DatastoreRecordStorage(
      { name: "a", multitenant: false },
      spec("b:c"),
      client as never,
      10,
    );
    await first.read("id");
    await second.read("id");
    expect(client.kinds[0]).not.toBe(client.kinds[1]);
  });

  it("keeps NFC and NFD storage keys distinct", async () => {
    const client = new RecordingClient();
    const first = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("é"),
      client as never,
      10,
    );
    const second = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("e\u0301"),
      client as never,
      10,
    );
    await first.read("id");
    await second.read("id");
    expect(client.kinds[0]).not.toBe(client.kinds[1]);
  });

  it("distinguishes tenancy mode and preserves tenant namespace", async () => {
    const client = new RecordingClient();
    const single = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec("key"),
      client as never,
      10,
    );
    const tenant = new DatastoreRecordStorage(
      { name: "context", multitenant: true, tenantId: "tenant" },
      spec("key"),
      client as never,
      10,
    );
    await single.read("id");
    await tenant.read("id");
    expect(client.kinds[0]).not.toBe(client.kinds[1]);
    expect(client.namespaces[1]).toBe("tenant");
  });
});

function spec(
  storageKey: string,
): RecordSpec<string, ReturnType<typeof create<typeof StringValueSchema>>> {
  return new RecordSpec({
    schema: StringValueSchema,
    storageKey,
    idKind: "string",
    extractId: (value) => value.value,
  });
}

class RecordingClient {
  readonly kinds: string[] = [];
  readonly namespaces: (string | undefined)[] = [];

  key(input: { readonly path: readonly [string, string]; readonly namespace?: string }): unknown {
    this.kinds.push(input.path[0]);
    this.namespaces.push(input.namespace);
    return input;
  }

  get(): Promise<readonly []> {
    return Promise.resolve([]);
  }
}
