import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { packAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import { PrimitiveIds, type PrimitiveId } from "../../src/repository/primitive-id.js";

describe("primitive aggregate IDs", () => {
  it("packs and unpacks string, number, and boolean producer IDs", () => {
    const ids: readonly PrimitiveId[] = ["task-primitive", 42, true];

    for (const id of ids) {
      expect(PrimitiveIds.unpack(PrimitiveIds.pack(id))).toBe(id);
    }
  });

  it("reads primitive values and ignores nonprimitive values", () => {
    expect(PrimitiveIds.read("task-primitive")).toBe("task-primitive");
    expect(PrimitiveIds.read(42)).toBe(42);
    expect(PrimitiveIds.read(false)).toBe(false);
    expect(PrimitiveIds.read({ value: "task-primitive" })).toBeUndefined();
    expect(PrimitiveIds.read(undefined)).toBeUndefined();
  });

  it("unpacks legacy user IDs and ignores absent or unreadable producer IDs", () => {
    expect(
      PrimitiveIds.unpack(packAny(UserIdSchema, create(UserIdSchema, { value: "user-task" }))),
    ).toBe("user-task");
    expect(PrimitiveIds.unpack(undefined)).toBeUndefined();
    expect(
      PrimitiveIds.unpack(create(AnySchema, { typeUrl: "type.example/Unknown" })),
    ).toBeUndefined();
  });
});
