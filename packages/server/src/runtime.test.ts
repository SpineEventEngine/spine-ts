import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
  type ServerRuntimeLifecycle,
  type ServerRuntimeState,
  type ServerRuntimeWork,
} from "./runtime.js";

describe("SingleProcessServerRuntime", () => {
  it("starts and closes with deterministic lifecycle states", async () => {
    const runtime = new SingleProcessServerRuntime();

    expectTypeOf(runtime).toExtend<ServerRuntimeLifecycle>();
    expectTypeOf<ServerRuntimeState>().toEqualTypeOf<
      "created" | "running" | "closing" | "closed"
    >();
    expectTypeOf<ServerRuntimeWork>().toEqualTypeOf<() => void | Promise<void>>();
    expect(runtime.state).toBe("created");

    await runtime.start();

    expect(runtime.state).toBe("running");

    await runtime.start();

    expect(runtime.state).toBe("running");

    const close = runtime.close();

    expect(runtime.state).toBe("closing");

    await close;

    expect(runtime.state).toBe("closed");
    await runtime.close();
    expect(runtime.state).toBe("closed");
    await expect(runtime.start()).rejects.toMatchObject({
      code: "closed",
      operation: "start",
    });
  });

  it("closes without start and keeps close idempotent", async () => {
    const runtime = new SingleProcessServerRuntime();

    await runtime.close();
    await runtime.close();

    expect(runtime.state).toBe("closed");
  });

  it("rejects work intake before start", () => {
    const runtime = new SingleProcessServerRuntime();

    expect(() => runtime.enqueue(() => undefined)).toThrow(ServerRuntimeStateError);
    expect(() => runtime.enqueue(() => undefined)).toThrow(
      "Cannot enqueue runtime work while server runtime is created.",
    );
  });

  it("runs accepted work asynchronously after intake returns", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];

    await runtime.start();

    const completion = runtime.enqueue(() => {
      observed.push("queued-work");
    });

    observed.push("after-intake");

    expect(observed).toEqual(["after-intake"]);

    await completion;

    expect(observed).toEqual(["after-intake", "queued-work"]);
  });

  it("runs queued work in intake order without synchronous overlap", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    await runtime.start();

    const first = runtime.enqueue(async () => {
      observed.push("first-start");
      await firstCanFinish;
      observed.push("first-end");
    });
    const second = runtime.enqueue(() => {
      observed.push("second");
    });

    observed.push("after-intake");

    expect(observed).toEqual(["after-intake"]);

    await Promise.resolve();

    expect(observed).toEqual(["after-intake", "first-start"]);

    releaseFirst();

    await Promise.all([first, second]);

    expect(observed).toEqual(["after-intake", "first-start", "first-end", "second"]);
  });

  it("prevents new work while closing and drains already accepted work", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];
    let releaseWork!: () => void;
    const workCanFinish = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    await runtime.start();

    const workStarted = new Promise<void>((resolve) => {
      void runtime.enqueue(async () => {
        observed.push("started");
        resolve();
        await workCanFinish;
        observed.push("finished");
      });
    });

    await workStarted;

    const close = runtime.close();

    expect(runtime.state).toBe("closing");
    expect(() => runtime.enqueue(() => undefined)).toThrow(ServerRuntimeStateError);
    expect(() => runtime.enqueue(() => undefined)).toThrow(
      "Cannot enqueue runtime work while server runtime is closing.",
    );
    expect(observed).toEqual(["started"]);

    releaseWork();

    await close;

    expect(runtime.state).toBe("closed");
    expect(observed).toEqual(["started", "finished"]);
    expect(() => runtime.enqueue(() => undefined)).toThrow(
      "Cannot enqueue runtime work while server runtime is closed.",
    );
  });

  it("returns failed work to its caller and continues later queued work", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];

    await runtime.start();

    const failed = runtime.enqueue(() => {
      throw new Error("boom");
    });
    const later = runtime.enqueue(() => {
      observed.push("later");
    });

    await expect(failed).rejects.toThrow("boom");
    await later;

    expect(observed).toEqual(["later"]);
  });
});
