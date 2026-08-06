/* eslint-disable @typescript-eslint/require-await -- Structural registry and Gateway fixtures expose
 * asynchronous contract methods without awaiting. */

import { describe, expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { DynamicUnaryForwarder, type DynamicUnaryClient } from "@spine-event-engine/auth";
import {
  ApplicationNode,
  LeasedNodeRegistry,
  ScheduledNodeDiscovery,
} from "@spine-event-engine/deployment";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  GceApplicationNode,
  GceMetadataService,
  GceRegistrar,
  GceRegistryReader,
} from "../src/index.js";

describe("GceApplicationNode", () => {
  it("keeps discovery active through crash expiry, zero, and later return", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "gce-crash" });
    const a = new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" });
    const b = new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" });
    let now = 0;
    const ticks: (() => void)[] = [];
    const snapshots: string[][] = [];
    let resolveSnapshot: (() => void) | undefined;
    const nextSnapshot = () =>
      new Promise<void>((resolve) => {
        resolveSnapshot = resolve;
      });
    const discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(registry, () => now),
      scheduler: { schedule: (_delay, onTick) => (ticks.push(onTick), () => undefined) },
    });
    const stop = discovery.watch((nodes) => {
      snapshots.push(nodes.map((node) => node.id));
      resolveSnapshot?.();
      resolveSnapshot = undefined;
    });
    try {
      await registry.register({ node: a, registrationId: "a-owner", expiresAt: 10 });
      let published = nextSnapshot();
      ticks.shift()?.();
      await published;
      await Promise.resolve();

      now = 10;
      published = nextSnapshot();
      ticks.shift()?.();
      await published;
      await Promise.resolve();

      await registry.register({
        node: new ApplicationNode({ id: "abandoned", endpoint: "http://10.0.0.3" }),
        registrationId: "crashed-owner",
        expiresAt: 10,
      });
      let renewal: (() => void) | undefined;
      const registrar = new GceRegistrar({
        registry,
        node: b,
        identity: "b-owner",
        now: () => now,
        scheduler: { schedule: (_delay, onTick) => ((renewal = onTick), () => undefined) },
      });
      await registrar.start();
      renewal?.();
      await registrar.close();
      await expect(registry.lookup("abandoned", now)).resolves.toBeUndefined();

      await registry.register({ node: b, registrationId: "b-restarted", expiresAt: 20 });
      published = nextSnapshot();
      ticks.shift()?.();
      await published;
      expect(snapshots).toEqual([["a"], [], ["b"]]);
    } finally {
      await stop();
      await registry.close();
      factory.close();
    }
  });
  it("reads documented GCE metadata paths with the required header", async () => {
    const original = globalThis.fetch;
    const requests: (RequestInfo | URL)[] = [];
    globalThis.fetch = async (input) => {
      requests.push(input);
      const path = requestUrl(input).split("/").slice(-2).join("/");
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

  it("rejects failed, malformed, and cancelled metadata reads", async () => {
    const original = globalThis.fetch;
    try {
      for (const status of [400, 503]) {
        globalThis.fetch = async () => new Response("unavailable", { status });
        await expect(new GceMetadataService().read(new AbortController().signal)).rejects.toThrow(
          "metadata request failed",
        );
      }

      for (const [path, value] of [
        ["project/project-id", " "],
        ["instance/zone", " "],
        ["instance/id", "not-a-number"],
        ["instance/network-interfaces/0/ip", " "],
      ]) {
        globalThis.fetch = async (input) => {
          const requested = requestUrl(input).replace(
            "http://metadata.google.internal/computeMetadata/v1/",
            "",
          );
          const body =
            requested === path
              ? value
              : (new Map([
                  ["project/project-id", "project"],
                  ["instance/zone", "projects/1/zones/zone-a"],
                  ["instance/id", "42"],
                  ["instance/network-interfaces/0/ip", "10.0.0.1"],
                ]).get(requested) ?? "");
          return new Response(body, { status: 200 });
        };
        await expect(new GceMetadataService().read(new AbortController().signal)).rejects.toThrow(
          "metadata response is invalid",
        );
      }

      const signals: AbortSignal[] = [];
      globalThis.fetch = async (_input, init) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) throw new Error("missing abort signal");
        signals.push(signal);
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        });
      };
      const controller = new AbortController();
      const reading = new GceMetadataService().read(controller.signal);
      controller.abort();
      await expect(reading).rejects.toThrow("cancelled");
      expect(signals).toHaveLength(4);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
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
      lookup: async () => undefined,
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

  it("uses exact twenty-second renewal and sixty-second lease-expiry timing", async () => {
    const ticks: (() => void)[] = [];
    const delays: number[] = [];
    const expiries: number[] = [];
    let now = 100;
    let secondSchedule: (() => void) | undefined;
    const renewed = new Promise<void>((resolve) => (secondSchedule = resolve));
    const registrar = new GceRegistrar({
      registry: {
        register: async (lease: { expiresAt: number }) => (expiries.push(lease.expiresAt), true),
        renew: async (_nodeId: string, _identity: string, expiresAt: number) => (
          expiries.push(expiresAt),
          true
        ),
        cleanup: async () => 0,
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      now: () => now,
      scheduler: {
        schedule: (delay, onTick) => (
          delays.push(delay),
          ticks.push(onTick),
          delays.length === 2 && secondSchedule?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    now = 20_100;
    ticks.shift()?.();
    await renewed;
    await registrar.close();
    expect(delays).toEqual([20_000, 20_000]);
    expect(expiries).toEqual([60_100, 80_100]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid registrar operation timeout of %s",
    (operationTimeoutMs) => {
      expect(
        () =>
          new GceRegistrar({
            registry: {} as import("@spine-event-engine/deployment").LeasedNodeRegistry,
            node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
            operationTimeoutMs,
          }),
      ).toThrow("operation timeout");
    },
  );

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

  it("uses Date.now when a registry reader clock is omitted", async () => {
    const original = Date.now;
    Date.now = () => 7;
    try {
      const registry = {
        read: async (now: number) => [
          new ApplicationNode({ id: String(now), endpoint: "http://10.0.0.1" }),
        ],
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
      await expect(
        new GceRegistryReader(registry).read(new AbortController().signal),
      ).resolves.toMatchObject([{ id: "7" }]);
    } finally {
      Date.now = original;
    }
  });

  it("derives metadata-backed registration from only a registry and port", async () => {
    const original = globalThis.fetch;
    const registrations: string[] = [];
    globalThis.fetch = async (input) => {
      const path = requestUrl(input).split("/").slice(-2).join("/");
      const body =
        new Map([
          ["project/project-id", "project"],
          ["instance/zone", "projects/1/zones/zone-a"],
          ["instance/id", "42"],
          ["0/ip", "10.0.0.1"],
        ]).get(path) ?? "";
      return new Response(body, { status: 200 });
    };
    const registrar = new GceRegistrar({
      registry: {
        register: async (lease: { node: ApplicationNode }) => (
          registrations.push(lease.node.id),
          true
        ),
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      port: 8080,
      scheduler: { schedule: () => () => undefined },
    });
    try {
      await registrar.start();
      expect(registrations).toEqual(["gce/project/zone-a/42"]);
    } finally {
      await registrar.close();
      globalThis.fetch = original;
    }
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
    const stop = discovery.watch((snapshot) => {
      expect(snapshot).toHaveLength(40);
    });
    tick?.();
    await Promise.resolve();
    await stop();
  });

  it("reconciles all discovered GCE nodes for gateway routing and subscriptions", async () => {
    const ticks: (() => void)[] = [];
    const nodes = Array.from(
      { length: 40 },
      (_, index) =>
        new ApplicationNode({ id: String(index), endpoint: `http://10.0.1.${String(index + 1)}` }),
    );
    let reconciled: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => (reconciled = resolve));
    const subscribed = new Set<string>();
    const gateway = new DynamicUnaryForwarder({
      create: async (node) => gatewayClient(node.id, subscribed),
    });
    const discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(
        {
          read: async () => nodes,
        } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
        () => 0,
      ),
      scheduler: { schedule: (_delay, onTick) => (ticks.push(onTick), () => undefined) },
    });
    const stop = discovery.watch((snapshot) => {
      void gateway.reconcile(snapshot).then(() => reconciled?.());
    });
    try {
      ticks.shift()?.();
      await ready;
      const routed = new Set<string>();
      for (let index = 0; index < 40; index++)
        routed.add(
          new TextDecoder().decode(
            await gateway.forward({
              service: "spine.client.QueryService",
              method: "Read",
              value: new Uint8Array(),
            }),
          ),
        );
      await gateway.subscribeDefinition(
        {
          kind: "public-subscription",
          bytes: toBinary(
            SubscriptionSchema,
            create(SubscriptionSchema, { id: { value: "all-nodes" }, topic: create(TopicSchema) }),
          ),
        },
        new AbortController().signal,
      );
      expect(routed).toEqual(new Set(nodes.map((node) => node.id)));
      expect(subscribed).toEqual(new Set(nodes.map((node) => node.id)));
    } finally {
      await stop();
      await gateway.close();
    }
  });

  it("retains the last discovery snapshot through a registry read failure", async () => {
    const ticks: (() => void)[] = [];
    let reads = 0;
    const first = [new ApplicationNode({ id: "a", endpoint: "http://10.0.0.1" })];
    const second = [new ApplicationNode({ id: "b", endpoint: "http://10.0.0.2" })];
    const registry = {
      read: async () => {
        reads += 1;
        if (reads === 2) throw new Error("read failed");
        return reads === 1 ? first : second;
      },
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const snapshots: string[][] = [];
    const discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(registry, () => 0),
      scheduler: { schedule: (_delay, onTick) => (ticks.push(onTick), () => undefined) },
    });
    const stop = discovery.watch((nodes) => snapshots.push(nodes.map((node) => node.id)));
    ticks.shift()?.();
    await Promise.resolve();
    ticks.shift()?.();
    await Promise.resolve();
    ticks.shift()?.();
    await Promise.resolve();
    expect(snapshots).toEqual([["a"], ["b"]]);
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
          resolve = () => {
            done({ projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" });
          };
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
          resolve = () => {
            calls.push("register");
            done(true);
          };
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
          resolveRenew = () => {
            calls.push("renew");
            done(true);
          };
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
        new Promise<import("../src/index.js").GceMetadata>((_done, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
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
          abort = () => {
            controller.abort();
          };
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

  it("bounds an unconfirmed ownership lookup with its own operation deadline", async () => {
    const ticks: (() => void)[] = [];
    const controllers: AbortController[] = [];
    let schedules = 0;
    let retryScheduled: (() => void) | undefined;
    const retried = new Promise<void>((resolve) => (retryScheduled = resolve));
    let lookupStarted: (() => void) | undefined;
    const lookup = new Promise<void>((resolve) => (lookupStarted = resolve));
    let lookupSignal: AbortSignal | undefined;
    const registry = {
      register: async () => {
        throw new Error("lost response");
      },
      lookup: (nodeId: string, now: number, signal: AbortSignal) =>
        new Promise<undefined>((_resolve, reject) => {
          expect(nodeId).toBe("node");
          expect(now).toBe(0);
          lookupSignal = signal;
          lookupStarted?.();
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("lookup deadline"));
            },
            {
              once: true,
            },
          );
        }),
      cleanup: async () => 0,
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      now: () => 0,
      scheduler: {
        schedule: (_delay, onTick) => (
          ticks.push(onTick),
          (schedules += 1) === 2 && retryScheduled?.(),
          () => undefined
        ),
      },
      deadlines: {
        create: () => {
          const controller = new AbortController();
          controllers.push(controller);
          return { signal: controller.signal, close: () => undefined };
        },
      },
    });
    await registrar.start();
    expect(ticks).toHaveLength(1);
    ticks.shift()?.();
    await lookup;
    try {
      controllers.at(-1)?.abort();
      expect(lookupSignal?.aborted).toBe(true);
      await retried;
    } finally {
      await registrar.close();
    }
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

  it("unrefs default registrar schedules and operation deadlines", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let unrefs = 0;
    globalThis.setTimeout = (() =>
      ({
        unref: () => {
          unrefs += 1;
        },
      }) as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    globalThis.clearTimeout = () => undefined;
    const registrar = new GceRegistrar({
      registry: {
        register: async () => true,
        remove: async () => true,
      } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
    });
    try {
      await registrar.start();
      expect(unrefs).toBe(2);
    } finally {
      await registrar.close();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
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

  it("recovers metadata on one scheduled retry without duplicating timers", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const secondScheduledPromise = new Promise<void>((done) => (secondScheduled = done));
    let reads = 0;
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const metadata = {
      read: async () => {
        reads += 1;
        if (reads === 1) throw new Error("metadata unavailable");
        return { projectId: "p", zone: "z", instanceId: "1", privateAddress: "10.0.0.1" };
      },
    };
    const calls: string[] = [];
    const registry = {
      lookup: async () => undefined,
      register: async () => (calls.push("register"), true),
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      metadata,
      port: 8080,
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    expect(schedules).toBe(1);
    ticks.shift()?.();
    await cleanup;
    expect(calls).toEqual(["register", "cleanup"]);
    await secondScheduledPromise;
    expect(schedules).toBe(2);
    await registrar.close();
  });

  it("recovers a failed ownership lookup on the next scheduled tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let lookupCalls = 0;
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const identities: string[] = [];
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        if (identities.length === 1) throw new Error("lost");
        return true;
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls === 1) throw new Error("read failed");
        return undefined;
      },
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(identities).toEqual(["owner", "owner"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed conditional registration on the next retry", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    const identities: string[] = [];
    const registry = {
      register: async (lease: { registrationId: string }) => {
        identities.push(lease.registrationId);
        if (identities.length < 3) throw new Error("write failed");
        return true;
      },
      lookup: async () => undefined,
      cleanup: async () => (cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      identity: "owner",
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(identities).toEqual(["owner", "owner", "owner"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed confirmed renewal on the next tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let renews = 0;
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: async () => {
        renews += 1;
        calls.push("renew");
        if (renews === 1) throw new Error("renew failed");
        return true;
      },
      cleanup: async () => (calls.push("cleanup"), cleanupDone?.(), 0),
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    expect(calls).toEqual(["renew"]);
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(calls).toEqual(["renew", "renew", "cleanup"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });

  it("recovers a failed cleanup on the next tick", async () => {
    const ticks: (() => void)[] = [];
    let schedules = 0;
    let secondScheduled: (() => void) | undefined;
    const second = new Promise<void>((done) => (secondScheduled = done));
    let thirdScheduled: (() => void) | undefined;
    const third = new Promise<void>((done) => (thirdScheduled = done));
    let cleanupDone: (() => void) | undefined;
    const cleanup = new Promise<void>((done) => (cleanupDone = done));
    let cleanups = 0;
    const calls: string[] = [];
    const registry = {
      register: async () => true,
      renew: async () => (calls.push("renew"), true),
      cleanup: async () => {
        cleanups += 1;
        calls.push("cleanup");
        if (cleanups === 1) throw new Error("cleanup failed");
        cleanupDone?.();
        return 0;
      },
      remove: async () => true,
    } as unknown as import("@spine-event-engine/deployment").LeasedNodeRegistry;
    const registrar = new GceRegistrar({
      registry,
      node: new ApplicationNode({ id: "node", endpoint: "http://10.0.0.1" }),
      scheduler: {
        schedule: (_delay, onTick) => (
          (schedules += 1),
          ticks.push(onTick),
          schedules === 2 && secondScheduled?.(),
          schedules === 3 && thirdScheduled?.(),
          () => undefined
        ),
      },
    });
    await registrar.start();
    ticks.shift()?.();
    await second;
    ticks.shift()?.();
    await cleanup;
    await third;
    expect(calls).toEqual(["renew", "cleanup", "renew", "cleanup"]);
    expect(schedules).toBe(3);
    await registrar.close();
  });
});

function gatewayClient(id: string, subscribed: Set<string>): DynamicUnaryClient {
  return {
    forward: async () => new TextEncoder().encode(id),
    close: async () => undefined,
    subscribe: async () => {
      subscribed.add(id);
      return { kind: "backend-subscription-envelope", bytes: new Uint8Array() };
    },
    activate: async () => undefined,
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
