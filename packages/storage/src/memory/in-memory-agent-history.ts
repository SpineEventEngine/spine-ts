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

import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";

import type {
  AgentHistoryPage,
  AgentHistoryRead,
  AgentHistoryStorage,
  AgentHistoryStorageInput,
} from "../entity/agent-history.js";
import { TenantBoundary } from "../internal/tenancy.js";
import { AgentHistoryIndex } from "./agent-history-index.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";

/**
 * Opens scoped in-memory Agent history handles.
 */
export interface MemoryAgentHistoryAccess {
  /**
   * Opens an indexed in-memory history handle.
   *
   * @typeParam Id Typed Agent identifier.
   * @param backend Shared in-memory backend.
   * @param input Context, state type, and typed ID scope.
   * @returns Independently closeable history handle.
   */
  open<Id>(
    backend: InMemoryStorageBackend,
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id>;
}

/**
 * Opens indexed Agent history against one in-memory backend.
 */
export const MemoryAgentHistory: MemoryAgentHistoryAccess = Object.freeze({
  /**
   * Opens an independent handle for the Agent state type and tenant boundary.
   *
   * @typeParam Id Typed Agent identifier.
   * @param backend Shared in-memory backend.
   * @param input State type, tenant, and ID codec.
   * @returns Independently closeable indexed history handle.
   */
  open<Id>(
    backend: InMemoryStorageBackend,
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    if (input.stateType.trim().length === 0) throw new TypeError("Agent state type is required.");
    const records = InMemoryStorageBackend.bind(
      backend,
      "entity",
      TenantBoundary.of(input.context),
      `agent-history:${input.stateType}`,
      () => new Map<string, AgentHistoryIndex>(),
    );
    return new MemoryAgentHistoryHandle(input.id.key, records);
  },
});

/**
 * Provides indexed append-only history for one memory repository scope.
 *
 * @typeParam Id Typed Agent identifier.
 */
class MemoryAgentHistoryHandle<Id> implements AgentHistoryStorage<Id> {
  readonly #idKey: (id: Id) => string;

  readonly #records: Map<string, AgentHistoryIndex>;

  #open = true;

  /**
   * Binds one typed ID codec to the retained per-Agent indexes.
   *
   * @param idKey Canonical Entity ID conversion.
   * @param records Retained indexes in the provider backend.
   */
  constructor(idKey: (id: Id) => string, records: Map<string, AgentHistoryIndex>) {
    this.#idKey = idKey;
    this.#records = records;
  }

  /**
   * Adds an immutable entry to the typed Agent's indexes.
   *
   * @param entityId Typed Agent identifier.
   * @param entry Complete Proto history entry.
   * @returns Resolves after the entry is indexed.
   */
  append(entityId: Id, entry: AgentHistoryEntry): Promise<void> {
    return Promise.resolve().then(() => {
      this.#requireOpen();
      const key = this.#key(entityId);
      let index = this.#records.get(key);
      if (index === undefined) {
        index = new AgentHistoryIndex();
        this.#records.set(key, index);
      }
      index.append(entry);
    });
  }

  /**
   * Reads one bounded indexed view of a typed Agent.
   *
   * @param request Entity ID, view, complete boundary, and response bounds.
   * @returns Independent Proto entries and continuation status.
   */
  read(request: AgentHistoryRead<Id>): Promise<AgentHistoryPage> {
    return Promise.resolve().then(() => {
      this.#requireOpen();
      this.#validateRead(request);
      const index = this.#records.get(this.#key(request.entityId)) ?? new AgentHistoryIndex();
      return index.read(request.view, request.after, request.count, request.maxBytes);
    });
  }

  /**
   * Closes this handle while retaining backend history for a later handle.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Validates positive finite page bounds and a category-compatible boundary.
   *
   * @param request History read bounds and view.
   */
  #validateRead(request: AgentHistoryRead<Id>): void {
    if (!Number.isSafeInteger(request.count) || request.count <= 0)
      throw new RangeError("Agent history count must be a positive safe integer.");
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0)
      throw new RangeError("Agent history maxBytes must be a positive safe integer.");
    const category = request.view.kind;
    if (request.after !== undefined && category !== "full" && request.after.category !== category)
      throw new TypeError("Agent history boundary category does not match the view.");
  }

  /**
   * Maps a typed Agent ID to its canonical storage key.
   *
   * @param entityId Typed Agent identifier.
   * @returns Canonical storage key.
   */
  #key(entityId: Id): string {
    const key = this.#idKey(entityId);
    if (key.length === 0) throw new TypeError("Agent history Entity ID is required.");
    return key;
  }

  /**
   * Rejects use after this independent handle closes.
   */
  #requireOpen(): void {
    if (!this.#open) throw new Error("Agent history storage handle is closed.");
  }
}
