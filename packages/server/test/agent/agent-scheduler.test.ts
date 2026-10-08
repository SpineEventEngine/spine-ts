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
import { Time } from "@spine-event-engine/core";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentInvocationKeySchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { CommandIdSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import {
  AgentScheduler,
  type AgentScanScope,
  type AgentScopeSource,
} from "../../src/agent/agent-scheduler.js";
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

function source(scopes: readonly AgentScanScope[]): AgentScopeSource {
  return {
    repositories: 1,
    page: () =>
      Promise.resolve({
        ids: scopes.map((_, index) =>
          create(TenantIdSchema, {
            kind: { case: "value", value: String(index) },
          }),
        ),
        hasMore: false,
      }),
    scope: (tenant) => {
      if (tenant.kind.case !== "value") throw new Error("Expected indexed test tenant.");
      const selected = scopes[Number(tenant.kind.value)];
      if (selected === undefined) throw new Error("Missing indexed test scope.");
      return selected;
    },
  };
}

async function ready(scheduler: AgentScheduler): Promise<void> {
  await scheduler.turn();
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

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
      source([scope]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
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
          records: ["A", "B", "C"].filter((name) => !seen.includes(name)).map(record),
          hasMore: false,
        }),
      run: async (key) => {
        const name = key.scope?.agentKey ?? "missing";
        seen.push(name);
        if (name === "A") await held;
      },
    };
    const scheduler = new AgentScheduler(
      source([scope]),
      new AgentExecutionCapacity(1, 1),
      () => undefined,
    );
    await ready(scheduler);
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
      source([scope]),
      new AgentExecutionCapacity(1, 0),
      (error) => {
        errors.push(error);
      },
    );
    await ready(scheduler);
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
      source(scopes),
      new AgentExecutionCapacity(2, 0),
      () => undefined,
    );
    await ready(scheduler);
    await scheduler.turn();
    await scheduler.turn();
    await scheduler.close();
    expect(visited).toEqual(["scope-0", "scope-1", "scope-2", "scope-3", "scope-4", "scope-5"]);
  });

  it("pages a large catalog lazily and promptly visits newly accepted work", async () => {
    const visited: number[] = [];
    let enumerations = 0;
    let constructed = 0;
    const large: AgentScopeSource = {
      repositories: 1,
      page: (after) => {
        enumerations += 1;
        const start = (after as { readonly index?: number } | undefined)?.index ?? 0;
        const end = Math.min(10_000, start + 16);
        return Promise.resolve({
          ids: Array.from({ length: end - start }, (_, offset) =>
            create(TenantIdSchema, {
              kind: { case: "value", value: String(start + offset) },
            }),
          ),
          ...(end < 10_000
            ? { after: { [Symbol.toStringTag]: "TenantCatalogCursor" as const, index: end } }
            : {}),
          hasMore: end < 10_000,
        });
      },
      scope: (tenant) => {
        constructed += 1;
        if (tenant.kind.case !== "value") throw new Error("Expected named tenant.");
        const index = Number(tenant.kind.value);
        return {
          id: `tenant-${String(index)}`,
          pending: () => {
            visited.push(index);
            return Promise.resolve({ records: [], hasMore: false });
          },
          run: () => Promise.resolve(),
        };
      },
    };
    const scheduler = new AgentScheduler(large, new AgentExecutionCapacity(2, 0), () => undefined);
    await ready(scheduler);
    await scheduler.turn();
    await scheduler.turn();
    expect(enumerations).toBe(1);
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(constructed).toBe(8);
    scheduler.wake(
      large.scope(create(TenantIdSchema, { kind: { case: "value", value: "9999" } }), 0),
    );
    await scheduler.turn();
    expect(visited).toContain(9_999);
    expect(visited).toContain(8);
    expect(constructed).toBeLessThanOrEqual(13);
    await scheduler.close();
  });

  it("expands multiple repositories lazily for each tenant page", async () => {
    const visited: string[] = [];
    let constructed = 0;
    const scheduler = new AgentScheduler(
      {
        repositories: 3,
        page: () =>
          Promise.resolve({
            ids: ["one", "two", "three"].map((value) =>
              create(TenantIdSchema, {
                kind: { case: "value", value },
              }),
            ),
            hasMore: false,
          }),
        scope: (tenant, repository) => {
          if (tenant.kind.case !== "value") throw new Error("Expected value tenant.");
          const id = `${tenant.kind.value}:${String(repository)}`;
          constructed += 1;
          return {
            id,
            pending: () => {
              visited.push(id);
              return Promise.resolve({ records: [], hasMore: false });
            },
            run: () => Promise.resolve(),
          };
        },
      },
      new AgentExecutionCapacity(2, 0),
      () => undefined,
    );
    await ready(scheduler);
    await scheduler.turn();
    expect(constructed).toBe(4);
    for (let turn = 0; turn < 4 && visited.length < 9; turn += 1) await scheduler.turn();
    expect(visited).toEqual([
      "one:0",
      "one:1",
      "one:2",
      "two:0",
      "two:1",
      "two:2",
      "three:0",
      "three:1",
      "three:2",
    ]);
    expect(constructed).toBe(9);
    await scheduler.close();
  });

  it("retains an urgent continuing page when capacity delays later records", async () => {
    const seen: string[] = [];
    const afters: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cursor = {
      asOf: create(TimestampSchema, { seconds: 10n }),
      key: {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "B" }),
        eligibleAt: create(TimestampSchema, { seconds: 9n }),
      },
    };
    const scope: AgentScanScope = {
      id: "urgent-continuing",
      pending: (after) => {
        afters.push(after === undefined ? "start" : "B");
        return Promise.resolve(
          after === undefined
            ? {
                records: [record("A"), record("B")].filter(
                  (entry) => !seen.includes(entry.accepted?.key?.scope?.agentKey ?? "missing"),
                ),
                after: cursor,
                hasMore: true,
              }
            : { records: [record("C")], hasMore: false },
        );
      },
      run: async (key) => {
        const name = key.scope?.agentKey ?? "missing";
        seen.push(name);
        if (name === "A") await held;
      },
    };
    const capacity = new AgentExecutionCapacity(1, 0);
    const scheduler = new AgentScheduler(source([]), capacity, () => undefined);
    await ready(scheduler);
    scheduler.wake(scope);
    await scheduler.turn();
    for (let tick = 0; tick < 8 && seen.length === 0; tick += 1) await Promise.resolve();
    expect(seen).toEqual(["A"]);
    release?.();
    for (let tick = 0; tick < 20 && capacity.full(); tick += 1) await Promise.resolve();
    for (let turn = 0; turn < 6 && !seen.includes("C"); turn += 1) {
      await scheduler.turn();
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    }
    expect(seen).toEqual(["A", "B", "C"]);
    expect(afters).toEqual(expect.arrayContaining(["start", "start", "B"]));
    await scheduler.close();
  });

  it("visits a new accepted tenant even when the retained catalog is empty", async () => {
    let enumerations = 0;
    let targeted = 0;
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: () => {
          enumerations += 1;
          return Promise.resolve({ ids: [], hasMore: false });
        },
        scope: () => {
          throw new Error("Empty catalog has no periodic scope.");
        },
      },
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
    await scheduler.turn();
    scheduler.wake({
      id: "new-tenant",
      pending: () => {
        targeted += 1;
        return Promise.resolve({ records: [], hasMore: false });
      },
      run: () => Promise.resolve(),
    });
    await scheduler.turn();
    expect(enumerations).toBe(1);
    expect(targeted).toBe(1);
    await scheduler.close();
  });

  it("continues catalog discovery with one execution slot and sustained accepted wakes", async () => {
    const seen: string[] = [];
    let releaseCatalog:
      | ((page: {
          ids: ReturnType<typeof create<typeof TenantIdSchema>>[];
          hasMore: false;
        }) => void)
      | undefined;
    const catalog = new Promise<{
      ids: ReturnType<typeof create<typeof TenantIdSchema>>[];
      hasMore: false;
    }>((resolve) => {
      releaseCatalog = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sweep: AgentScanScope = {
      id: "recovery",
      pending: () =>
        Promise.resolve({
          records: seen.includes("recovery") ? [] : [record("recovery")],
          hasMore: false,
        }),
      run: () => {
        seen.push("recovery");
        return Promise.resolve();
      },
    };
    const capacity = new AgentExecutionCapacity(1, 0);
    const scheduler = new AgentScheduler(
      { ...source([sweep]), page: () => catalog },
      capacity,
      () => undefined,
    );
    await scheduler.turn();
    const accepted = (index: number): AgentScanScope => ({
      id: `accepted-${String(index)}`,
      pending: () => Promise.resolve({ records: [record(String(index))], hasMore: false }),
      run: async () => {
        seen.push(`accepted-${String(index)}`);
        if (index === 0) await held;
      },
    });
    scheduler.wake(accepted(0));
    await scheduler.turn();
    expect(seen).toEqual(["accepted-0"]);
    releaseCatalog?.({
      ids: [create(TenantIdSchema, { kind: { case: "value", value: "0" } })],
      hasMore: false,
    });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await scheduler.turn();
    expect(seen).toEqual(["accepted-0"]);
    releaseFirst?.();
    for (let index = 0; index < 20 && capacity.full(); index += 1) await Promise.resolve();
    expect(capacity.full()).toBe(false);
    scheduler.wake(accepted(1));
    await scheduler.turn();
    for (let index = 0; index < 8 && !seen.includes("recovery"); index += 1)
      await Promise.resolve();
    expect(seen).toContain("recovery");
    await scheduler.close();
  });

  it("refreshes the catalog after provider time advances despite a retained sweep", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const prior = Time.setProvider({ currentTime: () => now });
    let enumerations = 0;
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: () => {
          enumerations += 1;
          return Promise.resolve({ ids: [], hasMore: false });
        },
        scope: () => {
          throw new Error("Empty catalog has no periodic scope.");
        },
      },
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    try {
      await ready(scheduler);
      await scheduler.turn();
      now = create(TimestampSchema, { seconds: 104n });
      await scheduler.turn();
      expect(enumerations).toBe(1);
      now = create(TimestampSchema, { seconds: 105n });
      await scheduler.turn();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
      expect(enumerations).toBe(2);
    } finally {
      await scheduler.close();
      Time.setProvider(prior);
    }
  });

  it("finishes a long sweep before refreshing and retries a transient page at its continuation", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const prior = Time.setProvider({ currentTime: () => now });
    const token = { [Symbol.toStringTag]: "TenantCatalogCursor" as const };
    const afters: (string | undefined)[] = [];
    let failed = false;
    const seen: string[] = [];
    const scopeAt = (index: number): AgentScanScope => ({
      id: `tenant-${String(index)}`,
      pending: () => {
        seen.push(String(index));
        return Promise.resolve({ records: [], hasMore: false });
      },
      run: () => Promise.resolve(),
    });
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: (after) => {
          afters.push(after === undefined ? undefined : "continued");
          if (after !== undefined && !failed) {
            failed = true;
            return Promise.reject(new Error("Transient tenant catalog failure."));
          }
          const start = after === undefined ? 0 : 16;
          return Promise.resolve({
            ids: Array.from({ length: 16 }, (_, offset) =>
              create(TenantIdSchema, {
                kind: { case: "value", value: String(start + offset) },
              }),
            ),
            ...(start === 0 ? { after: token } : {}),
            hasMore: start === 0,
          });
        },
        scope: (tenant) => {
          if (tenant.kind.case !== "value") throw new Error("Expected value tenant.");
          return scopeAt(Number(tenant.kind.value));
        },
      },
      new AgentExecutionCapacity(2, 0),
      () => undefined,
    );
    try {
      await ready(scheduler);
      now = create(TimestampSchema, { seconds: 110n });
      for (let turn = 0; turn < 40 && seen.length < 32; turn += 1) {
        await scheduler.turn();
        for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
      }
      expect(seen).toEqual(Array.from({ length: 32 }, (_, index) => String(index)));
      expect(afters.slice(0, 3)).toEqual([undefined, "continued", "continued"]);
      expect(afters.filter((after) => after === undefined)).toHaveLength(1);
      for (
        let turn = 0;
        turn < 4 && afters.filter((after) => after === undefined).length < 2;
        turn += 1
      ) {
        await scheduler.turn();
        for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
      }
      expect(afters.filter((after) => after === undefined).length).toBeGreaterThan(1);
    } finally {
      await scheduler.close();
      Time.setProvider(prior);
    }
  });

  it("retries an unavailable catalog on the periodic cadence", async () => {
    let requests = 0;
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: () => {
          requests += 1;
          return Promise.reject(new Error("Catalog temporarily unavailable."));
        },
        scope: () => {
          throw new Error("No catalog page succeeded.");
        },
      },
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await scheduler.turn();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requests).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(requests).toBeLessThanOrEqual(3);
    await scheduler.close();
  });

  it("rejects a nonadvancing pending cursor and an oversized provider page", async () => {
    const cursor = {
      asOf: create(TimestampSchema, { seconds: 10n }),
      key: {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "same" }),
        eligibleAt: create(TimestampSchema, { seconds: 9n }),
      },
    };
    let reads = 0;
    const scheduler = new AgentScheduler(
      source([
        {
          id: "malformed-pending",
          pending: () => {
            reads += 1;
            if (reads === 1)
              return Promise.resolve({ records: [record("first")], after: cursor, hasMore: true });
            return Promise.resolve({ records: [record("second")], after: cursor, hasMore: true });
          },
          run: () => Promise.resolve(),
        },
      ]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
    await scheduler.turn();
    await expect(scheduler.turn()).rejects.toThrow(/nonadvancing/);
    await scheduler.close();

    const oversized = new AgentScheduler(
      source([
        {
          id: "oversized-pending",
          pending: () =>
            Promise.resolve({
              records: Array.from({ length: 17 }, (_, i) => record(String(i))),
              hasMore: false,
            }),
          run: () => Promise.resolve(),
        },
      ]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(oversized);
    await expect(oversized.turn()).rejects.toThrow(/bounded page size/);
    await oversized.close();
  });

  it("rejects a pending continuation that changes its fixed sweep cutoff", async () => {
    let reads = 0;
    const cursor = (seconds: bigint) => ({
      asOf: create(TimestampSchema, { seconds }),
      key: {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "same" }),
        eligibleAt: create(TimestampSchema, { seconds: 9n }),
      },
    });
    const scheduler = new AgentScheduler(
      source([
        {
          id: "changed-cutoff",
          pending: () =>
            Promise.resolve({
              records: [],
              after: cursor(++reads === 1 ? 10n : 11n),
              hasMore: true,
            }),
          run: () => Promise.resolve(),
        },
      ]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
    await scheduler.turn();
    await expect(scheduler.turn()).rejects.toThrow(/nonadvancing/);
    await scheduler.close();
  });

  it("rejects oversized and uncontinuable catalog pages", async () => {
    const identity = create(TenantIdSchema, { kind: { case: "value", value: "one" } });
    const pages = [
      { ids: Array.from({ length: 17 }, () => identity), hasMore: false },
      { ids: [identity], hasMore: true },
    ];
    for (const page of pages) {
      const scheduler = new AgentScheduler(
        {
          repositories: 1,
          page: () => Promise.resolve(page),
          scope: () => {
            throw new Error("Malformed page must not construct a scope.");
          },
        },
        new AgentExecutionCapacity(1, 0),
        () => undefined,
      );
      await scheduler.turn();
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
      await expect(scheduler.turn()).rejects.toThrow(/invalid bounded page/);
      await scheduler.close();
    }
  });

  it("rejects a catalog page that repeats its provider continuation", async () => {
    const cursor = { [Symbol.toStringTag]: "TenantCatalogCursor" as const };
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: () => Promise.resolve({ ids: [], after: cursor, hasMore: true }),
        scope: () => {
          throw new Error("Empty catalog page has no scope.");
        },
      },
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await scheduler.turn();
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    await scheduler.turn();
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    await expect(scheduler.turn()).rejects.toThrow(/nonadvancing continuation/);
    await scheduler.close();
  });

  it("runs an accepted wake while catalog I/O hangs and ignores its late result after close", async () => {
    let settleCatalog:
      | ((page: {
          ids: ReturnType<typeof create<typeof TenantIdSchema>>[];
          hasMore: false;
        }) => void)
      | undefined;
    const catalog = new Promise<{
      ids: ReturnType<typeof create<typeof TenantIdSchema>>[];
      hasMore: false;
    }>((resolve) => {
      settleCatalog = resolve;
    });
    let requests = 0;
    const seen: string[] = [];
    const scheduler = new AgentScheduler(
      {
        repositories: 1,
        page: () => {
          requests += 1;
          return catalog;
        },
        scope: () => ({
          id: "late-periodic",
          pending: () => {
            throw new Error("Late catalog must not schedule a read.");
          },
          run: () => Promise.resolve(),
        }),
      },
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await scheduler.turn();
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
    scheduler.wake({
      id: "accepted-during-catalog-read",
      pending: () => Promise.resolve({ records: [record("accepted")], hasMore: false }),
      run: (key) => {
        seen.push(key.scope?.agentKey ?? "missing");
        return Promise.resolve();
      },
    });
    await scheduler.turn();
    for (let tick = 0; tick < 8 && seen.length === 0; tick += 1) await Promise.resolve();
    expect(seen).toEqual(["accepted"]);
    await scheduler.close();
    settleCatalog?.({
      ids: [create(TenantIdSchema, { kind: { case: "value", value: "late" } })],
      hasMore: false,
    });
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    await scheduler.turn();
    expect(requests).toBe(1);
    expect(seen).toEqual(["accepted"]);
  });

  it("detaches a hung pending read on close and ignores its late rejection", async () => {
    let rejectPending: ((reason: Error) => void) | undefined;
    const pending = new Promise<{ records: ReturnType<typeof record>[]; hasMore: false }>(
      (_, reject) => {
        rejectPending = reject;
      },
    );
    let runs = 0;
    const scheduler = new AgentScheduler(
      source([
        {
          id: "hung-pending",
          pending: () => pending,
          run: () => {
            runs += 1;
            return Promise.resolve();
          },
        },
      ]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
    const scan = scheduler.turn();
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
    await scheduler.close();
    await expect(scan).rejects.toThrow(/discovery stopped/);
    rejectPending?.(new Error("Late provider failure."));
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    expect(runs).toBe(0);
  });

  it("ignores a pending page that resolves after close", async () => {
    let resolvePending:
      ((page: { records: ReturnType<typeof record>[]; hasMore: false }) => void) | undefined;
    const pending = new Promise<{ records: ReturnType<typeof record>[]; hasMore: false }>(
      (resolve) => {
        resolvePending = resolve;
      },
    );
    let runs = 0;
    const scheduler = new AgentScheduler(
      source([
        {
          id: "late-pending",
          pending: () => pending,
          run: () => {
            runs += 1;
            return Promise.resolve();
          },
        },
      ]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
    const scan = scheduler.turn();
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
    await scheduler.close();
    await expect(scan).rejects.toThrow(/discovery stopped/);
    resolvePending?.({ records: [record("late")], hasMore: false });
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    await scheduler.turn();
    expect(runs).toBe(0);
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
      source([scope]),
      new AgentExecutionCapacity(1, 0),
      () => undefined,
    );
    await ready(scheduler);
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
    const first = new AgentScheduler(source([scope]), capacity, () => undefined);
    const second = new AgentScheduler(source([scope]), capacity, () => undefined);
    await ready(first);
    await ready(second);
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
