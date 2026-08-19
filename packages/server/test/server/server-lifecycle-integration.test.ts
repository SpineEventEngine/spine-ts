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

import * as http2 from "node:http2";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoundedContext,
  type BrowserServerOptions,
  EnvironmentType,
  type ListenerLifecycle,
  Server,
  ServerEnvironment,
} from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import type { EnvironmentAttachmentHandle } from "../../src/server/environment-attachment.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import {
  HeldStartupWorker,
  LifecycleTrackingStorageFactory,
  lifecycleFixture,
} from "./server-lifecycle-fixture.js";

const createHttp2Server = vi.hoisted(() =>
  vi.fn<(server: import("node:http2").Http2Server) => void>(),
);

vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  return {
    ...actual,
    createServer(...args: Parameters<typeof actual.createServer>) {
      const server = actual.createServer(...args);
      createHttp2Server(server);
      return server;
    },
  };
});

describe("Server lifecycle integration", () => {
  it("exports the listener lifecycle contract", () => {
    const lifecycle: ListenerLifecycle = { start: () => undefined, close: () => undefined };
    expect(lifecycle).toBeDefined();
  });

  it("starts listener lifecycles after readiness and closes them before network intake", async () => {
    const events: string[] = [];
    const server = Server.atPort(0).addListenerLifecycle({
      start: () => events.push("start"),
      close: () => events.push("close"),
    });
    const running = await server.start();
    expect(events).toEqual(["start"]);
    await running.close();
    expect(events).toEqual(["start", "close"]);
  });

  it("retries only a failed listener lifecycle close", async () => {
    let attempts = 0;
    const successful = vi.fn();
    const failing = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("close failed");
    });
    const running = await Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: successful })
      .addListenerLifecycle({ start: () => undefined, close: failing })
      .start();
    await expect(running.close()).rejects.toThrow("close failed");
    await running.close();
    expect(successful).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("rolls back only listener lifecycles admitted before a start failure", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const thirdClose = vi.fn();
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: firstClose })
      .addListenerLifecycle({
        start: () => {
          throw new Error("start failed");
        },
        close: secondClose,
      })
      .addListenerLifecycle({ start: () => undefined, close: thirdClose });
    await expect(server.start()).rejects.toThrow("start failed");
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).not.toHaveBeenCalled();
    expect(thirdClose).not.toHaveBeenCalled();
  });

  it("rolls back admitted listener lifecycles in reverse start order", async () => {
    const closed: string[] = [];
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("first") })
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("second") })
      .addListenerLifecycle({
        start: () => {
          throw new Error("start failed");
        },
        close: () => undefined,
      });

    await expect(server.start()).rejects.toThrow("start failed");
    expect(closed).toEqual(["second", "first"]);
  });

  it("does not restart after a listener-start failure rolls back cleanly", async () => {
    const start = vi.fn(() => {
      throw new Error("start failed");
    });
    const server = Server.atPort(0).addListenerLifecycle({ start, close: () => undefined });

    await expect(server.start()).rejects.toThrow("start failed");
    await expect(server.start()).rejects.toThrow("cannot restart after failed-start cleanup");
    expect(start).toHaveBeenCalledOnce();
  });

  it("retries later server cleanup after listener rollback before becoming terminal", async () => {
    const startFailure = new Error("listener start failed");
    const networkFailure = new Error("network close failed");
    const closed: string[] = [];
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer, [networkFailure]);
    });
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("admitted") })
      .addListenerLifecycle({
        start: () => {
          throw startFailure;
        },
        close: () => undefined,
      });

    const first = await server.start().catch((error: unknown) => error);
    expect(first).toBeInstanceOf(AggregateError);
    expect((first as AggregateError).errors).toEqual([startFailure, networkFailure]);
    expect(closed).toEqual(["admitted"]);
    expect(network?.calls()).toBe(1);

    const completion = await server.start().catch((error: unknown) => error);
    expectDeferredCleanupCompletion(completion);
    expect(network?.calls()).toBe(2);

    const terminal = await server.start().catch((error: unknown) => error);
    expectConsumedFailedStartServer(terminal);
  });

  it("aggregates listener start and admitted rollback failures in order", async () => {
    const startFailure = new Error("start failed");
    const rollbackFailure = new Error("rollback failed");
    const laterClose = vi.fn();
    const server = Server.atPort(0)
      .addListenerLifecycle({
        start: () => undefined,
        close: vi.fn().mockImplementationOnce(() => {
          throw rollbackFailure;
        }),
      })
      .addListenerLifecycle({
        start: () => {
          throw startFailure;
        },
        close: vi.fn(),
      })
      .addListenerLifecycle({ start: () => undefined, close: laterClose });
    const failure = await server.start().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([startFailure, rollbackFailure]);
    expect(laterClose).not.toHaveBeenCalled();
    await expect(server.start()).rejects.toThrow("deferred cleanup");
  });

  it("keeps the listener open until a failed lifecycle close retries", async () => {
    let attempts = 0;
    const running = await Server.atPort(0)
      .addListenerLifecycle({
        start: () => undefined,
        close: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("close failed");
        },
      })
      .start();
    await expect(running.close()).rejects.toThrow("close failed");
    const session = http2.connect(running.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");
    session.close();
    await once(session, "close");
    await running.close();
  });

  it("rejects standalone browser backends before listener lifecycle startup", async () => {
    const start = vi.fn();
    const close = vi.fn();
    const server = new Server({
      browser: { backend: { baseUrls: ["http://10.0.0.1"] } } as BrowserServerOptions,
    }).addListenerLifecycle({ start, close });
    await expect(server.start()).rejects.toThrow("Standalone browser server");
    expect(start).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  beforeEach(async () => {
    await resetServerEnvironmentForTest();
    createHttp2Server.mockReset();
  });

  it("waits for attached startup recovery before opening the listener", async () => {
    const fixture = await lifecycleFixture();
    const starting = Server.atPort(0).add(fixture.context).start();

    try {
      await fixture.worker.startedWithin();
      let settled = false;
      void starting.then(() => {
        settled = true;
      });
      await nextTurn();

      expect(fixture.worker.starts).toBe(1);
      expect(settled).toBe(false);
      expect(createHttp2Server).not.toHaveBeenCalled();

      fixture.worker.release();
      const server = await starting;
      expect(createHttp2Server).toHaveBeenCalledOnce();
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port.toString()}`);
      await server.close();
      await server.close();
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      fixture.worker.release();
      await starting.then(
        (server) => server.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("closes sessions, attachment delivery, resources, and owned facilities in order", async () => {
    const events: string[] = [];
    const fixture = await lifecycleFixture({
      events,
      settings: {
        delivery: { close: () => events.push("facility") },
      },
    });
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in lifecycle order test.");
      }
      events.push("context");
      return closeFixtureContext();
    });
    const server = Server.atPort(0)
      .add(fixture.context)
      .addResource({ close: () => events.push("resource") });
    const starting = server.start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const running = await starting;
      const session = http2.connect(running.baseUrl);
      session.on("error", () => undefined);
      session.on("close", () => events.push("session"));
      await once(session, "remoteSettings");

      await running.close();
      await running.close();
      await resetServerEnvironmentForTest();

      expect(events).toEqual([
        "recovery",
        "session",
        "stop",
        "await",
        "retire",
        "context",
        "resource",
        "facility",
      ]);
    } finally {
      closeContext.mockRestore();
      fixture.worker.release();
      await starting.then(
        (running) => running.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("blocks a fresh caller-owned generation until old retirement completes", async () => {
    const firstWorker = new HeldStartupWorker([]);
    const freshWorker = new HeldStartupWorker([]);
    firstWorker.release();
    freshWorker.release();
    const fixture = await lifecycleFixture({ workers: [firstWorker, freshWorker] });
    const firstStart = Server.atPort(0).add(fixture.context).start();
    let first: Awaited<ReturnType<Server["start"]>> | undefined;
    let firstClose: Promise<void> | undefined;
    let freshContext: BoundedContext | undefined;
    let freshStart: Promise<Awaited<ReturnType<Server["start"]>>> | undefined;
    let fresh: Awaited<ReturnType<Server["start"]>> | undefined;
    let releaseRetirement: (() => void) | undefined;

    try {
      first = await firstStart;
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      freshContext = await fixture.createContext("LifecycleFresh");
      releaseRetirement = firstWorker.holdNextRetire();
      firstClose = first.close();
      void firstClose.catch(() => undefined);
      await waitFor(() => firstWorker.retireCalls === 1);
      let firstCloseSettled = false;
      void firstClose.then(
        () => {
          firstCloseSettled = true;
        },
        () => {
          firstCloseSettled = true;
        },
      );

      freshStart = Server.atPort(0).add(freshContext).start();
      void freshStart.catch(() => undefined);
      let freshStartSettled = false;
      void freshStart.then(
        () => {
          freshStartSettled = true;
        },
        () => {
          freshStartSettled = true;
        },
      );
      await nextTurn();

      expect(firstCloseSettled).toBe(false);
      expect(freshStartSettled).toBe(false);
      expect(firstWorker.retireCalls).toBe(1);
      expect(freshWorker.starts).toBe(0);

      releaseRetirement();
      releaseRetirement = undefined;
      await firstClose;
      fresh = await freshStart;
      await fresh.close();

      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      firstWorker.release();
      freshWorker.release();
      releaseRetirement?.();
      await firstClose?.catch(() => undefined);
      await first?.close().catch(() => undefined);
      await firstStart.then(
        (running) => running.close(),
        () => undefined,
      );
      await freshStart?.then(
        (running) => running.close(),
        () => undefined,
      );
      await fresh?.close().catch(() => undefined);
      await freshContext?.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("coalesces concurrent starts into one build, attachment, and running result", async () => {
    const fixture = await lifecycleFixture();
    const server = Server.atPort(0).add(fixture.context);
    const first = server.start();
    const second = server.start();
    void second.catch(() => undefined);

    try {
      expect(second).toBe(first);
      await fixture.worker.startedWithin();
      expect(fixture.worker.starts).toBe(1);
      fixture.worker.release();

      const [firstRunning, secondRunning] = await Promise.all([first, second]);
      expect(secondRunning).toBe(firstRunning);
      await firstRunning.close();
    } finally {
      fixture.worker.release();
      await first.then(
        (running) => running.close(),
        () => undefined,
      );
      await second.then(
        (running) => running.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("coalesces concurrent close and detaches exactly once", async () => {
    const fixture = await lifecycleFixture();
    const starting = Server.atPort(0).add(fixture.context).start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const running = await starting;
      const first = running.close();
      const second = running.close();

      expect(second).toBe(first);
      await Promise.all([first, second]);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(fixture.worker.awaitCalls).toBe(1);
      expect(fixture.worker.retireCalls).toBe(1);
    } finally {
      fixture.worker.release();
      await starting.then(
        (running) => running.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("holds last owned teardown until active delivery settles without a paused successor", async () => {
    const events: string[] = [];
    const worker = new HeldStartupWorker(events);
    worker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const closeDelivery = vi.fn(() => events.push("delivery"));
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: {
        storageFactory,
        delivery: { close: closeDelivery },
      },
    });
    const closeResource = vi.fn(() => events.push("resource"));
    let network: NetworkCloseProbe | undefined;
    let context: BoundedContext | undefined;
    let running: Awaited<ReturnType<Server["start"]>> | undefined;
    let session: http2.ClientHttp2Session | undefined;
    let sessionClosed = false;
    let releaseActive: (() => void) | undefined;
    let posting: Promise<void> | undefined;
    let firstClose: Promise<void> | undefined;
    let contextCloseCalls = 0;
    let restoreContextClose: () => void = () => undefined;

    try {
      await fixture.context.close();
      context = await fixture
        .createBuilder("LifecycleActiveLastClose")
        .withStorageFactory(storageFactory)
        .buildAsync();
      const trackedStorages = [...storageFactory.storages];
      expect(trackedStorages.length).toBeGreaterThan(0);
      const closeTrackedContext = context.close.bind(context);
      const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
        this: BoundedContext,
      ) {
        if (this !== context) {
          throw new Error("Unexpected context close in active last-detach test.");
        }
        contextCloseCalls += 1;
        events.push("context");
        return closeTrackedContext();
      });
      restoreContextClose = () => {
        closeContext.mockRestore();
      };
      createHttp2Server.mockImplementationOnce((httpServer) => {
        network = trackNetworkClose(httpServer);
      });
      running = await Server.atPort(0).add(context).addResource({ close: closeResource }).start();
      session = http2.connect(running.baseUrl);
      session.on("error", () => undefined);
      session.on("close", () => {
        sessionClosed = true;
        events.push("session");
      });
      await once(session, "remoteSettings");
      releaseActive = worker.holdNextStart("STOPPED");
      posting = fixture.postEvent(context, "active-last-close");
      await posting;
      await waitFor(() => worker.starts === 2);
      firstClose = running.close();
      void firstClose.catch(() => undefined);
      await waitFor(() => worker.stopCalls === 1);
      const concurrentClose = running.close();

      expect(concurrentClose).toBe(firstClose);
      expect(network?.calls()).toBe(1);
      expect(sessionClosed).toBe(true);
      expect(events).toContain("session");
      expect(events).toContain("stop");
      expect(events.indexOf("session")).toBeLessThan(events.indexOf("stop"));
      expect(worker.starts).toBe(2);
      expect(worker.awaitCalls).toBe(0);
      expect(worker.retireCalls).toBe(0);
      expect(contextCloseCalls).toBe(0);
      expect(closeResource).not.toHaveBeenCalled();
      expect(closeDelivery).not.toHaveBeenCalled();
      expect(trackedStorages.length).toBeGreaterThan(0);
      expect(trackedStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(trackedStorages.every((storage) => storageFactory.closeCallsFor(storage) === 0)).toBe(
        true,
      );
      expect(storageFactory.isOpen()).toBe(true);
      const transport = fixture.environment.transport;
      if (transport === undefined) throw new Error("Expected local transport.");
      await expect(
        transport.publish({ topic: transportTopic, envelope: "active" }),
      ).resolves.toBeUndefined();

      releaseActive();
      releaseActive = undefined;
      await Promise.all([firstClose, concurrentClose]);
      await running.close();
      await resetServerEnvironmentForTest();

      expect(worker.starts).toBe(2);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(contextCloseCalls).toBe(1);
      expect(trackedStorages.length).toBeGreaterThan(0);
      expect(trackedStorages.every((storage) => storageFactory.closeCallsFor(storage) === 1)).toBe(
        true,
      );
      expect(closeResource).toHaveBeenCalledOnce();
      expect(closeDelivery).toHaveBeenCalledOnce();
      expect(storageFactory.closeCalls).toBe(1);
      await expect(
        transport.publish({ topic: transportTopic, envelope: "closed" }),
      ).rejects.toThrow("Local signal transport is closed.");
      expect(events.slice(-7)).toEqual([
        "stop",
        "await",
        "retire",
        "context",
        "resource",
        "delivery",
        "facility",
      ]);
    } finally {
      releaseActive?.();
      session?.destroy();
      try {
        await posting?.catch(() => undefined);
        await firstClose?.catch(() => undefined);
        await running?.close().catch(() => undefined);
      } finally {
        restoreContextClose();
        await context?.close().catch(() => undefined);
        await fixture.context.close().catch(() => undefined);
        await resetServerEnvironmentForTest().catch(() => undefined);
        fixture.dispose();
      }
    }
  });

  it("retains every owned dependency until unsafe last detach retry proves quiescence", async () => {
    const events: string[] = [];
    const worker = new HeldStartupWorker(events);
    worker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const closeDelivery = vi.fn(() => events.push("delivery"));
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: {
        storageFactory,
        delivery: { close: closeDelivery },
      },
    });
    const closeResource = vi.fn(() => events.push("resource"));
    let network: NetworkCloseProbe | undefined;
    const quiescenceFailure = new Error("last generation remained active");
    let context: BoundedContext | undefined;
    let running: Awaited<ReturnType<Server["start"]>> | undefined;
    let releaseRetry: (() => void) | undefined;
    let contextCloseCalls = 0;
    let restoreContextClose: () => void = () => undefined;

    try {
      await fixture.context.close();
      context = await fixture
        .createBuilder("LifecycleUnsafeLastDetach")
        .withStorageFactory(storageFactory)
        .buildAsync();
      const trackedStorages = [...storageFactory.storages];
      expect(trackedStorages.length).toBeGreaterThan(0);
      const closeTrackedContext = context.close.bind(context);
      const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
        this: BoundedContext,
      ) {
        if (this !== context) {
          throw new Error("Unexpected context close in unsafe last-detach test.");
        }
        contextCloseCalls += 1;
        return closeTrackedContext();
      });
      restoreContextClose = () => {
        closeContext.mockRestore();
      };
      createHttp2Server.mockImplementationOnce((httpServer) => {
        network = trackNetworkClose(httpServer);
      });
      running = await Server.atPort(0).add(context).addResource({ close: closeResource }).start();
      worker.failNextAwait(quiescenceFailure);
      const firstFailure = await running.close().catch((error: unknown) => error);

      expect(firstFailure).toMatchObject({ cause: quiescenceFailure });
      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(0);
      expect(contextCloseCalls).toBe(0);
      expect(closeResource).not.toHaveBeenCalled();
      expect(closeDelivery).not.toHaveBeenCalled();
      expect(trackedStorages.length).toBeGreaterThan(0);
      expect(trackedStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(trackedStorages.every((storage) => storageFactory.closeCallsFor(storage) === 0)).toBe(
        true,
      );
      expect(storageFactory.isOpen()).toBe(true);

      releaseRetry = worker.holdNextAwait();
      const firstRetry = running.close();
      void firstRetry.catch(() => undefined);
      await waitFor(() => worker.awaitCalls === 2);
      const concurrentRetry = running.close();
      expect(concurrentRetry).toBe(firstRetry);
      releaseRetry();
      releaseRetry = undefined;
      await Promise.all([firstRetry, concurrentRetry]);
      await running.close();
      await resetServerEnvironmentForTest();

      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);
      expect(contextCloseCalls).toBe(1);
      expect(trackedStorages.length).toBeGreaterThan(0);
      expect(trackedStorages.every((storage) => storageFactory.closeCallsFor(storage) === 1)).toBe(
        true,
      );
      expect(closeResource).toHaveBeenCalledOnce();
      expect(closeDelivery).toHaveBeenCalledOnce();
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      releaseRetry?.();
      try {
        await running?.close().catch(() => undefined);
      } finally {
        restoreContextClose();
        await context?.close().catch(() => undefined);
        await fixture.context.close().catch(() => undefined);
        await resetServerEnvironmentForTest().catch(() => undefined);
        fixture.dispose();
      }
    }
  });

  it("separates server cleanup from singleton facility cleanup after safe retirement errors", async () => {
    const events: string[] = [];
    const firstRetirementFailure = new Error("last retirement failed");
    const nestedRetirementFailure = new Error("nested last retirement failed");
    const contextFailure = new Error("last context close failed");
    const resourceFailure = new Error("last resource close failed");
    const facilityFailure = new Error("last delivery facility close failed");
    const worker = new HeldStartupWorker(events);
    worker.release();
    worker.failNextRetire(
      new AggregateError(
        [
          firstRetirementFailure,
          new AggregateError([nestedRetirementFailure], "nested last retirement"),
        ],
        "last retirement",
      ),
    );
    let deliveryAttempts = 0;
    const closeDelivery = vi.fn(() => {
      deliveryAttempts += 1;
      events.push("delivery");
      if (deliveryAttempts === 1) {
        throw facilityFailure;
      }
    });
    let contextAttempts = 0;
    const closeSuccessfulResource = vi.fn(() => events.push("resource-success"));
    let resourceAttempts = 0;
    const closeRetryingResource = vi.fn(() => {
      resourceAttempts += 1;
      events.push("resource-retry");
      if (resourceAttempts === 1) {
        throw resourceFailure;
      }
    });
    let fixture: Awaited<ReturnType<typeof lifecycleFixture>> | undefined;
    let running: Awaited<ReturnType<Server["start"]>> | undefined;
    let restoreContextClose: () => void = () => undefined;

    try {
      const storageFactory = new LifecycleTrackingStorageFactory(events);
      fixture = await lifecycleFixture({
        events,
        workers: [worker],
        settings: {
          storageFactory,
          delivery: { close: closeDelivery },
        },
      });
      const closeFixtureContext = fixture.context.close.bind(fixture.context);
      const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
        this: BoundedContext,
      ) {
        if (this !== fixture?.context) {
          throw new Error("Unexpected context close in safe last-cleanup test.");
        }
        contextAttempts += 1;
        events.push("context");
        return contextAttempts === 1 ? Promise.reject(contextFailure) : closeFixtureContext();
      });
      restoreContextClose = () => {
        closeContext.mockRestore();
      };
      running = await Server.atPort(0)
        .add(fixture.context)
        .addResource({ close: closeSuccessfulResource })
        .addResource({ close: closeRetryingResource })
        .start();
      const firstFailure = await running.close().catch((error: unknown) => error);

      expect(firstFailure).toBeInstanceOf(AggregateError);
      expect((firstFailure as AggregateError).errors).toEqual([
        firstRetirementFailure,
        nestedRetirementFailure,
        contextFailure,
        resourceFailure,
      ]);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeSuccessfulResource).toHaveBeenCalledOnce();
      expect(closeRetryingResource).toHaveBeenCalledOnce();
      expect(closeDelivery).not.toHaveBeenCalled();
      expect(storageFactory.closeCalls).toBe(0);

      await running.close();
      await running.close();

      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(closeContext).toHaveBeenCalledTimes(2);
      expect(closeSuccessfulResource).toHaveBeenCalledOnce();
      expect(closeRetryingResource).toHaveBeenCalledTimes(2);
      expect(closeDelivery).not.toHaveBeenCalled();
      expect(storageFactory.closeCalls).toBe(0);

      const facilityClose = await fixture.environment.close().catch((error: unknown) => error);
      expect(facilityClose).toBeInstanceOf(AggregateError);
      expect((facilityClose as AggregateError).errors).toEqual([facilityFailure]);
      expect(closeDelivery).toHaveBeenCalledOnce();
      expect(storageFactory.closeCalls).toBe(1);

      await fixture.environment.close();
      expect(closeDelivery).toHaveBeenCalledTimes(2);
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      try {
        await running?.close().catch(() => undefined);
      } finally {
        try {
          restoreContextClose();
        } finally {
          await fixture?.context.close().catch(() => undefined);
          await fixture?.environment.close().catch(() => undefined);
          fixture?.dispose();
        }
      }
    }
  });

  it.each([
    {
      kind: "empty",
      createScenario: () => {
        const failure = new AggregateError([], "empty last retirement");
        return { failure, expectedFailure: failure };
      },
    },
    {
      kind: "nested-empty",
      createScenario: () => {
        const innerFailure = new AggregateError([], "nested empty last retirement");
        const failure = new AggregateError([innerFailure], "nested-empty last retirement");
        return { failure, expectedFailure: innerFailure };
      },
    },
  ])(
    "preserves $kind aggregate failure presence across safe last cleanup",
    async ({ createScenario }) => {
      const worker = new HeldStartupWorker([]);
      worker.release();
      const { failure: retirementFailure, expectedFailure } = createScenario();
      worker.failNextRetire(retirementFailure);
      const closeResource = vi.fn();
      let fixture: Awaited<ReturnType<typeof lifecycleFixture>> | undefined;
      let running: Awaited<ReturnType<Server["start"]>> | undefined;

      try {
        fixture = await lifecycleFixture({ workers: [worker] });
        running = await Server.atPort(0)
          .add(fixture.context)
          .addResource({ close: closeResource })
          .start();
        const firstFailure = await running.close().catch((error: unknown) => error);

        expect(firstFailure).toBe(expectedFailure);
        expect(worker.stopCalls).toBe(1);
        expect(worker.awaitCalls).toBe(1);
        expect(worker.retireCalls).toBe(1);
        expect(closeResource).toHaveBeenCalledOnce();

        await running.close();
        await running.close();
        expect(worker.stopCalls).toBe(1);
        expect(worker.awaitCalls).toBe(1);
        expect(worker.retireCalls).toBe(1);
        expect(closeResource).toHaveBeenCalledOnce();
        await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
      } finally {
        await running?.close().catch(() => undefined);
        await fixture?.context.close().catch(() => undefined);
        await fixture?.environment.close().catch(() => undefined);
        fixture?.dispose();
      }
    },
  );

  it.each([
    {
      kind: "empty",
      createScenario: () => {
        const failure = new AggregateError([], "empty explicit-resource close");
        return { failure, expectedFailures: [failure] };
      },
    },
    {
      kind: "nested-empty",
      createScenario: () => {
        const innerFailure = new AggregateError([], "nested empty explicit-resource close");
        const failure = new AggregateError([innerFailure], "nested-empty explicit-resource close");
        return { failure, expectedFailures: [innerFailure] };
      },
    },
    {
      kind: "multiple empty",
      createScenario: () => {
        const firstFailure = new AggregateError([], "first empty explicit-resource close");
        const secondFailure = new AggregateError([], "second empty explicit-resource close");
        const failure = new AggregateError(
          [firstFailure, new AggregateError([secondFailure], "nested second empty close")],
          "multiple empty explicit-resource close",
        );
        return { failure, expectedFailures: [firstFailure, secondFailure] };
      },
    },
  ])(
    "retries an explicit resource after $kind aggregate failure without repeating later hooks",
    async ({ createScenario }) => {
      const { failure: resourceFailure, expectedFailures } = createScenario();
      let retryingAttempts = 0;
      const retryingResource = vi.fn(() => {
        retryingAttempts += 1;
        if (retryingAttempts === 1) {
          throw resourceFailure;
        }
        if (retryingAttempts > 2) {
          throw new Error("Explicit resource close repeated after success.");
        }
      });
      const laterResource = vi.fn();
      let fixture: Awaited<ReturnType<typeof lifecycleFixture>> | undefined;
      let running: Awaited<ReturnType<Server["start"]>> | undefined;

      try {
        fixture = await lifecycleFixture();
        fixture.worker.release();
        running = await Server.atPort(0)
          .add(fixture.context)
          .addResource({ close: retryingResource })
          .addResource({ close: laterResource })
          .start();
        const firstFailure = await running.close().catch((error: unknown) => error);

        expect(firstFailure).toBeInstanceOf(AggregateError);
        expect((firstFailure as AggregateError).errors).toEqual(expectedFailures);
        expect(retryingResource).toHaveBeenCalledOnce();
        expect(laterResource).toHaveBeenCalledOnce();

        await running.close();
        await running.close();

        expect(retryingResource).toHaveBeenCalledTimes(2);
        expect(laterResource).toHaveBeenCalledOnce();
      } finally {
        await running?.close().catch(() => undefined);
        await fixture?.context.close().catch(() => undefined);
        await fixture?.environment.close().catch(() => undefined);
        fixture?.dispose();
      }
    },
  );

  it("closes one shared running server without retiring its sibling generation", async () => {
    const events: string[] = [];
    const worker = new HeldStartupWorker(events);
    worker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const departingResource = vi.fn();
    const siblingResource = vi.fn();
    let departing: Awaited<ReturnType<Server["start"]>> | undefined;
    let sibling: Awaited<ReturnType<Server["start"]>> | undefined;
    let joined: Awaited<ReturnType<Server["start"]>> | undefined;

    try {
      departing = await Server.atPort(0)
        .add(fixture.createBuilder("LifecycleSharedDeparting"))
        .addResource({ close: departingResource })
        .start();
      const departingStorages = [...storageFactory.storages];
      sibling = await Server.atPort(0)
        .add(fixture.createBuilder("LifecycleSharedSibling"))
        .addResource({ close: siblingResource })
        .start();
      const siblingStorages = storageFactory.storages.filter(
        (storage) => !departingStorages.includes(storage),
      );

      const firstClose = departing.close();
      const concurrentClose = departing.close();
      expect(concurrentClose).toBe(firstClose);
      await Promise.all([firstClose, concurrentClose]);
      await departing.close();

      expect(departingResource).toHaveBeenCalledOnce();
      expect(siblingResource).not.toHaveBeenCalled();
      expect(
        departingStorages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(siblingStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(worker.starts).toBe(2);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);

      await expectConnectable(sibling);
      joined = await Server.atPort(0).add(fixture.createBuilder("LifecycleSharedJoined")).start();
      expect(worker.starts).toBe(3);
      await expectConnectable(sibling);
      await joined.close();
      joined = undefined;
      expect(siblingResource).not.toHaveBeenCalled();
      expect(siblingStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
    } finally {
      await joined?.close().catch(() => undefined);
      await departing?.close().catch(() => undefined);
      await sibling?.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retries unsafe shared detach without repeating successful network close", async () => {
    const worker = new HeldStartupWorker([]);
    worker.release();
    const fixture = await lifecycleFixture({ workers: [worker] });
    const sibling = await Server.atPort(0).add(fixture.context).start();
    const storageFactory = new LifecycleTrackingStorageFactory([]);
    const context = await fixture
      .createBuilder("LifecycleUnsafeRunningDetach")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const resourceClose = vi.fn();
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer);
    });
    const departing = await Server.atPort(0)
      .add(context)
      .addResource({ close: resourceClose })
      .start();
    const quiescenceFailure = new Error("shared selected owner remained active");
    worker.failNextAwait(quiescenceFailure);
    let releaseRetry: (() => void) | undefined;

    try {
      const firstFailure = await departing.close().catch((error: unknown) => error);
      expect(firstFailure).toBe(quiescenceFailure);
      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(0);
      expect(resourceClose).not.toHaveBeenCalled();
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);
      await expectConnectable(sibling);

      releaseRetry = worker.holdNextAwait();
      const firstRetry = departing.close();
      void firstRetry.catch(() => undefined);
      await waitFor(() => worker.awaitCalls === 2);
      const concurrentRetry = departing.close();
      expect(concurrentRetry).toBe(firstRetry);
      releaseRetry();
      releaseRetry = undefined;
      await Promise.all([firstRetry, concurrentRetry]);
      await departing.close();

      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      await expectConnectable(sibling);
    } finally {
      releaseRetry?.();
      await departing.close().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it.each([
    {
      kind: "empty",
      createScenario: () => {
        const failure = new AggregateError([], "empty selected-owner settlement");
        return { failure, expectedFailure: failure };
      },
    },
    {
      kind: "nested-empty",
      createScenario: () => {
        const innerFailure = new AggregateError([], "nested empty settlement");
        const failure = new AggregateError(
          [innerFailure],
          "nested-empty selected-owner settlement",
        );
        return { failure, expectedFailure: innerFailure };
      },
    },
  ])("retains unsafe shared detach after $kind aggregate rejection", async ({ createScenario }) => {
    const worker = new HeldStartupWorker([]);
    worker.release();
    const storageFactory = new LifecycleTrackingStorageFactory([]);
    const fixture = await lifecycleFixture({
      workers: [worker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const sibling = await Server.atPort(0)
      .add(fixture.createBuilder("LifecycleEmptyAggregateSibling"))
      .start();
    const siblingStorages = [...storageFactory.storages];
    const resourceClose = vi.fn();
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer);
    });
    const departing = await Server.atPort(0)
      .add(fixture.createBuilder("LifecycleEmptyAggregateDeparting"))
      .addResource({ close: resourceClose })
      .start();
    const departingStorages = storageFactory.storages.filter(
      (storage) => !siblingStorages.includes(storage),
    );
    const { failure: settlementFailure, expectedFailure } = createScenario();
    worker.failNextAwait(settlementFailure);
    let releaseRetry: (() => void) | undefined;

    try {
      const firstFailure = await departing.close().catch((error: unknown) => error);

      expect(resourceClose).not.toHaveBeenCalled();
      expect(firstFailure).toBe(expectedFailure);
      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(0);
      expect(departingStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(siblingStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await expectConnectable(sibling);

      releaseRetry = worker.holdNextAwait();
      const firstRetry = departing.close();
      void firstRetry.catch(() => undefined);
      await waitFor(() => worker.awaitCalls === 2);
      const concurrentRetry = departing.close();
      expect(concurrentRetry).toBe(firstRetry);
      releaseRetry();
      releaseRetry = undefined;
      await Promise.all([firstRetry, concurrentRetry]);
      await departing.close();

      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        departingStorages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(siblingStorages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await expectConnectable(sibling);
    } finally {
      releaseRetry?.();
      await departing.close().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("continues shared dependency cleanup after safe detach cleanup failure", async () => {
    const worker = new HeldStartupWorker([]);
    worker.release();
    const fixture = await lifecycleFixture({ workers: [worker] });
    const sibling = await Server.atPort(0).add(fixture.context).start();
    const storageFactory = new LifecycleTrackingStorageFactory([]);
    const context = await fixture
      .createBuilder("LifecycleSafeRunningDetachFailure")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const successfulResource = vi.fn();
    const retirementFailure = new Error("shared selected owner retirement failed after barrier");
    const resourceFailure = new Error("shared dependency close failed");
    const retryGate = Promise.withResolvers<undefined>();
    let retryingResourceAttempts = 0;
    const retryingResource = vi.fn(() => {
      retryingResourceAttempts += 1;
      if (retryingResourceAttempts === 1) {
        throw resourceFailure;
      }
      if (retryingResourceAttempts === 2) {
        return retryGate.promise;
      }
      throw new Error("Shared dependency close repeated after success.");
    });
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer);
    });
    const departing = await Server.atPort(0)
      .add(context)
      .addResource({ close: successfulResource })
      .addResource({ close: retryingResource })
      .start();
    worker.failNextRetire(retirementFailure);

    try {
      const firstFailure = await departing.close().catch((error: unknown) => error);
      expect(firstFailure).toBeInstanceOf(AggregateError);
      expect((firstFailure as AggregateError).errors).toEqual([retirementFailure, resourceFailure]);
      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledOnce();
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      await expectConnectable(sibling);

      const firstRetry = departing.close();
      void firstRetry.catch(() => undefined);
      await waitFor(() => retryingResourceAttempts === 2);
      const concurrentRetry = departing.close();
      expect(concurrentRetry).toBe(firstRetry);
      retryGate.resolve(undefined);
      await Promise.all([firstRetry, concurrentRetry]);
      await departing.close();

      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledTimes(2);
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      await expectConnectable(sibling);
    } finally {
      retryGate.resolve(undefined);
      await departing.close().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("gates shared detach and dependencies behind successful network close", async () => {
    const worker = new HeldStartupWorker([]);
    worker.release();
    const fixture = await lifecycleFixture({ workers: [worker] });
    const sibling = await Server.atPort(0).add(fixture.context).start();
    const storageFactory = new LifecycleTrackingStorageFactory([]);
    const context = await fixture
      .createBuilder("LifecycleRunningNetworkGate")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const resourceClose = vi.fn();
    const networkFailure = new Error("shared running network close failed");
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer, [networkFailure]);
    });
    const departing = await Server.atPort(0)
      .add(context)
      .addResource({ close: resourceClose })
      .start();

    try {
      const firstFailure = await departing.close().catch((error: unknown) => error);
      expect(firstFailure).toBe(networkFailure);
      expect(network?.calls()).toBe(1);
      expect(worker.stopCalls).toBe(0);
      expect(worker.awaitCalls).toBe(0);
      expect(worker.retireCalls).toBe(0);
      expect(resourceClose).not.toHaveBeenCalled();
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);
      await expectConnectable(sibling);

      await departing.close();
      expect(network?.calls()).toBe(2);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      await expectConnectable(sibling);
    } finally {
      await departing.close().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("closes singleton facilities only after safe startup rollback cleanup", async () => {
    const events: string[] = [];
    const startupFailure = new Error("owned startup recovery failed");
    const retirementFailure = new Error("owned startup retirement failed");
    const worker = new HeldStartupWorker(events);
    worker.rejectNextStart(startupFailure);
    worker.failNextRetire(retirementFailure);
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: {
        storageFactory,
        delivery: { close: () => events.push("delivery") },
      },
    });
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleOwnedSafeStartup")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const closeBuiltContext = context.close.bind(context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== context) {
        throw new Error("Unexpected context close in owned startup cleanup test.");
      }
      events.push("context");
      return closeBuiltContext();
    });
    const server = Server.atPort(0)
      .add(context)
      .addResource({ close: () => events.push("resource") });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([startupFailure, retirementFailure]);
      expect(createHttp2Server).not.toHaveBeenCalled();
      expect(events).toEqual(["recovery", "stop", "await", "retire", "context", "resource"]);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);

      await fixture.environment.close();
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "retire",
        "context",
        "resource",
        "delivery",
        "facility",
      ]);
      expect(storageFactory.isOpen()).toBe(false);
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retains unsafe startup dependencies until retry, then closes singleton facilities explicitly", async () => {
    const events: string[] = [];
    const startupFailure = new Error("unsafe owned startup recovery failed");
    const quiescenceFailure = new Error("unsafe owned startup quiescence unavailable");
    const worker = new HeldStartupWorker(events);
    worker.rejectNextStart(startupFailure);
    worker.failNextAwait(quiescenceFailure);
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: {
        storageFactory,
        delivery: { close: () => events.push("delivery") },
      },
    });
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleOwnedUnsafeStartup")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const builtStorageCount = storageFactory.storages.length;
    const closeBuiltContext = context.close.bind(context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== context) {
        throw new Error("Unexpected context close in unsafe owned startup test.");
      }
      events.push("context");
      return closeBuiltContext();
    });
    const closeResource = vi.fn(() => events.push("resource"));
    const server = Server.atPort(0).add(context).addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        startupFailure,
        expect.objectContaining({ cause: quiescenceFailure }),
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(events).toEqual(["recovery", "stop", "await"]);
      expect(closeContext).not.toHaveBeenCalled();
      expect(closeResource).not.toHaveBeenCalled();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "await",
        "retire",
        "context",
        "resource",
      ]);
      expect(worker.starts).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(storageFactory.closeCalls).toBe(0);
      expect(storageFactory.isOpen()).toBe(true);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);

      await fixture.environment.close();
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "await",
        "retire",
        "context",
        "resource",
        "delivery",
        "facility",
      ]);
      expect(storageFactory.closeCalls).toBe(1);
      expect(storageFactory.isOpen()).toBe(false);
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retries server and singleton facility close indexes in separate phases", async () => {
    const events: string[] = [];
    const startupFailure = new Error("owned partial-cleanup startup failed");
    const contextFailure = new Error("owned context storage close failed");
    const resourceFailure = new Error("owned resource close failed");
    const facilityFailure = new Error("owned tracing facility close failed");
    const worker = new HeldStartupWorker(events);
    worker.rejectNextStart(startupFailure);
    const facilityStorage = new LifecycleTrackingStorageFactory(events);
    let deliveryCloses = 0;
    const delivery = {
      close() {
        deliveryCloses += 1;
        events.push("delivery");
      },
    };
    let tracerCloses = 0;
    const tracerFactory = {
      close() {
        tracerCloses += 1;
        events.push("tracer");
        if (tracerCloses === 1) {
          throw facilityFailure;
        }
      },
    };
    const fixture = await lifecycleFixture({
      events,
      workers: [worker],
      settings: {
        storageFactory: facilityStorage,
        delivery,
        tracerFactory,
      },
    });
    await fixture.context.close();
    const contextStorage = new LifecycleTrackingStorageFactory([]);
    const context = await fixture
      .createBuilder("LifecycleOwnedPartialCleanup")
      .withStorageFactory(contextStorage)
      .buildAsync();
    const closeBuiltContext = context.close.bind(context);
    let contextCloses = 0;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== context) {
        throw new Error("Unexpected context close in partial owned cleanup test.");
      }
      contextCloses += 1;
      if (contextCloses === 1) {
        throw contextFailure;
      }
      return closeBuiltContext();
    });
    const successfulResource = vi.fn(() => events.push("resource-success"));
    let retryingResourceCloses = 0;
    const retryingResource = vi.fn(() => {
      retryingResourceCloses += 1;
      events.push("resource-retry");
      if (retryingResourceCloses === 1) {
        throw resourceFailure;
      }
    });
    const server = Server.atPort(0)
      .add(context)
      .addResource({ close: successfulResource })
      .addResource({ close: retryingResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        startupFailure,
        contextFailure,
        resourceFailure,
      ]);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledOnce();
      expect(deliveryCloses).toBe(0);
      expect(tracerCloses).toBe(0);
      expect(facilityStorage.closeCalls).toBe(0);
      expect(facilityStorage.isOpen()).toBe(true);
      expect(contextCloses).toBe(1);
      expect(contextStorage.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(
        contextStorage.storages.every((storage) => contextStorage.closeCallsFor(storage) === 0),
      ).toBe(true);

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledTimes(2);
      expect(deliveryCloses).toBe(0);
      expect(tracerCloses).toBe(0);
      expect(facilityStorage.closeCalls).toBe(0);
      expect(contextCloses).toBe(2);
      expect(
        contextStorage.storages.every((storage) => contextStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(contextStorage.storages.every((storage) => !storage.isOpen())).toBe(true);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);

      const facilityClose = await fixture.environment.close().catch((error: unknown) => error);
      expect(facilityClose).toBeInstanceOf(AggregateError);
      expect((facilityClose as AggregateError).errors).toEqual([facilityFailure]);
      expect(deliveryCloses).toBe(1);
      expect(tracerCloses).toBe(1);
      expect(facilityStorage.closeCalls).toBe(1);
      expect(facilityStorage.isOpen()).toBe(false);

      await fixture.environment.close();
      expect(deliveryCloses).toBe(1);
      expect(tracerCloses).toBe(2);
      expect(facilityStorage.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await context.close().catch(() => undefined);
      contextStorage.close();
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("detaches before explicit singleton cleanup after listener bind failure", async () => {
    const events: string[] = [];
    const retirementFailure = new Error("listener cleanup retirement failed");
    const fixture = await lifecycleFixture({
      events,
      settings: {
        delivery: { close: () => events.push("facility") },
      },
    });
    const blocker = await createPortBlocker();
    fixture.worker.failNextRetire(retirementFailure);
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in listener cleanup test.");
      }
      events.push("context");
      return closeFixtureContext();
    });
    const server = Server.atPort(blocker.port)
      .add(fixture.context)
      .addResource({ close: () => events.push("resource") });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const failure = await starting.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ code: "EADDRINUSE" }),
        retirementFailure,
      ]);
      expect(events).toEqual(["recovery", "stop", "await", "retire", "context", "resource"]);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);
      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(events).toEqual(["recovery", "stop", "await", "retire", "context", "resource"]);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);

      await fixture.environment.close();
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "retire",
        "context",
        "resource",
        "facility",
      ]);
    } finally {
      closeContext.mockRestore();
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      await blocker.close();
      fixture.dispose();
    }
  });

  it("retains endpoint dependencies when listener cleanup cannot establish quiescence", async () => {
    const events: string[] = [];
    const quiescenceFailure = new Error("quiescence unavailable");
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      awaitFailure: quiescenceFailure,
      settings: {
        storageFactory,
        delivery: { close: () => events.push("facility") },
      },
    });
    const blocker = await createPortBlocker();
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleUnsafeListenerCleanup")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const builtStorageCount = storageFactory.storages.length;
    const closeFixtureContext = context.close.bind(context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== context) {
        throw new Error("Unexpected context close in unsafe cleanup test.");
      }
      events.push("context");
      return closeFixtureContext();
    });
    const server = Server.atPort(blocker.port)
      .add(context)
      .addResource({ close: () => events.push("resource") });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ code: "EADDRINUSE" }),
        expect.objectContaining({ cause: quiescenceFailure }),
      ]);
      expect(events).toEqual(["recovery", "stop", "await"]);
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "await",
        "retire",
        "context",
        "resource",
      ]);
      expect(fixture.worker.starts).toBe(1);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(fixture.worker.awaitCalls).toBe(2);
      expect(fixture.worker.retireCalls).toBe(1);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(storageFactory.closeCalls).toBe(0);
      expect(storageFactory.isOpen()).toBe(true);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      await fixture.environment.close();
      expect(events).toEqual([
        "recovery",
        "stop",
        "await",
        "await",
        "retire",
        "context",
        "resource",
        "facility",
        "facility",
      ]);
      expect(storageFactory.closeCalls).toBe(1);
      expect(storageFactory.isOpen()).toBe(false);
    } finally {
      closeContext.mockRestore();
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await context.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      await blocker.close();
      fixture.dispose();
    }
  });

  it("retries safe non-last listener cleanup without retiring the sibling generation", async () => {
    const events: string[] = [];
    const retirementFailure = new Error("selected worker retirement failed after barrier");
    const fixture = await lifecycleFixture({ events });
    const siblingStarting = Server.atPort(0).add(fixture.context).start();
    fixture.worker.release();
    const sibling = await siblingStarting;
    const departingStorage = new LifecycleTrackingStorageFactory([]);
    const departingContext = await fixture
      .createBuilder("LifecycleSharedListenerFailure")
      .withStorageFactory(departingStorage)
      .buildAsync();
    const resourceClose = vi.fn();
    fixture.worker.failNextRetire(retirementFailure);
    const server = Server.atPort(sibling.port)
      .add(departingContext)
      .addResource({ close: resourceClose });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      const failure = await starting.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ code: "EADDRINUSE" }),
        retirementFailure,
      ]);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        departingStorage.storages.every((storage) => departingStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(fixture.worker.starts).toBe(2);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(fixture.worker.awaitCalls).toBe(1);
      expect(fixture.worker.retireCalls).toBe(1);

      const session = http2.connect(sibling.baseUrl);
      session.on("error", () => undefined);
      await once(session, "remoteSettings");
      session.close();
      await once(session, "close");

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        departingStorage.storages.every((storage) => departingStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(fixture.worker.retireCalls).toBe(1);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);
      await sibling.close();
      expect(fixture.worker.retireCalls).toBe(2);
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await departingContext.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retries network close before detach and preserves the original listener error", async () => {
    const events: string[] = [];
    const listenerFailure = Object.assign(new Error("instrumented listener bind failed"), {
      code: "EADDRINUSE",
    });
    const networkFailure = new Error("instrumented listener network close failed");
    createHttp2Server.mockImplementationOnce((httpServer) => {
      failListenerNetwork(httpServer, listenerFailure, [networkFailure]);
    });
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture();
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleNetworkCloseFailure")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const resourceClose = vi.fn();
    const server = Server.atPort(0).add(context).addResource({ close: resourceClose });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([listenerFailure, networkFailure]);
      expect((failure as AggregateError).errors[0]).toBe(listenerFailure);
      expect(fixture.worker.stopCalls).toBe(0);
      expect(fixture.worker.awaitCalls).toBe(0);
      expect(fixture.worker.retireCalls).toBe(0);
      expect(resourceClose).not.toHaveBeenCalled();
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(fixture.worker.awaitCalls).toBe(1);
      expect(fixture.worker.retireCalls).toBe(1);
      expect(resourceClose).toHaveBeenCalledOnce();
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(createHttp2Server).toHaveBeenCalledOnce();

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("uses ordinary detach after another server clears unsafe failed-start rollback", async () => {
    const fixture = await lifecycleFixture();
    fixture.worker.release();
    const sibling = await Server.atPort(0).add(fixture.context).start();
    const listenerFailure = Object.assign(new Error("cross-server listener bind failed"), {
      code: "EADDRINUSE",
    });
    const networkFailure = new Error("cross-server network close failed");
    createHttp2Server.mockImplementationOnce((httpServer) => {
      failListenerNetwork(httpServer, listenerFailure, [networkFailure]);
    });
    const listenerStorage = new LifecycleTrackingStorageFactory([]);
    const listenerContext = await fixture
      .createBuilder("LifecycleBlockedListenerDetach")
      .withStorageFactory(listenerStorage)
      .buildAsync();
    const listenerResource = vi.fn();
    const listenerServer = Server.atPort(0)
      .add(listenerContext)
      .addResource({ close: listenerResource });
    const listenerStarting = listenerServer.start();
    void listenerStarting.catch(() => undefined);

    const startupFailure = new Error("cross-server attachment startup failed");
    const rollbackFailure = new Error("cross-server attachment rollback remained unsafe");
    const rollbackStorage = new LifecycleTrackingStorageFactory([]);
    const rollbackContext = await fixture
      .createBuilder("LifecycleBlockingFailedRollback")
      .withStorageFactory(rollbackStorage)
      .buildAsync();
    const rollbackResource = vi.fn();
    const rollbackServer = Server.atPort(0)
      .add(rollbackContext)
      .addResource({ close: rollbackResource });
    let rollbackStarting: Promise<unknown> | undefined;

    try {
      const listenerStartError = await listenerStarting.catch((error: unknown) => error);
      expect(listenerStartError).toBeInstanceOf(AggregateError);
      expect((listenerStartError as AggregateError).errors).toEqual([
        listenerFailure,
        networkFailure,
      ]);
      expect(listenerResource).not.toHaveBeenCalled();
      expect(listenerStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      fixture.worker.rejectNextStart(startupFailure);
      fixture.worker.failNextAwait(rollbackFailure);
      rollbackStarting = rollbackServer.start();
      const rollbackStartError = await rollbackStarting.catch((error: unknown) => error);
      expect(rollbackStartError).toBeInstanceOf(AggregateError);
      expect((rollbackStartError as AggregateError).errors).toEqual([
        startupFailure,
        rollbackFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(rollbackResource).not.toHaveBeenCalled();
      expect(rollbackStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const blockedDetach = await listenerServer.start().catch((error: unknown) => error);
      expect(blockedDetach).toMatchObject({
        message: "Environment generation rollback requires an explicit retry.",
      });
      expect(listenerResource).not.toHaveBeenCalled();
      expect(listenerStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const rollbackCompletion = await rollbackServer.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(rollbackCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(rollbackResource).toHaveBeenCalledOnce();
      expect(
        rollbackStorage.storages.every((storage) => rollbackStorage.closeCallsFor(storage) === 1),
      ).toBe(true);

      const listenerCompletion = await listenerServer.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(listenerCompletion);
      expect(listenerResource).toHaveBeenCalledOnce();
      expect(
        listenerStorage.storages.every((storage) => listenerStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(fixture.worker.starts).toBe(3);
      expect(fixture.worker.stopCalls).toBe(2);
      expect(fixture.worker.awaitCalls).toBe(3);
      expect(fixture.worker.retireCalls).toBe(2);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const terminal = await listenerServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);
      const session = http2.connect(sibling.baseUrl);
      session.on("error", () => undefined);
      await once(session, "remoteSettings");
      session.close();
      await once(session, "close");

      await sibling.close();
      expect(fixture.worker.retireCalls).toBe(3);
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      fixture.worker.release();
      await listenerStarting.catch(() => undefined);
      await rollbackStarting?.catch(() => undefined);
      await rollbackServer.start().catch(() => undefined);
      await listenerServer.start().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await listenerContext.close().catch(() => undefined);
      await rollbackContext.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("keeps listener cleanup out of another server's failed-start retry", async () => {
    const fixture = await lifecycleFixture();
    fixture.worker.release();
    const sibling = await Server.atPort(0).add(fixture.context).start();
    const listenerRetirementFailure = new Error("isolated listener retirement failed");
    const listenerStorage = new LifecycleTrackingStorageFactory([]);
    const listenerContext = await fixture
      .createBuilder("LifecycleIsolatedListenerCleanup")
      .withStorageFactory(listenerStorage)
      .buildAsync();
    const listenerResource = vi.fn();
    fixture.worker.failNextRetire(listenerRetirementFailure);
    const listenerServer = Server.atPort(sibling.port)
      .add(listenerContext)
      .addResource({ close: listenerResource });
    const listenerStarting = listenerServer.start();
    void listenerStarting.catch(() => undefined);

    const rollbackStartupFailure = new Error("isolated rollback startup failed");
    const rollbackQuiescenceFailure = new Error("isolated rollback remained unsafe");
    const rollbackRetryFailure = new Error("isolated rollback retry remained unsafe");
    const rollbackStorage = new LifecycleTrackingStorageFactory([]);
    const rollbackContext = await fixture
      .createBuilder("LifecycleIsolatedFailedRollback")
      .withStorageFactory(rollbackStorage)
      .buildAsync();
    const rollbackResource = vi.fn();
    const rollbackServer = Server.atPort(0)
      .add(rollbackContext)
      .addResource({ close: rollbackResource });
    let rollbackStarting: Promise<unknown> | undefined;
    let listenerRetry: Promise<unknown> | undefined;
    let rollbackRetry: Promise<unknown> | undefined;
    let releaseRollbackRetry: (() => void) | undefined;

    try {
      const listenerStartError = await listenerStarting.catch((error: unknown) => error);
      expect(listenerStartError).toBeInstanceOf(AggregateError);
      expect((listenerStartError as AggregateError).errors).toEqual([
        expect.objectContaining({ code: "EADDRINUSE" }),
        listenerRetirementFailure,
      ]);
      expect(listenerResource).toHaveBeenCalledOnce();
      expect(
        listenerStorage.storages.every((storage) => listenerStorage.closeCallsFor(storage) === 1),
      ).toBe(true);

      fixture.worker.rejectNextStart(rollbackStartupFailure);
      fixture.worker.failNextAwait(rollbackQuiescenceFailure);
      rollbackStarting = rollbackServer.start();
      const rollbackStartError = await rollbackStarting.catch((error: unknown) => error);
      expect(rollbackStartError).toBeInstanceOf(AggregateError);
      expect((rollbackStartError as AggregateError).errors).toEqual([
        rollbackStartupFailure,
        rollbackQuiescenceFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(rollbackResource).not.toHaveBeenCalled();
      expect(rollbackStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const awaitCallsBeforeRetry = fixture.worker.awaitCalls;
      releaseRollbackRetry = fixture.worker.holdNextAwait(rollbackRetryFailure);
      listenerRetry = listenerServer.start();
      void listenerRetry.catch(() => undefined);
      rollbackRetry = rollbackServer.start();
      void rollbackRetry.catch(() => undefined);
      await waitFor(() => fixture.worker.awaitCalls === awaitCallsBeforeRetry + 1);

      let listenerRetrySettled = false;
      let listenerCompletion: unknown;
      void listenerRetry
        .catch((error: unknown) => error)
        .then((result) => {
          listenerCompletion = result;
          listenerRetrySettled = true;
        });
      await waitFor(() => listenerRetrySettled);
      expectDeferredCleanupCompletion(listenerCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(listenerResource).toHaveBeenCalledOnce();
      expect(
        listenerStorage.storages.every((storage) => listenerStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(rollbackResource).not.toHaveBeenCalled();
      expect(rollbackStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const sessionDuringRetry = http2.connect(sibling.baseUrl);
      sessionDuringRetry.on("error", () => undefined);
      await once(sessionDuringRetry, "remoteSettings");
      sessionDuringRetry.close();
      await once(sessionDuringRetry, "close");

      releaseRollbackRetry();
      releaseRollbackRetry = undefined;
      const rollbackRetryError = await rollbackRetry.catch((error: unknown) => error);
      expect(rollbackRetryError).toBe(rollbackRetryFailure);
      expect(rollbackRetryError).not.toBe(listenerStartError);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(rollbackResource).not.toHaveBeenCalled();
      expect(rollbackStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const rollbackCompletion = await rollbackServer.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(rollbackCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(rollbackResource).toHaveBeenCalledOnce();
      expect(
        rollbackStorage.storages.every((storage) => rollbackStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(fixture.worker.starts).toBe(3);
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const listenerTerminal = await listenerServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(listenerTerminal);
      const rollbackTerminal = await rollbackServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(rollbackTerminal);

      const sessionAfterRetry = http2.connect(sibling.baseUrl);
      sessionAfterRetry.on("error", () => undefined);
      await once(sessionAfterRetry, "remoteSettings");
      sessionAfterRetry.close();
      await once(sessionAfterRetry, "close");

      await sibling.close();
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      releaseRollbackRetry?.();
      await listenerStarting.catch(() => undefined);
      await rollbackStarting?.catch(() => undefined);
      await listenerRetry?.catch(() => undefined);
      await rollbackRetry?.catch(() => undefined);
      await rollbackServer.start().catch(() => undefined);
      await rollbackServer.start().catch(() => undefined);
      await listenerServer.start().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await listenerContext.close().catch(() => undefined);
      await rollbackContext.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("keeps a blocked attachment out of another server's failed-start retry", async () => {
    const fixture = await lifecycleFixture();
    fixture.worker.release();
    const sibling = await Server.atPort(0).add(fixture.context).start();

    const ownerStartupFailure = new Error("attachment owner startup failed");
    const ownerQuiescenceFailure = new Error("attachment owner remained unsafe");
    const ownerRetryFailure = new Error("attachment owner retry remained unsafe");
    const ownerStorage = new LifecycleTrackingStorageFactory([]);
    const ownerContext = await fixture
      .createBuilder("LifecycleAttachmentRollbackOwner")
      .withStorageFactory(ownerStorage)
      .buildAsync();
    const ownerResource = vi.fn();
    const ownerServer = Server.atPort(0).add(ownerContext).addResource({ close: ownerResource });
    fixture.worker.rejectNextStart(ownerStartupFailure);
    fixture.worker.failNextAwait(ownerQuiescenceFailure);
    const ownerStarting = ownerServer.start();
    void ownerStarting.catch(() => undefined);

    const blockedStorage = new LifecycleTrackingStorageFactory([]);
    const blockedContext = await fixture
      .createBuilder("LifecycleBlockedAttachment")
      .withStorageFactory(blockedStorage)
      .buildAsync();
    const duplicateBlockedClose = new Error("blocked resource closed more than once");
    let blockedCloseCalls = 0;
    const blockedResource = vi.fn(() => {
      blockedCloseCalls += 1;
      if (blockedCloseCalls > 1) {
        throw duplicateBlockedClose;
      }
    });
    const blockedServer = Server.atPort(0)
      .add(blockedContext)
      .addResource({ close: blockedResource });
    let blockedStarting: Promise<unknown> | undefined;
    let ownerRetry: Promise<unknown> | undefined;
    let blockedRetry: Promise<unknown> | undefined;
    let releaseOwnerRetry: (() => void) | undefined;

    try {
      const ownerStartError = await ownerStarting.catch((error: unknown) => error);
      expect(ownerStartError).toBeInstanceOf(AggregateError);
      expect((ownerStartError as AggregateError).errors).toEqual([
        ownerStartupFailure,
        ownerQuiescenceFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(ownerResource).not.toHaveBeenCalled();
      expect(ownerStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      blockedStarting = blockedServer.start();
      const blockedStartError = await blockedStarting.catch((error: unknown) => error);
      expect(blockedStartError).toMatchObject({
        message: "Environment generation rollback requires an explicit retry.",
      });
      expect(blockedStartError).not.toBeInstanceOf(AggregateError);
      expect(Object.hasOwn(blockedStartError as object, "cause")).toBe(false);
      expect(createHttp2Server).toHaveBeenCalledOnce();

      const awaitCallsBeforeRetry = fixture.worker.awaitCalls;
      releaseOwnerRetry = fixture.worker.holdNextAwait(ownerRetryFailure);
      ownerRetry = ownerServer.start();
      void ownerRetry.catch(() => undefined);
      await waitFor(() => fixture.worker.awaitCalls === awaitCallsBeforeRetry + 1);
      blockedRetry = blockedServer.start();
      void blockedRetry.catch(() => undefined);

      let blockedRetrySettled = false;
      let blockedTerminal: unknown;
      void blockedRetry
        .catch((error: unknown) => error)
        .then((result) => {
          blockedTerminal = result;
          blockedRetrySettled = true;
        });
      await waitFor(() => blockedRetrySettled);
      expectConsumedFailedStartServer(blockedTerminal);
      expect(blockedTerminal).not.toBe(ownerRetryFailure);
      expect(blockedResource).toHaveBeenCalledOnce();
      expect(
        blockedStorage.storages.every((storage) => blockedStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(ownerResource).not.toHaveBeenCalled();
      expect(ownerStorage.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);

      const sessionDuringRetry = http2.connect(sibling.baseUrl);
      sessionDuringRetry.on("error", () => undefined);
      await once(sessionDuringRetry, "remoteSettings");
      sessionDuringRetry.close();
      await once(sessionDuringRetry, "close");

      releaseOwnerRetry();
      releaseOwnerRetry = undefined;
      const ownerRetryError = await ownerRetry.catch((error: unknown) => error);
      expect(ownerRetryError).toBe(ownerRetryFailure);
      expect(ownerRetryError).not.toBe(blockedStartError);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(ownerResource).not.toHaveBeenCalled();
      expect(ownerStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const ownerCompletion = await ownerServer.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(ownerCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(ownerResource).toHaveBeenCalledOnce();
      expect(
        ownerStorage.storages.every((storage) => ownerStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(blockedResource).toHaveBeenCalledOnce();
      expect(fixture.worker.starts).toBe(2);
      expect(createHttp2Server).toHaveBeenCalledOnce();

      const ownerTerminal = await ownerServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(ownerTerminal);
      const blockedTerminalAgain = await blockedServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(blockedTerminalAgain);
      expect(blockedResource).toHaveBeenCalledOnce();

      const sessionAfterRetry = http2.connect(sibling.baseUrl);
      sessionAfterRetry.on("error", () => undefined);
      await once(sessionAfterRetry, "remoteSettings");
      sessionAfterRetry.close();
      await once(sessionAfterRetry, "close");

      await sibling.close();
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      releaseOwnerRetry?.();
      await ownerStarting.catch(() => undefined);
      await blockedStarting?.catch(() => undefined);
      await ownerRetry?.catch(() => undefined);
      await blockedRetry?.catch(() => undefined);
      await ownerServer.start().catch(() => undefined);
      await ownerServer.start().catch(() => undefined);
      await blockedServer.start().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await ownerContext.close().catch(() => undefined);
      await blockedContext.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("expires rollback authority before retrying a partial dependency close", async () => {
    const fixture = await lifecycleFixture();
    fixture.worker.release();
    const sibling = await Server.atPort(0).add(fixture.context).start();

    const firstStartupFailure = new Error("expired authority startup failed");
    const firstQuiescenceFailure = new Error("expired authority remained unsafe");
    const firstResourceFailure = new Error("expired authority resource close failed");
    const duplicateFirstClose = new Error("expired authority dependency closed more than once");
    const firstStorage = new LifecycleTrackingStorageFactory([]);
    const firstContext = await fixture
      .createBuilder("LifecycleExpiredRollbackAuthority")
      .withStorageFactory(firstStorage)
      .buildAsync();
    let successfulResourceCloses = 0;
    const successfulResource = vi.fn(() => {
      successfulResourceCloses += 1;
      if (successfulResourceCloses > 1) {
        throw duplicateFirstClose;
      }
    });
    let retryingResourceCloses = 0;
    const retryingResource = vi.fn(() => {
      retryingResourceCloses += 1;
      if (retryingResourceCloses === 1) {
        throw firstResourceFailure;
      }
      if (retryingResourceCloses > 2) {
        throw duplicateFirstClose;
      }
    });
    const firstServer = Server.atPort(0)
      .add(firstContext)
      .addResource({ close: successfulResource })
      .addResource({ close: retryingResource });
    fixture.worker.rejectNextStart(firstStartupFailure);
    fixture.worker.failNextAwait(firstQuiescenceFailure);
    const firstStarting = firstServer.start();
    void firstStarting.catch(() => undefined);

    const secondStartupFailure = new Error("new rollback owner startup failed");
    const secondQuiescenceFailure = new Error("new rollback owner remained unsafe");
    const secondRetryFailure = new Error("new rollback owner retry remained unsafe");
    const secondStorage = new LifecycleTrackingStorageFactory([]);
    const secondContext = await fixture
      .createBuilder("LifecycleNewRollbackOwner")
      .withStorageFactory(secondStorage)
      .buildAsync();
    const secondResource = vi.fn();
    const secondServer = Server.atPort(0).add(secondContext).addResource({ close: secondResource });
    let secondStarting: Promise<unknown> | undefined;
    let secondRetry: Promise<unknown> | undefined;
    let firstRetry: Promise<unknown> | undefined;
    let releaseSecondRetry: (() => void) | undefined;

    try {
      const firstStartError = await firstStarting.catch((error: unknown) => error);
      expect(firstStartError).toBeInstanceOf(AggregateError);
      expect((firstStartError as AggregateError).errors).toEqual([
        firstStartupFailure,
        firstQuiescenceFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(successfulResource).not.toHaveBeenCalled();
      expect(retryingResource).not.toHaveBeenCalled();

      const firstCleanupError = await firstServer.start().catch((error: unknown) => error);
      expect(firstCleanupError).toBe(firstResourceFailure);
      expect(firstCleanupError).not.toBe(firstStartError);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledOnce();
      expect(
        firstStorage.storages.every((storage) => firstStorage.closeCallsFor(storage) === 1),
      ).toBe(true);

      fixture.worker.rejectNextStart(secondStartupFailure);
      fixture.worker.failNextAwait(secondQuiescenceFailure);
      secondStarting = secondServer.start();
      const secondStartError = await secondStarting.catch((error: unknown) => error);
      expect(secondStartError).toBeInstanceOf(AggregateError);
      expect((secondStartError as AggregateError).errors).toEqual([
        secondStartupFailure,
        secondQuiescenceFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(secondResource).not.toHaveBeenCalled();
      expect(secondStorage.storages.every((storage) => storage.isOpen())).toBe(true);

      const awaitCallsBeforeRetry = fixture.worker.awaitCalls;
      releaseSecondRetry = fixture.worker.holdNextAwait(secondRetryFailure);
      secondRetry = secondServer.start();
      void secondRetry.catch(() => undefined);
      await waitFor(() => fixture.worker.awaitCalls === awaitCallsBeforeRetry + 1);
      firstRetry = firstServer.start();
      void firstRetry.catch(() => undefined);

      let firstRetrySettled = false;
      let firstCompletion: unknown;
      void firstRetry
        .catch((error: unknown) => error)
        .then((result) => {
          firstCompletion = result;
          firstRetrySettled = true;
        });
      await waitFor(() => firstRetrySettled);
      expectDeferredCleanupCompletion(firstCompletion);
      expect(firstCompletion).not.toBe(secondRetryFailure);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledTimes(2);
      expect(
        firstStorage.storages.every((storage) => firstStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(secondResource).not.toHaveBeenCalled();
      expect(secondStorage.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);

      const firstTerminal = await firstServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(firstTerminal);
      expect(successfulResource).toHaveBeenCalledOnce();
      expect(retryingResource).toHaveBeenCalledTimes(2);

      const sessionDuringRetry = http2.connect(sibling.baseUrl);
      sessionDuringRetry.on("error", () => undefined);
      await once(sessionDuringRetry, "remoteSettings");
      sessionDuringRetry.close();
      await once(sessionDuringRetry, "close");

      releaseSecondRetry();
      releaseSecondRetry = undefined;
      const secondRetryError = await secondRetry.catch((error: unknown) => error);
      expect(secondRetryError).toBe(secondRetryFailure);
      expect(secondRetryError).not.toBe(firstCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(true);
      expect(secondResource).not.toHaveBeenCalled();

      const secondCompletion = await secondServer.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(secondCompletion);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(secondResource).toHaveBeenCalledOnce();
      expect(
        secondStorage.storages.every((storage) => secondStorage.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(fixture.worker.starts).toBe(3);
      expect(createHttp2Server).toHaveBeenCalledOnce();

      const secondTerminal = await secondServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(secondTerminal);

      const sessionAfterRetry = http2.connect(sibling.baseUrl);
      sessionAfterRetry.on("error", () => undefined);
      await once(sessionAfterRetry, "remoteSettings");
      sessionAfterRetry.close();
      await once(sessionAfterRetry, "close");

      await sibling.close();
      await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
    } finally {
      releaseSecondRetry?.();
      await firstStarting.catch(() => undefined);
      await secondStarting?.catch(() => undefined);
      await firstRetry?.catch(() => undefined);
      await secondRetry?.catch(() => undefined);
      await secondServer.start().catch(() => undefined);
      await secondServer.start().catch(() => undefined);
      await firstServer.start().catch(() => undefined);
      await sibling.close().catch(() => undefined);
      await firstContext.close().catch(() => undefined);
      await secondContext.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it.each([
    {
      kind: "empty",
      createScenario: () => {
        const failure = new AggregateError([], "empty failed-start resource close");
        return { failure, expectedFailures: [failure] };
      },
    },
    {
      kind: "nested-empty",
      createScenario: () => {
        const innerFailure = new AggregateError([], "nested empty failed-start resource close");
        const failure = new AggregateError(
          [innerFailure],
          "nested-empty failed-start resource close",
        );
        return { failure, expectedFailures: [innerFailure] };
      },
    },
  ])(
    "preserves $kind explicit-resource identity across failed-start aggregation and retry",
    async ({ createScenario }) => {
      const startupFailure = new Error("empty-aggregate startup recovery failed");
      let fixture: Awaited<ReturnType<typeof lifecycleFixture>> | undefined;
      let worker: HeldStartupWorker | undefined;
      let server: Server | undefined;
      let starting: ReturnType<Server["start"]> | undefined;
      let firstOutcome: unknown;
      let firstRunning: Awaited<ReturnType<Server["start"]>> | undefined;
      const firstStartState = { rejected: false };
      let retainingFirstOutcome: Promise<unknown> | undefined;
      let cleanupOutcome: unknown;
      let cleanupRunning: Awaited<ReturnType<Server["start"]> | undefined>;
      let retainingCleanupOutcome: Promise<unknown> | undefined;
      let terminalOutcome: unknown;
      let terminalRunning: Awaited<ReturnType<Server["start"]> | undefined>;
      let retainingTerminalOutcome: Promise<unknown> | undefined;

      try {
        const { failure: resourceFailure, expectedFailures } = createScenario();
        worker = new HeldStartupWorker([]);
        worker.rejectNextStart(startupFailure);
        fixture = await lifecycleFixture({ workers: [worker] });
        let failedResourceAttempts = 0;
        const closeFailedResource = vi.fn(() => {
          failedResourceAttempts += 1;
          if (failedResourceAttempts === 1) {
            throw resourceFailure;
          }
          if (failedResourceAttempts > 2) {
            throw new Error("Failed-start resource close repeated after success.");
          }
        });
        const closeSuccessfulResource = vi.fn();
        server = Server.atPort(0)
          .add(fixture.context)
          .addResource({ close: closeFailedResource })
          .addResource({ close: closeSuccessfulResource });
        starting = server.start();
        retainingFirstOutcome = starting.then(
          (running) => {
            firstRunning = running;
            firstOutcome = running;
            return running;
          },
          (error: unknown) => {
            firstStartState.rejected = true;
            firstOutcome = error;
            return error;
          },
        );

        await worker.startedWithin();
        worker.release();
        await retainingFirstOutcome;

        expect(firstOutcome).toBeInstanceOf(AggregateError);
        const initialErrors = (firstOutcome as AggregateError).errors;
        expect(initialErrors).toHaveLength(1 + expectedFailures.length);
        expect(initialErrors[0]).toBe(startupFailure);
        for (const [index, expectedFailure] of expectedFailures.entries()) {
          expect(initialErrors[index + 1]).toBe(expectedFailure);
        }
        expect(closeFailedResource).toHaveBeenCalledOnce();
        expect(closeSuccessfulResource).toHaveBeenCalledOnce();
        expect(worker.starts).toBe(1);
        expect(worker.stopCalls).toBe(1);
        expect(worker.awaitCalls).toBe(1);
        expect(worker.retireCalls).toBe(1);
        expect(createHttp2Server).not.toHaveBeenCalled();

        if (firstStartState.rejected) {
          retainingCleanupOutcome = server.start().then(
            (running) => {
              cleanupRunning = running;
              cleanupOutcome = running;
              return running;
            },
            (error: unknown) => {
              cleanupOutcome = error;
              return error;
            },
          );
          await retainingCleanupOutcome;
          expectDeferredCleanupCompletion(cleanupOutcome);
          expect(closeFailedResource).toHaveBeenCalledTimes(2);
          expect(closeSuccessfulResource).toHaveBeenCalledOnce();
          expect(worker.starts).toBe(1);
          expect(worker.stopCalls).toBe(1);
          expect(worker.awaitCalls).toBe(1);
          expect(worker.retireCalls).toBe(1);
          expect(createHttp2Server).not.toHaveBeenCalled();

          retainingTerminalOutcome = server.start().then(
            (running) => {
              terminalRunning = running;
              terminalOutcome = running;
              return running;
            },
            (error: unknown) => {
              terminalOutcome = error;
              return error;
            },
          );
          await retainingTerminalOutcome;
          expectConsumedFailedStartServer(terminalOutcome);
          expect(closeFailedResource).toHaveBeenCalledTimes(2);
          expect(closeSuccessfulResource).toHaveBeenCalledOnce();
          expect(worker.starts).toBe(1);
          expect(createHttp2Server).not.toHaveBeenCalled();
        }
      } finally {
        worker?.release();
        await retainingFirstOutcome?.catch(() => undefined);
        await firstRunning?.close().catch(() => undefined);
        if (
          firstStartState.rejected &&
          retainingCleanupOutcome === undefined &&
          server !== undefined
        ) {
          retainingCleanupOutcome = server.start().then(
            (running) => {
              cleanupRunning = running;
              cleanupOutcome = running;
              return running;
            },
            (error: unknown) => {
              cleanupOutcome = error;
              return error;
            },
          );
        }
        await retainingCleanupOutcome?.catch(() => undefined);
        await cleanupRunning?.close().catch(() => undefined);
        await retainingTerminalOutcome?.catch(() => undefined);
        await terminalRunning?.close().catch(() => undefined);
        await fixture?.context.close().catch(() => undefined);
        await fixture?.environment.close().catch(() => undefined);
        fixture?.dispose();
      }
    },
  );

  it("terminally rejects a consumed server after retrying immediate-safe cleanup", async () => {
    const events: string[] = [];
    const startupFailure = new Error("safe startup recovery failed");
    const cleanupFailure = new Error("resource cleanup failed");
    const duplicateResourceClose = new Error("resource closed more than once");
    const firstWorker = new HeldStartupWorker(events);
    firstWorker.rejectNextStart(startupFailure);
    const freshWorker = new HeldStartupWorker(events);
    freshWorker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [firstWorker, freshWorker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleSafeFailedStart")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const builtStorageCount = storageFactory.storages.length;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    let successfulResourceCloses = 0;
    const closeResource = vi.fn(() => {
      successfulResourceCloses += 1;
      if (successfulResourceCloses > 1) {
        throw duplicateResourceClose;
      }
    });
    let failedResourceAttempts = 0;
    const failResource = vi.fn(() => {
      failedResourceAttempts += 1;
      if (failedResourceAttempts === 1) {
        throw cleanupFailure;
      }
      if (failedResourceAttempts > 2) {
        throw duplicateResourceClose;
      }
    });
    const server = Server.atPort(0)
      .add(context)
      .addResource({ close: closeResource })
      .addResource({ close: failResource });
    const starting = server.start();
    void starting.catch(() => undefined);
    let fresh: { close(): Promise<void> } | undefined;

    try {
      expect(fixture.worker).toBe(firstWorker);
      await firstWorker.startedWithin();
      firstWorker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([startupFailure, cleanupFailure]);
      expect(createHttp2Server).not.toHaveBeenCalled();
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(failResource).toHaveBeenCalledOnce();
      expect(builtStorageCount).toBeGreaterThan(0);
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);

      const completion = await server.start().catch((error: unknown) => error);
      await closeIfRunningServer(completion);
      expectDeferredCleanupCompletion(completion);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(failResource).toHaveBeenCalledTimes(2);
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const firstTerminal = await server.start().catch((error: unknown) => error);
      await closeIfRunningServer(firstTerminal).catch(() => undefined);
      const secondTerminal = await server.start().catch((error: unknown) => error);
      await closeIfRunningServer(secondTerminal).catch(() => undefined);

      expectConsumedFailedStartServer(firstTerminal);
      expectConsumedFailedStartServer(secondTerminal);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(failResource).toHaveBeenCalledTimes(2);
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const freshContext = await fixture
        .createBuilder("LifecycleAfterConsumedFailedStart")
        .withStorageFactory(storageFactory)
        .buildAsync();
      fresh = await Server.atPort(0).add(freshContext).start();
      expect(storageFactory.storages.length).toBeGreaterThan(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(createHttp2Server).toHaveBeenCalledOnce();
      await fresh.close();

      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await resetServerEnvironmentForTest();
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await fresh?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("terminally rejects after immediate-safe cleanup succeeds with the original failure", async () => {
    const events: string[] = [];
    const startupFailure = new Error("immediate-safe startup failed");
    const duplicateResourceClose = new Error("immediate-safe resource closed twice");
    const firstWorker = new HeldStartupWorker(events);
    firstWorker.rejectNextStart(startupFailure);
    const freshWorker = new HeldStartupWorker(events);
    freshWorker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [firstWorker, freshWorker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleImmediateSafeTerminal")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const builtStorageCount = storageFactory.storages.length;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    let resourceCloses = 0;
    const closeResource = vi.fn(() => {
      resourceCloses += 1;
      if (resourceCloses > 1) {
        throw duplicateResourceClose;
      }
    });
    const server = Server.atPort(0).add(context).addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);
    let fresh: { close(): Promise<void> } | undefined;

    try {
      await firstWorker.startedWithin();
      firstWorker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBe(startupFailure);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const terminal = await server.start().catch((error: unknown) => error);
      await closeIfRunningServer(terminal).catch(() => undefined);
      expectConsumedFailedStartServer(terminal);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const freshContext = await fixture
        .createBuilder("LifecycleAfterImmediateSafeTerminal")
        .withStorageFactory(storageFactory)
        .buildAsync();
      fresh = await Server.atPort(0).add(freshContext).start();
      expect(storageFactory.storages.length).toBeGreaterThan(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(createHttp2Server).toHaveBeenCalledOnce();
      await fresh.close();

      expect(storageFactory.isOpen()).toBe(true);
      await resetServerEnvironmentForTest();
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await fresh?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("terminally rejects after retained cleanup succeeds with a retirement failure", async () => {
    const events: string[] = [];
    const startupFailure = new Error("retained terminal startup failed");
    const quiescenceFailure = new Error("retained terminal quiescence unavailable");
    const retirementFailure = new Error("retained terminal retirement failed");
    const duplicateResourceClose = new Error("retained terminal resource closed twice");
    const firstWorker = new HeldStartupWorker(events);
    firstWorker.rejectNextStart(startupFailure);
    firstWorker.failNextAwait(quiescenceFailure);
    firstWorker.failNextRetire(retirementFailure);
    const freshWorker = new HeldStartupWorker(events);
    freshWorker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [firstWorker, freshWorker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const context = await fixture
      .createBuilder("LifecycleRetirementErrorTerminal")
      .withStorageFactory(storageFactory)
      .buildAsync();
    const builtStorageCount = storageFactory.storages.length;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    let resourceCloses = 0;
    const closeResource = vi.fn(() => {
      resourceCloses += 1;
      if (resourceCloses > 1) {
        throw duplicateResourceClose;
      }
    });
    const server = Server.atPort(0).add(context).addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);
    let fresh: { close(): Promise<void> } | undefined;

    try {
      await firstWorker.startedWithin();
      firstWorker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        startupFailure,
        expect.objectContaining({ cause: quiescenceFailure }),
      ]);
      expect(closeContext).not.toHaveBeenCalled();
      expect(closeResource).not.toHaveBeenCalled();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(firstWorker.stopCalls).toBe(1);
      expect(firstWorker.awaitCalls).toBe(1);
      expect(firstWorker.retireCalls).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const cleanupFailure = await server.start().catch((error: unknown) => error);
      expect(cleanupFailure).toBe(retirementFailure);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(
        storageFactory.storages.every((storage) => storageFactory.closeCallsFor(storage) === 1),
      ).toBe(true);
      expect(firstWorker.awaitCalls).toBe(2);
      expect(firstWorker.retireCalls).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const terminal = await server.start().catch((error: unknown) => error);
      await closeIfRunningServer(terminal).catch(() => undefined);
      expectConsumedFailedStartServer(terminal);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(0);
      expect(createHttp2Server).not.toHaveBeenCalled();

      const freshContext = await fixture
        .createBuilder("LifecycleAfterRetirementErrorTerminal")
        .withStorageFactory(storageFactory)
        .buildAsync();
      fresh = await Server.atPort(0).add(freshContext).start();
      expect(storageFactory.storages.length).toBeGreaterThan(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(createHttp2Server).toHaveBeenCalledOnce();
      await fresh.close();

      expect(storageFactory.isOpen()).toBe(true);
      await resetServerEnvironmentForTest();
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await fresh?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("flattens nested retirement and dependency cleanup aggregates in stable order", async () => {
    const startupFailure = new Error("aggregate startup failed");
    const firstRetirementFailure = new Error("first worker retirement failed");
    const nestedRetirementFailure = new Error("nested worker retirement failed");
    const firstContextFailure = new Error("first context cleanup failed");
    const secondContextFailure = new Error("second context cleanup failed");
    const firstResourceFailure = new Error("first resource cleanup failed");
    const secondResourceFailure = new Error("second resource cleanup failed");
    const worker = new HeldStartupWorker([]);
    worker.rejectNextStart(startupFailure);
    worker.failNextRetire(
      new AggregateError(
        [
          firstRetirementFailure,
          new AggregateError([nestedRetirementFailure], "nested worker retirement"),
        ],
        "worker retirement failures",
      ),
    );
    const fixture = await lifecycleFixture({ workers: [worker] });
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    let contextCloseAttempts = 0;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in aggregate cleanup test.");
      }
      contextCloseAttempts += 1;
      return contextCloseAttempts === 1
        ? Promise.reject(
            new AggregateError(
              [
                firstContextFailure,
                new AggregateError([secondContextFailure], "nested context cleanup"),
              ],
              "context cleanup",
            ),
          )
        : closeFixtureContext();
    });
    let resourceCloseAttempts = 0;
    const closeResource = vi.fn(() => {
      resourceCloseAttempts += 1;
      if (resourceCloseAttempts === 1) {
        throw new AggregateError(
          [
            firstResourceFailure,
            new AggregateError([secondResourceFailure], "nested resource cleanup"),
          ],
          "resource cleanup",
        );
      }
    });
    const server = Server.atPort(0).add(fixture.context).addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        startupFailure,
        firstRetirementFailure,
        nestedRetirementFailure,
        firstContextFailure,
        secondContextFailure,
        firstResourceFailure,
        secondResourceFailure,
      ]);
      expect(serverEnvironmentAccess.failedStartPending(fixture.environment)).toBe(false);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(closeContext).toHaveBeenCalledTimes(2);
      expect(closeResource).toHaveBeenCalledTimes(2);
      expect(worker.starts).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(1);
      expect(worker.retireCalls).toBe(1);
      expect(createHttp2Server).not.toHaveBeenCalled();
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("coalesces repeated unsafe rollback retries without repeating reported causes", async () => {
    const events: string[] = [];
    const startupFailure = new Error("retry startup recovery failed");
    const firstQuiescenceFailure = new Error("first retry quiescence unavailable");
    const secondQuiescenceFailure = new Error("second retry quiescence unavailable");
    const worker = new HeldStartupWorker(events);
    worker.rejectNextStart(startupFailure);
    worker.failNextAwait(firstQuiescenceFailure);
    worker.failNextAwait(secondQuiescenceFailure);
    const fixture = await lifecycleFixture({ events, workers: [worker] });
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in repeated rollback retry test.");
      }
      return closeFixtureContext();
    });
    const closeResource = vi.fn();
    const server = Server.atPort(0).add(fixture.context).addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const startFailure = await starting.catch((error: unknown) => error);
      expect((startFailure as AggregateError).errors).toEqual([
        startupFailure,
        expect.objectContaining({ cause: firstQuiescenceFailure }),
      ]);

      const retryFailure = await server.start().catch((error: unknown) => error);
      expect(retryFailure).toMatchObject({ cause: secondQuiescenceFailure });
      expect(retryFailure).not.toBe(startupFailure);
      expect(closeContext).not.toHaveBeenCalled();
      expect(closeResource).not.toHaveBeenCalled();
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(0);

      const releaseRetry = worker.holdNextAwait();
      const firstRetry = server.start();
      void firstRetry.catch(() => undefined);
      await waitFor(() => worker.awaitCalls === 3);
      const secondRetry = server.start();
      void secondRetry.catch(() => undefined);
      expect(secondRetry).toBe(firstRetry);
      releaseRetry();
      const [firstCompletion, secondCompletion] = await Promise.all([
        firstRetry.catch((error: unknown) => error),
        secondRetry.catch((error: unknown) => error),
      ]);

      expect(secondCompletion).toBe(firstCompletion);
      expectDeferredCleanupCompletion(firstCompletion);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeResource).toHaveBeenCalledOnce();
      expect(worker.starts).toBe(1);
      expect(worker.stopCalls).toBe(1);
      expect(worker.awaitCalls).toBe(3);
      expect(worker.retireCalls).toBe(1);
      expect(createHttp2Server).not.toHaveBeenCalled();
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retries only failed context and resource cleanup indexes", async () => {
    const events: string[] = [];
    const startupFailure = new Error("partial cleanup startup failed");
    const quiescenceFailure = new Error("partial cleanup quiescence unavailable");
    const contextFailure = new Error("context close failed");
    const resourceFailure = new Error("resource close failed");
    const worker = new HeldStartupWorker(events);
    worker.rejectNextStart(startupFailure);
    worker.failNextAwait(quiescenceFailure);
    const fixture = await lifecycleFixture({ events, workers: [worker] });
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    let contextCloseAttempts = 0;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in partial cleanup retry test.");
      }
      contextCloseAttempts += 1;
      return contextCloseAttempts === 1 ? Promise.reject(contextFailure) : closeFixtureContext();
    });
    const closeSuccessfulResource = vi.fn();
    let failedResourceAttempts = 0;
    const closeFailedResource = vi.fn(() => {
      failedResourceAttempts += 1;
      if (failedResourceAttempts === 1) {
        throw resourceFailure;
      }
    });
    const server = Server.atPort(0)
      .add(fixture.context)
      .addResource({ close: closeSuccessfulResource })
      .addResource({ close: closeFailedResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const startFailure = await starting.catch((error: unknown) => error);
      expect((startFailure as AggregateError).errors).toEqual([
        startupFailure,
        expect.objectContaining({ cause: quiescenceFailure }),
      ]);

      const cleanupFailure = await server.start().catch((error: unknown) => error);
      expect(cleanupFailure).toBeInstanceOf(AggregateError);
      expect((cleanupFailure as AggregateError).errors).toEqual([contextFailure, resourceFailure]);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(closeSuccessfulResource).toHaveBeenCalledOnce();
      expect(closeFailedResource).toHaveBeenCalledOnce();
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);

      const completion = await server.start().catch((error: unknown) => error);
      expectDeferredCleanupCompletion(completion);
      expect(closeContext).toHaveBeenCalledTimes(2);
      expect(closeSuccessfulResource).toHaveBeenCalledOnce();
      expect(closeFailedResource).toHaveBeenCalledTimes(2);
      expect(worker.awaitCalls).toBe(2);
      expect(worker.retireCalls).toBe(1);
      expect(createHttp2Server).not.toHaveBeenCalled();
    } finally {
      closeContext.mockRestore();
      worker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retries caller-owned unsafe attachment cleanup without restarting the server", async () => {
    const events: string[] = [];
    const startupFailure = new Error("startup recovery failed");
    const quiescenceFailure = new Error("startup quiescence unavailable");
    const firstWorker = new HeldStartupWorker(events);
    firstWorker.rejectNextStart(startupFailure);
    firstWorker.failNextAwait(quiescenceFailure);
    const freshWorker = new HeldStartupWorker(events);
    freshWorker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [firstWorker, freshWorker],
      settings: { storageFactory },
    });
    await fixture.context.close();
    const contextBuilder = fixture.createBuilder("LifecycleFailedStart");
    let resourceCloses = 0;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    const server = Server.atPort(0)
      .add(contextBuilder)
      .addResource({
        close() {
          resourceCloses += 1;
          events.push("resource");
        },
      });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await firstWorker.startedWithin();
      expect(createHttp2Server).not.toHaveBeenCalled();
      firstWorker.release();
      const startFailure = await starting.catch((error: unknown) => error);
      const builtStorageCount = storageFactory.storages.length;

      expect(startFailure).toBeInstanceOf(AggregateError);
      expect((startFailure as AggregateError).errors).toEqual([
        startupFailure,
        expect.objectContaining({ cause: quiescenceFailure }),
      ]);
      expect(createHttp2Server).not.toHaveBeenCalled();
      expect(firstWorker.starts).toBe(1);
      expect(firstWorker.stopCalls).toBe(1);
      expect(firstWorker.awaitCalls).toBe(1);
      expect(firstWorker.retireCalls).toBe(0);
      expect(closeContext).not.toHaveBeenCalled();
      expect(resourceCloses).toBe(0);
      expect(builtStorageCount).toBeGreaterThan(0);
      expect(storageFactory.storages.every((storage) => storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);

      const cleanupFailure = await server.start().catch((error: unknown) => error);

      expect(cleanupFailure).toBeInstanceOf(Error);
      expect(cleanupFailure).not.toBeInstanceOf(AggregateError);
      expect((cleanupFailure as Error).constructor).toBe(Error);
      expect((cleanupFailure as Error).message).toBe(
        "Server deferred cleanup completed after an earlier failed start.",
      );
      expect(Object.hasOwn(cleanupFailure as object, "cause")).toBe(false);
      expect(createHttp2Server).not.toHaveBeenCalled();
      expect(storageFactory.storages).toHaveLength(builtStorageCount);
      expect(firstWorker.starts).toBe(1);
      expect(firstWorker.stopCalls).toBe(1);
      expect(firstWorker.awaitCalls).toBe(2);
      expect(firstWorker.retireCalls).toBe(1);
      expect(closeContext).toHaveBeenCalledOnce();
      expect(resourceCloses).toBe(1);
      expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      expect(events.slice(0, 6)).toEqual([
        "recovery",
        "stop",
        "await",
        "await",
        "retire",
        "resource",
      ]);

      const freshContext = await fixture.createContext("LifecycleAfterFailedStart");
      const freshStarting = Server.atPort(0).add(freshContext).start();
      const fresh = await freshStarting;
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(events.indexOf("retire")).toBeLessThan(events.lastIndexOf("recovery"));
      await fresh.close();

      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await resetServerEnvironmentForTest();
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await fixture.context.close();
      await resetServerEnvironmentForTest().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("installs a deterministic attachment worker only once before lifecycle use", async () => {
    ServerEnvironment.when(EnvironmentType.Local).use({});
    const first = ServerEnvironment.instance();
    const worker = new HeldStartupWorker([]);
    serverEnvironmentAccess.installTestAttachments(first, () => worker);
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(first, () => worker);
    }).toThrow("Test attachments may only be installed before environment lifecycle use.");

    expect(serverEnvironmentAccess.failedStartPending(first)).toBe(false);
    await resetServerEnvironmentForTest();

    ServerEnvironment.when(EnvironmentType.Local).use({});
    const observed = ServerEnvironment.instance();
    expect(serverEnvironmentAccess.failedStartPending(observed)).toBe(false);
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(observed, () => worker);
    }).not.toThrow();
    await resetServerEnvironmentForTest();

    ServerEnvironment.when(EnvironmentType.Local).use({});
    const used = ServerEnvironment.instance();
    const handle = await serverEnvironmentAccess.attach(used, {
      ownership: "caller",
      descriptors: [],
    });
    let rejected = false;
    try {
      serverEnvironmentAccess.installTestAttachments(used, () => worker);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    if (rejected) {
      await serverEnvironmentAccess.detach(used, handle);
      await resetServerEnvironmentForTest();
    }

    ServerEnvironment.when(EnvironmentType.Local).use({});
    const closed = ServerEnvironment.instance();
    await resetServerEnvironmentForTest();
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(closed, () => worker);
    }).toThrow("Test attachments may only be installed before environment lifecycle use.");
  });

  it("observes exact-handle endpoint safety without mutating its active attachment", async () => {
    const first = await lifecycleFixture();
    first.worker.release();
    let firstHandle: EnvironmentAttachmentHandle | undefined;

    try {
      firstHandle = await serverEnvironmentAccess.attach(first.environment, {
        ownership: "caller",
        descriptors: [boundedContextAccess.delivery(first.context)],
      });

      expect(serverEnvironmentAccess.detachRetryPending(first.environment, firstHandle)).toBe(
        false,
      );
      expect(serverEnvironmentAccess.endpointSafe(first.environment, firstHandle)).toBe(false);
      expect(serverEnvironmentAccess.endpointSafe(first.environment, firstHandle)).toBe(false);
      expect(first.worker.stopCalls).toBe(0);
      expect(first.worker.awaitCalls).toBe(0);
      expect(first.worker.retireCalls).toBe(0);

      await serverEnvironmentAccess.detach(first.environment, firstHandle);
      expect(first.worker.stopCalls).toBe(1);
      expect(first.worker.awaitCalls).toBe(1);
      expect(first.worker.retireCalls).toBe(1);
    } finally {
      if (firstHandle !== undefined) {
        await serverEnvironmentAccess.detach(first.environment, firstHandle).catch(() => undefined);
      }
      await first.context.close().catch(() => undefined);
      await resetServerEnvironmentForTest().catch(() => undefined);
      first.dispose();
    }
  });
});

function once(target: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => target.once(event, resolve));
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, ms = 250): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Lifecycle condition was not reached in time.");
    }
    await nextTurn();
  }
}

function expectDeferredCleanupCompletion(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe(
    "Server deferred cleanup completed after an earlier failed start.",
  );
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
}

function expectConsumedFailedStartServer(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe(
    "Server cannot restart after failed-start cleanup has completed.",
  );
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
}

async function closeIfRunningServer(value: unknown): Promise<void> {
  if (value instanceof Error || typeof value !== "object" || value === null) {
    return;
  }
  const close: unknown = Reflect.get(value, "close");
  if (typeof close === "function") {
    await Reflect.apply(close, value, []);
  }
}

async function createPortBlocker(): Promise<{ readonly port: number; close(): Promise<void> }> {
  const server = http2.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Port blocker did not expose a TCP address.");
  }
  return Object.freeze({
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  });
}

function failListenerNetwork(
  server: http2.Http2Server,
  listenerFailure: Error,
  networkFailures: readonly Error[],
): void {
  const failures = [...networkFailures];
  let networkOpen = true;
  Object.defineProperties(server, {
    listen: {
      configurable: true,
      value: (...args: unknown[]) => {
        void args;
        setImmediate(() => server.emit("error", listenerFailure));
        return server;
      },
    },
    listening: {
      configurable: true,
      get: () => networkOpen,
    },
    close: {
      configurable: true,
      value: (callback?: (error?: Error) => void) => {
        const failure = failures.shift();
        if (failure === undefined) {
          networkOpen = false;
        }
        setImmediate(() => callback?.(failure));
        return server;
      },
    },
  });
}

interface NetworkCloseProbe {
  calls(): number;
}

function trackNetworkClose(
  server: http2.Http2Server,
  closeFailures: readonly Error[] = [],
): NetworkCloseProbe {
  const failures = [...closeFailures];
  const close = server.close.bind(server);
  let calls = 0;
  Object.defineProperty(server, "close", {
    configurable: true,
    value: (callback?: (error?: Error) => void) => {
      calls += 1;
      const failure = failures.shift();
      if (failure !== undefined) {
        setImmediate(() => callback?.(failure));
        return server;
      }
      return close(callback);
    },
  });
  return Object.freeze({ calls: () => calls });
}

async function expectConnectable(server: { readonly baseUrl: string }): Promise<void> {
  const session = http2.connect(server.baseUrl);
  session.on("error", () => undefined);
  await once(session, "remoteSettings");
  session.close();
  await once(session, "close");
}
