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

import { AiModel, type AiModel as AiCapability } from "@spine-event-engine/ai";

import { DraftSupportReplySchema } from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySchema } from "../generated/spine/examples/support/types_pb.js";

/**
 * Defines a bounded draft for human review from the submitted warehouse facts.
 * Construction validates configuration and performs no model request.
 */
export const draftSupportReply: AiCapability<
  typeof DraftSupportReplySchema,
  typeof SupportReplySchema
> = AiModel.define({
  name: "draft-support-reply",
  version: "1",
  kind: "generation",
  input: DraftSupportReplySchema,
  output: SupportReplySchema,
  outputMode: "prompt-and-validate",
  instructions: [
    "Draft a reply for a support person to review, using only the supplied ticket facts.",
    "Neither packing station can print shipping labels; printers and PCs were already restarted.",
    "Acknowledge the shipping impact. Do not suggest repeating attempted steps.",
    "Ask about missing facts. Do not invent a diagnosis, claim resolution, or send a reply.",
  ].join(" "),
  validation: {
    version: "1",

    /**
     * Rejects blank or oversized text before a proposal is admitted.
     *
     * @param value Candidate reply after Protobuf validation.
     * @returns Domain text issues used for a bounded correction.
     */
    check(value) {
      const issues = [];
      if (!value.subject.trim() || value.subject.length > 160)
        issues.push({
          code: "SUBJECT",
          path: "subject",
          message: "Use a short, nonblank subject.",
        });
      if (!value.body.trim() || value.body.length > 4_000)
        issues.push({ code: "BODY", path: "body", message: "Use a bounded, nonblank reply." });
      if (
        value.questions.length > 3 ||
        value.questions.some((question) => !question.trim() || question.length > 200)
      )
        issues.push({
          code: "QUESTIONS",
          path: "questions",
          message: "Use at most three short, nonblank questions.",
        });
      return issues;
    },
  },
  limits: {
    modelRequests: 2,
    toolCalls: 0,
    deadlineMs: 30_000,
    maxInputBytes: 16_000,
    maxOutputBytes: 8_000,
    maxOutputTokens: 1_000,
  },
});
