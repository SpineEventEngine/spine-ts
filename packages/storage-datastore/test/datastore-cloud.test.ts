import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

const cloudTestEnabled =
  process.env.DATASTORE_CLOUD_TEST === "1" && process.env.DATASTORE_PROJECT_ID !== undefined;

describe.skipIf(!cloudTestEnabled)("Datastore cloud smoke", () => {
  it("uses an explicitly configured project and removes its disposable record", async () => {
    const factory = DatastoreStorageFactory.create({ projectId: process.env.DATASTORE_PROJECT_ID });
    const id = `cloud-smoke-${String(Date.now())}`;
    const storage = factory.createRecordStorage(
      { name: `T0046Cloud${String(Date.now())}`, multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    const record = create(StringValueSchema, { value: id });

    try {
      await storage.write(record);
      await expect(storage.read(id)).resolves.toEqual(record);
    } finally {
      await storage.delete(id);
    }
  });
});
