import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreRecordStorage } from "../src/datastore/record-storage.js";
import { CanonicalValue } from "../src/datastore/value-codec.js";

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

  it("uses distinct physical keys for cross-key reads and deletes", async () => {
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

    await first.delete("shared-slot");
    await second.read("shared-slot");
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

  it("accepts 1500 kind bytes and rejects 1501 before client activity", async () => {
    const client = new RecordingClient();
    const accepted = new DatastoreRecordStorage(
      { name: "context", multitenant: false },
      spec(storageKeyForBytes(1_500)),
      client as never,
      10,
    );
    await accepted.read("id");
    expect(Buffer.byteLength(client.kinds[0] ?? "", "utf8")).toBe(1_500);
    expect(
      () =>
        new DatastoreRecordStorage(
          { name: "context", multitenant: false },
          spec(storageKeyForBytes(1_501)),
          client as never,
          10,
        ),
    ).toThrow("1500");
    expect(client.kinds).toHaveLength(1);
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

function storageKeyForBytes(bytes: number): string {
  for (let length = 0; length < 2_000; length++) {
    const key = "x".repeat(length);
    if (Buffer.byteLength(CanonicalValue.encode(["context", false, key]), "utf8") === bytes)
      return key;
  }
  throw new Error(`No storage key encodes to ${String(bytes)} bytes.`);
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
