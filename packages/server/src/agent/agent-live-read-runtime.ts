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

import { toBinary, type MessageShape } from "@bufbuild/protobuf";
import { TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import type { HistoryRead } from "@spine-event-engine/ai";
import type { Query } from "@spine-event-engine/proto/client";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import type { AgentHistoryPage } from "@spine-event-engine/storage/provider";
import type { AgentHistoryScope } from "./agent-history.js";
import { AgentLiveBudget } from "./agent-live-budget.js";

/**
 * Sequences live Agent reads without durable snapshots or replay.
 */
export class AgentLiveReadRuntime {
  #pending = 0;

  #closed = false;

  #tail: Promise<void> = Promise.resolve();

  /**
   * Binds one handler to its exact Agent scope and invocation-wide budget.
   *
   * @param budget Invocation-wide resource budget.
   * @param checkSession Callback that validates the current execution session.
   * @param scope Captured invocation or tenant scope.
   */
  constructor(
    private readonly scope: AgentHistoryScope,
    private readonly budget: AgentLiveBudget,
    private readonly checkSession?: () => Promise<void>,
  ) {}

  /**
   * Reads one indexed page in call order and enforces its actual byte ceiling.
   * @param scope Exact repository and Agent identity.
   * @param request Public page request.
   * @param live Complete provider page callback.
   * @param maxBytes Optional effective response byte ceiling.
   * @returns The current provider page.
   */
  history(
    scope: AgentHistoryScope,
    request: HistoryRead,
    live: () => Promise<AgentHistoryPage>,
    maxBytes: number | undefined,
  ): Promise<AgentHistoryPage> {
    return this.sequence(async () => {
      this.checkScope(scope);
      if (!Number.isSafeInteger(request.pageSize) || request.pageSize <= 0)
        throw new RangeError("Agent history pageSize must be a positive safe integer.");
      if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0))
        throw new RangeError("Agent history maxBytes must be a positive safe integer.");
      this.budget.reserveRead();
      if (this.checkSession !== undefined) await this.checkSession();
      const page = await live();
      const bytes = page.entries.reduce(
        (sum, entry) => sum + toBinary(AgentHistoryEntrySchema, entry).length,
        0,
      );
      if (maxBytes !== undefined && bytes > maxBytes)
        throw new RangeError("Agent history page exceeds maxBytes.");
      return page;
    });
  }

  /**
   * Executes one typed projection query in the same call-order queue.
   * @typeParam Schema Generated Projection state schema.
   * @param schema Expected state descriptor.
   * @param query Original typed query.
   * @param live Complete routed query callback.
   * @returns Current typed states from the routed query.
   */
  query<Schema extends MessageSchema>(
    schema: Schema,
    query: Query,
    live: () => Promise<readonly MessageShape<Schema>[]>,
  ): Promise<readonly MessageShape<Schema>[]> {
    return this.sequence(async () => {
      if (query.target?.type !== TypeUrls.derive(schema))
        throw new Error("Agent projection query target type changed.");
      this.budget.reserveRead();
      if (this.checkSession !== undefined) await this.checkSession();
      return live();
    });
  }

  /**
   * Rejects escaped pending reads and closes this handler's read facade.
   */
  finish(): void {
    if (this.#pending !== 0) throw new Error("Agent history read is still in progress.");
    this.#closed = true;
  }

  /**
   * Admits before calling provider or user callbacks and serializes complete reads.
   *
   * @typeParam T Result of the serialized history read.
   * @param onRead Callback admitted for one history read.
   * @returns The result of the serialized history read.
   */
  private sequence<T>(onRead: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Agent live read facade is closed."));
    this.#pending++;
    const result = this.#tail.then(onRead);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#pending--;
    });
  }

  /**
   * Rejects a protected page intercepted from another Agent scope.
   *
   * @param scope Captured invocation or tenant scope.
   */
  private checkScope(scope: AgentHistoryScope): void {
    if (
      scope.context !== this.scope.context ||
      scope.tenant !== this.scope.tenant ||
      scope.repository !== this.scope.repository ||
      scope.entity !== this.scope.entity
    )
      throw new Error("Agent history read scope changed.");
  }
}
