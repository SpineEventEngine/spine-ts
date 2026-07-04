import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { packAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import {
  packPrimitiveId,
  primitiveId,
  unpackPrimitiveId,
  type PrimitiveId,
} from "../../src/repository/primitive-id.js";

describe("primitive aggregate IDs", () => {
  it("packs and unpacks string, number, and boolean producer IDs", () => {
    const ids: readonly PrimitiveId[] = ["task-primitive", 42, true];

    for (const id of ids) {
      expect(unpackPrimitiveId(packPrimitiveId(id))).toBe(id);
    }
  });

  it("reads primitive values and ignores nonprimitive values", () => {
    expect(primitiveId("task-primitive")).toBe("task-primitive");
    expect(primitiveId(42)).toBe(42);
    expect(primitiveId(false)).toBe(false);
    expect(primitiveId({ value: "task-primitive" })).toBeUndefined();
    expect(primitiveId(undefined)).toBeUndefined();
  });

  it("unpacks legacy user IDs and ignores absent or unreadable producer IDs", () => {
    expect(
      unpackPrimitiveId(packAny(UserIdSchema, create(UserIdSchema, { value: "user-task" }))),
    ).toBe("user-task");
    expect(unpackPrimitiveId(undefined)).toBeUndefined();
    expect(
      unpackPrimitiveId(create(AnySchema, { typeUrl: "type.example/Unknown" })),
    ).toBeUndefined();
  });
});
