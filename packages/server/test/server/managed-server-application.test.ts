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

import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { ManagedServerApplication } from "../../src/index.js";
import { ManagedServerCoordinator } from "../../src/server/managed-server-application.js";

class FakeClock {
  #now = 0;
  readonly delays: number[] = [];
  readonly #timers = new Map<number, { readonly at: number; readonly action: () => void }>();
  #nextTimer = 0;

  now(): number {
    return this.#now;
  }

  setTimeout(action: () => void, delay: number): number {
    const timer = this.#nextTimer++;
    this.delays.push(delay);
    this.#timers.set(timer, { at: this.#now + delay, action });
    return timer;
  }

  clearTimeout(timer: number): void {
    this.#timers.delete(timer);
  }

  advance(delay: number): void {
    this.#now += delay;
    for (const [timer, pending] of [...this.#timers]) {
      if (pending.at > this.#now) continue;
      this.#timers.delete(timer);
      pending.action();
    }
  }
}

const fakeChild = (pid: number): ChildProcess =>
  Object.assign(new EventEmitter(), {
    pid,
    connected: true,
    exitCode: null,
    signalCode: null,
    send: vi.fn(),
  }) as unknown as ChildProcess;

describe("ManagedServerApplication", () => {
  it("delays repeated failed replacements exponentially and caps the delay", async () => {
    const clock = new FakeClock();
    const spawned: {
      readonly child: ChildProcess;
      readonly slot: number;
      readonly incarnation: string;
    }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not used")),
        restart: { initialDelayMs: 2, maximumDelayMs: 5, healthyReadyMs: 100, concurrentStarts: 1 },
      },
      {
        clock,
        spawn: (_moduleUrl, slot, incarnation) => {
          const child = fakeChild(spawned.length + 1);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    let current = spawned[0];
    current.child.emit("message", {
      type: "ready",
      slot: String(current.slot),
      incarnation: current.incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    const handle = await started;
    for (const expectedDelay of [2, 4, 5]) {
      current.child.emit("exit");
      expect(clock.delays.at(-1)).toBe(expectedDelay);
      clock.advance(expectedDelay);
      const replacement = spawned.at(-1);
      if (replacement === undefined) throw new Error("Replacement did not start.");
      current = replacement;
      current.child.emit("message", {
        type: "ready",
        slot: String(current.slot),
        incarnation: current.incarnation,
        endpoint: "http://127.0.0.1:2",
      });
    }
    clock.advance(100);
    current.child.emit("exit");
    expect(clock.delays.at(-1)).toBe(2);
    (current.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      current.child.emit("exit");
      return true;
    });
    await handle.close();
  });

  it("remains alive but unready at zero ready children and ignores malformed READY facts", async () => {
    const clock = new FakeClock();
    const spawned: {
      readonly child: ChildProcess;
      readonly slot: number;
      readonly incarnation: string;
    }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not used")),
        restart: { initialDelayMs: 2, maximumDelayMs: 2, healthyReadyMs: 10, concurrentStarts: 1 },
      },
      {
        clock,
        spawn: (_moduleUrl, slot, incarnation) => {
          const child = fakeChild(spawned.length + 1);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    const first = spawned[0];
    first.child.emit("message", null);
    first.child.emit("message", {
      type: "ready",
      slot: "wrong",
      incarnation: "wrong",
      endpoint: 1,
    });
    expect(spawned).toHaveLength(1);
    first.child.emit("message", {
      type: "ready",
      slot: String(first.slot),
      incarnation: first.incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    const handle = await started;
    first.child.emit("exit");
    expect(handle.ready).toBe(false);
    clock.advance(2);
    const replacement = spawned[1];
    first.child.emit("exit");
    expect(clock.delays).toHaveLength(1);
    replacement.child.emit("message", {
      type: "ready",
      slot: String(replacement.slot),
      incarnation: replacement.incarnation,
      endpoint: "http://127.0.0.1:2",
    });
    expect(handle.ready).toBe(true);
    (replacement.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      replacement.child.emit("exit");
      return true;
    });
    const firstClose = coordinator.close();
    const secondClose = coordinator.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(handle.childPids).toEqual([]);
    expect(handle.childEndpoints).toEqual([]);
  });

  it("limits concurrent starts while admitting every initial logical slot", async () => {
    const clock = new FakeClock();
    const spawned: {
      readonly child: ChildProcess;
      readonly slot: number;
      readonly incarnation: string;
    }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 2,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not used")),
        restart: { concurrentStarts: 1 },
      },
      {
        clock,
        spawn: (_moduleUrl, slot, incarnation) => {
          const child = fakeChild(spawned.length + 1);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    expect(spawned).toHaveLength(1);
    for (const index of [0, 1]) {
      const current = spawned[index];
      current.child.emit("message", {
        type: "ready",
        slot: String(current.slot),
        incarnation: current.incarnation,
        endpoint: `http://127.0.0.1:${String(index + 1)}`,
      });
      if (index === 0) expect(spawned).toHaveLength(2);
    }
    await started;
    for (const current of spawned) {
      (current.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        current.child.emit("exit");
        return true;
      });
    }
    await coordinator.close();
  });

  it("replaces a child which exits before READY without abandoning initial readiness", async () => {
    const clock = new FakeClock();
    const spawned: {
      readonly child: ChildProcess;
      readonly slot: number;
      readonly incarnation: string;
    }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not used")),
        restart: { initialDelayMs: 2, maximumDelayMs: 2 },
      },
      {
        clock,
        spawn: (_moduleUrl, slot, incarnation) => {
          const child = fakeChild(spawned.length + 1);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    spawned[0].child.emit("exit");
    expect(clock.delays).toEqual([2]);
    clock.advance(2);
    const replacement = spawned[1];
    replacement.child.emit("message", {
      type: "ready",
      slot: String(replacement.slot),
      incarnation: replacement.incarnation,
      endpoint: "http://127.0.0.1:2",
    });
    const handle = await started;
    (replacement.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      replacement.child.emit("exit");
      return true;
    });
    await handle.close();
  });

  it("keeps replacing after a synchronous child-start failure", async () => {
    const clock = new FakeClock();
    const spawned: {
      readonly child: ChildProcess;
      readonly slot: number;
      readonly incarnation: string;
    }[] = [];
    let starts = 0;
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not used")),
        restart: { initialDelayMs: 2, maximumDelayMs: 2 },
      },
      {
        clock,
        spawn: (_moduleUrl, slot, incarnation) => {
          starts++;
          if (starts === 1) throw new Error("fork failed");
          const child = fakeChild(starts);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    expect(clock.delays).toEqual([2]);
    clock.advance(2);
    const replacement = spawned[0];
    replacement.child.emit("message", {
      type: "ready",
      slot: String(replacement.slot),
      incarnation: replacement.incarnation,
      endpoint: "http://127.0.0.1:2",
    });
    const handle = await started;
    (replacement.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      replacement.child.emit("exit");
      return true;
    });
    await handle.close();
  });
  it("sends a child READY fact only after local assembly and synchronization", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const priorSlot = process.env.SPINE_MANAGED_SERVER_SLOT;
    const priorIncarnation = process.env.SPINE_MANAGED_SERVER_INCARNATION;
    const priorListeners = new Set(process.listeners("message"));
    const send = vi.spyOn(process, "send").mockImplementation((_message, callback) => {
      callback(null);
      return true;
    });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    process.env.SPINE_MANAGED_SERVER_SLOT = "0";
    process.env.SPINE_MANAGED_SERVER_INCARNATION = "incarnation";
    const close = vi.fn(() => Promise.resolve());
    try {
      const handle = await ManagedServerApplication.run({
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () =>
          Promise.resolve({ host: "127.0.0.1", port: 42, baseUrl: "http://127.0.0.1:42", close }),
        synchronizationGates: [Promise.resolve()],
      });
      expect(send).toHaveBeenCalledWith(
        { type: "ready", slot: "0", incarnation: "incarnation", endpoint: "http://127.0.0.1:42" },
        expect.any(Function),
      );
      await handle.close();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      send.mockRestore();
      for (const listener of process.listeners("message")) {
        if (!priorListeners.has(listener)) process.off("message", listener);
      }
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
      if (priorSlot === undefined) delete process.env.SPINE_MANAGED_SERVER_SLOT;
      else process.env.SPINE_MANAGED_SERVER_SLOT = priorSlot;
      if (priorIncarnation === undefined) delete process.env.SPINE_MANAGED_SERVER_INCARNATION;
      else process.env.SPINE_MANAGED_SERVER_INCARNATION = priorIncarnation;
    }
  });

  it("rejects a child start when its private parent IPC rejects READY", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const send = vi.spyOn(process, "send").mockImplementation((_message, callback) => {
      callback(new Error("closed"));
      return false;
    });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    try {
      await expect(
        ManagedServerApplication.run({
          processCount: 1,
          moduleUrl: import.meta.url,
          host: "127.0.0.1",
          port: 0,
          createServer: () =>
            Promise.resolve({
              host: "127.0.0.1",
              port: 42,
              baseUrl: "http://127.0.0.1:42",
              close: () => Promise.resolve(),
            }),
        }),
      ).rejects.toThrow("closed");
    } finally {
      send.mockRestore();
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });
  it("starts one separate complete child for an explicit single-replica cohort", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(managed.ready).toBe(true);
      expect(managed.childPids).toHaveLength(1);
      expect(managed.childPids[0]).not.toBe(process.pid);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("starts four distinct child processes for one managed cohort", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 4,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(new Set(managed.childPids).size).toBe(4);
      expect(managed.childPids).not.toContain(process.pid);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("reports each child's actual local listener only after that child is ready", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(managed.childEndpoints).toEqual([
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      ]);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("waits for child-local synchronization before admitting its private listener", async () => {
    const startedAt = Date.now();
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      moduleUrl: new URL("./managed-server-application-gated-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
      expect(managed.childEndpoints).toHaveLength(1);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("replaces only the unexpected child exit and retains its surviving sibling", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 2,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      const [failed, survivor] = managed.childPids;
      process.kill(failed, "SIGKILL");
      await expect.poll(() => managed.childPids.includes(survivor), { timeout: 10_000 }).toBe(true);
      await expect
        .poll(() => managed.childPids.some((pid) => pid !== failed && pid !== survivor), {
          timeout: 10_000,
        })
        .toBe(true);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it.each([
    { initialDelayMs: 0 },
    { maximumDelayMs: 1, initialDelayMs: 2 },
    { healthyReadyMs: Number.POSITIVE_INFINITY },
    { concurrentStarts: 2 },
  ])("rejects invalid bounded restart settings %o", async (restart) => {
    await expect(
      ManagedServerApplication.run({
        processCount: 1,
        moduleUrl: import.meta.url,
        host: "127.0.0.1",
        port: 0,
        createServer: () => Promise.reject(new Error("not reached")),
        restart,
      }),
    ).rejects.toThrow("restart");
  });

  it("does not restart a child that the managed cohort closes", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      host: "127.0.0.1",
      port: 0,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
      restart: { initialDelayMs: 1, maximumDelayMs: 1, healthyReadyMs: 1 },
    });
    await managed.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(managed.childPids).toEqual([]);
  }, 20_000);
  it.each([undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid explicit process count %s without deriving a machine default",
    async (processCount) => {
      await expect(
        ManagedServerApplication.run({
          processCount: processCount as unknown as number,
          moduleUrl: import.meta.url,
          host: "127.0.0.1",
          port: 0,
          createServer: () =>
            Promise.resolve({
              host: "127.0.0.1",
              port: 1,
              baseUrl: "http://127.0.0.1:1",
              close: () => Promise.resolve(),
            }),
        }),
      ).rejects.toThrow("processCount");
    },
  );
});
