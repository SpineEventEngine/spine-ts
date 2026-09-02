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

import {
  EntityHistoryConformance,
  eventHistorySpec,
  stateHistorySpec,
} from "../../src/provider.js";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { StringValue } from "@bufbuild/protobuf/wkt";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageConformance,
  EntityStorageInput,
} from "../../src/provider.js";
import { expect, it } from "vitest";

it("exposes the narrow provider-only entity history SPI", () => {
  const types:
    | [
        EntityRecordStorage<string>,
        EntityStateHistoryPort<string, StringValue>,
        EntityEventHistoryPort<string>,
        EntityStorageConformance<string, StringValue>,
        EntityStorageInput<string, StringValue>,
      ]
    | undefined = undefined;
  expect(types).toBeUndefined();
  expect(EntityHistoryConformance.check).toBeTypeOf("function");
  expect(stateHistorySpec(StringValueSchema).group.name).toBe(StringValueSchema.typeName);
  expect(eventHistorySpec(StringValueSchema).group.name).toBe(StringValueSchema.typeName);
});
