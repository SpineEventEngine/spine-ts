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

import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AgentExecutionHeadSchema,
  type AgentExecutionHead,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import { AgentExecutionRecords } from "../entity/agent-execution-record-spec.js";

/**
 * One complete observed head-index entry.
 */
export interface MemoryPendingHead {
  /**
   * Complete native-equivalent order key.
   */
  readonly orderKey: string;

  /**
   * Independent head snapshot at the page read.
   */
  readonly head: AgentExecutionHead;
}

/**
 * Keeps one ordered discovery entry per Agent instance.
 */
export class MemoryPendingHeadIndex {
  readonly #byScope = new Map<string, MemoryPendingHead>();

  readonly #ordered: MemoryPendingHead[] = [];

  /**
   * Replaces the visible entry for one complete Agent scope.
   * @param head Per-instance pending and lease record.
   * @param scope Generated state type and Agent key.
   */
  set(scope: string, head: AgentExecutionHead): void {
    const previous = this.#byScope.get(scope);
    if (previous !== undefined) this.#ordered.splice(this.lower(previous.orderKey), 1);
    if (head.pending === undefined || head.eligibleAt === undefined || head.scope === undefined) {
      this.#byScope.delete(scope);
      return;
    }
    const entry = {
      orderKey: AgentExecutionRecords.pendingKey(head.eligibleAt, head.scope),
      head: fromBinary(AgentExecutionHeadSchema, toBinary(AgentExecutionHeadSchema, head)),
    };
    this.#ordered.splice(this.lower(entry.orderKey), 0, entry);
    this.#byScope.set(scope, entry);
  }

  /**
   * Reads no more than count plus one candidate before the fixed cutoff.
   * @param after Observed pending-page cursor.
   * @param asOf Fixed eligibility cutoff for the page.
   * @param count Maximum number of records in the page.
   * @returns Ordered bounded per-instance head entries.
   */
  page(after: string | undefined, asOf: Timestamp, count: number): readonly MemoryPendingHead[] {
    const start = after === undefined ? 0 : this.upper(after);
    const end = this.lower(AgentExecutionRecords.pendingLower(asOf));
    return this.#ordered.slice(start, Math.min(end, start + count + 1));
  }

  /**
   * Finds the first index entry whose key is not smaller than value.
   * @param value Value read from a provider boundary.
   * @returns First matching index position.
   */
  private lower(value: string): number {
    let left = 0;
    let right = this.#ordered.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const entry = this.#ordered[middle];
      if (entry === undefined) throw new Error("Agent head index position is missing.");
      if (entry.orderKey < value) left = middle + 1;
      else right = middle;
    }
    return left;
  }

  /**
   * Finds the first index entry strictly after the cursor.
   * @param value Value read from a provider boundary.
   * @returns Position after the last matching index entry.
   */
  private upper(value: string): number {
    let left = this.lower(value);
    while (this.#ordered[left]?.orderKey === value) left += 1;
    return left;
  }
}
