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
  Experimental_DecisionModelV4Answer,
  Experimental_DecisionModelV4CallOptions,
  Experimental_DecisionModelV4Input,
  Experimental_DecisionModelV4Question,
  Experimental_DecisionModelV4Result,
  LanguageModelV3,
  LanguageModelV4,
} from "@ai-sdk/provider";

export type GenerationModel = LanguageModelV3 | LanguageModelV4;
export type DecisionModel = Experimental_DecisionModelV4;
export type DecisionTypes = [
  Experimental_DecisionModelV4Input,
  Experimental_DecisionModelV4Question,
  Experimental_DecisionModelV4CallOptions,
  Experimental_DecisionModelV4Answer,
  Experimental_DecisionModelV4Result,
];
