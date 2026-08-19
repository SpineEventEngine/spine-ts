/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import {
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";
import {
  InMemorySubscriptionBindings,
  SubscriptionGateway,
  SubscriptionUpdateRelay,
  TransportFacts,
} from "../../src/index.js";
import type { SubscriptionGatewayOptions } from "../../src/index.js";

type MutableFixtureOptions = {
  -readonly [Key in keyof SubscriptionGatewayOptions]: SubscriptionGatewayOptions[Key];
};

const service = "spine.client.SubscriptionService";
const topic = toBinary(
  TopicSchema,
  create(TopicSchema, {
    target: create(TargetSchema),
    context: create(ActorContextSchema, {
      actor: { value: "owner-a" },
      tenantId: tenant("tenant-a"),
    }),
  }),
);
function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}
function request(method: "Subscribe" | "Activate" | "Cancel", bytes: Uint8Array) {
  return {
    service,
    method,
    wire:
      method === "Subscribe"
        ? { kind: "subscription-topic" as const, bytes }
        : { kind: "public-subscription" as const, bytes },
    credential: { kind: "bearer" as const, value: "credential" },
    transport: TransportFacts.from({ service, method }),
  };
}
function user(value: string) {
  return create(UserIdSchema, { value });
}
function defined<Value>(value: Value | undefined, message: string): Value {
  if (value === undefined) throw new Error(message);
  return value;
}
function setup(
  overrides: {
    readonly activate?: () => Promise<void>;
    readonly cancel?: () => Promise<void>;
  } = {},
) {
  let nextId = 0;
  const bindings = new InMemorySubscriptionBindings({
    nextId: () => `gateway-${String(++nextId)}`,
    dispose: () => Promise.resolve(),
  });
  const calls: string[] = [];
  return {
    bindings,
    calls,
    options: {
      bindings,
      sessions: {
        resolve: () =>
          Promise.resolve({
            principal: { id: "owner-a" },
            expiresAt: create(TimestampSchema, { seconds: 100n }),
          }),
      },
      authorize: () => Promise.resolve(true),
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: user("owner-a"),
            tenant: tenant("tenant-a"),
            timestamp: create(TimestampSchema, { seconds: 10n }),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: user("owner-a"),
            timestamp: create(TimestampSchema),
          }),
      },
      clock: { now: () => create(TimestampSchema, { seconds: 10n }) },
      creator: {
        subscribe: () => {
          calls.push("subscribe");
          return Promise.resolve();
        },
        activate: async () => {
          calls.push("activate");
          await overrides.activate?.();
        },
        cancel: async () => {
          calls.push("cancel");
          await overrides.cancel?.();
        },
      },
    } as MutableFixtureOptions,
  };
}
function gateway(
  fixture: ReturnType<typeof setup>,
  limits?: { readonly maxRequestBytes?: number },
) {
  return new SubscriptionGateway(
    limits === undefined ? fixture.options : { ...fixture.options, limits },
  );
}
async function subscribe(gateway: SubscriptionGateway) {
  const result = await gateway.handle(request("Subscribe", topic));
  if (result.kind !== "subscribed") throw new Error("fixture subscription rejected");
  return result.wire.bytes;
}
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function subscriptionWire(id: string, actor = "owner-a", tenantId = "tenant-a") {
  return toBinary(
    SubscriptionSchema,
    create(SubscriptionSchema, {
      id: { value: id },
      topic: create(TopicSchema, {
        context: create(ActorContextSchema, {
          actor: { value: actor },
          tenantId: tenant(tenantId),
        }),
      }),
    }),
  );
}
function canonicalBinding(id: string, whenExpires: number) {
  const definition = subscriptionWire(id);
  const subscription = fromBinary(SubscriptionSchema, definition);
  return {
    topic: {
      kind: "subscription-topic" as const,
      bytes: toBinary(TopicSchema, subscription.topic ?? create(TopicSchema)),
    },
    whenExpires,
  };
}
function trustedContext() {
  return create(ActorContextSchema, {
    actor: user("owner-a"),
    tenantId: tenant("tenant-a"),
  });
}

describe("SubscriptionGateway", () => {
  it("does not start native activation for a pre-aborted downstream request", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const controller = new AbortController();
    controller.abort();

    await expect(
      subscriptionGateway.handle({ ...request("Activate", wire), signal: controller.signal }),
    ).resolves.toEqual({ kind: "rejected", reason: "denied" });
    expect(fixture.calls).toEqual(["subscribe"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("does not start queued native activation after its downstream signal aborts", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "queued-activation",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("queued-activation", 100));
    const first = bindings.activate({
      id: "queued-activation",
      context: trustedContext(),
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: async () => {
        await firstMayFinish;
        throw new Error("first activation failed");
      },
    });
    await tick();
    const controller = new AbortController();
    let queuedNativeCalls = 0;
    const queued = bindings.activate({
      id: "queued-activation",
      context: trustedContext(),
      nowMs: 1,
      signal: controller.signal,
      onDefinition: () => {
        queuedNativeCalls++;
        return Promise.resolve();
      },
    });
    controller.abort();
    defined(releaseFirst, "expected first activation release")();

    await expect(first).rejects.toThrow("first activation failed");
    await expect(queued).resolves.toEqual({ kind: "denied" });
    expect(queuedNativeCalls).toBe(0);
    expect(bindings.size).toBe(1);
  });

  it("cancels an active binding once after aborting its native effect", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "active-cancel",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("active-cancel", 100));
    let cancels = 0;
    const active = bindings.activate({
      id: "active-cancel",
      context: trustedContext(),
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: async (_backend, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        throw new Error("native activation stopped during cancellation");
      },
    });
    await tick();
    const cancelled = bindings.cancel({
      id: "active-cancel",
      context: trustedContext(),
      nowMs: 1,
      onDefinition: () => {
        cancels++;
        return Promise.resolve();
      },
    });
    await expect(active).resolves.toEqual({ kind: "activated" });
    await expect(cancelled).resolves.toEqual({ kind: "closed" });
    expect(cancels).toBe(1);
    expect(bindings.size).toBe(0);
  });

  it("keeps an active update stream open beyond the finite-operation timeout", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "long-lived-activation",
      limits: { operationTimeoutMs: 5 },
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("long-lived-activation", 100));
    const controller = new AbortController();
    let settled = false;
    const active = bindings.activate({
      id: "long-lived-activation",
      context: trustedContext(),
      nowMs: 1,
      signal: controller.signal,
      onDefinition: async (_definition, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    void active.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    controller.abort();

    await expect(active).rejects.toThrow("aborted");
  });

  it("observes browser cancellation triggered synchronously by active work", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "synchronous-cancellation",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("synchronous-cancellation", 100));
    const controller = new AbortController();
    const active = bindings.activate({
      id: "synchronous-cancellation",
      context: trustedContext(),
      nowMs: 1,
      signal: controller.signal,
      onDefinition: () => {
        controller.abort();
        return new Promise<void>(() => undefined);
      },
    });

    await expect(
      Promise.race([
        active,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("activation did not observe synchronous cancellation"));
          }, 20);
        }),
      ]),
    ).rejects.toThrow("subscription operation aborted");
  });

  it("retains a naturally completed native activation until cancellation or expiry", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);

    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "activated",
    });
    expect(fixture.calls).toEqual(["subscribe", "activate"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("expires a live activation without another gateway request", async () => {
    let aborted = false;
    const fixture = setup();
    fixture.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: 10n, nanos: 20_000_000 }),
      });
    fixture.options.clock = { now: () => create(TimestampSchema, { seconds: 10n }) };
    fixture.options.creator.activate = async (_request, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);

    await expect(subscriptionGateway.handle(request("Activate", wire))).rejects.toThrow("aborted");
    expect(aborted).toBe(true);
    expect(fixture.bindings.size).toBe(0);
  });

  it("aborts B3 work and retains the binding when its update sink rejects malformed bytes", async () => {
    const fixture = setup();
    let activated = false;
    fixture.options.creator.activate = async ({ updates }) => {
      activated = true;
      await updates({ kind: "subscription-update", bytes: new Uint8Array([255]) });
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const relay = new SubscriptionUpdateRelay();

    await expect(
      subscriptionGateway.handle({
        ...request("Activate", wire),
        updates: (update) => relay.push(update),
      }),
    ).rejects.toThrow();
    expect(activated).toBe(true);
    expect(fixture.calls).toEqual(["subscribe"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("passes the platform AbortSignal to subscription callbacks", async () => {
    let received: AbortSignal | undefined;
    const fixture = setup();
    fixture.options.creator.subscribe = (_request, signal) => {
      received = signal;
      return Promise.resolve();
    };
    await gateway(fixture).handle(request("Subscribe", topic));
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.addEventListener.bind(received)).toBeTypeOf("function");
  });

  it("forwards copied public updates through the activation sink for the backend stream lifetime", async () => {
    const fixture = setup();
    let received: Uint8Array | undefined;
    fixture.options.creator.activate = async ({ updates }) => {
      const source = toBinary(
        SubscriptionUpdateSchema,
        create(SubscriptionUpdateSchema, {
          subscription: create(SubscriptionSchema, {
            id: { value: "backend-owned" },
            topic: create(TopicSchema, {
              id: { value: "backend-topic" },
              target: create(TargetSchema, {
                type: "example.Backend",
                criterion: { case: "includeAll", value: true },
              }),
            }),
          }),
        }),
      );
      await updates({ kind: "subscription-update", bytes: source });
      source.fill(9);
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const result = await subscriptionGateway.handle({
      ...request("Activate", wire),
      updates: (update) => {
        received = update.bytes;
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ kind: "activated" });
    const emitted = fromBinary(SubscriptionUpdateSchema, defined(received, "expected update"));
    const publicSubscription = fromBinary(SubscriptionSchema, wire);
    const emittedSubscription = defined(emitted.subscription, "expected emitted subscription");
    const emittedTopic = defined(emittedSubscription.topic, "expected emitted topic");
    const emittedTarget = defined(emittedTopic.target, "expected emitted target");
    const publicTopic = defined(publicSubscription.topic, "expected public topic");
    const publicTarget = defined(publicTopic.target, "expected public target");
    expect(toBinary(TargetSchema, emittedTarget)).toEqual(toBinary(TargetSchema, publicTarget));
    expect(emitted.subscription).toEqual(publicSubscription);
  });

  it("aborts a quiet activation through the admitted downstream signal while retaining it", async () => {
    const fixture = setup();
    fixture.options.creator.activate = async (_request, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const controller = new AbortController();
    const activating = subscriptionGateway.handle({
      ...request("Activate", wire),
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    await expect(activating).rejects.toThrow("aborted");
    expect(fixture.calls).toEqual(["subscribe"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("rejects terminal, invalid, and unauthorized gateway requests", async () => {
    const closed = gateway(setup());
    await closed.close();
    await expect(closed.handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    await expect(
      gateway(setup()).handle({ ...request("Subscribe", topic), service: "unknown.Service" }),
    ).resolves.toEqual({ kind: "rejected", reason: "unknown-operation" });
    await expect(
      gateway(setup()).handle(request("Subscribe", new Uint8Array([255]))),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "malformed-request",
    });
    const invalidTime = setup();
    invalidTime.options.clock = { now: () => create(TimestampSchema, { seconds: 10n, nanos: -1 }) };
    await expect(gateway(invalidTime).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    const unauthenticated = setup();
    unauthenticated.options.sessions.resolve = () => Promise.resolve(undefined);
    await expect(gateway(unauthenticated).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "unauthenticated",
    });
    const forbidden = setup();
    forbidden.options.authorize = () => Promise.resolve(false);
    await expect(gateway(forbidden).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "forbidden",
    });
    const expired = setup();
    expired.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: 10n }),
      });
    await expect(gateway(expired).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
  });

  it("rejects a session timestamp whose milliseconds exceed the safe integer range", async () => {
    const fixture = setup();
    fixture.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: 9_007_199_254_741n }),
      });

    await expect(gateway(fixture).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(fixture.calls).toEqual([]);
  });

  it("normalizes identifier failures and distinguishes absent from expired cancellation", async () => {
    const unavailableId = new InMemorySubscriptionBindings({
      nextId: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercises raw identifier normalization.
        throw "identifier source unavailable";
      },
      dispose: () => Promise.resolve(),
    });
    await expect(unavailableId.create(canonicalBinding("unavailable", 100))).rejects.toThrow(
      "subscription binding creation failed",
    );

    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const cancel = (id: string, nowMs: number) =>
      bindings.cancel({
        id,
        context: trustedContext(),
        nowMs,
        onDefinition: () => Promise.resolve(),
      });
    await expect(cancel("missing", 0)).resolves.toEqual({ kind: "closed" });
    await bindings.create(canonicalBinding("one", 1));
    await expect(cancel("one", 1)).resolves.toEqual({ kind: "denied" });
    await tick();
    expect(bindings.size).toBe(0);
  });

  it("preserves present transport facts while accepting a tenant-less trusted context", async () => {
    const fixture = setup();
    const tenantlessTopic = toBinary(
      TopicSchema,
      create(TopicSchema, {
        target: create(TargetSchema),
        context: create(ActorContextSchema, { actor: user("owner-a") }),
      }),
    );
    fixture.options.contexts.resolve = () =>
      Promise.resolve({
        actor: user("owner-a"),
        timestamp: create(TimestampSchema, { seconds: 10n }),
      });
    let seen: Parameters<SubscriptionGatewayOptions["authorize"]>[1]["transport"] | undefined;
    fixture.options.authorize = (_principal, incoming) => {
      seen = incoming.transport;
      return Promise.resolve(true);
    };
    const incoming = request("Subscribe", tenantlessTopic);
    incoming.transport = TransportFacts.from({
      service,
      method: "Subscribe",
      origin: "https://browser.example",
      headers: { "x-request-id": "request", "x-correlation-id": "correlation" },
      peerAddress: "127.0.0.1",
      userAgent: "browser",
    });
    await expect(gateway(fixture).handle(incoming)).resolves.toMatchObject({ kind: "subscribed" });
    expect(seen).toMatchObject({
      origin: "https://browser.example",
      requestId: "request",
      correlationId: "correlation",
      peerAddress: "127.0.0.1",
      userAgent: "browser",
    });
  });

  it("retains optional trusted zone and language facts in the public Subscription", async () => {
    const fixture = setup();
    fixture.options.contexts.resolve = () =>
      Promise.resolve({
        actor: user("owner-a"),
        tenant: tenant("tenant-a"),
        timestamp: create(TimestampSchema, { seconds: 10n }),
        zoneId: create(ZoneIdSchema, { value: "Europe/Lisbon" }),
        language: 1,
      });

    const result = await gateway(fixture).handle(request("Subscribe", topic));
    if (result.kind !== "subscribed") throw new Error("expected subscription");
    const retained = fromBinary(SubscriptionSchema, result.wire.bytes).topic?.context;
    expect(retained).toMatchObject({ zoneId: { value: "Europe/Lisbon" }, language: 1 });
  });

  it("rejects a lifecycle method paired with the wrong public wire shape", async () => {
    const fixture = setup();
    await expect(
      gateway(fixture).handle({
        ...request("Cancel", topic),
        wire: { kind: "subscription-topic", bytes: topic },
      } as never),
    ).resolves.toEqual({ kind: "rejected", reason: "unknown-operation" });
  });

  it("keeps logical definition bounds separate from native child-envelope bounds", async () => {
    const oversize = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { maxBackendEnvelopeBytes: 1 },
      dispose: () => Promise.resolve(),
    });
    await expect(oversize.create(canonicalBinding("one", 100))).resolves.toMatchObject({
      kind: "public-subscription",
    });
    const emptyId = new InMemorySubscriptionBindings({
      nextId: () => "",
      dispose: () => Promise.resolve(),
    });
    await expect(emptyId.create(canonicalBinding("empty", 100))).rejects.toThrow("unique");
    const duplicateId = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const input = canonicalBinding("one", 100);
    await duplicateId.create(input);
    await expect(duplicateId.create(input)).rejects.toThrow("unique");
  });

  it("rejects invalid public binding limits before accepting a definition", () => {
    expect(
      () =>
        new InMemorySubscriptionBindings({
          nextId: () => "one",
          dispose: () => Promise.resolve(),
          limits: { pendingOperationLimit: 0 },
        }),
    ).toThrow("positive safe integers");
  });

  it("does not apply a native child-envelope bound to the logical definition", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    fixture.options.creator.subscribe = () => Promise.resolve();
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings,
      limits: { maxBackendEnvelopeBytes: 1 },
    });

    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toMatchObject({
      kind: "subscribed",
    });
  });

  it("denies a foreign cancel before its definition callback", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("one", 100));
    await expect(
      bindings.cancel({
        id: "one",
        context: create(ActorContextSchema, {
          actor: user("other"),
          tenantId: tenant("tenant-a"),
        }),
        nowMs: 1,
        onDefinition: () => {
          throw new Error("must not run");
        },
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("returns only a copied public subscription wire and never a backend envelope", async () => {
    const fixture = setup();
    const result = await gateway(fixture).handle(request("Subscribe", topic));
    expect(result.kind).toBe("subscribed");
    if (result.kind !== "subscribed") return;
    expect(result.wire.kind).toBe("public-subscription");
    expect(fromBinary(SubscriptionSchema, result.wire.bytes).id?.value).toBe("gateway-1");
    expect(result.wire.bytes).not.toEqual(topic);
  });

  it("isolates admission, store, and callback bytes from mutation", async () => {
    let callbackBytes: Uint8Array | undefined;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const source = new Uint8Array([1, 2, 3]);
    await bindings.create(canonicalBinding("one", 100));
    source.fill(9);
    await bindings.activate({
      id: "one",
      context: trustedContext(),
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: ({ bytes }) => {
        callbackBytes = bytes;
        bytes.fill(8);
        return Promise.resolve();
      },
    });
    expect(callbackBytes).toEqual(
      new Uint8Array(defined(callbackBytes, "expected callback bytes").byteLength),
    );
    let retryBytes: Uint8Array | undefined;
    await bindings.cancel({
      id: "one",
      context: trustedContext(),
      nowMs: 1,
      onDefinition: ({ bytes }) => {
        retryBytes = bytes;
        return Promise.resolve();
      },
    });
    expect(retryBytes).toEqual(
      new Uint8Array(defined(retryBytes, "expected retry bytes").byteLength),
    );
  });

  it("serializes delayed activate before cancel backend effects", async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = setup({
      activate: async () => {
        await wait;
      },
    });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const activating = subscriptionGateway.handle(request("Activate", wire));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelling = subscriptionGateway.handle(request("Cancel", wire));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
    defined(release, "expected release")();
    await activating;
    await cancelling;
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
  });

  it("closes cancel-first bindings and rejects a later activate", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "cancelled",
    });
    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(fixture.calls).toEqual(["subscribe", "cancel"]);
  });

  it("rejects a second queued operation while an effect and one queued operation exist", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = setup({ activate: async () => held });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const activating = subscriptionGateway.handle(request("Activate", wire));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const queued = subscriptionGateway.handle(request("Cancel", wire));
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "binding-busy",
    });
    defined(release, "expected release")();
    await activating;
    await queued;
  });

  it("retains failed cancellation cleanup for a retry and then clears it", async () => {
    let attempt = 0;
    const fixture = setup({
      cancel: () => {
        attempt++;
        if (attempt === 1) throw new Error("cleanup failed");
        return Promise.resolve();
      },
    });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Cancel", wire))).rejects.toThrow(
      "cleanup failed",
    );
    expect(fixture.bindings.size).toBe(1);
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "cancelled",
    });
    expect(attempt).toBe(2);
    expect(fixture.bindings.size).toBe(0);
  });

  it("maps direct binding busy and denied outcomes to public rejections", async () => {
    const fixture = setup();
    const original = fixture.bindings;
    fixture.options.bindings = {
      create: original.create.bind(original),
      activate: () => Promise.reject(new Error("binding-busy")),
      cancel: () => Promise.resolve({ kind: "denied" as const }),
      purgeExpired: original.purgeExpired.bind(original),
      close: original.close.bind(original),
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "binding-busy",
    });
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
  });

  it("rejects activate and cancel wires without a usable subscription ID", async () => {
    const subscriptionGateway = gateway(setup());
    const withoutId = toBinary(
      SubscriptionSchema,
      create(SubscriptionSchema, { topic: create(TopicSchema) }),
    );
    for (const method of ["Activate", "Cancel"] as const)
      await expect(subscriptionGateway.handle(request(method, withoutId))).resolves.toEqual({
        kind: "rejected",
        reason: "denied",
      });
    for (const method of ["Activate", "Cancel"] as const)
      await expect(
        subscriptionGateway.handle(request(method, subscriptionWire(""))),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "denied",
      });
  });

  it("maps a direct cancellation busy error to its public rejection", async () => {
    const fixture = setup();
    const original = fixture.bindings;
    fixture.options.bindings = {
      create: original.create.bind(original),
      activate: original.activate.bind(original),
      cancel: () => Promise.reject(new Error("binding-busy")),
      purgeExpired: original.purgeExpired.bind(original),
      close: original.close.bind(original),
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "binding-busy",
    });
  });

  it("runs mandatory cancellation cleanup after an activation callback rejects", async () => {
    const failure = new Error("activate failed");
    const fixture = setup({ activate: async () => Promise.reject(failure) });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Activate", wire))).rejects.toBe(failure);
    expect(fixture.calls).toEqual(["subscribe", "activate"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("makes store close terminal for concurrent and late creation", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const closing = bindings.close();
    const create = bindings.create(canonicalBinding("one", 10));
    await closing;
    await expect(create).rejects.toThrow("closed");
    expect(bindings.size).toBe(0);
  });

  it("waits for an aborted activation before disposing its binding during close", async () => {
    let releaseActivation: (() => void) | undefined;
    let activationAborted = false;
    let disposeCalls = 0;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => {
        disposeCalls++;
        return Promise.resolve();
      },
    });
    await bindings.create(canonicalBinding("one", 100));
    const activating = bindings.activate({
      id: "one",
      context: trustedContext(),
      nowMs: 0,
      signal: new AbortController().signal,
      onDefinition: async (_envelope, signal) => {
        await new Promise<void>((resolve) => {
          releaseActivation = resolve;
          signal.addEventListener(
            "abort",
            () => {
              activationAborted = true;
            },
            { once: true },
          );
        });
      },
    });
    await tick();
    const activationOutcome = activating.catch((error: unknown) => error);
    const closing = bindings.close();
    await tick();
    expect(activationAborted).toBe(true);
    expect(disposeCalls).toBe(0);
    defined(releaseActivation, "expected held activation")();
    await expect(activationOutcome).resolves.toBeInstanceOf(Error);
    await closing;
    expect(disposeCalls).toBe(1);
    expect(bindings.size).toBe(0);
  });

  it("disposes an expired binding once when close overlaps its active effect", async () => {
    let releaseActivation: (() => void) | undefined;
    let disposeCalls = 0;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => {
        disposeCalls++;
        return Promise.resolve();
      },
    });
    await bindings.create(canonicalBinding("one", 1));
    const activating = bindings.activate({
      id: "one",
      context: trustedContext(),
      nowMs: 0,
      signal: new AbortController().signal,
      onDefinition: async () =>
        new Promise<void>((resolve) => {
          releaseActivation = resolve;
        }),
    });
    await tick();
    const activationOutcome = activating.catch((error: unknown) => error);
    await bindings.purgeExpired(1);
    await bindings.purgeExpired(1);
    const closing = bindings.close();
    await tick();
    expect(disposeCalls).toBe(0);
    defined(releaseActivation, "expected held activation")();
    await expect(activationOutcome).resolves.toBeInstanceOf(Error);
    await closing;
    expect(disposeCalls).toBe(1);
    expect(bindings.size).toBe(0);
  });

  it("tracks a synchronous callback failure and releases its subscription definition", async () => {
    let envelope: Uint8Array | undefined;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("one", 100));
    await expect(
      bindings.activate({
        id: "one",
        context: trustedContext(),
        nowMs: 0,
        signal: new AbortController().signal,
        onDefinition: (received) => {
          envelope = received.bytes;
          throw new Error("synchronous activation failure");
        },
      }),
    ).rejects.toThrow("synchronous activation failure");
    expect(envelope).toEqual(new Uint8Array(defined(envelope, "expected definition").byteLength));
    await expect(bindings.close()).resolves.toBeUndefined();
    expect(bindings.size).toBe(0);
  });

  it("normalizes a synchronous non-Error callback throw without losing its cause", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create(canonicalBinding("one", 100));

    await expect(
      bindings.activate({
        id: "one",
        context: trustedContext(),
        nowMs: 0,
        signal: new AbortController().signal,
        onDefinition: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercises raw callback normalization.
          throw "non-Error callback failure";
        },
      }),
    ).rejects.toMatchObject({
      message: "Subscription backend callback threw a non-Error value.",
      cause: "non-Error callback failure",
    });
    await expect(bindings.close()).resolves.toBeUndefined();
  });

  it("finishes disposal after an abort-ignoring activation settles during close", async () => {
    let releaseActivation: (() => void) | undefined;
    let disposeCalls = 0;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { shutdownTimeoutMs: 1 },
      dispose: () => {
        disposeCalls++;
        return Promise.resolve();
      },
    });
    await bindings.create(canonicalBinding("one", 100));
    const activating = bindings.activate({
      id: "one",
      context: trustedContext(),
      nowMs: 0,
      signal: new AbortController().signal,
      onDefinition: async () =>
        new Promise<void>((resolve) => {
          releaseActivation = resolve;
        }),
    });
    await tick();
    const activationOutcome = activating.catch((error: unknown) => error);
    const closing = bindings.close();
    try {
      await expect(closing).rejects.toBeInstanceOf(AggregateError);
      expect(disposeCalls).toBe(0);
    } finally {
      defined(releaseActivation, "expected held activation")();
    }
    await expect(activationOutcome).resolves.toBeInstanceOf(Error);
    await tick();
    expect(disposeCalls).toBe(1);
    expect(bindings.size).toBe(0);
  });

  it("rejects a fabricated actor context before the definition callback", async () => {
    const fixture = setup();
    const fabricated = toBinary(
      TopicSchema,
      create(TopicSchema, {
        context: create(ActorContextSchema, {
          actor: { value: "other" },
          tenantId: tenant("tenant-a"),
        }),
      }),
    );
    await expect(gateway(fixture).handle(request("Subscribe", fabricated))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects an oversize request synchronously before session resolution", async () => {
    let sessionCalls = 0;
    const fixture = setup();
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      sessions: { resolve: () => Promise.resolve((++sessionCalls, undefined)) },
      limits: { maxRequestBytes: 1 },
    });
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "request-too-large",
    });
    expect(sessionCalls).toBe(0);
  });

  it("does not let a delayed binding block another binding", async () => {
    let release: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let activation = 0;
    const fixture = setup({
      activate: async () => {
        activation++;
        if (activation === 1) await delayed;
      },
    });
    const subscriptionGateway = gateway(fixture);
    const first = await subscribe(subscriptionGateway);
    const secondTopic = toBinary(
      TopicSchema,
      create(TopicSchema, {
        context: create(ActorContextSchema, {
          actor: { value: "owner-a" },
          tenantId: tenant("tenant-a"),
        }),
      }),
    );
    const second = await subscriptionGateway.handle(request("Subscribe", secondTopic));
    if (second.kind !== "subscribed") throw new Error("second subscription rejected");
    const firstActivation = subscriptionGateway.handle(request("Activate", first));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      subscriptionGateway.handle(request("Activate", second.wire.bytes)),
    ).resolves.toEqual({ kind: "activated" });
    defined(release, "expected release")();
    await firstActivation;
  });

  it("disposes an expired binding without blocking an unrelated binding", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bindings = new InMemorySubscriptionBindings({
      nextId: (() => {
        let id = 0;
        return () => String(++id);
      })(),
      dispose: async () => {
        calls.push("dispose");
        await held;
      },
    });
    const first = await bindings.create(canonicalBinding("1", 1));
    const second = await bindings.create(canonicalBinding("2", 100));
    const purging = bindings.purgeExpired(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      bindings.activate({
        id: defined(fromBinary(SubscriptionSchema, second.bytes).id, "expected subscription id")
          .value,
        context: trustedContext(),
        nowMs: 2,
        signal: new AbortController().signal,
        onDefinition: () => {
          calls.push("activate");
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "activated" });
    expect(calls).toEqual(["dispose", "activate"]);
    defined(release, "expected release")();
    await purging;
    expect(bindings.size).toBe(1);
    expect(
      defined(fromBinary(SubscriptionSchema, first.bytes).id, "expected subscription id").value,
    ).toBe("1");
  });

  it("closes terminally within one timeout while disposing every retained binding", async () => {
    const started: string[] = [];
    const bindings = new InMemorySubscriptionBindings({
      nextId: (() => {
        let id = 0;
        return () => String(++id);
      })(),
      limits: { shutdownTimeoutMs: 1 },
      dispose: async (_envelope, signal) => {
        started.push(signal.aborted ? "aborted" : "live");
        await new Promise<void>(() => undefined);
      },
    });
    for (let id = 0; id < 2; id++) await bindings.create(canonicalBinding(String(id + 1), 100));
    await expect(bindings.close()).rejects.toBeInstanceOf(AggregateError);
    expect(started).toEqual(["live", "live"]);
    expect(bindings.size).toBe(0);
  });

  it("admits copied wire and transport facts synchronously before awaiting session security", async () => {
    const fixture = setup();
    let releaseSession: (() => void) | undefined;
    const sessionHeld = new Promise<void>((resolve) => (releaseSession = resolve));
    const seen: {
      readonly actor: string | undefined;
      readonly requestId: string | undefined;
    }[] = [];
    fixture.options.sessions.resolve = async () => {
      await sessionHeld;
      return {
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: 100n }),
      };
    };
    fixture.options.authorize = (_principal, incoming) => {
      seen.push({
        actor: incoming.requestedContext.actor?.value,
        requestId: incoming.transport.requestId,
      });
      return Promise.resolve(true);
    };
    const mutableWire = topic.slice();
    const mutable = request("Subscribe", mutableWire);
    const transport = mutable.transport as { requestId?: string };
    transport.requestId = "original";
    const pending = gateway(fixture).handle(mutable);
    mutableWire.fill(0);
    transport.requestId = "mutated";
    defined(releaseSession, "expected session release")();
    await expect(pending).resolves.toMatchObject({ kind: "subscribed" });
    expect(seen).toEqual([{ actor: "owner-a", requestId: "original" }]);
  });

  it("rejects Subscribe when an awaited authorization gate outlives the session", async () => {
    let now = 10n;
    const fixture = setup();
    fixture.options.clock = { now: () => create(TimestampSchema, { seconds: now }) };
    fixture.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: 11n }),
      });
    fixture.options.authorize = () => {
      now = 12n;
      return Promise.resolve(true);
    };

    await expect(gateway(fixture).handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(fixture.calls).toEqual([]);
    expect(fixture.bindings.size).toBe(0);
  });

  it("compensates an expired delayed Subscribe", async () => {
    let now = 10n;
    let expiresAt = 11n;
    let releaseBackend: (() => void) | undefined;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const fixture = setup();
    fixture.options.bindings = bindings;
    fixture.options.clock = { now: () => create(TimestampSchema, { seconds: now }) };
    fixture.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: expiresAt }),
      });
    fixture.options.creator.subscribe = () =>
      new Promise((resolve) => {
        releaseBackend = () => {
          resolve();
        };
      });
    const subscriptionGateway = gateway(fixture);
    const pending = subscriptionGateway.handle(request("Subscribe", topic));
    await tick();
    now = 12n;
    defined(releaseBackend, "expected delayed backend Subscribe")();

    await expect(pending).resolves.toEqual({ kind: "rejected", reason: "denied" });
    expect(fixture.calls).toEqual(["cancel"]);
    expect(bindings.size).toBe(0);

    expiresAt = 100n;
    fixture.options.creator.subscribe = () => Promise.resolve();
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toMatchObject({
      kind: "subscribed",
    });
    expect(bindings.size).toBe(1);
    await subscriptionGateway.close();
  });

  it("rejects Activate when an awaited authorization gate outlives the session", async () => {
    let now = 10n;
    let expiresAt = 100n;
    const fixture = setup();
    fixture.options.clock = { now: () => create(TimestampSchema, { seconds: now }) };
    fixture.options.sessions.resolve = () =>
      Promise.resolve({
        principal: { id: "owner-a" },
        expiresAt: create(TimestampSchema, { seconds: expiresAt }),
      });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    expiresAt = 11n;
    fixture.options.authorize = () => {
      now = 12n;
      return Promise.resolve(true);
    };

    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(fixture.calls).toEqual(["subscribe"]);
    expect(fixture.bindings.size).toBe(1);
  });

  it("rejects stale Actor and Tenant Activate and Cancel at the gateway without definition callbacks", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const staleActor = subscriptionWire(
      defined(fromBinary(SubscriptionSchema, wire).id, "expected subscription id").value,
      "other",
      "tenant-a",
    );
    const staleTenant = subscriptionWire(
      defined(fromBinary(SubscriptionSchema, wire).id, "expected subscription id").value,
      "owner-a",
      "other",
    );
    for (const [method, candidate] of [
      ["Activate", staleActor],
      ["Cancel", staleActor],
      ["Activate", staleTenant],
      ["Cancel", staleTenant],
    ] as const)
      await expect(subscriptionGateway.handle(request(method, candidate))).resolves.toEqual({
        kind: "rejected",
        reason: "denied",
      });
    expect(fixture.calls).toEqual(["subscribe"]);
  });

  it("denies foreign Cancels before the legitimate queued Cancel", async () => {
    let release: (() => void) | undefined;
    const active = new Promise<void>((resolve) => (release = resolve));
    const fixture = setup({ activate: async () => active });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const activating = subscriptionGateway.handle(request("Activate", wire));
    await tick();
    const id = defined(fromBinary(SubscriptionSchema, wire).id, "expected subscription id").value;
    await expect(
      subscriptionGateway.handle(request("Cancel", subscriptionWire(id, "other", "tenant-a"))),
    ).resolves.toEqual({ kind: "rejected", reason: "denied" });
    await expect(
      subscriptionGateway.handle(request("Cancel", subscriptionWire(id, "owner-a", "other"))),
    ).resolves.toEqual({ kind: "rejected", reason: "denied" });
    const cancelling = subscriptionGateway.handle(request("Cancel", wire));
    await tick();
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
    defined(release, "expected release")();
    await activating;
    await expect(cancelling).resolves.toEqual({ kind: "cancelled" });
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
  });

  it("aborts a hung Subscribe at its operation timeout and settles its handle", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    let aborted = false;
    fixture.options.creator.subscribe = async (_request, signal) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      await new Promise<void>(() => undefined);
    };
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings,
      limits: { operationTimeoutMs: 1 },
    });
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).rejects.toThrow(
      "aborted",
    );
    expect(aborted).toBe(true);
    fixture.options.creator.subscribe = () => Promise.resolve();
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toMatchObject({
      kind: "subscribed",
    });
  });

  it("propagates a direct binding creation failure", async () => {
    const fixture = setup();
    fixture.options.creator.subscribe = () => Promise.resolve();
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      limits: { operationTimeoutMs: 1, maxBackendEnvelopeBytes: 1 },
    });
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toMatchObject({
      kind: "subscribed",
    });
    const failingBindings = {
      create: () => {
        throw new Error("create failed");
      },
      activate: fixture.bindings.activate.bind(fixture.bindings),
      cancel: fixture.bindings.cancel.bind(fixture.bindings),
      purgeExpired: fixture.bindings.purgeExpired.bind(fixture.bindings),
      close: fixture.bindings.close.bind(fixture.bindings),
    };
    const createFailureGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings: failingBindings,
      limits: { operationTimeoutMs: 1 },
    });
    await expect(createFailureGateway.handle(request("Subscribe", topic))).rejects.toThrow(
      "create failed",
    );
  });

  it("does not call a backend subscription when direct binding creation fails", async () => {
    const fixture = setup();
    let cancellations = 0;
    fixture.options.creator.cancel = () => {
      cancellations++;
      return Promise.resolve();
    };
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings: {
        create: () => {
          throw new Error("durable binding write failed");
        },
        activate: fixture.bindings.activate.bind(fixture.bindings),
        cancel: fixture.bindings.cancel.bind(fixture.bindings),
        purgeExpired: fixture.bindings.purgeExpired.bind(fixture.bindings),
        close: fixture.bindings.close.bind(fixture.bindings),
      },
    });

    await expect(subscriptionGateway.handle(request("Subscribe", topic))).rejects.toThrow(
      "durable binding write failed",
    );
    expect(cancellations).toBe(0);
  });

  it("lets a concurrent Cancel close first when Activate is delayed before store admission", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    let releaseContext: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (releaseContext = resolve));
    const original = fixture.options.contexts.resolve.bind(fixture.options.contexts);
    fixture.options.contexts.resolve = async (principal, incoming, clock) => {
      if (incoming.kind === "activate") await held;
      return original(principal, incoming, clock);
    };
    const activating = subscriptionGateway.handle(request("Activate", wire));
    await tick();
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "cancelled",
    });
    defined(releaseContext, "expected context release")();
    await expect(activating).resolves.toEqual({ kind: "rejected", reason: "denied" });
    expect(fixture.calls).toEqual(["subscribe", "cancel"]);
  });

  it("expires active and queued work in order, aborts the effect, and leaves no binding retained", async () => {
    let now = 10n;
    let activeAborted = false;
    const fixture = setup();
    fixture.options.clock = { now: () => create(TimestampSchema, { seconds: now }) };
    fixture.options.creator.activate = async (_request, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            activeAborted = true;
            resolve();
          },
          { once: true },
        );
      });
    };
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    const activating = subscriptionGateway.handle(request("Activate", wire));
    await tick();
    const queued = subscriptionGateway.handle(request("Cancel", wire));
    now = 100n;
    await fixture.bindings.purgeExpired(100_000);
    await expect(activating).rejects.toThrow("aborted");
    await expect(queued).resolves.toEqual({ kind: "rejected", reason: "denied" });
    await tick();
    expect(activeAborted).toBe(true);
    expect(fixture.bindings.size).toBe(0);
  });

  it("close aborts and settles an active effect and bounded cleanup with zero retained bindings", async () => {
    let activeAborted = false;
    let cleanupAborted = false;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { shutdownTimeoutMs: 1 },
      dispose: async (_backend, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              cleanupAborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    const fixture = setup();
    fixture.options.creator.activate = async (_request, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            activeAborted = true;
            resolve();
          },
          { once: true },
        );
      });
    };
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings,
      limits: { shutdownTimeoutMs: 1 },
    });
    const wire = await subscribe(subscriptionGateway);
    const activating = subscriptionGateway.handle(request("Activate", wire));
    const activeSettled = activating.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("aborted");
    });
    await tick();
    await expect(subscriptionGateway.close()).rejects.toBeInstanceOf(AggregateError);
    await activeSettled;
    expect(activeAborted).toBe(true);
    expect(cleanupAborted).toBe(false);
    expect(bindings.size).toBe(0);
  });
});
