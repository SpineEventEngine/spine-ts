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
import { registerProtoModule, registeredProtoModules } from "@spine-event-engine/proto/codegen";
import {
  TaskCreatedSchema,
  TaskRenamedSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  AnyPacker,
  defaultStringifierRegistry,
  StringifierRegistry,
  Stringifiers,
  TypeRegistry,
} from "../src/index.js";

const userId = create(UserIdSchema, { value: "user-42" });
const typed = (prefix: string) =>
  create(AnySchema, {
    typeUrl: `${prefix}/${UserIdSchema.typeName}`,
    value: toBinary(UserIdSchema, userId),
  });

describe("Any JSON URL preservation", () => {
  it("keeps existing Any conversion available after a duplicate descriptor is rejected", () => {
    const converter = defaultStringifierRegistry.forMessage(AnySchema);
    const packed = typed("custom");
    const text = converter.toString(packed);
    const before = registeredProtoModules();
    expect(() =>
      registerProtoModule({
        name: "invalid-duplicate-descriptors",
        schemas: [TaskRenamedSchema, TaskRenamedSchema],
        dependencies: [],
      }),
    ).toThrow(/Conflicting Protobuf type/u);
    expect(registeredProtoModules()).toBe(before);
    const alias = Object.assign(Object.create(TaskRenamedSchema) as typeof TaskRenamedSchema, {
      typeName: "spine.examples.todo.TaskRenamedAlias",
    });
    expect(() =>
      registerProtoModule({
        name: "invalid-shared-descriptor",
        schemas: [TaskRenamedSchema, alias],
        dependencies: [],
      }),
    ).toThrow(/Conflicting Protobuf descriptor/u);
    expect(registeredProtoModules()).toBe(before);
    expect(converter.fromString(text)).toEqual(packed);
  });

  it("expands an already obtained converter after a generated module registers", () => {
    const stringifier = defaultStringifierRegistry.forMessage(AnySchema);
    const packed = create(AnySchema, {
      typeUrl: `custom/${TaskCreatedSchema.typeName}`,
      value: toBinary(TaskCreatedSchema, create(TaskCreatedSchema)),
    });
    expect(() => stringifier.toString(packed)).toThrow();

    const module = Object.freeze({
      name: "core-test-late-task-event",
      schemas: [TaskCreatedSchema],
      dependencies: [],
    });
    expect(registerProtoModule(module)).toBe(module);
    expect(registerProtoModule(module)).toBe(module);
    const text = stringifier.toString(packed);
    expect(stringifier.fromString(text)).toEqual(packed);
    expect(() => registerProtoModule({ ...module, schemas: [UserIdSchema] })).toThrow(
      /Conflicting/u,
    );
    expect(stringifier.toString(packed)).toBe(text);
  });

  it("pins a shared converter choice once a message mapping is requested", () => {
    defaultStringifierRegistry.forMessage(UserIdSchema);
    expect(() => {
      defaultStringifierRegistry.register(UserIdSchema, {
        toString: (value) => value.value,
        fromString: (value) => create(UserIdSchema, { value }),
      });
    }).toThrow(/already in use/u);
    expect(() => {
      defaultStringifierRegistry.setTypeRegistry(new TypeRegistry());
    }).toThrow(/generated module descriptors/u);
  });

  it("keeps copied custom converters isolated while following later generated descriptors", () => {
    const custom = new StringifierRegistry();
    const copied = new StringifierRegistry(custom);
    const stringifier = copied.forMessage(AnySchema);
    const packed = create(AnySchema, {
      typeUrl: `custom/${TaskRenamedSchema.typeName}`,
      value: toBinary(TaskRenamedSchema, create(TaskRenamedSchema)),
    });
    expect(() => stringifier.toString(packed)).toThrow();

    registerProtoModule({
      name: "core-test-late-task-renamed",
      schemas: [TaskRenamedSchema],
      dependencies: [],
    });
    expect(stringifier.fromString(stringifier.toString(packed))).toEqual(packed);
    custom.register(UserIdSchema, {
      toString: (value) => `changed:${value.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice(8) }),
    });
    expect(copied.forMessage(UserIdSchema).toString(userId)).toBe('{"value":"user-42"}');
  });

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
