import { describe, expect, it } from "vitest";
import { ApplicationNode, ScheduledNodeDiscovery } from "@spine-event-engine/deployment";
import { GceApplicationNode, GceRegistrar, GceRegistryReader } from "../src/index.js";

describe("GceApplicationNode", () => {
  it("derives a stable private node and preserves canonical overrides", () => {
    expect(
      GceApplicationNode.create(
        { projectId: "project", zone: "zone", instanceId: "42", privateAddress: "fd00::1" },
        { port: 8080, endpoint: "https://Api.Example.Test", tlsServerName: "Api.Example.Test" },
      ),
    ).toMatchObject({
      id: "gce/project/zone/42",
      endpoint: "https://api.example.test",
      tlsServerName: "api.example.test",
    });
  });

  it("registers after start, renews at twenty seconds, and removes on close", async () => {
    const calls: string[] = [];
    let tick: (() => void) | undefined;
    const registry = {
      register: async () => (calls.push("register"), true),
      renew: async () => (calls.push("renew"), true),
      cleanup: async () => (calls.push("cleanup"), 0),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "process",
      now: () => 0,
      scheduler: {
        schedule: (delay, onTick) => (
          expect(delay).toBe(20_000),
          (tick = onTick),
          () => calls.push("cancel")
        ),
      },
    });
    await registrar.start();
    tick?.();
    await Promise.resolve();
    await registrar.close();
    expect(calls).toEqual(["register", "renew", "cancel", "cleanup", "remove"]);
  });

  it("reads complete registry snapshots using its injected clock", async () => {
    const registry = {
      read: async (now: number) => [
        new ApplicationNode({ id: String(now), endpoint: "http://10.0.0.1" }),
      ],
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    await expect(
      new GceRegistryReader(registry, () => 7).read(new AbortController().signal),
    ).resolves.toMatchObject([{ id: "7" }]);
  });

  it("feeds all live registry nodes through scheduled discovery", async () => {
    let tick: (() => void) | undefined;
    const nodes = Array.from(
      { length: 40 },
      (_, index) =>
        new ApplicationNode({ id: String(index), endpoint: `http://10.0.0.${String(index + 1)}` }),
    );
    const registry = {
      read: async () => nodes,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(registry, () => 0),
      scheduler: { schedule: (_delay, onTick) => ((tick = onTick), () => undefined) },
    });
    const stop = discovery.watch((snapshot) => expect(snapshot).toHaveLength(40));
    tick?.();
    await Promise.resolve();
    await stop();
  });
});
