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
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 1_000,
      totalInputBytes: 1_000,
      totalOutputBytes: 1_000,
    },
    concurrentOperations,
    queuedOperations,
  });
}

describe("shared Agent execution capacity", () => {
  it("signals availability after a held Agent releases its slot", async () => {
    const capacity = AgentExecutionCapacity.for(registry(1, 0));
    const released = Promise.withResolvers<undefined>();
    const observed: string[] = [];
    const stop = capacity.onAvailable((key) => {
      observed.push(key);
    });
    const held = capacity.reserve("agent-a", new AbortController().signal);
    expect(capacity.reserve("agent-b", new AbortController().signal)).toBeUndefined();
    const work = held?.run(() => released.promise);
    released.resolve(undefined);
    await work;
    expect(observed).toEqual(["agent-a"]);
    expect(capacity.reserve("agent-b", new AbortController().signal)).toBeDefined();
    stop();
  });
  it("reserves before receipt without starting and releases a failed admission", async () => {
    const capacity = AgentExecutionCapacity.for(registry(1, 0));
    let started = 0;
    const first = capacity.reserve("first", new AbortController().signal);
    expect(first).toBeDefined();
    expect(capacity.reserve("overflow", new AbortController().signal)).toBeUndefined();
    expect(started).toBe(0);
    first?.release();
    const replacement = capacity.reserve("replacement", new AbortController().signal);
    expect(replacement).toBeDefined();
    await replacement?.run(() => {
      started += 1;
      return Promise.resolve();
    });
    expect(started).toBe(1);
    expect(capacity.reserve("after-run", new AbortController().signal)).toBeDefined();
  });

  it("does not consume an active slot for a same-Agent turn before it starts", async () => {
    const capacity = AgentExecutionCapacity.for(registry(1, 1));
    const first = capacity.reserve("first", new AbortController().signal);
    const waiting = capacity.reserve("same-Agent waiting", new AbortController().signal);
    expect(first).toBeDefined();
    expect(waiting).toBeDefined();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = first?.run(() => blocked);
    let started = false;
    await Promise.resolve();
    expect(started).toBe(false);
    release();
    await active;
    expect(started).toBe(false);
    const second = waiting?.run(() => {
      started = true;
      return Promise.resolve();
    });
    await second;
    expect(started).toBe(true);
  });

  it("frees a reserved slot when cancellation precedes acknowledgement", () => {
    const capacity = AgentExecutionCapacity.for(registry(1, 0));
    const abort = new AbortController();
    const reserved = capacity.reserve("cancelled", abort.signal);
    expect(reserved).toBeDefined();
    abort.abort();
    expect(capacity.reserve("next", new AbortController().signal)).toBeDefined();
    expect(() => reserved?.run(() => Promise.resolve())).toThrow(/no longer available/);
  });
  it("starts independent work without an application concurrency ceiling", async () => {
    const capacity = AgentExecutionCapacity.for(AiRegistry.create({ defaultModels: {} }));
    const releases: (() => void)[] = [];
    let started = 0;
    const submit = (key: string) =>
      capacity.reserve(key, new AbortController().signal)?.run(() => {
        started += 1;
        return new Promise<void>((resolve) => releases.push(resolve));
      });
    const first = submit("first");
    const second = submit("second");
    await Promise.resolve();
    expect(started).toBe(2);
    for (const release of releases) release();
    await Promise.all([first, second]);
  });
  it("rejects cancelled admission and releases a slot after execution fails", async () => {
    const capacity = AgentExecutionCapacity.for(registry(1, 0));
    const cancelled = new AbortController();
    cancelled.abort();
    expect(
      capacity
        .reserve("cancelled-before-admission", cancelled.signal)
        ?.run(() => Promise.reject(new Error("Cancelled request ran."))),
    ).toBeUndefined();
    const failure = new Error("Provider claim failed.");
    const failed = capacity
      .reserve("failed-claim", new AbortController().signal)
      ?.run(() => Promise.reject(failure));
    await expect(failed).rejects.toBe(failure);
    await expect(
      capacity.reserve("after-failure", new AbortController().signal)?.run(() => Promise.resolve()),
    ).resolves.toBeUndefined();
  });

  it("limits active transitions and retains one FIFO waiting descriptor across Bounded Contexts", async () => {
    const ai = registry(1, 1);
    const firstContext = AgentExecutionCapacity.for(ai);
    const secondContext = AgentExecutionCapacity.for(ai);
    expect(firstContext).toBe(secondContext);
    const order: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = firstContext
      .reserve("context-A:signal-1", new AbortController().signal)
      ?.run(async () => {
        order.push("A-start");
        await blocked;
        order.push("A-end");
      });
    const waiting = secondContext
      .reserve("context-B:signal-1", new AbortController().signal)
      ?.run(() => {
        order.push("B-start");
        return Promise.resolve();
      });
    expect(active).toBeDefined();
    expect(waiting).toBeDefined();
    expect(
      secondContext
        .reserve("context-C:overflow", new AbortController().signal)
        ?.run(() => Promise.resolve()),
    ).toBeUndefined();
    expect(
      firstContext
        .reserve("context-B:signal-1", new AbortController().signal)
        ?.run(() => Promise.resolve()),
    ).toBeUndefined();
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
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = capacity.reserve("active", new AbortController().signal)?.run(() => blocked);
    expect(
      capacity.reserve("overflow", new AbortController().signal)?.run(() => Promise.resolve()),
    ).toBeUndefined();
    if (release === undefined) throw new Error("Expected active gate.");
    release();
    await active;
    const queue = AgentExecutionCapacity.for(registry(1, 1));
    let releaseSecond: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const running = queue.reserve("running", new AbortController().signal)?.run(() => held);
    const cancelled = new AbortController();
    const waiting = queue.reserve("waiting", cancelled.signal)?.run(() => {
      throw new Error("Cancelled descriptor must not run.");
    });
    cancelled.abort();
    await waiting;
    const replacement = queue
      .reserve("replacement", new AbortController().signal)
      ?.run(() => Promise.resolve());
    expect(replacement).toBeDefined();
    if (releaseSecond === undefined) throw new Error("Expected second active gate.");
    releaseSecond();
    await Promise.all([running, replacement]);
  });
});
