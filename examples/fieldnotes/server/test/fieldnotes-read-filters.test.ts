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
import { UserIdSchema } from "@spine-event-engine/proto";
import type { ReadSideContext } from "@spine-event-engine/server";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceAddedSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/events_pb.js";
import { PlaceUnavailableSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections_pb.js";
import { describe, expect, it } from "vitest";
import { fieldnotesReadFilters } from "../src/fieldnotes-read-filters.js";

describe("Fieldnotes read filters", () => {
  it("keeps states, outcomes and refusals private to their verified principal", async () => {
    const filters = fieldnotesReadFilters();
    const forSchema = (name: string) => {
      const filter = filters.find((candidate) => candidate.schema.typeName === name);
      if (filter === undefined) throw new Error(`Missing filter ${name}`);
      return filter;
    };
    const author = create(UserIdSchema, { value: "author" });
    const admitted = { principal: { id: "author" } } as ReadSideContext;
    const foreign = { principal: { id: "foreign" } } as ReadSideContext;
    const anonymous = {} as ReadSideContext;
    const view = create(PlaceViewSchema, { author });
    const stateFilter = forSchema(PlaceViewSchema.typeName);
    expect(await stateFilter.filter(view, admitted)).toEqual(view);
    expect(await stateFilter.filter(view, foreign)).toBeNull();
    expect(await stateFilter.filter(view, anonymous)).toBeNull();
    expect(
      await stateFilter.filter(create(PlaceViewSchema, { author, removed: true }), admitted),
    ).toBeNull();
    const event = create(PlaceAddedSchema, { author });
    const eventFilter = forSchema(PlaceAddedSchema.typeName);
    expect(await eventFilter.filter(event, admitted)).toEqual(event);
    expect(await eventFilter.filter(event, foreign)).toBeNull();
    const refusal = create(PlaceUnavailableSchema, { requester: author });
    const refusalFilter = forSchema(PlaceUnavailableSchema.typeName);
    expect(await refusalFilter.filter(refusal, admitted)).toEqual(refusal);
    expect(await refusalFilter.filter(refusal, foreign)).toBeNull();
  });
});
