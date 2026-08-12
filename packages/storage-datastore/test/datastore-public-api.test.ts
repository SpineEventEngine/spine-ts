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

import type { Message } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { Datastore } from "@google-cloud/datastore";
import type { RecordSpec, StorageContext } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import {
  type CreateEntityStorage,
  type CreateRecordStorage,
  DatastoreStorageFactory,
  type RecordLayout,
} from "../src/index.js";

describe("Datastore public compile-consumer contract", () => {
  it("keeps builder overloads and creator aliases available without a public constructor", () => {
    const layout: RecordLayout = { kind: "consumer.records" };
    const recordCreator: CreateRecordStorage = <I>(
      _context: StorageContext,
      _recordSpec: RecordSpec<I, Message>,
      _client: Datastore,
      maxClientSideScan: number,
    ) => {
      expect(maxClientSideScan).toBe(1_000);
      return { close: () => undefined, isOpen: () => true } as never;
    };
    const entityCreator: CreateEntityStorage = () => ({}) as never;
    const builder = DatastoreStorageFactory.newBuilder()
      .setClient({} as Datastore)
      .organizeRecords(StringValueSchema, layout)
      .organizeRecords(StringValueSchema, StringValueSchema, layout)
      .useRecordStorage(StringValueSchema, recordCreator)
      .useRecordStorage(StringValueSchema, StringValueSchema, recordCreator)
      .useEntityStorage(StringValueSchema, entityCreator);

    expect(builder.build()).toBeInstanceOf(DatastoreStorageFactory);
  });
});

// Constructor accessibility is checked by this external-consumer compilation unit.
// @ts-expect-error DatastoreStorageFactory is builder-only.
void new DatastoreStorageFactory({}, new Map(), new Map(), new Map());
