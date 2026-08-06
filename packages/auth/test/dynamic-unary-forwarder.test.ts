import { describe, expect, it } from "vitest";
import { ApplicationNode } from "@spine-event-engine/deployment";

import { DynamicUnaryForwarder } from "../src/index.js";

describe("DynamicUnaryForwarder", () => {
  it("routes every node in round-robin order and recovers from empty membership", async () => {
    const calls: string[] = [];
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => ({ forward: async () => new TextEncoder().encode(node.id), close: async () => calls.push(`close:${node.id}`) }),
    });
    await forwarder.reconcile(["a", "b", "c"].map((id) => new ApplicationNode({ id, endpoint: `http://10.0.0.${id.charCodeAt(0)}` })));
    for (let index = 0; index < 6; index++) calls.push(new TextDecoder().decode(await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() })));
    await forwarder.reconcile([]);
    await expect(forwarder.forward({ service: "s", method: "m", value: new Uint8Array() })).rejects.toThrow("absent");
    await forwarder.reconcile([new ApplicationNode({ id: "d", endpoint: "http://10.0.0.4" })]);
    calls.push(new TextDecoder().decode(await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() })));
    expect(calls).toEqual(["a", "b", "c", "a", "b", "c", "close:a", "close:b", "close:c", "d"]);
  });

  it("uses all 40 nodes without retrying a selected failure", async () => {
    let creates = 0;
    const forwarder = new DynamicUnaryForwarder({
      create: async (node) => { creates++; return { forward: async () => { if (node.id === "0") throw new Error("dispatched"); return new TextEncoder().encode(node.id); }, close: async () => {} }; },
    });
    await forwarder.reconcile(Array.from({ length: 40 }, (_, index) => new ApplicationNode({ id: String(index), endpoint: `http://10.0.1.${index + 1}` })));
    await expect(forwarder.forward({ service: "s", method: "m", value: new Uint8Array() })).rejects.toThrow("dispatched");
    const used = new Set<string>();
    for (let index = 1; index < 40; index++) used.add(new TextDecoder().decode(await forwarder.forward({ service: "s", method: "m", value: new Uint8Array() })));
    expect(creates).toBe(40);
    expect(used.size).toBe(39);
  });
});
