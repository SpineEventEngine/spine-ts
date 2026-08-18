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
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { CommandService } from "@spine-event-engine/proto/client";

import {
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  type RunningServer,
} from "../../src/index.js";
import {
  ManagedServerCoordinator,
  managedServerApplicationAccess,
  managedServerCoordinatorAccess,
} from "../../src/server/managed-server-application.js";

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

const itemAt = <T>(values: readonly T[], index: number, description: string): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`Expected ${description}.`);
  return value;
};

const localRunningServer = (close: () => Promise<void>, port = 42): RunningServer => {
  const server: RunningServer = {
    host: "127.0.0.1",
    port,
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close,
  };
  managedServerApplicationAccess.installRegistriesForTest(server, [
    new InMemorySubscriptionRegistry(),
  ]);
  return server;
};

function managedRegistryChild(registry?: "memory" | "custom"): ChildProcess {
  return fork(
    fileURLToPath(new URL("./managed-server-subscription-registry-child.mjs", import.meta.url)),
    {
      env: {
        ...process.env,
        SPINE_MANAGED_SERVER_CHILD: "true",
        SPINE_MANAGED_SERVER_SLOT: "0",
        SPINE_MANAGED_SERVER_INCARNATION: "registry-test",
        ...(registry === undefined ? {} : { SPINE_MANAGED_REGISTRY: registry }),
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
}

function childExit(child: ChildProcess): Promise<{ readonly code: number | null }> {
  return new Promise((resolve) => {
    child.once("exit", (code) => {
      resolve({ code });
    });
  });
}

function childStderr(child: ChildProcess): { readonly text: () => string } {
  let output = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { text: () => output };
}

const managedSignalListener = (
  signal: NodeJS.Signals,
  prior: ReadonlySet<NodeJS.SignalsListener>,
): NodeJS.SignalsListener => {
  const listener = process.listeners(signal).find((candidate) => !prior.has(candidate));
  if (listener === undefined) throw new Error(`Expected a managed ${signal} listener.`);
  return listener;
};

const managedMessageListener = (
  prior: ReadonlySet<NodeJS.MessageListener>,
): NodeJS.MessageListener => {
  const listener = process.listeners("message").find((candidate) => !prior.has(candidate));
  if (listener === undefined) throw new Error("Expected a managed message listener.");
  return listener;
};

const managedDisconnectListener = (
  prior: ReadonlySet<NodeJS.DisconnectListener>,
): NodeJS.DisconnectListener => {
  const listener = process.listeners("disconnect").find((candidate) => !prior.has(candidate));
  if (listener === undefined) throw new Error("Expected a managed disconnect listener.");
  return listener;
};

const fakeChild = (pid: number): ChildProcess => {
  const killCalls: string[] = [];
  return Object.assign(new EventEmitter(), {
    pid,
    connected: true,
    exitCode: null,
    signalCode: null,
    send: vi.fn(),
    kill: vi.fn(function (this: EventEmitter, signal: string) {
      killCalls.push(signal);
      this.emit("exit");
      return true;
    }),
    killCalls,
  }) as unknown as ChildProcess;
};

describe("ManagedServerApplication", () => {
  it("keeps private Coordinator membership facts absent for opaque managed handles", () => {
    const opaque = {
      ready: false,
      close: () => Promise.resolve(),
    };

    expect(managedServerApplicationAccess.readyMembers(opaque)).toEqual([]);
    expect(managedServerApplicationAccess.coordinatorEndpoint(opaque)).toBeUndefined();
  });

  it("uses the shared close path for a parent SIGINT", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    const priorSignals = new Set(process.listeners("SIGINT"));
    const priorDisconnect = Object.getOwnPropertyDescriptor(process, "disconnect");
    const disconnect = vi.fn();
    Object.defineProperty(process, "disconnect", { configurable: true, value: disconnect });
    const spawned: { slot: number; incarnation: string }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
      },
      {
        clock,
        spawn: (_url, slot, incarnation) => {
          spawned.push({ slot, incarnation });
          return child;
        },
      },
    );
    try {
      const started = coordinator.start();
      child.emit("message", {
        type: "ready",
        slot: "0",
        incarnation: itemAt(spawned, 0, "the initial replica").incarnation,
        endpoint: "http://127.0.0.1:1",
      });
      await started;
      (child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        child.emit("exit");
        return true;
      });
      managedSignalListener("SIGINT", priorSignals)("SIGINT");
      await Promise.resolve();
      await expect(coordinator.close()).resolves.toBeUndefined();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(process.listeners("SIGINT")).toEqual([...priorSignals]);
    } finally {
      if (priorDisconnect === undefined) delete (process as { disconnect?: unknown }).disconnect;
      else Object.defineProperty(process, "disconnect", priorDisconnect);
    }
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "closes its child when the parent receives %s",
    async (signal) => {
      const parent = fork(
        fileURLToPath(new URL("./managed-server-application-parent.mjs", import.meta.url)),
        [],
        { silent: true },
      );
      const ready = await new Promise<number>((resolve, reject) => {
        parent.once("message", (message: unknown) => {
          if (
            typeof message === "object" &&
            message !== null &&
            (message as { pid?: unknown }).pid !== undefined
          )
            resolve((message as { pid: number }).pid);
          else reject(new Error("Managed parent did not report its child."));
        });
        parent.once("error", reject);
      });
      parent.kill(signal);
      await new Promise<void>((resolve) =>
        parent.once("exit", () => {
          resolve();
        }),
      );
      await expect
        .poll(
          () => {
            try {
              process.kill(ready, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 5_000 },
        )
        .toBe(false);
    },
    20_000,
  );

  it("forwards a command through the managed Coordinator to the child normal service", async () => {
    const parent = fork(
      fileURLToPath(new URL("./managed-server-application-parent.mjs", import.meta.url)),
      [],
      { silent: true },
    );
    try {
      const endpoint = await new Promise<string>((resolve, reject) => {
        parent.once("message", (message: unknown) => {
          const endpoint =
            typeof message === "object" && message !== null
              ? (message as { endpoint?: unknown }).endpoint
              : undefined;
          if (typeof endpoint === "string") resolve(endpoint);
          else reject(new Error("Managed parent did not report its Coordinator endpoint."));
        });
        parent.once("error", reject);
      });
      const response = await createClient(
        CommandService,
        createGrpcTransport({ baseUrl: endpoint }),
      ).post(create(CommandService.method.post.input));
      expect(response.status).toBeDefined();
    } finally {
      parent.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        parent.once("exit", () => {
          resolve();
        });
      });
    }
  }, 20_000);
  it("treats one asynchronous child error and its later exit as one failed incarnation", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
        restart: { initialDelayMs: 2, maximumDelayMs: 2 },
      },
      { clock, spawn: () => child },
    );
    void coordinator.start();
    child.emit("error", new Error("fork channel failed"));
    child.emit("exit", 1);
    expect(clock.delays).toEqual([2, 1_000]);
    clock.advance(2);
    (child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      child.emit("exit");
      return true;
    });
    await coordinator.close();
  });

  it("drains a retired failed child when the coordinator closes", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
        restart: { initialDelayMs: 10_000, maximumDelayMs: 10_000 },
      },
      { clock, spawn: () => child },
    );
    void coordinator.start();
    child.emit("error", new Error("child channel failed"));
    const closing = coordinator.close();
    clock.advance(1_000);
    await closing;
  });

  it("bounds a failed asynchronous child-error termination without blocking replacement", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    const killCalls: string[] = [];
    Object.assign(child, {
      kill: vi.fn((signal: string) => {
        killCalls.push(signal);
        return true;
      }),
    });
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
        restart: { initialDelayMs: 10_000, maximumDelayMs: 10_000 },
      },
      { clock, spawn: () => child },
    );
    void coordinator.start();
    child.emit("error", new Error("child channel failed"));
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(killCalls).toContain("SIGTERM");
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(killCalls).toContain("SIGKILL");
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    const close = coordinator.close();
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    await expect(close).rejects.toThrow("SIGKILL");
    child.emit("exit");
    await expect(coordinator.close()).resolves.toBeUndefined();
  });

  it("shares a failed parent close, bounds it, and retries the remaining child cleanup", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    Object.assign(child, { kill: vi.fn(() => true) });
    const spawned: { slot: number; incarnation: string }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
      },
      {
        clock,
        spawn: (_url, slot, incarnation) => {
          spawned.push({ slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    child.emit("message", {
      type: "ready",
      slot: "0",
      incarnation: itemAt(spawned, 0, "the initial replica").incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    await started;
    const first = coordinator.close();
    expect(coordinator.close()).toBe(first);
    clock.advance(1_000);
    await Promise.resolve();
    clock.advance(1_000);
    await Promise.resolve();
    clock.advance(1_000);
    await Promise.resolve();
    await expect(first).rejects.toThrow("SIGKILL");
    (child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      child.emit("exit");
      return true;
    });
    await expect(coordinator.close()).resolves.toBeUndefined();
  });

  it("reports Coordinator startup and managed-child rollback failures together", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    Object.assign(child, { kill: vi.fn(() => true) });
    const spawned: { slot: number; incarnation: string }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
      },
      {
        clock,
        spawn: (_url, slot, incarnation) => {
          spawned.push({ slot, incarnation });
          return child;
        },
        openCoordinator: () => Promise.reject(new Error("Coordinator listener failed")),
      },
    );
    const failure = coordinator.start().catch((error: unknown) => error);
    child.emit("message", {
      type: "ready",
      slot: "0",
      incarnation: itemAt(spawned, 0, "the initial replica").incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    await Promise.resolve();
    await Promise.resolve();
    for (let attempt = 0; attempt < 3; attempt++) {
      clock.advance(1_000);
      await Promise.resolve();
      await Promise.resolve();
    }
    const error = await failure;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      new Error("Coordinator listener failed"),
      new Error("Managed child did not exit after SIGKILL."),
    ]);
    child.emit("exit");
    await expect(coordinator.close()).resolves.toBeUndefined();
  });

  it("rejects non-canonical, oversized, and stale READY endpoints without retaining them", async () => {
    const clock = new FakeClock();
    const spawned: { child: ChildProcess; slot: number; incarnation: string }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
      },
      {
        clock,
        spawn: (_url, slot, incarnation) => {
          const child = fakeChild(1);
          spawned.push({ child, slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    const first = itemAt(spawned, 0, "the initial replica");
    for (const endpoint of [
      "https://127.0.0.1:1",
      "http://localhost:1",
      "http://127.0.0.1:1/path",
      "http://user@127.0.0.1:1",
      "http://127.0.0.1:0",
      "not-a-url",
      `http://127.0.0.1:1/${"x".repeat(300)}`,
    ]) {
      first.child.emit("message", {
        type: "ready",
        slot: String(first.slot),
        incarnation: first.incarnation,
        endpoint,
      });
    }
    expect(managedServerCoordinatorAccess.readyMembers(coordinator)).toEqual([]);
    first.child.emit("message", {
      type: "ready",
      slot: String(first.slot),
      incarnation: "stale",
      endpoint: "http://127.0.0.1:1",
    });
    expect(managedServerCoordinatorAccess.readyMembers(coordinator)).toEqual([]);
    first.child.emit("message", {
      type: "ready",
      slot: String(first.slot),
      incarnation: first.incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    await started;
    expect(managedServerCoordinatorAccess.readyMembers(coordinator)).toHaveLength(1);
    (first.child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      first.child.emit("exit");
      return true;
    });
    await coordinator.close();
  });

  it("does not start synchronization work in the parent", async () => {
    const synchronize = vi.fn(() => Promise.resolve());
    const clock = new FakeClock();
    const child = fakeChild(1);
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
        synchronize,
      },
      { clock, spawn: () => child },
    );
    void coordinator.start();
    expect(synchronize).not.toHaveBeenCalled();
    (child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      child.emit("exit");
      return true;
    });
    await coordinator.close();
  });

  it("removes a draining child from Coordinator admission before its server closes", async () => {
    const clock = new FakeClock();
    const child = fakeChild(1);
    const spawned: { slot: number; incarnation: string }[] = [];
    const coordinator = new ManagedServerCoordinator(
      {
        processCount: 1,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("unused")),
      },
      {
        clock,
        spawn: (_url, slot, incarnation) => {
          spawned.push({ slot, incarnation });
          return child;
        },
      },
    );
    const started = coordinator.start();
    const replica = itemAt(spawned, 0, "the initial replica");
    child.emit("message", {
      type: "ready",
      slot: String(replica.slot),
      incarnation: replica.incarnation,
      endpoint: "http://127.0.0.1:1",
    });
    await started;
    (child.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      child.emit("message", {
        type: "draining",
        slot: String(replica.slot),
        incarnation: replica.incarnation,
      });
      return true;
    });

    const closing = coordinator.close();

    expect(managedServerCoordinatorAccess.readyMembers(coordinator)).toEqual([]);
    child.emit("exit");
    await closing;
  });
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
    let current = itemAt(spawned, 0, "the initial replica");
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
    const first = itemAt(spawned, 0, "the initial replica");
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
    const replacement = itemAt(spawned, 1, "the replacement replica");
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
    expect(managedServerApplicationAccess.readyMembers(handle).map((member) => member.pid)).toEqual(
      [],
    );
    expect(
      managedServerApplicationAccess.readyMembers(handle).map((member) => member.endpoint),
    ).toEqual([]);
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
      const current = itemAt(spawned, index, "the next replica");
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
    itemAt(spawned, 0, "the initial replica").child.emit("exit");
    expect(clock.delays).toEqual([2]);
    clock.advance(2);
    const replacement = itemAt(spawned, 1, "the replacement replica");
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
    const replacement = itemAt(spawned, 0, "the replacement replica");
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
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    const priorDisconnect = Object.getOwnPropertyDescriptor(process, "disconnect");
    const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    });
    const disconnect = vi.fn();
    Object.defineProperty(process, "send", { configurable: true, value: send });
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    Object.defineProperty(process, "disconnect", { configurable: true, value: disconnect });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    process.env.SPINE_MANAGED_SERVER_SLOT = "0";
    process.env.SPINE_MANAGED_SERVER_INCARNATION = "incarnation";
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("retry child close"))
      .mockResolvedValueOnce(undefined);
    try {
      const handle = await ManagedServerApplication.run({
        processCount: 1,
        port: 50_051,
        moduleUrl: import.meta.url,
        createServer: () => Promise.resolve(localRunningServer(close)),
        synchronize: () => Promise.resolve(),
      });
      expect(send).toHaveBeenCalledWith(
        { type: "ready", slot: "0", incarnation: "incarnation", endpoint: "http://127.0.0.1:42" },
        expect.any(Function),
      );
      await expect(handle.close()).rejects.toThrow("retry child close");
      await expect(handle.close()).resolves.toBeUndefined();
      expect(close).toHaveBeenCalledTimes(2);
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorDisconnect === undefined) delete (process as { disconnect?: unknown }).disconnect;
      else Object.defineProperty(process, "disconnect", priorDisconnect);
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
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(new Error("closed"));
      return false;
    });
    Object.defineProperty(process, "send", { configurable: true, value: send });
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const close = vi.fn(() => Promise.resolve());
    try {
      await expect(
        ManagedServerApplication.run({
          processCount: 1,
          port: 50_051,
          moduleUrl: import.meta.url,
          createServer: () => Promise.resolve(localRunningServer(close)),
        }),
      ).rejects.toThrow("closed");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });

  it("ignores one private control fact before accepting close", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    const priorMessages = new Set(process.listeners("message"));
    const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    });
    Object.defineProperty(process, "send", { configurable: true, value: send });
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const close = vi.fn(() => Promise.resolve());
    try {
      await ManagedServerApplication.run({
        processCount: 1,
        port: 50_051,
        moduleUrl: import.meta.url,
        createServer: () => Promise.resolve(localRunningServer(close)),
      });
      const onMessage = managedMessageListener(priorMessages);
      onMessage({ type: "ignored" }, undefined);
      expect(close).not.toHaveBeenCalled();
      Object.defineProperty(process, "connected", { configurable: true, value: false });
      onMessage({ type: "close" }, undefined);
      await expect.poll(() => close).toHaveBeenCalledOnce();
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });

  it("closes a child when its parent IPC disconnects", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    const priorDisconnect = Object.getOwnPropertyDescriptor(process, "disconnect");
    const priorDisconnects = new Set(process.listeners("disconnect"));
    const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    });
    const disconnect = vi.fn();
    Object.defineProperty(process, "send", { configurable: true, value: send });
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    Object.defineProperty(process, "disconnect", { configurable: true, value: disconnect });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const close = vi.fn(() => Promise.resolve());
    try {
      await ManagedServerApplication.run({
        processCount: 1,
        port: 50_051,
        moduleUrl: import.meta.url,
        createServer: () => Promise.resolve(localRunningServer(close)),
      });
      const onDisconnect = managedDisconnectListener(priorDisconnects);
      onDisconnect();
      process.off("disconnect", onDisconnect);
      await expect.poll(() => close).toHaveBeenCalledOnce();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(process.listeners("disconnect")).toEqual([...priorDisconnects]);
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorDisconnect === undefined) delete (process as { disconnect?: unknown }).disconnect;
      else Object.defineProperty(process, "disconnect", priorDisconnect);
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });

  it.each(["message", "disconnect"] as const)(
    "contains a failed child close triggered by private %s and permits explicit retry",
    async (trigger) => {
      const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
      const priorSend = Object.getOwnPropertyDescriptor(process, "send");
      const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
      const priorDisconnect = Object.getOwnPropertyDescriptor(process, "disconnect");
      const priorMessages = new Set(process.listeners("message"));
      const priorDisconnects = new Set(process.listeners("disconnect"));
      const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
        callback(null);
        return true;
      });
      const disconnect = vi.fn();
      Object.defineProperty(process, "send", { configurable: true, value: send });
      Object.defineProperty(process, "connected", { configurable: true, value: true });
      Object.defineProperty(process, "disconnect", { configurable: true, value: disconnect });
      process.env.SPINE_MANAGED_SERVER_CHILD = "true";
      const close = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("event close failed"))
        .mockResolvedValueOnce(undefined);
      const unhandled = vi.fn();
      process.once("unhandledRejection", unhandled);
      try {
        const handle = await ManagedServerApplication.run({
          processCount: 1,
          port: 50_051,
          moduleUrl: import.meta.url,
          createServer: () => Promise.resolve(localRunningServer(close)),
        });
        if (trigger === "message")
          managedMessageListener(priorMessages)({ type: "close" }, undefined);
        else {
          const onDisconnect = managedDisconnectListener(priorDisconnects);
          onDisconnect();
          process.off("disconnect", onDisconnect);
        }
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
        await expect(handle.close()).resolves.toBeUndefined();
        expect(close).toHaveBeenCalledTimes(2);
        expect(disconnect).toHaveBeenCalledOnce();
      } finally {
        process.off("unhandledRejection", unhandled);
        if (priorSend === undefined) delete (process as { send?: unknown }).send;
        else Object.defineProperty(process, "send", priorSend);
        if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
        else Object.defineProperty(process, "connected", priorConnected);
        if (priorDisconnect === undefined) delete (process as { disconnect?: unknown }).disconnect;
        else Object.defineProperty(process, "disconnect", priorDisconnect);
        for (const listener of process.listeners("message")) {
          if (!priorMessages.has(listener)) process.off("message", listener);
        }
        for (const listener of process.listeners("disconnect")) {
          if (!priorDisconnects.has(listener)) process.off("disconnect", listener);
        }
        if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
        else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
      }
    },
  );

  it("closes local assembly when a marked child has no parent IPC", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    Object.defineProperty(process, "send", { configurable: true, value: undefined });
    Object.defineProperty(process, "connected", { configurable: true, value: false });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const close = vi.fn(() => Promise.resolve());
    try {
      await expect(
        ManagedServerApplication.run({
          processCount: 1,
          port: 50_051,
          moduleUrl: import.meta.url,
          createServer: () => Promise.resolve(localRunningServer(close)),
        }),
      ).rejects.toThrow("no parent IPC");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });

  it("contains a synchronous READY IPC failure after closing local assembly", async () => {
    const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
    const priorSend = Object.getOwnPropertyDescriptor(process, "send");
    const priorConnected = Object.getOwnPropertyDescriptor(process, "connected");
    Object.defineProperty(process, "send", {
      configurable: true,
      value: () => {
        throw new Error("ipc write failed");
      },
    });
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const close = vi.fn(() => Promise.resolve());
    try {
      await expect(
        ManagedServerApplication.run({
          processCount: 1,
          port: 50_051,
          moduleUrl: import.meta.url,
          createServer: () => Promise.resolve(localRunningServer(close)),
        }),
      ).rejects.toThrow("ipc write failed");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (priorSend === undefined) delete (process as { send?: unknown }).send;
      else Object.defineProperty(process, "send", priorSend);
      if (priorConnected === undefined) delete (process as { connected?: unknown }).connected;
      else Object.defineProperty(process, "connected", priorConnected);
      if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
    }
  });
  it("starts one separate complete child for an explicit single-replica cohort", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(managed.ready).toBe(true);
      expect(
        managedServerApplicationAccess.readyMembers(managed).map((member) => member.pid),
      ).toHaveLength(1);
      expect(
        managedServerApplicationAccess.readyMembers(managed).map((member) => member.pid)[0],
      ).not.toBe(process.pid);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("rejects a persistent normal Server registry before a managed child reports READY", async () => {
    const child = managedRegistryChild();
    const messages: unknown[] = [];
    const stderr = childStderr(child);
    child.on("message", (message) => messages.push(message));
    const exited = childExit(child);
    try {
      await expect(exited).resolves.toMatchObject({ code: 1 });
      expect(messages).toEqual([]);
      expect(stderr.text()).toContain("in-memory Stand subscription registry");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    }
  }, 20_000);

  it("rejects a custom non-persistent registry before a managed child reports READY", async () => {
    const child = managedRegistryChild("custom");
    const messages: unknown[] = [];
    const stderr = childStderr(child);
    child.on("message", (message) => messages.push(message));
    const exited = childExit(child);
    let completed = false;

    try {
      await expect(exited).resolves.toMatchObject({ code: 1 });
      completed = true;
      expect(messages).toEqual([]);
      expect(stderr.text()).toContain("in-memory Stand subscription registry");
    } finally {
      if (!completed) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  }, 20_000);

  it("admits an in-memory normal Server registry as a managed READY child", async () => {
    const child = managedRegistryChild("memory");
    childStderr(child);
    const ready = new Promise<void>((resolve) => {
      child.on("message", (message: { readonly type?: string }) => {
        if (message.type === "ready") resolve();
      });
    });

    const exited = childExit(child);
    try {
      await ready;
      child.send({ type: "close" });
      await expect(exited).resolves.toMatchObject({ code: 0 });
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    }
  }, 20_000);

  it("does not block readiness when a child writes verbose standard output", async () => {
    const priorVerbose = process.env.SPINE_MANAGED_SERVER_VERBOSE;
    process.env.SPINE_MANAGED_SERVER_VERBOSE = "true";
    try {
      const managed = await ManagedServerApplication.run({
        processCount: 1,
        port: 50_051,
        moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
        createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
      });
      await managed.close();
    } finally {
      if (priorVerbose === undefined) delete process.env.SPINE_MANAGED_SERVER_VERBOSE;
      else process.env.SPINE_MANAGED_SERVER_VERBOSE = priorVerbose;
    }
  }, 20_000);

  it("starts four distinct child processes for one managed cohort", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 4,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(
        new Set(managedServerApplicationAccess.readyMembers(managed).map((member) => member.pid))
          .size,
      ).toBe(4);
      expect(
        managedServerApplicationAccess.readyMembers(managed).map((member) => member.pid),
      ).not.toContain(process.pid);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("reports each child's actual local listener only after that child is ready", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(
        managedServerApplicationAccess.readyMembers(managed).map((member) => member.endpoint),
      ).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/)]);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("waits for child-local synchronization before admitting its private listener", async () => {
    const startedAt = Date.now();
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-gated-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
      expect(
        managedServerApplicationAccess.readyMembers(managed).map((member) => member.endpoint),
      ).toHaveLength(1);
    } finally {
      await managed.close();
    }
  }, 20_000);

  it("replaces only the unexpected child exit and retains its surviving sibling", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 2,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
    });
    try {
      const memberPids = managedServerApplicationAccess
        .readyMembers(managed)
        .map((member) => member.pid);
      const failed = itemAt(memberPids, 0, "a failed child PID");
      const survivor = itemAt(memberPids, 1, "a surviving child PID");
      process.kill(failed, "SIGKILL");
      await expect
        .poll(
          () =>
            managedServerApplicationAccess
              .readyMembers(managed)
              .map((member) => member.pid)
              .includes(survivor),
          { timeout: 10_000 },
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            managedServerApplicationAccess
              .readyMembers(managed)
              .map((member) => member.pid)
              .some((pid) => pid !== failed && pid !== survivor),
          {
            timeout: 10_000,
          },
        )
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
        port: 50_051,
        moduleUrl: import.meta.url,
        createServer: () => Promise.reject(new Error("not reached")),
        restart,
      }),
    ).rejects.toThrow("restart");
  });

  it("does not restart a child that the managed cohort closes", async () => {
    const managed = await ManagedServerApplication.run({
      processCount: 1,
      port: 50_051,
      moduleUrl: new URL("./managed-server-application-child.mjs", import.meta.url).href,
      createServer: () => Promise.reject(new Error("Parent must not assemble a child.")),
      restart: { initialDelayMs: 1, maximumDelayMs: 1, healthyReadyMs: 1 },
    });
    await managed.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      managedServerApplicationAccess.readyMembers(managed).map((member) => member.pid),
    ).toEqual([]);
  }, 20_000);
  it.each([undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid explicit process count %s without deriving a machine default",
    async (processCount) => {
      await expect(
        ManagedServerApplication.run({
          processCount: processCount as unknown as number,
          port: 50_051,
          moduleUrl: import.meta.url,
          createServer: () => Promise.resolve(localRunningServer(() => Promise.resolve(), 1)),
        }),
      ).rejects.toThrow("processCount");
    },
  );

  it.each([undefined, 0, -1, 65_536, 1.5, Number.POSITIVE_INFINITY])(
    "rejects an unusable Coordinator port %s before local child assembly",
    async (port) => {
      const priorChild = process.env.SPINE_MANAGED_SERVER_CHILD;
      process.env.SPINE_MANAGED_SERVER_CHILD = "true";
      const createServer = vi.fn(() =>
        Promise.resolve(localRunningServer(() => Promise.resolve())),
      );
      try {
        await expect(
          ManagedServerApplication.run({
            processCount: 1,
            // @ts-expect-error Exercises runtime validation of an omitted port.
            port,
            moduleUrl: import.meta.url,
            createServer,
          }),
        ).rejects.toThrow("Managed server Coordinator port");
        expect(createServer).not.toHaveBeenCalled();
      } finally {
        if (priorChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
        else process.env.SPINE_MANAGED_SERVER_CHILD = priorChild;
      }
    },
  );
});
