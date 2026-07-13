import * as http2 from "node:http2";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoundedContext, Server, ServerEnvironment } from "../../src/index.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { HeldStartupWorker, lifecycleFixture } from "./server-lifecycle-fixture.js";

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

  it("installs a deterministic attachment worker only once before lifecycle use", async () => {
    const first = ServerEnvironment.local();
    const worker = new HeldStartupWorker([]);
    serverEnvironmentAccess.installTestAttachments(first, () => worker);
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(first, () => worker);
    }).toThrow("Test attachments may only be installed before environment lifecycle use.");

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
