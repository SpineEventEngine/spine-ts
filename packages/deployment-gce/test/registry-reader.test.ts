/* eslint-disable @typescript-eslint/require-await -- Structural registry and Gateway fixtures expose
 * asynchronous contract methods without awaiting. */

import { create, toBinary } from "@bufbuild/protobuf";
import { DynamicUnaryForwarder, type DynamicUnaryClient } from "@spine-event-engine/auth";
import {
  ApplicationNode,
  LeasedNodeRegistry,
  ScheduledNodeDiscovery,
} from "@spine-event-engine/deployment";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { GceRegistrar, GceRegistryReader } from "../src/index.js";

describe("GceRegistryReader", () => {
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
