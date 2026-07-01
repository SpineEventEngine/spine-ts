import { describe, expect, it } from "vitest";

import {
  EventStore,
  InMemoryRecordStorage,
  InMemoryStorageFactory,
  RecordColumn,
  RecordSpec,
  RecordStorage,
  StorageFactory,
} from "../src/index.js";

describe("@spine-ts/storage", () => {
  it("re-exports the public storage seam from the package root", () => {
    expect(EventStore).toBeTypeOf("function");
    expect(InMemoryRecordStorage).toBeTypeOf("function");
    expect(InMemoryStorageFactory).toBeTypeOf("function");
    expect(RecordColumn).toBeTypeOf("function");
    expect(RecordSpec).toBeTypeOf("function");
    expect(RecordStorage).toBeTypeOf("function");
    expect(StorageFactory).toBeTypeOf("function");
  });
});
