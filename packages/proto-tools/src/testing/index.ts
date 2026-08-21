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
 * Exports compiler-focused test support for consumers that verify generated handler registries.
 */
export { BuildHandlerAnalyzer } from "../generation/build-time-handler-analyzer.js";
export { GeneratedRegistryWriter } from "../generation/generated-registry-writer.js";
export type { BuildHandlerAnalysis } from "../generation/generated-registry-writer.js";
export { generateHandlerRegistry } from "../generation/handler-codegen.js";
