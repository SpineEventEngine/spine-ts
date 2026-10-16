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

import { create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { describe, expect, it } from "vitest";

import { AgentExecutionSizes, AgentHistoryRecords } from "../../src/provider.js";
import { accepted } from "./agent-execution-fixtures.js";
import { conversation } from "./agent-history-fixtures.js";

describe("Agent execution payload accounting", () => {
  it("includes the complete scope wrapper for every provider row", () => {
    const source = accepted("capacity-source", "T-capacity");
    const scope = source.key?.scope;
    expect(scope).toBeDefined();
    if (scope === undefined) throw new Error("Fixture lacks Agent scope.");
    const record = create(AgentExecutionRecordSchema, { accepted: source });
    const head = create(AgentExecutionHeadSchema, { scope, pending: source.key });
    const entry = conversation(
      "capacity-history",
      "capacity-conversation",
      create(TimestampSchema, { seconds: 100n }),
    );
    const wrapper = AgentHistoryRecords.record(scope.stateType, scope.agentKey, entry);
    expect(AgentExecutionSizes.record(record)).toBe(
      toBinary(AgentExecutionRecordSchema, record).length,
    );
    expect(AgentExecutionSizes.head(head)).toBe(toBinary(AgentExecutionHeadSchema, head).length);
    expect(AgentExecutionSizes.history(scope, entry)).toBe(
      toBinary(AgentHistoryRecordSchema, wrapper).length,
    );
    expect(AgentExecutionSizes.history(scope, entry)).toBeGreaterThan(
      toBinary(AgentHistoryRecordSchema, create(AgentHistoryRecordSchema, { entry })).length,
    );
  });
});
