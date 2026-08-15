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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { DeliveryCleanupStorageFactories } from "../src/internal/delivery-cleanup.js";
import { InMemoryStorageFactory } from "../src/memory/in-memory-storage-factory.js";
import { RecordSpec } from "../src/record/record-spec.js";

const spec = new RecordSpec({
  sourceType: StringValueSchema,
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (record) => record.value,
});

describe("Memory delivery cleanup source graph", () => {
  it("rejects an unregistered factory", () => {
    expect(() => DeliveryCleanupStorageFactories.create({} as never)).toThrow("does not provide");
  });
  it("removes only an exact inbox snapshot while the exact session remains current", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "memory-cleanup", multitenant: false } as const;
    const inbox = factory.createRecordStorage(context, spec);
    const sessions = factory.createRecordStorage(context, spec);
    const current = create(StringValueSchema, { value: "session" });
    const delivered = create(StringValueSchema, { value: "delivered" });
    await sessions.write(current);
    await inbox.write(delivered);
    const cleanup = DeliveryCleanupStorageFactories.create(factory);
    await expect(
      cleanup.remove({
        context,
        inbox: { spec, id: "delivered", expected: delivered },
        session: {
          spec,
          id: "session",
          expected: current,
          isCurrent: (value) => value.value === "session",
        },
      }),
    ).resolves.toBe(true);
    await expect(inbox.read("delivered")).resolves.toBeUndefined();
    await expect(
      cleanup.remove({
        context,
        inbox: { spec, id: "delivered", expected: delivered },
        session: { spec, id: "session", expected: current, isCurrent: () => false },
      }),
    ).resolves.toBe(false);
    await sessions.compareAndSet(
      "session",
      current,
      create(StringValueSchema, { value: "changed" }),
    );
    await expect(
      cleanup.remove({
        context,
        inbox: { spec, id: "delivered", expected: delivered },
        session: { spec, id: "session", expected: current, isCurrent: () => true },
      }),
    ).resolves.toBe(false);
    cleanup.close();
    await expect(
      cleanup.remove({
        context,
        inbox: { spec, id: "delivered", expected: delivered },
        session: { spec, id: "session", expected: current, isCurrent: () => true },
      }),
    ).rejects.toThrow("closed");
    inbox.close();
    sessions.close();
  });
});
