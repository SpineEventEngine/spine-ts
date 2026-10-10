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

import type { AiFailure } from "@spine-event-engine/ai";
import type { AiAttemptReplay } from "@spine-event-engine/ai/spi/adapter";
import { AiOutcome } from "@spine-event-engine/proto/agent";

/**
 * Validates the original persisted failure before a saved terminal response is reused.
 * @param replay Saved physical response and matching diagnostic.
 * @returns Exact original failure category and retryability.
 */
export const replayFailure = (replay: AiAttemptReplay): AiFailure => {
  const { response, failure } = replay;
  if (!failure || response.diagnosticId?.value !== failure.diagnosticId)
    throw new Error("Saved model failure diagnostic mismatch");
  if (response.outcome === AiOutcome.INVALID_OUTPUT && failure.code !== "INVALID_OUTPUT")
    throw new Error("Saved invalid-output failure category mismatch");
  if (response.outcome === AiOutcome.REFUSED && failure.code !== "REFUSED")
    throw new Error("Saved refusal failure category mismatch");
  if (
    response.outcome === AiOutcome.FAILED &&
    (failure.code === "INVALID_OUTPUT" || failure.code === "REFUSED")
  )
    throw new Error("Saved model failure category mismatch");
  if (![AiOutcome.INVALID_OUTPUT, AiOutcome.REFUSED, AiOutcome.FAILED].includes(response.outcome))
    throw new Error("Saved model outcome is not a terminal failure");
  return failure;
};
