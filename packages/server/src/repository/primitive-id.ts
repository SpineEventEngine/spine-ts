import { create } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  DoubleValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { packAny, unpackAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";

export type PrimitiveId = string | number | boolean;

export function packPrimitiveId(id: PrimitiveId): Any {
  switch (typeof id) {
    case "string":
      return packAny(StringValueSchema, create(StringValueSchema, { value: id }));
    case "number":
      return packAny(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
    case "boolean":
      return packAny(BoolValueSchema, create(BoolValueSchema, { value: id }));
  }
}

export function primitiveId(value: unknown): PrimitiveId | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

export function unpackPrimitiveId(id: Any | undefined): PrimitiveId | undefined {
  if (id === undefined) {
    return undefined;
  }

  return (
    unpackAny(id, StringValueSchema)?.value ??
    unpackAny(id, DoubleValueSchema)?.value ??
    unpackAny(id, BoolValueSchema)?.value ??
    unpackAny(id, UserIdSchema)?.value
  );
}
