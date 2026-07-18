import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;

describe.skipIf(emulatorHost === undefined)("Datastore emulator", () => {
  it("stores and removes a record through the configured emulator", async () => {
    const factory = DatastoreStorageFactory.create({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const storage = factory.createRecordStorage(
      { name: `T0046Emulator${String(Date.now())}`, multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    const record = create(StringValueSchema, { value: "emulator-record" });

    await storage.write(record);
    await expect(storage.read("emulator-record")).resolves.toEqual(record);
    await expect(storage.delete("emulator-record")).resolves.toBe(true);
  });
});
