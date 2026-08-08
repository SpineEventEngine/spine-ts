import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

const cloudTestEnabled =
  process.env.DATASTORE_CLOUD_TEST === "1" && process.env.DATASTORE_PROJECT_ID !== undefined;
describe.skipIf(!cloudTestEnabled)("Datastore cloud smoke", () => {
  it("writes and removes one source-family record", async () => {
    const client = new Datastore({ projectId: process.env.DATASTORE_PROJECT_ID });
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client)
      .build()
      .createRecordStorage(
        { name: `T0135Cloud${String(Date.now())}`, multitenant: false },
        new RecordSpec({
          sourceType: StringValueSchema,
          recordType: StringValueSchema,
          idKind: "string",
          extractId: (record) => record.value,
        }),
      );
    const record = create(StringValueSchema, { value: `cloud-${String(Date.now())}` });
    try {
      await storage.write(record);
      await expect(storage.read(record.value)).resolves.toEqual(record);
    } finally {
      await storage.delete(record.value);
    }
  });
});
