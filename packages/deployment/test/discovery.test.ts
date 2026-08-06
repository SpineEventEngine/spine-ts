import { describe, expect, it } from "vitest";

import { ApplicationNode, ScheduledNodeDiscovery, StaticNodeDiscovery } from "../src/index.js";

describe("ApplicationNode", () => {
  it.each([
    "user@host.test",
    "host.test:443",
    "host.test?x=1",
    "host.test#x",
    "[fd00::1]",
    "10.0.0.1",
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
});

describe("StaticNodeDiscovery", () => {
  it("publishes complete immutable snapshots including an empty one", async () => {
    const source = new StaticNodeDiscovery([]);
    const snapshots: readonly string[][] = [];
    const close = source.watch((nodes) => snapshots.push(nodes.map((node) => node.id)));

    source.replace([new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" })]);
    source.replace([]);
    await close();

    expect(snapshots).toEqual([[], ["node/a"], []]);
  });
});

describe("ScheduledNodeDiscovery", () => {
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
});
