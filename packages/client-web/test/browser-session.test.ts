import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSession } from "../src/index.js";

describe("BrowserSession", () => {
  const sessions: BrowserSession[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close()));
    vi.unstubAllGlobals();
  });

  it("keeps bearer credentials in memory and returns fresh metadata after replacement or clear", () => {
    const session = remember(BrowserSession.bearer({ token: "first-token", maxRequestMs: 100 }));

    expect(session.requestMetadata().get("authorization")).toBe("Bearer first-token");
    session.replaceBearer("second-token");
    expect(session.requestMetadata().get("authorization")).toBe("Bearer second-token");
    session.clearBearer();
    expect(session.requestMetadata().has("authorization")).toBe(false);
  });

  it("uses browser-managed cookie credentials and never invents authorization metadata", () => {
    const session = remember(BrowserSession.cookie({ maxRequestMs: 100 }));

    expect(session.credentials).toBe("include");
    expect(session.requestMetadata()).toEqual(new Headers());
  });

  it("binds the default browser fetch to its global receiver", async () => {
    const fetch = vi.fn(function (this: typeof globalThis) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response());
    });
    vi.stubGlobal("fetch", fetch);
    const session = remember(BrowserSession.bearer({ token: "token", maxRequestMs: 100 }));

    await session.fetch("https://gateway.example.test/context");

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps its credential mode private when JavaScript attempts to mutate the public getter", async () => {
    const fetch = vi.fn(async () => new Response());
    const session = remember(BrowserSession.bearer({ token: "token", fetch, maxRequestMs: 100 }));

    expect(() => {
      (session as unknown as { credentials: RequestCredentials }).credentials = "include";
    }).toThrow();
    await session.fetch("https://gateway.example.test/session");

    expect(session.credentials).toBe("omit");
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("omit");
  });

  it("bounds and aborts an application-owned HTTP request", async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const session = remember(BrowserSession.cookie({ fetch, maxRequestMs: 1 }));

    await expect(session.fetch("https://gateway.example.test/session")).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("redacts bearer values from request failures and closes outstanding work", async () => {
    const token = "very-secret-token";
    let aborts = 0;
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborts++;
              reject(new Error(token));
            },
            { once: true },
          );
        }),
    );
    const session = remember(BrowserSession.bearer({ token, fetch, maxRequestMs: 100 }));
    const pending = session.fetch("https://gateway.example.test/session");

    await session.close();
    await expect(pending).rejects.not.toThrow(token);
    expect(aborts).toBe(1);
    expect(session.requestMetadata().has("authorization")).toBe(false);
  });

  it("updates only informational context through an abortable reauthentication adapter", async () => {
    const session = remember(BrowserSession.bearer({ token: "token", maxRequestMs: 100 }));
    const reauthenticate = vi.fn(async (request: { readonly signal: AbortSignal }) => {
      expect(request.signal.aborted).toBe(false);
      return { actor: "alice", tenant: "tasks", expiresAt: new Date("2030-01-01T00:00:00Z") };
    });

    await session.reauthenticate(reauthenticate);

    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(session.context).toEqual({
      actor: "alice",
      tenant: "tasks",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    expect(session.requestMetadata().get("authorization")).toBe("Bearer token");
  });

  it("settles at its deadline when application fetch ignores abort", async () => {
    const session = remember(
      BrowserSession.cookie({ fetch: () => new Promise<Response>(() => {}), maxRequestMs: 1 }),
    );

    await expect(session.fetch("https://gateway.example.test/session")).rejects.toThrow(
      "timed out",
    );
  });

  it("observes a late rejection after timeout before it can become unhandled", async () => {
    let rejectLate: ((error: Error) => void) | undefined;
    const session = remember(
      BrowserSession.cookie({
        fetch: () => new Promise<Response>((_resolve, reject) => (rejectLate = reject)),
        maxRequestMs: 1,
      }),
    );

    await expect(session.fetch("https://gateway.example.test/session")).rejects.toThrow(
      "timed out",
    );
    rejectLate?.(new Error("late timeout rejection"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("observes a late rejection after caller cancellation before it can become unhandled", async () => {
    let rejectLate: ((error: Error) => void) | undefined;
    const controller = new AbortController();
    const session = remember(
      BrowserSession.cookie({
        fetch: () => new Promise<Response>((_resolve, reject) => (rejectLate = reject)),
        maxRequestMs: 100,
      }),
    );
    const pending = session.fetch("https://gateway.example.test/session", {
      signal: controller.signal,
    });

    controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow("caller cancelled");
    rejectLate?.(new Error("late cancellation rejection"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("uses one bearer snapshot even when replacement happens during the request", async () => {
    let received: Headers | undefined;
    let release: (() => void) | undefined;
    const session = remember(
      BrowserSession.bearer({
        token: "first-token",
        maxRequestMs: 100,
        fetch: (_input, init) =>
          new Promise<Response>((resolve) => {
            received = new Headers(init?.headers);
            release = () => resolve(new Response());
          }),
      }),
    );
    const pending = session.fetch("https://gateway.example.test/session");
    session.replaceBearer("second-token");
    release?.();

    await pending;
    expect(received?.get("authorization")).toBe("Bearer first-token");
  });

  it("does not let an older reauthentication overwrite newer informational context", async () => {
    let first: ((value: { actor: string }) => void) | undefined;
    let second: ((value: { actor: string }) => void) | undefined;
    const session = remember(BrowserSession.cookie({ maxRequestMs: 100 }));
    const older = session.reauthenticate(() => new Promise((resolve) => (first = resolve)));
    const newer = session.reauthenticate(() => new Promise((resolve) => (second = resolve)));

    second?.({ actor: "new" });
    await newer;
    first?.({ actor: "old" });
    await older;

    expect(session.context).toEqual({ actor: "new" });
  });

  it("rejects malformed informational facts without retaining bearer data in an error cause", async () => {
    const token = "another-secret-token";
    const session = remember(BrowserSession.bearer({ token, maxRequestMs: 100 }));

    await expect(
      session.reauthenticate(async () => ({ actor: "", expiresAt: new Date("invalid") })),
    ).rejects.not.toThrow(token);
  });

  it("forwards caller cancellation into application reauthentication", async () => {
    const controller = new AbortController();
    const session = remember(BrowserSession.cookie({ maxRequestMs: 100 }));
    const pending = session.reauthenticate(
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      { signal: controller.signal },
    );

    controller.abort(new Error("subscription cancelled"));
    await expect(pending).rejects.toThrow("subscription cancelled");
  });

  it("returns a defensive expiry snapshot that cannot mutate retained informational context", async () => {
    const expiry = new Date("2030-01-01T00:00:00Z");
    const session = remember(BrowserSession.cookie({ maxRequestMs: 100 }));
    await session.reauthenticate(async () => ({ actor: "alice", expiresAt: expiry }));
    const observed = session.context?.expiresAt;

    observed?.setUTCFullYear(2040);

    expect(session.context?.expiresAt).toEqual(expiry);
  });

  it("rejects invalid session limits and bearer values before retaining them", () => {
    expect(() => BrowserSession.cookie({ maxRequestMs: 0 })).toThrow("deadline");
    expect(() => BrowserSession.cookie({ maxRequestMs: 60_001 })).toThrow("deadline");
    expect(() => BrowserSession.bearer({ token: "" })).toThrow("bearer token");
    expect(() => BrowserSession.bearer({ token: "x".repeat(16_385) })).toThrow("bearer token");
  });

  it("rejects bearer mutation on cookie sessions and rejects work after close", async () => {
    const session = remember(BrowserSession.cookie({ maxRequestMs: 100 }));
    expect(() => session.replaceBearer("token")).toThrow("Cookie sessions");

    await session.close();

    await expect(session.fetch("https://gateway.example.test/session")).rejects.toThrow("closed");
    await expect(session.reauthenticate(async () => undefined)).rejects.toThrow("closed");
  });

  it("propagates an already-aborted application request without starting fetch", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before request"));
    const fetch = vi.fn();
    const session = remember(BrowserSession.cookie({ fetch, maxRequestMs: 100 }));

    await expect(
      session.fetch("https://gateway.example.test/session", { signal: controller.signal }),
    ).rejects.toThrow("cancelled before request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves non-bearer request errors and accepts a tenant-only informational context", async () => {
    const session = remember(
      BrowserSession.cookie({
        fetch: async () => {
          throw new Error("gateway unavailable");
        },
        maxRequestMs: 100,
      }),
    );

    await expect(session.fetch("https://gateway.example.test/session")).rejects.toThrow(
      "gateway unavailable",
    );
    await session.reauthenticate(async () => ({ tenant: "tasks" }));
    expect(session.context).toEqual({ tenant: "tasks" });
  });

  function remember(session: BrowserSession): BrowserSession {
    sessions.push(session);
    return session;
  }
});
