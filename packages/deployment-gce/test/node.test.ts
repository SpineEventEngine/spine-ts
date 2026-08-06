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

  it("uses bracketed private IPv6 defaults and fences numeric instance identities", () => {
    expect(
      GceApplicationNode.create(
        { projectId: "p", zone: "z", instanceId: "2", privateAddress: "fd00::1" },
        { port: 8080 },
      ),
    ).toMatchObject({ id: "gce/p/z/2", endpoint: "http://[fd00::1]:8080" });
    expect(() =>
      GceApplicationNode.create(
        { projectId: "p", zone: "z", instanceId: "label", privateAddress: "10.0.0.1" },
        { port: 0 },
      ),
    ).toThrow();
  });

  it("lets an explicit canonical HTTPS override win and rejects invalid endpoint inputs", () => {
    const metadata = { projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" };
    expect(
      GceApplicationNode.create(metadata, {
        port: 8080,
        endpoint: "https://API.Example.Test",
        tlsServerName: "Api.Example.Test",
      }),
    ).toMatchObject({ endpoint: "https://api.example.test", tlsServerName: "api.example.test" });
    expect(() =>
      GceApplicationNode.create(metadata, {
        port: 8080,
        endpoint: "http://10.0.0.1",
        tlsServerName: "api.test",
      }),
    ).toThrow("TLS");
    expect(() =>
      GceApplicationNode.create(metadata, { port: 8080, endpoint: "https://user@api.test/path" }),
    ).toThrow("endpoint");
    expect(() =>
      GceApplicationNode.create(metadata, { port: 8080, endpoint: "ftp://api.test" }),
    ).toThrow("endpoint");
  });

  it("uses the numeric GCE instance identity to distinguish restarts", () => {
    const base = { projectId: "p", zone: "z", privateAddress: "10.0.0.1" };
    expect(GceApplicationNode.create({ ...base, instanceId: "1" }, { port: 8080 }).id).not.toBe(
      GceApplicationNode.create({ ...base, instanceId: "2" }, { port: 8080 }).id,
    );
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

  it("closes each deadline after admitted registry work", async () => {
    let created = 0;
    let closed = 0;
    let tick: (() => void) | undefined;
    const registry = {
      register: async () => true,
      renew: async () => true,
      cleanup: async () => 0,
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: { schedule: (_delay, onTick) => ((tick = onTick), () => undefined) },
      deadlines: {
        create: () => {
          created += 1;
          return { signal: new AbortController().signal, close: () => (closed += 1) };
        },
      },
    });
    await registrar.start();
    tick?.();
    await Promise.resolve();
    await registrar.close();
    expect(created).toBe(closed);
    expect(created).toBeGreaterThanOrEqual(4);
  });

  it("confirms a lost initial write through the same owner before renewing", async () => {
    const ticks: (() => void)[] = [];
    let scheduleCount = 0;
    let secondScheduled: (() => void) | undefined;
    const secondScheduledPromise = new Promise<void>((done) => (secondScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanupPromise = new Promise<void>((done) => (cleanupDone = done));
    let renewDone: (() => void) | undefined;
    const renewPromise = new Promise<void>((done) => (renewDone = done));
    const calls: string[] = [];
    const registry = {
      register: async () => {
        calls.push("register");
        throw new Error("lost response");
      },
      lookup: async () => (
        calls.push("lookup"),
        {
          registrationId: "owner",
          expiresAt: 100,
          node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
        }
      ),
      renew: async () => (calls.push("renew"), renewDone?.(), true),
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          ticks.push(onTick),
          (scheduleCount += 1) === 2 && secondScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await cleanupPromise;
    expect(calls).toEqual(["register", "lookup", "cleanup"]);
    await secondScheduledPromise;
    ticks.shift()?.();
    await renewPromise;
    expect(calls).toEqual(["register", "lookup", "cleanup", "renew"]);
    await registrar.close();
  });

  it.each([
    ["absent", undefined],
    ["expired", undefined],
    ["other owner", { registrationId: "other", expiresAt: 100 }],
  ])("retries one same-identity registration when lookup is %s", async (_name, lookup) => {
    const ticks: (() => void)[] = [];
    const identities: string[] = [];
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let attempts = 0;
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        attempts += 1;
        if (attempts === 1) throw new Error("lost response");
        return true;
      },
      lookup: async () =>
        lookup === undefined
          ? undefined
          : { ...lookup, node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }) },
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      now: () => 1,
      scheduler: { schedule: (_delay, onTick) => (ticks.push(onTick), () => undefined) },
    });
    await registrar.start();
    ticks.shift()?.();
    await cleanup;
    expect(identities).toEqual(["owner", "owner"]);
    await registrar.close();
  });
});
