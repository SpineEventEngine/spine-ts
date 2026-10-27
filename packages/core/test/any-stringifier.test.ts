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

import { create, createRegistry, fromJson, toBinary } from "@bufbuild/protobuf";
import { AnySchema, OptionSchema, StructSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  EnrichmentSchema,
  Enrichment_ContainerSchema,
  EventContextSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { IdFilterSchema } from "@spine-event-engine/proto/client";
import { AnyPacker, StringifierRegistry, Stringifiers, TypeRegistry } from "../src/index.js";

const userId = create(UserIdSchema, { value: "user-42" });
const typed = (prefix: string) =>
  create(AnySchema, {
    typeUrl: `${prefix}/${UserIdSchema.typeName}`,
    value: toBinary(UserIdSchema, userId),
  });

describe("Any JSON URL preservation", () => {
  it("restores different prefixes for repeated identifiers with a native registry", () => {
    const value = create(IdFilterSchema, { id: [typed("first"), typed("second")] });
    const stringifier = Stringifiers.forMessage(IdFilterSchema, createRegistry(UserIdSchema));
    expect(stringifier.fromString(stringifier.toString(value))).toEqual(value);
  });

  it("restores nested packed map and oneof Any values with a Spine registry", () => {
    const registry = new TypeRegistry([EnrichmentSchema, UserIdSchema]);
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(registry);
    const container = create(Enrichment_ContainerSchema, {
      items: { first: typed("first"), second: typed("second") },
    });
    const enrichment = create(EnrichmentSchema, { mode: { case: "container", value: container } });
    const packed = AnyPacker.pack(EnrichmentSchema, enrichment);
    const stringifier = stringifiers.forMessage(AnySchema);
    expect(stringifier.fromString(stringifier.toString(packed))).toEqual(packed);
  });

  it("accepts a proto field name while preserving the original Any URL", () => {
    const stringifier = Stringifiers.forMessage(EventContextSchema, createRegistry(UserIdSchema));
    const json = JSON.stringify({
      producer_id: { "@type": `first/${UserIdSchema.typeName}`, value: "user-42" },
    });
    expect(stringifier.fromString(json).producerId?.typeUrl).toBe(`first/${UserIdSchema.typeName}`);
  });

  it("leaves arbitrary Struct @type data untouched", () => {
    const struct = fromJson(StructSchema, {
      "@type": "ordinary-data",
      nested: { "@type": "also-data" },
    });
    const packed = AnyPacker.pack(StructSchema, struct);
    const stringifier = Stringifiers.forMessage(AnySchema, createRegistry(StructSchema));
    expect(stringifier.fromString(stringifier.toString(packed))).toEqual(packed);
  });

  it("restores an ordinary google.protobuf.Option value field", () => {
    const option = create(OptionSchema, { name: "example.option", value: typed("custom") });
    const packed = AnyPacker.pack(OptionSchema, option);
    const stringifier = Stringifiers.forMessage(
      AnySchema,
      createRegistry(OptionSchema, UserIdSchema),
    );
    expect(stringifier.fromString(stringifier.toString(packed))).toEqual(packed);
  });

  it("restores an Any wrapped inside a raw binary Any fixture", () => {
    const inner = typed("inner");
    const outer = create(AnySchema, {
      typeUrl: "outer/google.protobuf.Any",
      value: toBinary(AnySchema, inner),
    });
    const stringifier = Stringifiers.forMessage(AnySchema, createRegistry(AnySchema, UserIdSchema));
    expect(stringifier.fromString(stringifier.toString(outer))).toEqual(outer);
  });
});
