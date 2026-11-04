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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AuthenticatedPrincipalSchema,
  OpaqueSessionRecordSchema,
} from "@spine-event-engine/proto/auth";
import { describe, expect, it } from "vitest";

import { MemoryOpaqueSessionStore } from "../../src/index.js";
import { SessionRecords } from "../../src/sessions/session-record.js";

function record(id: string, generation: string, nanos = 1) {
  return create(OpaqueSessionRecordSchema, {
    id,
    generation,
    principal: create(AuthenticatedPrincipalSchema, { id: "principal" }),
    whenExpires: create(TimestampSchema, { seconds: 100n, nanos }),
  });
}

describe("memory opaque session transitions", () => {
  it("rejects malformed exact deadlines and incomplete domain records", () => {
    for (const [seconds, nanos] of [
      [-62_135_596_801n, 0],
      [253_402_300_800n, 0],
      [0n, -1],
      [0n, 1_000_000_000],
    ] as const)
      expect(() => SessionRecords.deadline(create(TimestampSchema, { seconds, nanos }))).toThrow(
        "Timestamp range",
      );
    expect(() =>
      SessionRecords.expiry(create(OpaqueSessionRecordSchema, { id: "missing" })),
    ).toThrow("expiry");
    expect(() =>
      SessionRecords.publicPrincipal(
        create(OpaqueSessionRecordSchema, {
          id: "missing",
          whenExpires: create(TimestampSchema, { seconds: 1n }),
        }),
      ),
    ).toThrow("principal");
  });

  it("rejects future maintenance cutoffs and new work after close", async () => {
    const store = new MemoryOpaqueSessionStore(() => create(TimestampSchema, { seconds: 100n }), 1);
    await store.insert(record("one", "generation"));
    expect(await store.insert(record("two", "generation"))).toBe(false);
    await expect(store.purgeExpired(create(TimestampSchema, { seconds: 101n }))).rejects.toThrow(
      "trusted clock",
    );
    await store.close();
    await expect(store.read("one")).rejects.toThrow("closed");
  });

  it("orders the full signed Timestamp range and neighboring nanoseconds", () => {
    const values = [
      [-62_135_596_800n, 0],
      [-1n, 999_999_999],
      [0n, 0],
      [0n, 1],
      [253_402_300_799n, 999_999_999],
    ] as const;
    const keys = values.map(([seconds, nanos]) =>
      SessionRecords.orderKey(create(TimestampSchema, { seconds, nanos })),
    );
    expect(keys.every((key) => key.byteLength === 12)).toBe(true);
    for (let index = 1; index < keys.length; index += 1) {
      const previous = keys[index - 1];
      const current = keys[index];
      if (previous === undefined || current === undefined) throw new Error("missing ordered key");
      expect(Buffer.compare(previous, current)).toBeLessThan(0);
    }
  });

  it("inserts absent, replaces exactly one expected generation, and conditionally compensates", async () => {
    const store = new MemoryOpaqueSessionStore();
    const first = record("reference", "one");
    const second = record("reference", "two");
    expect(await store.insert(first)).toBe(true);
    expect(await store.insert(second)).toBe(false);
    expect(await store.replace(first, second)).toBe(true);
    expect(await store.replace(first, record("reference", "three"))).toBe(false);
    expect(await store.remove(first)).toBe(false);
    expect((await store.read("reference"))?.generation).toBe("two");
    expect(await store.remove(second)).toBe(true);
    expect(await store.read("reference")).toBeUndefined();
    await store.close();
  });

  it("purges only rows at or before an exact nanosecond cutoff", async () => {
    const store = new MemoryOpaqueSessionStore();
    await store.insert(record("older", "one", 1));
    await store.insert(record("newer", "one", 2));
    expect(await store.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 1 }))).toBe(1);
    expect(await store.read("older")).toBeUndefined();
    expect(await store.read("newer")).toBeDefined();
    await store.close();
  });
});
