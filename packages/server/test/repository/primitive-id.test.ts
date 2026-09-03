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
import { Int32ValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import { MessageIds, PrimitiveIds } from "../../src/repository/primitive-id.js";
import type { MessageId } from "../../src/index.js";

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

  it("reads message IDs with arbitrary declared fields", () => {
    const oneField = { $typeName: "example.UuidId", uuid: "task-1" };
    const nested = {
      $typeName: "example.LibraryCardId",
      reader: { $typeName: "example.Reader", email: "reader@example.com" },
    };
    const composite = {
      $typeName: "example.CustomerId",
      registrationDate: { $typeName: "google.protobuf.Timestamp", seconds: 42n, nanos: 0 },
      number: 7,
    };
    const oneFieldMessage: MessageId = oneField;
    const nestedMessage: MessageId = nested;
    const compositeMessage: MessageId = composite;

    expect(MessageIds.read(oneFieldMessage)).toBe(oneField);
    expect(MessageIds.read(nestedMessage)).toBe(nested);
    expect(MessageIds.read(compositeMessage)).toBe(composite);
  });

  it("recognizes a message ID with a field named value without scalar semantics", () => {
    expect(MessageIds.read({ $typeName: "example.TaskId", value: "task-1" })).toEqual({
      $typeName: "example.TaskId",
      value: "task-1",
    });
    expect(MessageIds.read({ $typeName: 1, value: "task-1" })).toBeUndefined();
  });

  it("rejects inherited message type names", () => {
    const inheritedTypeName = Object.create({ $typeName: "example.TaskId" }) as {
      value: string;
    };
    inheritedTypeName.value = "task-1";

    expect(MessageIds.read(inheritedTypeName)).toBeUndefined();
  });
});
