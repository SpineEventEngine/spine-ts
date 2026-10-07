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

import { AiRegistry } from "@spine-event-engine/ai";
import { describe, expect, it } from "vitest";
import { AgentExecutionCapacity } from "../../src/agent/agent-execution-capacity.js";

function registry(concurrentOperations: number, queuedOperations: number) {
  return AiRegistry.create({
    defaultModels: {},
    invocationLimits: {
      operations: 1, modelRequests: 1, toolCalls: 0, recordedReads: 0,
      deadlineMs: 1_000, totalInputBytes: 1_000, totalOutputBytes: 1_000,
      maxRecoveryBytes: 4_000,
    },
    concurrentOperations, queuedOperations,
  });
}

describe("shared Agent execution capacity", () => {
  it("limits active transitions and retains one FIFO waiting descriptor across contexts", async () => {
    const ai = registry(1, 1);
    const firstContext = AgentExecutionCapacity.for(ai);
    const secondContext = AgentExecutionCapacity.for(ai);
    expect(firstContext).toBe(secondContext);
    const order: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const active = firstContext.trySubmit({
      key: "context-A:signal-1", signal: new AbortController().signal,
      run: async () => { order.push("A-start"); await blocked; order.push("A-end"); },
    });
    const waiting = secondContext.trySubmit({
      key: "context-B:signal-1", signal: new AbortController().signal,
      run: () => { order.push("B-start"); return Promise.resolve(); },
    });
    expect(active).toBeDefined();
    expect(waiting).toBeDefined();
    expect(secondContext.trySubmit({
      key: "context-C:overflow", signal: new AbortController().signal,
      run: () => Promise.resolve(),
    })).toBeUndefined();
    expect(firstContext.trySubmit({
      key: "context-B:signal-1", signal: new AbortController().signal,
      run: () => Promise.resolve(),
    })).toBeUndefined();
    await Promise.resolve();
    expect(order).toEqual(["A-start"]);
    if (release === undefined) throw new Error("Expected active gate.");
    release();
    await Promise.all([active, waiting]);
    expect(order).toEqual(["A-start", "A-end", "B-start"]);
  });

  it("declines zero-queue overflow and removes an aborted waiting descriptor", async () => {
    const ai = registry(1, 0);
    const capacity = AgentExecutionCapacity.for(ai);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const active = capacity.trySubmit({
      key: "active", signal: new AbortController().signal,
      run: () => blocked,
    });
    expect(capacity.trySubmit({
      key: "overflow", signal: new AbortController().signal,
      run: () => Promise.resolve(),
    })).toBeUndefined();
    if (release === undefined) throw new Error("Expected active gate.");
    release();
    await active;
    const queue = AgentExecutionCapacity.for(registry(1, 1));
    let releaseSecond: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const running = queue.trySubmit({
      key: "running", signal: new AbortController().signal, run: () => held,
    });
    const cancelled = new AbortController();
    const waiting = queue.trySubmit({
      key: "waiting", signal: cancelled.signal,
      run: () => { throw new Error("Cancelled descriptor must not run."); },
    });
    cancelled.abort();
    await waiting;
    const replacement = queue.trySubmit({
      key: "replacement", signal: new AbortController().signal,
      run: () => Promise.resolve(),
    });
    expect(replacement).toBeDefined();
    if (releaseSecond === undefined) throw new Error("Expected second active gate.");
    releaseSecond();
    await Promise.all([running, replacement]);
  });
});
