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

/** Provider-only contracts for implementing a Spine storage adapter. */
export * from "./internal/delivery-cleanup.js";
export * from "./internal/entity-commit.js";
export * from "./internal/entity-history.js";
export * from "./internal/event-store.js";
export * from "./internal/query-values.js";
export * from "./internal/tenancy.js";
