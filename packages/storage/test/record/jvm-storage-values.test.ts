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
