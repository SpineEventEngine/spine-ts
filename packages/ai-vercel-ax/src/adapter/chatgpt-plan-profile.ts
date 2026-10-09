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

import type { VercelProviderCapabilities } from "./factory.js";

/**
 * Exact stateless Responses contract accepted by ChatGPT plan usage.
 */
export const chatgptPlanProfile: VercelProviderCapabilities = Object.freeze({
  id: "chatgpt-plan-responses-v1",
  routeSuffix: "/responses",
  providerProtocol: "openai-responses-stream-v1",
  boundedFetchRevision: "spine-bounded-fetch-v1",
  outputContract: "prompt-validate-v1",
  cancellationContract: "ticket-abort-and-deadline-v1",
  retryContract: "one-provider-call-per-ticket-v1",
  tokenCeiling: "unsupported",
} as const satisfies VercelProviderCapabilities);
