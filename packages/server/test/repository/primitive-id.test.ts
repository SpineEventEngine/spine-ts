import { create } from "@bufbuild/protobuf";
import { Int32ValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import { MessageIds, PrimitiveIds } from "../../src/repository/primitive-id.js";

describe("primitive aggregate IDs", () => {
  it("packs and unpacks primitive ID values directly", () => {
    expect(PrimitiveIds.unpack(PrimitiveIds.pack("task-primitive"))).toBe("task-primitive");
    expect(PrimitiveIds.unpack(PrimitiveIds.pack(42))).toBe(42);
    expect(PrimitiveIds.unpack(PrimitiveIds.pack(42n))).toBe(42n);
    expect(PrimitiveIds.unpack(PrimitiveIds.pack(true))).toBe(true);
    expect(PrimitiveIds.unpack(undefined)).toBeUndefined();
  });

  it("reads a JVM-compatible int32 producer identity", () => {
    const producerId = AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 42 }));

    expect(PrimitiveIds.unpack(producerId)).toBe(42);
  });

  it("reads only finite primitive message ID values", () => {
    expect(MessageIds.read({ $typeName: "example.TaskId", value: "task-1" })).toEqual({
      $typeName: "example.TaskId",
      value: "task-1",
    });
    expect(
      MessageIds.read({ $typeName: "example.TaskId", value: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
    expect(MessageIds.read({ $typeName: "example.TaskId" })).toBeUndefined();
    expect(MessageIds.read({ $typeName: 1, value: "task-1" })).toBeUndefined();
  });
});
