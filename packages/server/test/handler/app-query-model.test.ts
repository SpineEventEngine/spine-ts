/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from "@bufbuild/protobuf";
import {
  AnyPacker,
  StringifierRegistry,
  TypeRegistry,
  type AppQueryResponseFor,
} from "@spine-event-engine/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { GetProjectOverview } from "../../test-fixtures/generated/repository-routing/project_queries_app_query.js";
import {
  GetProjectOverview_QuerySchema,
  GetProjectOverview_ResponseSchema,
} from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import { serverTestFixturesProtoModule } from "../../test-fixtures/generated/proto-module.js";

describe("generated App Query model", () => {
  it("aliases the original message schemas and maps the request type to its result", () => {
    expect(GetProjectOverview.querySchema).toBe(GetProjectOverview_QuerySchema);
    expect(GetProjectOverview.responseSchema).toBe(GetProjectOverview_ResponseSchema);
    expectTypeOf<
      AppQueryResponseFor<GetProjectOverview.Query>
    >().toEqualTypeOf<GetProjectOverview.Response>();
  });

  it("registers both nested messages through the ordinary model inventory", () => {
    const registry = TypeRegistry.from(serverTestFixturesProtoModule);
    const query = create(GetProjectOverview.querySchema);
    const response = create(GetProjectOverview.responseSchema);
    expect(
      AnyPacker.unpackUsing(registry, AnyPacker.pack(GetProjectOverview.querySchema, query))
        .$typeName,
    ).toBe(query.$typeName);
    expect(
      AnyPacker.unpackUsing(registry, AnyPacker.pack(GetProjectOverview.responseSchema, response))
        .$typeName,
    ).toBe(response.$typeName);

    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(registry);
    for (const [schema, value] of [
      [GetProjectOverview.querySchema, query],
      [GetProjectOverview.responseSchema, response],
    ] as const) {
      const stringifier = stringifiers.forMessage(schema);
      expect(stringifier.fromString(stringifier.toString(value)).$typeName).toBe(value.$typeName);
    }
  });
});
