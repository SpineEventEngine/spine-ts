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

import type {
  Experimental_DecisionModelV4,
  Experimental_EvaluationModelV4,
  LanguageModelV3,
  LanguageModelV4,
} from "@ai-sdk/provider";
import { VercelAx, VercelDecision, type VercelDecisionModel } from "../src/index.js";
import type { StreamModel } from "../src/adapter/streamed-model.js";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ConnectedGenerationModel =
  Awaited<ReturnType<Parameters<typeof VercelAx.model>[0]["connect"]>> extends {
    model: infer Model;
  }
    ? Model
    : never;
type ConnectedDecisionModel =
  Awaited<ReturnType<Parameters<typeof VercelDecision.model>[0]["connect"]>> extends {
    model: infer Model;
  }
    ? Model
    : never;

export type GenerationBoundary = Assert<Equal<ConnectedGenerationModel, StreamModel>>;
export type DecisionBoundary = Assert<Equal<ConnectedDecisionModel, VercelDecisionModel>>;
export type PinnedGenerationSdk = Assert<Equal<StreamModel, LanguageModelV3 | LanguageModelV4>>;
export type PinnedDecisionSdk = Assert<
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- The adapter still exposes this SDK interface.
  Equal<VercelDecisionModel, Experimental_DecisionModelV4 | Experimental_EvaluationModelV4>
>;
