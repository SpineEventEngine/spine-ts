import {
  EntityHistoryConformance,
  eventHistorySpec,
  stateHistorySpec,
} from "../../src/internal/entity-history.js";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { StringValue } from "@bufbuild/protobuf/wkt";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageConformance,
  EntityStorageInput,
} from "../../src/internal/entity-history.js";
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
