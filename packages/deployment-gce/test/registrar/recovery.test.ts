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

/* eslint-disable @typescript-eslint/require-await -- Structural registry and Gateway fixtures expose
 * asynchronous contract methods without awaiting. */

import { ApplicationNode } from "@spine-event-engine/deployment";
import { describe, expect, it, vi } from "vitest";

import { GceRegistrar } from "../../src/index.js";

describe("GceRegistrar recovery", () => {
  it("warns once when an active renewal fails and schedules a retry", async () => {
    const ticks: (() => void)[] = [];
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const registrar = new GceRegistrar({
      registry: {
        register: async () => true,
        renew: async () => Promise.reject(new Error("temporary registry failure")),
        cleanup: async () => 0,
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      logger: logger as never,
      scheduler: { schedule: (_delay, tick) => (ticks.push(tick), () => undefined) },
    });

    await registrar.start();
    ticks.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "deployment.gce.registrar.renew",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("deployment.gce.registrar.renew_failed");
    await registrar.close();
  });

  it("confirms a lost initial write through the same owner before renewing", async () => {
    const ticks: (() => void)[] = [];
    let scheduleCount = 0;
    let secondScheduled: (() => void) | undefined;
    const secondScheduledPromise = new Promise<void>((done) => (secondScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanupPromise = new Promise<void>((done) => (cleanupDone = done));
    let renewDone: (() => void) | undefined;
    const renewPromise = new Promise<void>((done) => (renewDone = done));
    const calls: string[] = [];
    const registry = {
      register: async () => {
        calls.push("register");
        throw new Error("lost response");
      },
      lookup: async () => (
        calls.push("lookup"),
        {
          registrationId: "owner",
          expiresAt: 100,
          node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
        }
      ),
      renew: async () => (calls.push("renew"), renewDone?.(), true),
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          ticks.push(onTick),
          (scheduleCount += 1) === 2 && secondScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await cleanupPromise;
    expect(calls).toEqual(["register", "lookup", "cleanup"]);
    await secondScheduledPromise;
    ticks.shift()?.();
    await renewPromise;
    expect(calls).toEqual(["register", "lookup", "cleanup", "renew"]);
    await registrar.close();
  });

  it.each([
    ["absent", undefined],
    ["expired", undefined],
    ["other owner", { registrationId: "other", expiresAt: 100 }],
  ])("retries one same-identity registration when lookup is %s", async (_name, lookup) => {
    const ticks: (() => void)[] = [];
    const identities: string[] = [];
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let attempts = 0;
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        attempts += 1;
        if (attempts === 1) throw new Error("lost response");
        return true;
      },
      lookup: async () =>
        lookup === undefined
          ? undefined
          : { ...lookup, node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }) },
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      now: () => 1,
      scheduler: { schedule: (_delay, onTick) => (ticks.push(onTick), () => undefined) },
    });
    await registrar.start();
    ticks.shift()?.();
    await cleanup;
    expect(identities).toEqual(["owner", "owner"]);
    await registrar.close();
  });

  it("recovers metadata on one scheduled retry without duplicating timers", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const secondScheduledPromise = new Promise<void>((done) => (secondScheduled = done));
    let reads = 0;
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const metadata = {
      read: async () => {
        reads += 1;
        if (reads === 1) throw new Error("metadata unavailable");
        return { projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" };
      },
    };
    const calls: string[] = [];
    const registry = {
      lookup: async () => undefined,
      register: async () => (calls.push("register"), true),
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      metadata,
      port: 8080,
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    expect(schedules).toBe(1);
    ticks.shift()?.();
    await cleanup;
    expect(calls).toEqual(["register", "cleanup"]);
    await secondScheduledPromise;
    expect(schedules).toBe(2);
    await registrar.close();
  });

  it("recovers a failed ownership lookup on the next scheduled tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let lookupCalls = 0;
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const identities: string[] = [];
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        if (identities.length === 1) throw new Error("lost");
        return true;
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls === 1) throw new Error("read failed");
        return undefined;
      },
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(identities).toEqual(["owner", "owner"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed conditional registration on the next retry", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const identities: string[] = [];
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        if (identities.length < 3) throw new Error("write failed");
        return true;
      },
      lookup: async () => undefined,
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(identities).toEqual(["owner", "owner", "owner"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed confirmed renewal on the next tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let renews = 0;
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: async () => {
        renews += 1;
        calls.push("renew");
        if (renews === 1) throw new Error("renew failed");
        return true;
      },
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    expect(calls).toEqual(["renew"]);
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(calls).toEqual(["renew", "renew", "cleanup"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed cleanup on the next tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let cleanups = 0;
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: async () => (calls.push("renew"), true),
      cleanup: async () => {
        cleanups += 1;
        calls.push("cleanup");
        if (cleanups === 1) throw new Error("cleanup failed");
        cleanupDone?.();
        return 0;
      },
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(calls).toEqual(["renew", "cleanup", "renew", "cleanup"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });
});
