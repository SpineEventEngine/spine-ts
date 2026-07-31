import { describe, expect, it, vi } from "vitest";

import { LocalChatLifecycle } from "../src/local-lifecycle.js";

describe("LocalChatLifecycle", () => {
  it("closes every acquired resource when a later assembly step fails", async () => {
    const events: string[] = [];
    const backend = {
      close: vi.fn(() =>
        Promise.resolve().then(() => {
          events.push("backend");
        }),
      ),
    };
    const subscriptions = {
      close: vi.fn(() =>
        Promise.resolve().then(() => {
          events.push("subscriptions");
        }),
      ),
    };
    await expect(
      LocalChatLifecycle.acquire((resources) => {
        resources.acquire(backend);
        resources.acquire(subscriptions);
        return Promise.reject(new Error("bind failed"));
      }),
    ).rejects.toThrow("bind failed");
    expect(events).toEqual(["subscriptions", "backend"]);
  });

  it("lets subscription shutdown release an active listener close", async () => {
    let releaseListener: (() => void) | undefined;
    const listener = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseListener = resolve;
          }),
      ),
    };
    const subscriptions = {
      close: vi.fn(() => {
        releaseListener?.();
        return Promise.resolve();
      }),
    };
    const lifecycle = new LocalChatLifecycle(
      listener,
      subscriptions,
      { close: () => Promise.resolve() },
      (work) => work,
    );

    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(listener.close).toHaveBeenCalledOnce();
    expect(subscriptions.close).toHaveBeenCalledOnce();
  });

  it("continues backend cleanup after listener timeout and retains its in-flight close for retry", async () => {
    let releaseListener: (() => void) | undefined;
    const listener = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseListener = resolve;
          }),
      ),
    };
    const backend = { close: vi.fn(() => Promise.resolve()) };
    const within = vi
      .fn<(work: Promise<void>, label: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("listener close timed out."))
      .mockImplementation((work) => work);
    const lifecycle = new LocalChatLifecycle(
      listener,
      { close: () => Promise.resolve() },
      backend,
      within,
    );

    await expect(lifecycle.close()).rejects.toThrow("Local Chat cleanup failed");
    expect(backend.close).toHaveBeenCalledOnce();
    const retry = lifecycle.close();
    expect(listener.close).toHaveBeenCalledOnce();
    releaseListener?.();
    await expect(retry).resolves.toBeUndefined();
    expect(listener.close).toHaveBeenCalledOnce();
    expect(backend.close).toHaveBeenCalledOnce();
  });

  it("starts listener close before subscription close, shares callers, and retries failed phases", async () => {
    const events: string[] = [];
    const listener = {
      close: vi.fn(() =>
        Promise.resolve().then(() => {
          events.push("listener");
        }),
      ),
    };
    const subscriptions = {
      close: vi.fn(() =>
        Promise.resolve().then(() => {
          events.push("subscriptions");
        }),
      ),
    };
    const backend = {
      close: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("retry"))
        .mockResolvedValue(),
    };
    const lifecycle = new LocalChatLifecycle(listener, subscriptions, backend, (work) => work);
    const first = lifecycle.close();
    expect(lifecycle.close()).toBe(first);
    await expect(first).rejects.toThrow("Local Chat cleanup failed");
    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(events).toEqual(["listener", "subscriptions"]);
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(subscriptions.close).toHaveBeenCalledTimes(1);
    expect(backend.close).toHaveBeenCalledTimes(2);
  });

  it("aggregates rollback and rejected cleanup phases before retrying them", async () => {
    await expect(
      LocalChatLifecycle.acquire((resources) => {
        resources.acquire({ close: () => Promise.reject(new Error("rollback")) });
        return Promise.reject(new Error("assembly"));
      }),
    ).rejects.toThrow("Local Chat assembly failed");

    const listener = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("listener"))
      .mockResolvedValue();
    const subscriptions = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("subscriptions"))
      .mockResolvedValue();
    const backend = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("backend"));
    const lifecycle = new LocalChatLifecycle(
      { close: listener },
      { close: subscriptions },
      { close: backend },
      (work) => work,
    );
    await expect(lifecycle.close()).rejects.toThrow("Local Chat cleanup failed");
    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(subscriptions).toHaveBeenCalledTimes(2);
    expect(backend).toHaveBeenCalledTimes(2);
  });
});
