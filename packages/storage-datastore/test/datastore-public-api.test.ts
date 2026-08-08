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
