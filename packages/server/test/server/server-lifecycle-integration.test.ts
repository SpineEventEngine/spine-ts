import * as http2 from "node:http2";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoundedContext, Server, ServerEnvironment } from "../../src/index.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import {
  HeldStartupWorker,
  LifecycleTrackingStorageFactory,
  lifecycleFixture,
} from "./server-lifecycle-fixture.js";

const createHttp2Server = vi.hoisted(() => vi.fn());

vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  return {
    ...actual,
    createServer(...args: Parameters<typeof actual.createServer>) {
      createHttp2Server();
      return actual.createServer(...args);
    },
  };
});

describe("Server lifecycle integration", () => {
  beforeEach(() => createHttp2Server.mockClear());

  it("waits for attached startup recovery before opening the listener", async () => {
    const fixture = await lifecycleFixture();
    const starting = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .start();

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
      await expect(fixture.environment.close()).resolves.toBeUndefined();
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
      environment: {
        delivery: { close: () => events.push("facility") },
        ownsDelivery: true,
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
    const server = Server.atPort(0, {
      environment: fixture.environment,
      ownsEnvironment: true,
    })
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

  it("reuses a caller-owned environment through a fresh server attachment", async () => {
    const fixture = await lifecycleFixture();
    const firstStart = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const first = await firstStart;
      await first.close();

      const freshContext = await fixture.createContext("LifecycleFresh");
      const fresh = await Server.atPort(0, { environment: fixture.environment })
        .add(freshContext)
        .start();
      await fresh.close();

      expect(fixture.worker.starts).toBe(2);
      await expect(fixture.environment.close()).resolves.toBeUndefined();
    } finally {
      fixture.worker.release();
      await firstStart.then(
        (running) => running.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("coalesces concurrent starts into one build, attachment, and running result", async () => {
    const fixture = await lifecycleFixture();
    const server = Server.atPort(0, { environment: fixture.environment }).add(fixture.context);
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
    const starting = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .start();

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

  it("detaches before eligible owned cleanup after listener bind failure", async () => {
    const blocker = await Server.atPort(0).start();
    const events: string[] = [];
    const fixture = await lifecycleFixture({
      events,
      environment: {
        delivery: { close: () => events.push("facility") },
        ownsDelivery: true,
      },
    });
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
    const starting = Server.atPort(blocker.port, {
      environment: fixture.environment,
      ownsEnvironment: true,
    })
      .add(fixture.context)
      .addResource({ close: () => events.push("resource") })
      .start();
    void starting.catch(() => undefined);

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      await expect(starting).rejects.toMatchObject({ code: "EADDRINUSE" });
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
      await blocker.close();
      fixture.dispose();
    }
  });

  it("retains endpoint dependencies when listener cleanup cannot establish quiescence", async () => {
    const blocker = await Server.atPort(0).start();
    const events: string[] = [];
    const quiescenceFailure = new Error("quiescence unavailable");
    const fixture = await lifecycleFixture({
      events,
      awaitFailure: quiescenceFailure,
      environment: {
        delivery: { close: () => events.push("facility") },
        ownsDelivery: true,
      },
    });
    const closeFixtureContext = fixture.context.close.bind(fixture.context);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this !== fixture.context) {
        throw new Error("Unexpected context close in unsafe cleanup test.");
      }
      events.push("context");
      return closeFixtureContext();
    });
    const starting = Server.atPort(blocker.port, {
      environment: fixture.environment,
      ownsEnvironment: true,
    })
      .add(fixture.context)
      .addResource({ close: () => events.push("resource") })
      .start();
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
    } finally {
      closeContext.mockRestore();
      fixture.worker.release();
      await starting.catch(() => undefined);
      await blocker.close();
      fixture.dispose();
    }
  });

  it("retries failed immediate-safe cleanup without rebuilding or reattaching", async () => {
    const events: string[] = [];
    const startupFailure = new Error("safe startup recovery failed");
    const cleanupFailure = new Error("resource cleanup failed");
    const firstWorker = new HeldStartupWorker(events);
    firstWorker.rejectNextStart(startupFailure);
    const freshWorker = new HeldStartupWorker(events);
    freshWorker.release();
    const storageFactory = new LifecycleTrackingStorageFactory(events);
    const fixture = await lifecycleFixture({
      events,
      workers: [firstWorker, freshWorker],
      environment: { storageFactory, ownsStorageFactory: true },
    });
    await fixture.context.close();
    const contextBuilder = fixture
      .createBuilder("LifecycleSafeFailedStart")
      .withStorageFactory(storageFactory);
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    const closeResource = vi.fn();
    let failedResourceAttempts = 0;
    const failResource = vi.fn(() => {
      failedResourceAttempts += 1;
      if (failedResourceAttempts === 1) {
        throw cleanupFailure;
      }
    });
    const server = Server.atPort(0, { environment: fixture.environment })
      .add(contextBuilder)
      .addResource({ close: closeResource })
      .addResource({ close: failResource });
    const starting = server.start();
    void starting.catch(() => undefined);
    let restarted: { close(): Promise<void> } | undefined;

    try {
      expect(fixture.worker).toBe(firstWorker);
      await firstWorker.startedWithin();
      firstWorker.release();
      const failure = await starting.catch((error: unknown) => error);
      const builtStorageCount = storageFactory.storages.length;

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

      restarted = await server.start();
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(storageFactory.storages.length).toBeGreaterThan(builtStorageCount);
      expect(createHttp2Server).toHaveBeenCalledOnce();
      await restarted.close();

      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await fixture.environment.close();
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await restarted?.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("flattens safe attachment and dependency cleanup aggregates in stable order", async () => {
    const startupFailure = new Error("aggregate startup failed");
    const reportingFailure = new Error("aggregate reporting failed");
    const retirementFailure = new Error("aggregate retirement failed");
    const firstContextFailure = new Error("first context cleanup failed");
    const secondContextFailure = new Error("second context cleanup failed");
    const firstResourceFailure = new Error("first resource cleanup failed");
    const secondResourceFailure = new Error("second resource cleanup failed");
    const worker = new HeldStartupWorker([]);
    worker.rejectNextStart(startupFailure);
    worker.failNextRetire(
      new AggregateError(
        [reportingFailure, new AggregateError([retirementFailure], "nested retirement")],
        "post-quiescence failures",
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
    const server = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .addResource({ close: closeResource });
    const starting = server.start();
    void starting.catch(() => undefined);

    try {
      await worker.startedWithin();
      worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        startupFailure,
        reportingFailure,
        retirementFailure,
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
      await fixture.environment.close().catch(() => undefined);
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
    const server = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .addResource({ close: closeResource });
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
      await fixture.environment.close().catch(() => undefined);
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
    const server = Server.atPort(0, { environment: fixture.environment })
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
      await fixture.environment.close().catch(() => undefined);
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
      environment: { storageFactory, ownsStorageFactory: true },
    });
    await fixture.context.close();
    const contextBuilder = fixture.createBuilder("LifecycleFailedStart");
    let resourceCloses = 0;
    const closeContext = vi.spyOn(BoundedContext.prototype, "close");
    const server = Server.atPort(0, { environment: fixture.environment })
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
      const freshStarting = Server.atPort(0, { environment: fixture.environment })
        .add(freshContext)
        .start();
      const fresh = await freshStarting;
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
      expect(events.indexOf("retire")).toBeLessThan(events.lastIndexOf("recovery"));
      await fresh.close();

      expect(storageFactory.isOpen()).toBe(true);
      expect(storageFactory.closeCalls).toBe(0);
      await fixture.environment.close();
      expect(storageFactory.closeCalls).toBe(1);
    } finally {
      closeContext.mockRestore();
      firstWorker.release();
      freshWorker.release();
      await starting.catch(() => undefined);
      await serverEnvironmentAccess.retryFailedStart(fixture.environment).catch(() => undefined);
      await fixture.context.close();
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("installs a deterministic attachment worker only once before lifecycle use", async () => {
    const first = ServerEnvironment.local();
    const worker = new HeldStartupWorker([]);
    serverEnvironmentAccess.installTestAttachments(first, () => worker);
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(first, () => worker);
    }).toThrow("Test attachments may only be installed before environment lifecycle use.");

    const observed = ServerEnvironment.local();
    expect(serverEnvironmentAccess.failedStartPending(observed)).toBe(false);
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(observed, () => worker);
    }).not.toThrow();
    await observed.close();

    const used = ServerEnvironment.local();
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
      await used.close();
    }

    const closed = ServerEnvironment.local();
    await closed.close();
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(closed, () => worker);
    }).toThrow("Test attachments may only be installed before environment lifecycle use.");
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

async function closeIfRunningServer(value: unknown): Promise<void> {
  if (value instanceof Error || typeof value !== "object" || value === null) {
    return;
  }
  const close: unknown = Reflect.get(value, "close");
  if (typeof close === "function") {
    await Reflect.apply(close, value, []);
  }
}
