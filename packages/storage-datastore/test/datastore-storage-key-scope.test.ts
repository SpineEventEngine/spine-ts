import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreRecordStorage } from "../src/datastore/record-storage.js";

describe("DatastoreRecordStorage physical scope", () => {
  it("uses source type as the default kind while scope separates contexts", async () => {
    const client = new RecordingClient();
    const first = storage(client, { name: "one", multitenant: false });
    const second = storage(client, { name: "two", multitenant: false });
    await first.write(create(StringValueSchema, { value: "task" }));
    await second.write(create(StringValueSchema, { value: "task" }));
    expect(client.saved.map((row) => row.key.path[0])).toEqual([
      StringValueSchema.typeName,
      StringValueSchema.typeName,
    ]);
    expect(client.saved[0]?.data._scope).not.toBe(client.saved[1]?.data._scope);
  });

  it("uses the tenant namespace and a distinct scope", async () => {
    const client = new RecordingClient();
    await storage(client, { name: "shared", multitenant: true, tenantId: "tenant" }).write(
      create(StringValueSchema, { value: "task" }),
    );
    expect(client.saved[0]?.key.namespace).toBe("tenant");
  });

  it("rejects an oversized explicit layout before client activity", () => {
    const client = new RecordingClient();
    expect(
      () =>
        new DatastoreRecordStorage(
          { name: "scope", multitenant: false },
          spec(),
          client as never,
          1_000,
          undefined,
          "x".repeat(1_501),
        ),
    ).toThrow("1,500");
    expect(client.saved).toHaveLength(0);
  });
});

function spec() {
  return new RecordSpec({
    sourceType: StringValueSchema,
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (value) => value.value,
  });
}
function storage(
  client: RecordingClient,
  context: { name: string; multitenant: boolean; tenantId?: string },
) {
  return new DatastoreRecordStorage(context, spec(), client as never, 1_000);
}
class RecordingClient {
  readonly KEY = Symbol("key");
  readonly saved: {
    key: { path: readonly [string, string]; namespace?: string };
    data: Record<string, unknown>;
  }[] = [];
  key(value: { path: readonly [string, string]; namespace?: string }) {
    return value;
  }
  save(value: {
    key: { path: readonly [string, string]; namespace?: string };
    data: Record<string, unknown>;
  }) {
    this.saved.push(value);
    return Promise.resolve();
  }
  get() {
    return Promise.resolve([undefined] as const);
  }
}
