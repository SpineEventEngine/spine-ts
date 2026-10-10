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

import type { TenantBoundary } from "../internal/tenancy.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { KeyedSerialQueue } from "./in-memory-entity-history.js";

/**
 * Shares one per-Agent mutation queue between standalone history and fenced execution.
 */
export const AgentHistoryMutationQueue = {
  /**
   * Binds the queue to one complete provider tenant boundary.
   * @param backend Shared in-memory backend.
   * @param tenant Complete tenant boundary.
   * @returns Queue keyed by canonical Agent identifier.
   */
  bind(backend: InMemoryStorageBackend, tenant: TenantBoundary): KeyedSerialQueue {
    return InMemoryStorageBackend.bind(
      backend,
      "entity",
      tenant,
      "agent-history-mutation",
      () => new KeyedSerialQueue(),
    );
  },
};
