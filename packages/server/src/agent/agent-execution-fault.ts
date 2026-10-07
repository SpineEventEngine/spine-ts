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

/**
 * Safe terminal reason for a deterministic accepted Agent execution fault.
 */
export type AgentExecutionFaultReason =
  | "REVISION_CHANGED"
  | "REPLAY_DIVERGENCE"
  | "READ_BUDGET_EXCEEDED"
  | "MODEL_BUDGET_EXCEEDED"
  | "TOOL_BUDGET_EXCEEDED";

/**
 * Marks a local, repeatable check that failed before a provider write.
 */
export class AgentExecutionFault extends Error {
  /**
   * Records the safe reason included in the terminal System Event.
   * @param reason Safe terminal category.
   * @param message Specific nonsecret diagnostic for local callers.
   */
  constructor(
    readonly reason: AgentExecutionFaultReason,
    message: string,
  ) {
    super(message);
    this.name = "AgentExecutionFault";
  }
}
