import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
  type RuntimeStateErrorCode,
  type ServerRuntimeLifecycle,
  type ServerRuntimeState,
  type ServerRuntimeWork,
} from "../../src/runtime/runtime.js";

describe("SingleProcessServerRuntime", () => {
  it("starts and closes with deterministic lifecycle states", async () => {
    const runtime = new SingleProcessServerRuntime();

    expectTypeOf(runtime).toExtend<ServerRuntimeLifecycle>();
    expectTypeOf<ServerRuntimeState>().toEqualTypeOf<
      "created" | "running" | "closing" | "closed"
    >();
    expectTypeOf<RuntimeStateErrorCode>().toEqualTypeOf<"INVALID_RUNTIME_STATE">();
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
      code: "INVALID_RUNTIME_STATE",
      operation: "start",
      state: "closed",
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
    expect(captureStateError(() => runtime.enqueue(() => undefined))).toMatchObject({
      code: "INVALID_RUNTIME_STATE",
      operation: "enqueue",
      state: "created",
    });
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

  it("rejects reentrant work intake while a work item is active", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];

    await runtime.start();

    const completion = runtime.enqueue(() => {
      observed.push("outer");

      expect(() => runtime.enqueue(() => undefined)).toThrow(ServerRuntimeStateError);
      expect(captureStateError(() => runtime.enqueue(() => undefined))).toMatchObject({
        code: "INVALID_RUNTIME_STATE",
        operation: "enqueue",
        state: "running-work",
      });
      expect(() => runtime.enqueue(() => undefined)).toThrow(
        "Cannot enqueue runtime work from an active runtime work item.",
      );
    });

    await completion;
    await runtime.enqueue(() => {
      observed.push("later");
    });

    expect(observed).toEqual(["outer", "later"]);
  });

  it("queues external work while another work item is active", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];
    let releaseWork!: () => void;
    const workCanFinish = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });

    await runtime.start();

    const first = runtime.enqueue(async () => {
      observed.push("first-start");
      await workCanFinish;
      observed.push("first-end");
    });

    await Promise.resolve();

    const second = runtime.enqueue(() => {
      observed.push("second");
    });

    expect(observed).toEqual(["first-start"]);

    releaseWork();
    await Promise.all([first, second]);

    expect(observed).toEqual(["first-start", "first-end", "second"]);
  });

  it("accepts follow-up work after active work has settled", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];
    let enqueueFollowUp!: () => Promise<void>;

    await runtime.start();

    await runtime.enqueue(() => {
      enqueueFollowUp = () =>
        runtime.enqueue(() => {
          observed.push("follow-up");
        });
      observed.push("outer");
    });
    await enqueueFollowUp();

    expect(observed).toEqual(["outer", "follow-up"]);
  });

  it("rejects close from active work", async () => {
    const runtime = new SingleProcessServerRuntime();
    const observed: string[] = [];

    await runtime.start();

    const completion = runtime.enqueue(async () => {
      observed.push("outer");

      await expect(runtime.close()).rejects.toMatchObject({
        code: "INVALID_RUNTIME_STATE",
        operation: "close",
        state: "running-work",
      });
      await expect(runtime.close()).rejects.toThrow(
        "Cannot close server runtime from an active runtime work item.",
      );
      observed.push("after-rejection");
    });

    await completion;
    await runtime.close();

    expect(runtime.state).toBe("closed");
    expect(observed).toEqual(["outer", "after-rejection"]);
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
    expect(captureStateError(() => runtime.enqueue(() => undefined))).toMatchObject({
      code: "INVALID_RUNTIME_STATE",
      operation: "enqueue",
      state: "closing",
    });
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

function captureStateError(operation: () => unknown): ServerRuntimeStateError {
  try {
    operation();
  } catch (error) {
    if (error instanceof ServerRuntimeStateError) {
      return error;
    }
  }

  throw new Error("Expected ServerRuntimeStateError.");
}
