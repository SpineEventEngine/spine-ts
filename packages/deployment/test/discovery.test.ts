/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/require-await */

import { describe, expect, it, vi } from "vitest";

import { ApplicationNode, ScheduledNodeDiscovery, StaticNodeDiscovery } from "../src/index.js";

describe("ApplicationNode", () => {
  it.each([
    "user@host.test",
    "host.test:443",
    "host.test?x=1",
    "host.test#x",
    "[fd00::1]",
    "10.0.0.1",
    "bad_label.test",
    "-leading.test",
    "trailing-.test",
    "foo..example",
  ])("rejects invalid TLS authority %s", (tlsServerName) => {
    expect(
      () => new ApplicationNode({ id: "node", endpoint: "https://10.0.0.1", tlsServerName }),
    ).toThrow();
  });

  it("normalizes IDN TLS authorities and rejects an empty explicit port", () => {
    expect(
      new ApplicationNode({
        id: "node",
        endpoint: "https://10.0.0.1",
        tlsServerName: "bücher.example",
      }).tlsServerName,
    ).toBe("xn--bcher-kva.example");
    expect(
      () =>
        new ApplicationNode({
          id: "node",
          endpoint: "https://10.0.0.1",
          tlsServerName: "host.test:",
        }),
    ).toThrow();
  });
  it("canonicalizes a HTTPS endpoint and its TLS authority", () => {
    const node = new ApplicationNode({
      id: "node/one",
      endpoint: "https://API.Example.test:443/",
      tlsServerName: "Api.Example.Test",
    });

    expect(node.endpoint).toBe("https://api.example.test");
    expect(node.tlsServerName).toBe("api.example.test");
  });

  it("keeps bracketed IPv6 origins and rejects TLS names for HTTP", () => {
    expect(
      new ApplicationNode({ id: "node/v6", endpoint: "http://[fd00::1]:8080/" }).endpoint,
    ).toBe("http://[fd00::1]:8080");
    expect(
      () =>
        new ApplicationNode({
          id: "node/http",
          endpoint: "http://10.0.0.1",
          tlsServerName: "a.test",
        }),
    ).toThrow("TLS server names require HTTPS");
  });

  it.each([
    "",
    "relative/path",
    "ftp://host.test",
    "http://user@host.test",
    "http://host.test/path",
  ])("rejects a non-canonical application endpoint %s", (endpoint) => {
    expect(() => new ApplicationNode({ id: "node", endpoint })).toThrow("endpoint");
  });
});

describe("StaticNodeDiscovery", () => {
  it("publishes complete immutable snapshots including an empty one", async () => {
    const source = new StaticNodeDiscovery([]);
    const snapshots: string[][] = [];
    const close = source.watch((nodes) => snapshots.push(nodes.map((node) => node.id)));

    source.replace([new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" })]);
    source.replace([]);
    await close();

    expect(snapshots).toEqual([[], ["node/a"], []]);
  });
});

describe("ScheduledNodeDiscovery", () => {
  it("validates refresh intervals and accepts the default", async () => {
    expect(
      () =>
        new ScheduledNodeDiscovery({
          reader: { read: async () => [] },
          scheduler: { schedule: () => () => {} },
          intervalMs: 0,
        }),
    ).toThrow("positive safe integer");
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => [] },
    });
    await source.close();
  });

  it("cancels a scheduled tick when closed before it runs", async () => {
    let tick: (() => void) | undefined;
    let cancelled = 0;
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => [] },
      scheduler: {
        schedule: (_delay, scheduled) => {
          tick = scheduled;
          return () => cancelled++;
        },
      },
    });
    source.watch(() => undefined);
    await source.close();
    tick?.();
    await Promise.resolve();
    await source.close();
    expect(cancelled).toBe(1);
  });

  it("suppresses a successful callback when close races the read", async () => {
    let resolveRead: ((nodes: readonly ApplicationNode[]) => void) | undefined;
    const ticks: (() => void)[] = [];
    const snapshots: (readonly ApplicationNode[])[] = [];
    const source = new ScheduledNodeDiscovery({
      reader: { read: () => new Promise((resolve) => (resolveRead = resolve)) },
      scheduler: { schedule: (_delay, tick) => (ticks.push(tick), () => {}) },
    });
    source.watch((nodes) => snapshots.push(nodes));
    ticks.shift()?.();
    await Promise.resolve();
    const closing = source.close();
    resolveRead?.([]);
    await closing;
    expect(snapshots).toEqual([]);
  });

  it("aborts and joins a pending reader on close", async () => {
    let rejectRead: ((reason: Error) => void) | undefined;
    let aborted = false;
    const source = new ScheduledNodeDiscovery({
      reader: {
        read: (signal) =>
          new Promise((_, reject) => {
            rejectRead = reject;
            signal.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      },
      scheduler: {
        schedule: (_delay, tick) => {
          queueMicrotask(tick);
          return () => {};
        },
      },
    });
    source.watch(() => undefined);
    await Promise.resolve();
    let settled = false;
    const closing = source.close().then(() => {
      settled = true;
    });
    expect(aborted).toBe(true);
    expect(settled).toBe(false);
    rejectRead?.(new Error("aborted"));
    await closing;
  });
  it("retries after a reader failure and permits only one watch", async () => {
    const ticks: (() => void)[] = [];
    let reads = 0;
    const source = new ScheduledNodeDiscovery({
      reader: {
        read: async () => {
          reads++;
          if (reads === 1) throw new Error("temporary");
          return [];
        },
      },
      scheduler: {
        schedule: (_delay, tick) => {
          ticks.push(tick);
          return () => {};
        },
      },
    });
    source.watch(() => undefined);
    expect(() => source.watch(() => undefined)).toThrow("one active watch");
    ticks.shift()?.();
    await Promise.resolve();
    ticks.shift()?.();
    await Promise.resolve();
    expect(reads).toBe(2);
  });

  it("warns once when an active refresh fails and retains the last snapshot", async () => {
    const ticks: (() => void)[] = [];
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => Promise.reject(new Error("temporary")) },
      logger: logger as never,
      scheduler: { schedule: (_delay, tick) => (ticks.push(tick), () => undefined) },
    });

    source.watch(() => undefined);
    ticks.shift()?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(logger.withMetadata).toHaveBeenCalledWith({ operation: "deployment.discovery.refresh" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("deployment.discovery.refresh_failed");
    await source.close();
  });

  it("contains synchronous and rejecting logger failures while retrying discovery", async () => {
    const ticks: (() => void)[] = [];
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => Promise.reject(new Error("temporary")) },
      logger: {
        withMetadata: () => ({
          warn: () => Promise.reject(new Error("logger unavailable")),
        }),
      } as never,
      scheduler: { schedule: (_delay, tick) => (ticks.push(tick), () => undefined) },
    });

    source.watch(() => undefined);
    ticks.shift()?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(ticks).toHaveLength(1);
    await source.close();
  });
  it("uses an injected zero then ten-second schedule", async () => {
    const delays: number[] = [];
    let tick: (() => void) | undefined;
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => [new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })] },
      scheduler: {
        schedule: (delay, onTick) => {
          delays.push(delay);
          tick = onTick;
          return () => {};
        },
      },
    });
    const seen: string[][] = [];
    source.watch((nodes) => seen.push(nodes.map((node) => node.id)));
    tick?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(delays).toEqual([0, 10_000]);
    expect(seen).toEqual([["a"]]);
  });

  it("rejects watches after close", async () => {
    const source = new ScheduledNodeDiscovery({
      reader: { read: async () => [] },
      scheduler: { schedule: () => () => {} },
    });
    await source.close();
    expect(() => source.watch(() => undefined)).toThrow("closed");
  });
});
