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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { FieldPathSchema, UserIdSchema } from "@spine-event-engine/proto";
import { AnyPacker, TypeRegistry, TypeUrls } from "../src/index.js";

describe("AnyPacker", () => {
  it("returns an existing Any unchanged, including its URL, bytes, and unknown fields", () => {
    const packed = fromBinary(
      AnySchema,
      new Uint8Array([
        ...toBinary(
          AnySchema,
          create(AnySchema, {
            typeUrl: "custom/spine.base.FieldPath",
            value: new Uint8Array([8, 1]),
          }),
        ),
        0x98,
        0x06,
        0x7b,
      ]),
    );
    expect(AnyPacker.pack(AnySchema, packed)).toBe(packed);
    expect(AnyPacker.pack(packed)).toBe(packed);
  });

  it("rejects a schema without a message at the JavaScript boundary", () => {
    const caller = AnyPacker as unknown as { pack(schema: typeof FieldPathSchema): unknown };
    expect(() => caller.pack(FieldPathSchema)).toThrow("AnyPacker.pack requires a message.");
  });

  it("preserves unknown binary fields when packing a new message", () => {
    const message = fromBinary(
      FieldPathSchema,
      new Uint8Array([
        ...toBinary(FieldPathSchema, create(FieldPathSchema, { fieldName: ["task"] })),
        0x98,
        0x06,
        0x7b,
      ]),
    );
    const packed = AnyPacker.pack(FieldPathSchema, message);
    expect(packed.typeUrl).toBe(TypeUrls.derive(FieldPathSchema));
    expect(packed.value).toEqual(toBinary(FieldPathSchema, message));
  });

  it("requires the full schema URL and valid bytes, with optional alternatives", () => {
    const message = create(FieldPathSchema, { fieldName: ["task"] });
    const packed = AnyPacker.pack(FieldPathSchema, message);
    const wrongPrefix = create(AnySchema, { ...packed, typeUrl: "other/spine.base.FieldPath" });
    const malformed = create(AnySchema, { ...packed, value: new Uint8Array([0xff]) });
    expect(AnyPacker.unpack(packed, FieldPathSchema)).toEqual(message);
    expect(() => AnyPacker.unpack(wrongPrefix, FieldPathSchema)).toThrow();
    expect(() => AnyPacker.unpack(malformed, FieldPathSchema)).toThrow();
    expect(AnyPacker.tryUnpack(wrongPrefix, FieldPathSchema)).toBeUndefined();
    expect(AnyPacker.tryUnpack(malformed, FieldPathSchema)).toBeUndefined();
    expect(AnyPacker.tryUnpack(undefined, FieldPathSchema)).toBeUndefined();
  });

  it("unpacks the exact custom registered URL without canonical rechecking", () => {
    const registry = new TypeRegistry();
    registry.register(UserIdSchema, { typeUrl: "custom/spine.core.UserId" });
    const packed = create(AnySchema, {
      typeUrl: "custom/spine.core.UserId",
      value: toBinary(UserIdSchema, create(UserIdSchema, { value: "u1" })),
    });
    expect(AnyPacker.unpackUsing(registry, packed)).toEqual(create(UserIdSchema, { value: "u1" }));
    expect(() =>
      AnyPacker.unpackUsing(
        registry,
        create(AnySchema, { ...packed, typeUrl: "other/spine.core.UserId" }),
      ),
    ).toThrow('Unregistered Any type URL "other/spine.core.UserId".');
    expect(
      AnyPacker.tryUnpackUsing(
        registry,
        create(AnySchema, { ...packed, typeUrl: "other/spine.core.UserId" }),
      ),
    ).toBeUndefined();
  });

  it("propagates registry lookup failures through optional unpacking", () => {
    const registry = {
      findByTypeUrl: () => {
        throw new Error("registry unavailable");
      },
    } as unknown as TypeRegistry;
    expect(() =>
      AnyPacker.tryUnpackUsing(registry, AnyPacker.pack(UserIdSchema, create(UserIdSchema))),
    ).toThrow("registry unavailable");
  });

  it("does not consult the registry when the optional envelope is absent", () => {
    const registry = {
      findByTypeUrl: () => {
        throw new Error("unexpected lookup");
      },
    } as unknown as TypeRegistry;
    expect(AnyPacker.tryUnpackUsing(registry, undefined)).toBeUndefined();
  });
});
