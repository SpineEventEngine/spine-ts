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
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { TenantRecords } from "../../src/memory/tenant-records.js";
import { RecordSpec } from "../../src/record/record-spec.js";

const oldKind = Symbol("normalized kind");
const oldPayload = Symbol("normalized payload");

function oldNormalize(value: unknown): unknown {
  if (typeof value === "bigint") return { [oldKind]: "bigint", [oldPayload]: value.toString() };
  if (value instanceof Uint8Array) return { [oldKind]: "bytes", [oldPayload]: [...value] };
  if (Array.isArray(value)) return value.map(oldNormalize);
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;
  if (typeof value !== "object") return undefined;
  const empty = Object.create(null) as Record<string, unknown>;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      Object.defineProperty(result, key, {
        value: oldNormalize(Reflect.get(value, key)),
        enumerable: true,
      });
      return result;
    }, empty);
}

function oldEncoded(value: unknown): unknown[] {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") return ["number", String(value)];
  if (typeof value === "string") return ["string", value];
  if (Array.isArray(value)) return ["array", ...value.map(oldEncoded)];
  if (typeof value === "object" && oldKind in value)
    return [Reflect.get(value, oldKind), Reflect.get(value, oldPayload)];
  return ["object", ...Object.keys(value).map((key) => [key, oldEncoded(Reflect.get(value, key))])];
}

function oldKey(value: unknown): string {
  return JSON.stringify(oldEncoded(oldNormalize(value)));
}

describe("canonical tenant record keys", () => {
  it("matches old tagged keys over primitive, nested, sparse and object-enumeration cases", () => {
    const records = new TenantRecords<unknown, Event>();
    const special = Object.create({ inherited: 1 }) as Record<string | symbol, unknown>;
    Object.defineProperty(special, "__proto__", { value: 2, enumerable: true });
    Object.defineProperty(special, "hidden", { value: 3 });
    special[Symbol("ignored")] = 4;
    for (const key of ["4294967295", "4294967294", "10", "2", "01", "-0", "0", "z"])
      special[key] = key;
    const sparse: unknown[] = [];
    sparse.length = 3;
    sparse[1] = undefined;
    sparse[2] = { nested: [new Uint8Array([0, 255]), 9007199254740993n] };
    const values: unknown[] = [
      undefined,
      null,
      false,
      true,
      0,
      -0,
      1.5,
      NaN,
      Infinity,
      -Infinity,
      "",
      "ascii",
      "é",
      "😀",
      "\ud800",
      0n,
      -12345678901234567890n,
      new Uint8Array(),
      new Uint8Array([0, 127, 255]),
      [],
      [undefined],
      sparse,
      {},
      special,
      Object.create(null),
      { b: 2, a: 1 },
      { kind: "bigint", payload: 10 },
      { kind: "bytes", payload: [1, 2] },
      { nested: [{ "10": "a", "2": "b", "4294967295": "c" }, sparse, special] },
      () => undefined,
      Symbol("unsupported"),
      new Date(0),
    ];
    for (let index = 0; index < 500; index++) {
      values.push({
        [String(index % 29)]: [values[index % 27], { [String(499 - index)]: index }],
        [`key-${String(index % 13)}`]: values[(index * 7) % 27],
      });
    }
    for (const value of values) expect(records.capture(value).key).toBe(oldKey(value));
    const hole: unknown[] = [];
    hole.length = 1;
    expect(records.capture(hole).key).not.toBe(records.capture([undefined]).key);
    expect(records.capture({ b: 2, a: 1 }).key).toBe(records.capture({ a: 1, b: 2 }).key);
  });

  it("reads getters in the old lexical order before numeric-key enumeration", () => {
    const records = new TenantRecords<unknown, Event>();
    const reads: string[] = [];
    const value = Object.create(null) as Record<string, unknown>;
    for (const key of ["2", "10", "a"]) {
      Object.defineProperty(value, key, {
        enumerable: true,
        get: () => {
          reads.push(key);
          return key;
        },
      });
    }
    const expected = oldKey(value);
    expect(reads).toEqual(["10", "2", "a"]);
    reads.length = 0;
    expect(records.capture(value).key).toBe(expected);
    expect(reads).toEqual(["10", "2", "a"]);
  });

  it("retains the public read, CAS and delete identity behavior", () => {
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "object",
      extractId: (record) => ({ "10": record.value, "2": "two" }),
    });
    const records = new TenantRecords<object, StringValue>();
    const first = spec.materialize(create(StringValueSchema, { value: "first" }));
    const second = spec.materialize(create(StringValueSchema, { value: "second" }));
    const sameSlot = { "2": "two", "10": "first" };
    records.write(first);
    expect(records.read(sameSlot)?.value).toBe("first");
    expect(records.compareAndSet(sameSlot, undefined, second)).toBe(false);
    expect(records.compareAndSet(sameSlot, first, second)).toBe(true);
    expect(records.read(sameSlot)?.value).toBe("second");
    expect(records.delete(sameSlot)).toBe(true);
    expect(records.read(sameSlot)).toBeUndefined();
  });
});
