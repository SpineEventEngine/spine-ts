import { describe, expect, it } from "vitest";
import { ApplicationNode } from "@spine-event-engine/deployment";

import { DynamicUnaryForwarder } from "../src/index.js";

describe("DynamicUnaryForwarder", () => {
  it("keeps newer membership routable after an older removal waits for disposal", async () => {
    let releaseClose: (() => void) | undefined;
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => ({
        forward: async () => new TextEncoder().encode(node.id),
        close: () =>
          new Promise((resolve) => {
            releaseClose = resolve;
          }),
      }),
    });
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    await forwarder.reconcile([a]);
    const remove = forwarder.reconcile([]);
    await Promise.resolve();
    const retain = forwarder.reconcile([a]);
    releaseClose?.();
    await Promise.all([remove, retain]);
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("a");
  });

  it("waits for stalled siblings before a new batch exceeds the global start limit", async () => {
    let active = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const forwarder = new DynamicUnaryForwarder({
      maxConcurrentStarts: 2,
      create: (node) =>
        new Promise((resolve, reject) => {
          active++;
          peak = Math.max(peak, active);
          if (node.id === "fail") {
            active--;
            reject(new Error("fail"));
            return;
          }
          if (node.id === "stall") {
            release = () => {
              active--;
              resolve({
                forward: async () => new TextEncoder().encode(node.id),
                close: async () => {},
              });
            };
            return;
          }
          active--;
          resolve({
            forward: async () => new TextEncoder().encode(node.id),
            close: async () => {},
          });
        }),
    });
    void forwarder.reconcile([
      new ApplicationNode({ id: "fail", endpoint: "http://10.0.0.1" }),
      new ApplicationNode({ id: "stall", endpoint: "http://10.0.0.2" }),
    ]);
    await Promise.resolve();
    const latest = forwarder.reconcile([
      new ApplicationNode({ id: "latest", endpoint: "http://10.0.0.3" }),
    ]);
    release?.();
    await latest;
    expect(peak).toBeLessThanOrEqual(2);
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("latest");
  });
  it("coalesces heavy churn behind a stalled first create and settles every caller", async () => {
    const started: string[] = [];
    let release: (() => void) | undefined;
    const forwarder = new DynamicUnaryForwarder({
      create: (node) =>
        new Promise((resolve) => {
          started.push(node.id);
          if (node.id === "a")
            release = () =>
              resolve({ forward: async () => new Uint8Array(), close: async () => {} });
          else resolve({ forward: async () => new Uint8Array(), close: async () => {} });
        }),
    });
    const first = forwarder.reconcile([
      new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" }),
    ]);
    await Promise.resolve();
    const callers = Array.from({ length: 1000 }, (_, index) =>
      forwarder.reconcile([
        new ApplicationNode({
          id: `${index}`,
          endpoint: `http://10.1.${Math.floor(index / 250)}.${(index % 250) + 1}`,
        }),
      ]),
    );
    release?.();
    await Promise.all([first, ...callers]);
    expect(started).toEqual(["a", "999"]);
  });

  it("contains a conflicting duplicate snapshot and preserves current membership", async () => {
    let created = 0;
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => {
        created++;
        return {
          forward: async () => new TextEncoder().encode(node.endpoint),
          close: async () => {},
        };
      },
    });
    await forwarder.reconcile([new ApplicationNode({ id: "saved", endpoint: "http://10.0.0.9" })]);
    await forwarder.reconcile([
      new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" }),
      new ApplicationNode({ id: "a", endpoint: "http://10.0.0.2" }),
    ]);
    expect(created).toBe(1);
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("http://10.0.0.9");
  });
  it("creates an equal duplicate once and replaces a TLS-only change", async () => {
    const created: string[] = [];
    const closed: string[] = [];
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => {
        created.push(node.tlsServerName ?? "none");
        return {
          forward: async () => new Uint8Array(),
          close: async () => {
            closed.push(node.tlsServerName ?? "none");
          },
        };
      },
    });
    const first = new ApplicationNode({
      id: "a",
      endpoint: "https://10.0.0.1",
      tlsServerName: "one.test",
    });
    await forwarder.reconcile([first, first]);
    await forwarder.reconcile([
      new ApplicationNode({ id: "a", endpoint: "https://10.0.0.1", tlsServerName: "two.test" }),
    ]);
    expect(created).toEqual(["one.test", "two.test"]);
    expect(closed).toEqual(["one.test"]);
  });

  it("closes an established client exactly once across concurrent close calls", async () => {
    let closes = 0;
    const forwarder = new DynamicUnaryForwarder({
      create: async () => ({
        forward: async () => new Uint8Array(),
        close: async () => {
          closes++;
        },
      }),
    });
    await forwarder.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await Promise.all([forwarder.close(), forwarder.close(), forwarder.close()]);
    expect(closes).toBe(1);
  });
  it("aborts every concurrent stalled create and closes repeatedly", async () => {
    const aborted: string[] = [];
    const forwarder = new DynamicUnaryForwarder({
      maxConcurrentStarts: 2,
      create: (node, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.push(node.id);
            reject(new Error("aborted"));
          });
        }),
    });
    void forwarder.reconcile(
      ["a", "b"].map(
        (id) => new ApplicationNode({ id, endpoint: `http://10.0.0.${id === "a" ? 1 : 2}` }),
      ),
    );
    await Promise.resolve();
    await Promise.all([forwarder.close(), forwarder.close()]);
    expect(aborted.sort()).toEqual(["a", "b"]);
  });

  it("recovers after a failed factory and ignores close failure during removal", async () => {
    let fail = true;
    let closeAttempts = 0;
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => {
        if (fail) {
          fail = false;
          throw new Error("factory");
        }
        return {
          forward: async () => new TextEncoder().encode(node.id),
          close: async () => {
            closeAttempts++;
            if (closeAttempts < 3) throw new Error("close");
          },
        };
      },
    });
    await forwarder.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await forwarder.reconcile([new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" })]);
    expect(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    ).toBe("b");
    await expect(forwarder.close()).rejects.toThrow("cleanup remains incomplete");
    await expect(forwarder.close()).resolves.toBeUndefined();
    expect(closeAttempts).toBe(3);
  });
  it("coalesces B behind A so only the latest pending snapshot is created", async () => {
    const started: string[] = [];
    let releaseA: (() => void) | undefined;
    const forwarder = new DynamicUnaryForwarder({
      create: (node) =>
        new Promise((resolve) => {
          started.push(node.id);
          if (node.id === "a")
            releaseA = () =>
              resolve({ forward: async () => new Uint8Array(), close: async () => {} });
          else resolve({ forward: async () => new Uint8Array(), close: async () => {} });
        }),
    });
    const a = forwarder.reconcile([new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })]);
    await Promise.resolve();
    const b = forwarder.reconcile([new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" })]);
    const c = forwarder.reconcile([new ApplicationNode({ id: "c", endpoint: "http://10.0.0.3" })]);
    releaseA?.();
    await Promise.all([a, b, c]);
    expect(started).toEqual(["a", "c"]);
  });

  it("limits concurrent client starts while eventually including all nodes", async () => {
    let active = 0;
    let peak = 0;
    const forwarder = new DynamicUnaryForwarder({
      maxConcurrentStarts: 2,
      create: async (node) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return { forward: async () => new TextEncoder().encode(node.id), close: async () => {} };
      },
    });
    await forwarder.reconcile(
      Array.from(
        { length: 40 },
        (_, index) =>
          new ApplicationNode({ id: `${index}`, endpoint: `http://10.0.2.${index + 1}` }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("routes every node in round-robin order and recovers from empty membership", async () => {
    const calls: string[] = [];
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => ({
        forward: async () => new TextEncoder().encode(node.id),
        close: async () => calls.push(`close:${node.id}`),
      }),
    });
    await forwarder.reconcile(
      ["a", "b", "c"].map(
        (id) => new ApplicationNode({ id, endpoint: `http://10.0.0.${id.charCodeAt(0)}` }),
      ),
    );
    for (let index = 0; index < 6; index++)
      calls.push(
        new TextDecoder().decode(
          await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
        ),
      );
    await forwarder.reconcile([]);
    await expect(
      forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
    ).rejects.toThrow("absent");
    await forwarder.reconcile([new ApplicationNode({ id: "d", endpoint: "http://10.0.0.4" })]);
    calls.push(
      new TextDecoder().decode(
        await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
      ),
    );
    expect(calls).toEqual(["a", "b", "c", "a", "b", "c", "close:a", "close:b", "close:c", "d"]);
  });

  it("uses all 40 nodes without retrying a selected failure", async () => {
    let creates = 0;
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => {
        creates++;
        return {
          forward: async () => {
            if (node.id === "0") throw new Error("dispatched");
            return new TextEncoder().encode(node.id);
          },
          close: async () => {},
        };
      },
    });
    await forwarder.reconcile(
      Array.from(
        { length: 40 },
        (_, index) =>
          new ApplicationNode({ id: String(index), endpoint: `http://10.0.1.${index + 1}` }),
      ),
    );
    await expect(
      forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
    ).rejects.toThrow("dispatched");
    const used = new Set<string>();
    for (let index = 1; index < 40; index++)
      used.add(
        new TextDecoder().decode(
          await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() }),
        ),
      );
    expect(creates).toBe(40);
    expect(used.size).toBe(39);
  });
});
