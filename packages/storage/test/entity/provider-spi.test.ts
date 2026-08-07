import {
  EntityHistoryConformance,
  entityEventHistoryRecordSpec,
  entityStateHistoryRecordSpec,
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
        EntityRecordStorage<string, StringValue>,
        EntityStateHistoryPort<string, StringValue>,
        EntityEventHistoryPort<string>,
        EntityStorageConformance<string, StringValue>,
        EntityStorageInput<string, StringValue>,
      ]
    | undefined = undefined;
  expect(types).toBeUndefined();
  expect(EntityHistoryConformance.check).toBeTypeOf("function");
  expect(entityStateHistoryRecordSpec(StringValueSchema).group.name).toBe(
    StringValueSchema.typeName,
  );
  expect(entityEventHistoryRecordSpec(StringValueSchema).group.name).toBe(
    StringValueSchema.typeName,
  );
});
