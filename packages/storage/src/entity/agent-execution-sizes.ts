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

import { toBinary } from "@bufbuild/protobuf";
import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  type AgentExecutionHead,
  type AgentExecutionRecord,
  type AgentExecutionScope,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";

import { AgentHistoryRecords } from "./agent-history-record-spec.js";

/**
 * Calculates complete internal Protobuf row sizes before an external Agent call.
 */
export const AgentExecutionSizes = {
  /**
   * Calculates the retained execution journal and accepted source facts.
   * @param record Complete execution record proposed for persistence.
   * @returns Exact serialized execution-record bytes.
   */
  record(record: AgentExecutionRecord): number {
    return toBinary(AgentExecutionRecordSchema, record).length;
  },

  /**
   * Calculates per-instance claim, eligibility and preferences.
   * @param head Complete head proposed for persistence.
   * @returns Exact serialized head bytes.
   */
  head(head: AgentExecutionHead): number {
    return toBinary(AgentExecutionHeadSchema, head).length;
  },

  /**
   * Calculates a history entry inside its persisted scope envelope.
   * @param scope Generated state type and canonical Agent key.
   * @param entry Original conversation, System or domain entry.
   * @returns Exact serialized internal history-record bytes.
   */
  history(scope: AgentExecutionScope, entry: AgentHistoryEntry): number {
    return toBinary(
      AgentHistoryRecordSchema,
      AgentHistoryRecords.record(scope.stateType, scope.agentKey, entry),
    ).length;
  },
};
