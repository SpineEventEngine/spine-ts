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

import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AgentExecutionStorageFactories } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { exerciseAgentExecutionLifecycle } from "../../storage/test/entity/agent-execution-provider-conformance.js";
import { HistoryDatastoreBackend } from "./datastore/entity-history-fixture.js";
import { DatastoreStorageFactory } from "../src/index.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("Datastore Agent execution provider boundary", () => {
  it("keeps the original invocation across reconstruction and fences a second claim", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const storage = AgentExecutionStorageFactories.create(factory, input);
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    try {
      await storage.admit(source);
      expect((await storage.pending({ count: 1 })).records[0]?.accepted).toEqual(source);
      const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
      const first = required(await storage.claim(key, "first-token", expiry));
      expect(first.record.claimToken).toBe("first-token");
      expect(await storage.claim(key, "second-token", expiry)).toBeUndefined();
      await exerciseAgentExecutionLifecycle(storage);
      storage.close();
      const reopened = AgentExecutionStorageFactories.create(factory, input);
      try {
        expect((await reopened.read(key))?.claimToken).toBe("first-token");
      } finally {
        reopened.close();
      }
    } finally {
      storage.close();
      factory.close();
    }
  });
});
