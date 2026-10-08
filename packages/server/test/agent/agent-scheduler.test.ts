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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentInvocationKeySchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { CommandIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { AgentScheduler, type AgentScanScope } from "../../src/agent/agent-scheduler.js";
import { AgentExecutionCapacity } from "../../src/agent/agent-execution-capacity.js";

const record = (name: string) =>
  create(AgentExecutionRecordSchema, {
    accepted: create(AgentAcceptedInvocationSchema, {
      key: create(AgentInvocationKeySchema, {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: name }),
        sourceSignal: create(AgentSignalKeySchema, {
          id: { case: "command", value: create(CommandIdSchema, { uuid: name }) },
        }),
      }),
    }),
  });

describe("Agent indexed scheduler", () => {
  it("coalesces an in-flight scan and retries provider errors without losing a sweep", async () => {
    let reads = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error("Pending index temporarily unavailable.");
    const scope: AgentScanScope = {
      id: "provider-retry",
      pending: async () => {
        reads += 1;
        if (reads === 1) {
          await blocked;
          throw failure;
        }
        if (reads === 2) return { records: [], hasMore: true };
        return { records: [], hasMore: false };
      },
      run: () => Promise.resolve(),
    };
    const scheduler = new AgentScheduler(
      () => Promise.resolve([scope]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    const first = scheduler.turn();
    const concurrent = scheduler.turn();
    release?.();
    const attempts = await Promise.allSettled([first, concurrent]);
    expect(attempts).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(reads).toBe(1);
    await expect(scheduler.turn()).rejects.toThrow("continuation");
    await scheduler.turn();
    expect(reads).toBe(3);
    await scheduler.close();
  });

  it("rediscovers a durable record skipped when resident capacity is full", async () => {
    const seen: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scope: AgentScanScope = {
      id: "durable-overflow",
      pending: () =>
        Promise.resolve({
          records: [record("A"), record("B"), record("C")],
          hasMore: false,
        }),
      run: async (key) => {
        const name = key.scope?.agentKey ?? "missing";
        seen.push(name);
        if (name === "A") await held;
      },
    };
    const scheduler = new AgentScheduler(
      () => Promise.resolve([scope]),
      new AgentExecutionCapacity(1, 1),
      () => undefined,
    );
    await scheduler.turn();
    await Promise.resolve();
    expect(seen).toEqual(["A"]);
    if (release === undefined) throw new Error("Expected active execution gate.");
    release();
    for (let turn = 0; turn < 4 && !seen.includes("C"); turn += 1) {
      await Promise.resolve();
      await scheduler.turn();
    }
    expect(seen).toContain("C");
    await scheduler.close();
  });

  it("retains provider continuation across bounded turns even when every claim fails", async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const time = create(TimestampSchema, { seconds: 10n });
    const cursor = (name: string) => ({
      asOf: time,
      key: {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: name }),
        eligibleAt: create(TimestampSchema, { seconds: 9n }),
      },
    });
    const afters: string[] = [];
    const scope: AgentScanScope = {
      id: "one-tenant-one-repository",
      pending: (after) => {
        const name = after === undefined ? "A" : after.key.scope.agentKey === "A" ? "B" : "C";
        afters.push(after?.key.scope.agentKey ?? "start");
        return Promise.resolve({
          records: [record(name)],
          after: cursor(name),
          hasMore: name !== "C",
        });
      },
      run: (key) => {
        seen.push(key.scope?.agentKey ?? "missing");
        return Promise.reject(new Error("claim lost"));
      },
    };
    const scheduler = new AgentScheduler(
      () => Promise.resolve([scope]),
      new AgentExecutionCapacity(1, 0),
      (error) => {
        errors.push(error);
      },
    );
    await scheduler.turn();
    await Promise.resolve();
    await scheduler.turn();
    await Promise.resolve();
    await scheduler.turn();
    await scheduler.close();
    expect(afters).toEqual(["start", "A", "B"]);
    expect(seen).toEqual(["A", "B", "C"]);
    expect(errors).toHaveLength(3);
  });

  it("rotates across more scopes than one bounded turn", async () => {
    const visited: string[] = [];
    const scopes: AgentScanScope[] = Array.from({ length: 6 }, (_, index) => ({
      id: `scope-${String(index)}`,
      pending: () => {
        visited.push(`scope-${String(index)}`);
        return Promise.resolve({ records: [], hasMore: false });
      },
      run: () => Promise.resolve(),
    }));
    const scheduler = new AgentScheduler(
      () => Promise.resolve(scopes),
      new AgentExecutionCapacity(2, 0),
      () => undefined,
    );
    await scheduler.turn();
    await scheduler.turn();
    await scheduler.close();
    expect(visited).toEqual([
      "scope-0",
      "scope-1",
      "scope-2",
      "scope-3",
      "scope-4",
      "scope-5",
      "scope-0",
      "scope-1",
    ]);
  });

  it("cancels an active execution and stops discovery before shutdown drains", async () => {
    let entered: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let observedAbort = false;
    let reads = 0;
    const scope: AgentScanScope = {
      id: "shutdown-scope",
      pending: () => {
        reads += 1;
        return Promise.resolve({ records: [record("shutdown")], hasMore: false });
      },
      run: (_entry, signal) => {
        entered?.();
        return new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    };
    const scheduler = new AgentScheduler(
      () => Promise.resolve([scope]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await scheduler.turn();
    await active;
    await scheduler.close();
    await scheduler.turn();
    expect(observedAbort).toBe(true);
    expect(reads).toBe(1);
  });

  it("deduplicates the same durable invocation across context schedulers", async () => {
    const capacity = new AgentExecutionCapacity(2, 0);
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs: string[] = [];
    const scope: AgentScanScope = {
      id: "context:tenant:agent-type",
      pending: () => Promise.resolve({ records: [record("same")], hasMore: false }),
      run: async (key) => {
        runs.push(key.scope?.agentKey ?? "missing");
        await held;
      },
    };
    const first = new AgentScheduler(
      () => Promise.resolve([scope]),
      capacity,
      () => undefined,
    );
    const second = new AgentScheduler(
      () => Promise.resolve([scope]),
      capacity,
      () => undefined,
    );
    await first.turn();
    await second.turn();
    await Promise.resolve();
    expect(runs).toEqual(["same"]);
    if (release === undefined) throw new Error("Expected first claim gate.");
    release();
    await first.close();
    await second.close();
  });
});
