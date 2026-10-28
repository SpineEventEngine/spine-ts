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
 * Safe category for a live Agent check that fails before persistence.
 */
export type AgentLiveFaultReason =
  | "READ_BUDGET_EXCEEDED"
  | "MODEL_BUDGET_EXCEEDED"
  | "MODEL_USE_DENIED"
  | "TOOL_BUDGET_EXCEEDED";

/**
 * Reports a local live Agent check with a nonsecret diagnostic.
 */
export class AgentLiveFault extends Error {
  /**
   * Records the safe category for the Agent failure event.
   *
   * @param reason Safe failure category.
   * @param message Nonsecret diagnostic for local callers.
   */
  constructor(
    readonly reason: AgentLiveFaultReason,
    message: string,
  ) {
    super(message);
    this.name = "AgentLiveFault";
  }
}
