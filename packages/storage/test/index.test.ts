import { describe, expect, it } from "vitest";

import {
  EventStore,
  InMemoryRecordStorage,
  InMemoryStorageFactory,
  RecordColumn,
  RecordMask,
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
    expect(RecordMask.apply).toBeTypeOf("function");
    expect(RecordSpec).toBeTypeOf("function");
    expect(RecordStorage).toBeTypeOf("function");
    expect(StorageFactory).toBeTypeOf("function");
  });

  it("applies record masks through nested arrays", () => {
    const masked = RecordMask.apply(
      {
        items: [
          { keep: 1, drop: 2 },
          { keep: 3, drop: 4 },
        ],
        drop: true,
      },
      ["items.keep"],
    );

    expect(masked).toEqual({
      items: [{ keep: 1 }, { keep: 3 }],
    });
  });
});
