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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

const cloudTestEnabled =
  process.env.DATASTORE_CLOUD_TEST === "1" && process.env.DATASTORE_PROJECT_ID !== undefined;
describe.skipIf(!cloudTestEnabled)("Datastore cloud smoke", () => {
  it("writes and removes one source-family record", async () => {
    const projectId = process.env.DATASTORE_PROJECT_ID;
    const client = new Datastore(projectId === undefined ? {} : { projectId });
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
