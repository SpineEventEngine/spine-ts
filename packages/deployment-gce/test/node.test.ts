import { describe, expect, it } from "vitest";
import { ApplicationNode, ScheduledNodeDiscovery } from "@spine-event-engine/deployment";
import {
  GceApplicationNode,
  GceMetadataService,
  GceRegistrar,
  GceRegistryReader,
} from "../src/index.js";

describe("GceApplicationNode", () => {
  it("reads documented GCE metadata paths with the required header", async () => {
    const original = globalThis.fetch;
    const requests: RequestInfo[] = [];
    globalThis.fetch = async (input) => {
      requests.push(input);
      const path = String(input).split("/").slice(-2).join("/");
      const body =
        new Map([
          ["project/project-id", " project "],
          ["instance/zone", "projects/1/zones/zone-a"],
          ["instance/id", "42"],
          ["0/ip", "10.0.0.1"],
        ]).get(path) ?? "";
      return new Response(body, { status: 200 });
    };
    try {
      await expect(new GceMetadataService().read(new AbortController().signal)).resolves.toEqual({
        projectId: "project",
        zone: "zone-a",
        instanceId: "42",
        privateAddress: "10.0.0.1",
      });
      expect(requests).toHaveLength(4);
    } finally {
      globalThis.fetch = original;
    }
  });
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
    expect(calls).toEqual(["register", "cancel", "renew", "cleanup", "remove"]);
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

  it("adapts registration to the listener lifecycle contract", async () => {
    const calls: string[] = [];
    const registry = {
      register: async () => (calls.push("start"), true),
      remove: async () => (calls.push("close"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "process",
      now: () => 0,
      scheduler: { schedule: () => () => undefined },
    });
    const lifecycle = registrar.lifecycle();
    await lifecycle.start();
    await lifecycle.close();
    expect(calls).toEqual(["start", "close"]);
  });

  it("aborts and joins stalled metadata before removing its lease", async () => {
    let resolve: (() => void) | undefined;
    let aborted = false;
    const metadata = {
      read: (signal: AbortSignal) =>
        new Promise<import("../src/index.js").GceMetadata>((done) => {
          signal.addEventListener("abort", () => (aborted = true));
          resolve = () =>
            done({ projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" });
        }),
    };
    const calls: string[] = [];
    const registry = {
      register: async () => (calls.push("register"), true),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({ registry, metadata, port: 8080 });
    const starting = registrar.start();
    await Promise.resolve();
    await Promise.resolve();
    const closing = registrar.close();
    expect(aborted).toBe(true);
    expect(calls).toEqual([]);
    resolve?.();
    await starting;
    await closing;
    expect(calls).toEqual(["register", "remove"]);
  });

  it("joins a stalled initial registration before removal", async () => {
    let resolve: (() => void) | undefined;
    let admitted: (() => void) | undefined;
    const admittedPromise = new Promise<void>((done) => (admitted = done));
    const calls: string[] = [];
    const registry = {
      register: () =>
        new Promise<boolean>((done) => {
          admitted?.();
          resolve = () => (calls.push("register"), done(true));
        }),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
    });
    const starting = registrar.start();
    await admittedPromise;
    const closing = registrar.close();
    expect(calls).toEqual([]);
    resolve?.();
    await starting;
    await closing;
    expect(calls).toEqual(["register", "remove"]);
  });

  it("joins a stalled renewal and cleanup before removal", async () => {
    let tick: (() => void) | undefined;
    let resolveRenew: (() => void) | undefined;
    let admitted: (() => void) | undefined;
    const admittedPromise = new Promise<void>((done) => (admitted = done));
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: () =>
        new Promise<boolean>((done) => {
          admitted?.();
          resolveRenew = () => (calls.push("renew"), done(true));
        }),
      cleanup: async () => (calls.push("cleanup"), 0),
      remove: async () => (calls.push("remove"), true),
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: { schedule: (_delay, onTick) => ((tick = onTick), () => calls.push("cancel")) },
    });
    await registrar.start();
    tick?.();
    await admittedPromise;
    const closing = registrar.close();
    expect(calls).toEqual(["cancel"]);
    resolveRenew?.();
    await closing;
    expect(calls).toEqual(["cancel", "renew", "cleanup", "remove"]);
  });

  it("aborts metadata at its deadline and closes the deadline handle", async () => {
    let abort: (() => void) | undefined;
    let closed = false;
    const metadata = {
      read: (signal: AbortSignal) =>
        new Promise<import("../src/index.js").GceMetadata>((_done, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    };
    const registrar = new GceRegistrar({
      registry: {
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      metadata,
      port: 8080,
      deadlines: {
        create: () => {
          const controller = new AbortController();
          abort = () => controller.abort();
          return { signal: controller.signal, close: () => (closed = true) };
        },
      },
    });
    const starting = registrar.start();
    await Promise.resolve();
    abort?.();
    await starting;
    await registrar.close();
    expect(closed).toBe(true);
  });
});
