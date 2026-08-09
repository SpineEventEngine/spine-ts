import { create, toJsonString } from "@bufbuild/protobuf";
import { UserIdSchema } from "@spine-event-engine/proto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface GoldenValue {
  readonly name: string;
  readonly protoJson?: string;
  readonly mysql: Readonly<Record<string, unknown>>;
  readonly datastore: Readonly<Record<string, unknown>>;
}

interface GoldenValues {
  readonly format: string;
  readonly identifiers: readonly GoldenValue[];
  readonly columns: readonly GoldenValue[];
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/jvm-storage-values.json", import.meta.url), "utf8"),
) as GoldenValues;

describe("JVM storage golden values", () => {
  it("covers every required identifier and column category", () => {
    expect(fixture.format).toBe("spine-jvm-storage-values-v1");
    expect(fixture.identifiers.map(({ name }) => name)).toEqual([
      "MessageId",
      "BoardId",
      "UserId",
      "string",
      "int32",
      "int64",
    ]);
    expect(fixture.columns.map(({ name }) => name)).toEqual([
      "string",
      "int32",
      "int64",
      "boolean",
      "bytes",
      "enum",
      "ordinary-message",
      "timestamp",
      "version",
      "null",
    ]);
  });

  it("uses compact Proto JSON for a representative message value", () => {
    const user = create(UserIdSchema, { value: "user-42" });
    const expected = fixture.columns.find(({ name }) => name === "ordinary-message");

    expect(toJsonString(UserIdSchema, user)).toBe(expected?.protoJson);
    expect(expected?.mysql).toEqual({ type: "string", value: '{"value":"user-42"}' });
    expect(expected?.datastore).toEqual({
      type: "string",
      value: '{"value":"user-42"}',
    });
  });
});
