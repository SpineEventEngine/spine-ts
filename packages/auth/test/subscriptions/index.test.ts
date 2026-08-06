import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
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
      fingerprint: (principal) => principal.id,
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
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });
    const first = bindings.activate({
      id: "queued-activation",
      principalFingerprint: "owner",
      tenant: undefined,
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
      principalFingerprint: "owner",
      tenant: undefined,
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
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });
    let cancels = 0;
    const active = bindings.activate({
      id: "active-cancel",
      principalFingerprint: "owner",
      tenant: undefined,
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
      },
    });
    await tick();
    const cancelled = bindings.cancel({
      id: "active-cancel",
      principalFingerprint: "owner",
      tenant: undefined,
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

  it("disposes a naturally completed native activation and removes its binding", async () => {
    const fixture = setup();
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);

    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "activated",
    });
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
    expect(fixture.bindings.size).toBe(0);
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

  it("aborts B3 work and removes the binding when its update sink rejects malformed bytes", async () => {
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
    expect(fixture.calls).toEqual(["subscribe", "cancel"]);
    expect(fixture.bindings.size).toBe(0);
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

  it("aborts a quiet activation through the admitted downstream signal and cleans up once", async () => {
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
    expect(fixture.calls).toEqual(["subscribe", "cancel"]);
    expect(fixture.bindings.size).toBe(0);
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
    await expect(
      unavailableId.create({
        definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
        principalFingerprint: "owner",
        tenant: undefined,
        expiresAtMs: 100,
      }),
    ).rejects.toThrow("subscription binding creation failed");

    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const cancel = (id: string, nowMs: number) =>
      bindings.cancel({
        id,
        principalFingerprint: "owner",
        tenant: undefined,
        nowMs,
        onDefinition: () => Promise.resolve(),
      });
    await expect(cancel("missing", 0)).resolves.toEqual({ kind: "closed" });
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 1,
    });
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

  it("keeps logical definition bounds separate from native child-envelope bounds", async () => {
    const oversize = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { maxBackendEnvelopeBytes: 1 },
      dispose: () => Promise.resolve(),
    });
    await expect(
      oversize.create({
        definition: { kind: "public-subscription", bytes: new Uint8Array([1, 2]) },
        principalFingerprint: "p",
        tenant: undefined,
        expiresAtMs: 100,
      }),
    ).resolves.toEqual({ id: "one" });
    const emptyId = new InMemorySubscriptionBindings({
      nextId: () => "",
      dispose: () => Promise.resolve(),
    });
    await expect(
      emptyId.create({
        definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
        principalFingerprint: "p",
        tenant: undefined,
        expiresAtMs: 100,
      }),
    ).rejects.toThrow("unique");
    const duplicateId = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const input = {
      definition: { kind: "public-subscription" as const, bytes: new Uint8Array([1]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 100,
    };
    await duplicateId.create(input);
    await expect(duplicateId.create(input)).rejects.toThrow("unique");
  });

  it("maps capacity reservation and retained-creation capacity failures to public rejection reasons", async () => {
    const fixture = setup();
    const bindings = fixture.bindings;
    const unavailable = {
      create: bindings.create.bind(bindings),
      activate: bindings.activate.bind(bindings),
      cancel: bindings.cancel.bind(bindings),
      reserveCapacity: () => Promise.reject(new Error("store unavailable")),
      purgeExpired: bindings.purgeExpired.bind(bindings),
      close: bindings.close.bind(bindings),
    };
    await expect(
      new SubscriptionGateway({ ...fixture.options, bindings: unavailable }).handle(
        request("Subscribe", topic),
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "denied" });
    const capacityFailure = {
      ...unavailable,
      reserveCapacity: () => Promise.resolve({ id: "reserved", release: () => Promise.resolve() }),
      create: () => {
        throw new Error("binding-capacity-exceeded");
      },
    };
    await expect(
      new SubscriptionGateway({ ...fixture.options, bindings: capacityFailure }).handle(
        request("Subscribe", topic),
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "binding-capacity-exceeded" });
  });

  it("suppresses backend activation and cancellation when a durable guard is false", async () => {
    const fixture = setup();
    const bindings = fixture.bindings;
    const guarded = {
      create: bindings.create.bind(bindings),
      activate: async (input: Parameters<typeof bindings.activate>[0]) => {
        await input.onDefinition(
          { kind: "public-subscription", bytes: new Uint8Array([1]) },
          new AbortController().signal,
          () => Promise.resolve(false),
        );
        return { kind: "activated" as const };
      },
      cancel: async (input: Parameters<typeof bindings.cancel>[0]) => {
        await input.onDefinition(
          { kind: "public-subscription", bytes: new Uint8Array([1]) },
          new AbortController().signal,
          () => Promise.resolve(false),
        );
        return { kind: "closed" as const };
      },
      reserveCapacity: bindings.reserveCapacity.bind(bindings),
      purgeExpired: bindings.purgeExpired.bind(bindings),
      close: bindings.close.bind(bindings),
    };
    const subscriptionGateway = new SubscriptionGateway({ ...fixture.options, bindings: guarded });
    const wire = await subscribe(subscriptionGateway);

    await expect(subscriptionGateway.handle(request("Activate", wire))).resolves.toEqual({
      kind: "activated",
    });
    await expect(subscriptionGateway.handle(request("Cancel", wire))).resolves.toEqual({
      kind: "cancelled",
    });
    expect(fixture.calls).toEqual(["subscribe"]);
  });

  it("does not apply a native child-envelope bound to the logical definition", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
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

  it("denies a foreign cancel before it reserves a binding queue slot", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: "tenant",
      expiresAtMs: 100,
    });
    await expect(
      bindings.cancel({
        id: "one",
        principalFingerprint: "other",
        tenant: "tenant",
        nowMs: 1,
        onDefinition: () => {
          throw new Error("must not run");
        },
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("leases capacity before backend Subscribe starts", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.options.creator.subscribe = async () => {
      await held;
    };
    const subscriptionGateway = new SubscriptionGateway({ ...fixture.options, bindings });
    const first = subscriptionGateway.handle(request("Subscribe", topic));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "binding-capacity-exceeded",
    });
    defined(release, "expected release")();
    await first;
  });

  it("gateway close aborts a pending Subscribe and releases its capacity lease", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    let aborted = false;
    fixture.options.creator.subscribe = async (_request, signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise<void>(() => undefined);
    };
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings,
      limits: { shutdownTimeoutMs: 1 },
    });
    const pending = subscriptionGateway.handle(request("Subscribe", topic));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await subscriptionGateway.close();
    expect(aborted).toBe(true);
    await expect(pending).rejects.toThrow("aborted");
    await expect(bindings.reserveCapacity()).rejects.toThrow("closed");
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
    await bindings.create({
      definition: { kind: "public-subscription", bytes: source },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 100,
    });
    source.fill(9);
    await bindings.activate({
      id: "one",
      principalFingerprint: "p",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: ({ bytes }) => {
        callbackBytes = bytes;
        bytes.fill(8);
        return Promise.resolve();
      },
    });
    expect(callbackBytes).toEqual(new Uint8Array([0, 0, 0]));
    let retryBytes: Uint8Array | undefined;
    await bindings.cancel({
      id: "one",
      principalFingerprint: "p",
      tenant: undefined,
      nowMs: 1,
      onDefinition: ({ bytes }) => {
        retryBytes = bytes;
        return Promise.resolve();
      },
    });
    expect(retryBytes).toEqual(new Uint8Array([0, 0, 0]));
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

  it("runs mandatory cancellation cleanup after an activation callback rejects", async () => {
    const failure = new Error("activate failed");
    const fixture = setup({ activate: async () => Promise.reject(failure) });
    const subscriptionGateway = gateway(fixture);
    const wire = await subscribe(subscriptionGateway);
    await expect(subscriptionGateway.handle(request("Activate", wire))).rejects.toBe(failure);
    expect(fixture.calls).toEqual(["subscribe", "activate", "cancel"]);
    expect(fixture.bindings.size).toBe(0);
  });

  it("makes store close terminal for concurrent and late creation", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    const closing = bindings.close();
    const create = bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 10,
    });
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
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });
    const activating = bindings.activate({
      id: "one",
      principalFingerprint: "owner",
      tenant: undefined,
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

  it("waits for an abort-ignoring activation before disposing an expired binding", async () => {
    let releaseActivation: (() => void) | undefined;
    let disposeCalls = 0;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => {
        disposeCalls++;
        return Promise.resolve();
      },
    });
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 1,
    });
    const activating = bindings.activate({
      id: "one",
      principalFingerprint: "owner",
      tenant: undefined,
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
    await tick();
    expect(disposeCalls).toBe(0);
    defined(releaseActivation, "expected held activation")();
    await expect(activationOutcome).resolves.toBeInstanceOf(Error);
    await tick();
    expect(disposeCalls).toBe(1);
    expect(bindings.size).toBe(0);
  });

  it("tracks a synchronous callback failure and releases its subscription definition", async () => {
    let envelope: Uint8Array | undefined;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });
    await expect(
      bindings.activate({
        id: "one",
        principalFingerprint: "owner",
        tenant: undefined,
        nowMs: 0,
        signal: new AbortController().signal,
        onDefinition: (received) => {
          envelope = received.bytes;
          throw new Error("synchronous activation failure");
        },
      }),
    ).rejects.toThrow("synchronous activation failure");
    expect(envelope).toEqual(new Uint8Array([0]));
    await expect(bindings.close()).resolves.toBeUndefined();
    expect(bindings.size).toBe(0);
  });

  it("normalizes a synchronous non-Error callback throw without losing its cause", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      dispose: () => Promise.resolve(),
    });
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });

    await expect(
      bindings.activate({
        id: "one",
        principalFingerprint: "owner",
        tenant: undefined,
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
    await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "owner",
      tenant: undefined,
      expiresAtMs: 100,
    });
    const activating = bindings.activate({
      id: "one",
      principalFingerprint: "owner",
      tenant: undefined,
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

  it("rejects a second retained binding at the configured capacity", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    const input = {
      definition: { kind: "public-subscription" as const, bytes: new Uint8Array([1]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 100,
    };
    await bindings.create(input);
    await expect(bindings.create(input)).rejects.toThrow("binding-capacity-exceeded");
    expect(bindings.size).toBe(1);
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
    const first = await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([1]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 1,
    });
    const second = await bindings.create({
      definition: { kind: "public-subscription", bytes: new Uint8Array([2]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 100,
    });
    const purging = bindings.purgeExpired(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      bindings.activate({
        id: second.id,
        principalFingerprint: "p",
        tenant: undefined,
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
    expect(first.id).toBe("1");
  });

  it("enforces capacity atomically for simultaneous creates", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: (() => {
        let id = 0;
        return () => String(++id);
      })(),
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    const input = {
      definition: { kind: "public-subscription" as const, bytes: new Uint8Array([1]) },
      principalFingerprint: "p",
      tenant: undefined,
      expiresAtMs: 100,
    };
    const results = await Promise.allSettled([bindings.create(input), bindings.create(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(bindings.size).toBe(1);
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
    for (let id = 0; id < 2; id++)
      await bindings.create({
        definition: { kind: "public-subscription", bytes: new Uint8Array([id]) },
        principalFingerprint: "p",
        tenant: undefined,
        expiresAtMs: 100,
      });
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

  it("compensates an expired delayed Subscribe and releases its reserved capacity", async () => {
    let now = 10n;
    let expiresAt = 11n;
    let releaseBackend: (() => void) | undefined;
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
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

  it("aborts a hung Subscribe at its operation timeout, settles its handle, and releases its lease", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
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

  it("releases leases when logical creation fails through coordinator compensation", async () => {
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
      reserveCapacity: fixture.bindings.reserveCapacity.bind(fixture.bindings),
      purgeExpired: fixture.bindings.purgeExpired.bind(fixture.bindings),
      close: fixture.bindings.close.bind(fixture.bindings),
    };
    const createFailureGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings: failingBindings,
      limits: { operationTimeoutMs: 1 },
    });
    await expect(createFailureGateway.handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
  });

  it("cancels the logical coordinator after durable binding persistence fails", async () => {
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
        reserveCapacity: fixture.bindings.reserveCapacity.bind(fixture.bindings),
        purgeExpired: fixture.bindings.purgeExpired.bind(fixture.bindings),
        close: fixture.bindings.close.bind(fixture.bindings),
      },
    });

    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toEqual({
      kind: "rejected",
      reason: "denied",
    });
    expect(cancellations).toBe(1);
  });

  it("bounds close-raced compensation, releases capacity, and retains no binding", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    let releaseCreate: (() => void) | undefined;
    const creating = new Promise<void>((resolve) => (releaseCreate = resolve));
    let createStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => (createStarted = resolve));
    const delayedBindings = {
      create: async (input: Parameters<typeof bindings.create>[0]) => {
        defined(createStarted, "expected create start")();
        await creating;
        void input;
        throw new Error("binding store is closed");
      },
      activate: bindings.activate.bind(bindings),
      cancel: bindings.cancel.bind(bindings),
      reserveCapacity: bindings.reserveCapacity.bind(bindings),
      purgeExpired: bindings.purgeExpired.bind(bindings),
      close: () => Promise.resolve(),
    };
    let releaseSubscribe: (() => void) | undefined;
    const receiving = new Promise<void>((resolve) => (releaseSubscribe = resolve));
    let subscribeSignal: AbortSignal | undefined;
    fixture.options.creator.subscribe = async (_request, signal) => {
      subscribeSignal = signal;
      await receiving;
    };
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings: delayedBindings,
      limits: { shutdownTimeoutMs: 1 },
    });
    const pending = subscriptionGateway.handle(request("Subscribe", topic));
    await tick();
    defined(releaseSubscribe, "expected subscribe release")();
    await started;
    await subscriptionGateway.close();
    expect(subscribeSignal?.aborted).toBe(true);
    defined(releaseCreate, "expected create release")();
    await expect(pending).resolves.toEqual({ kind: "rejected", reason: "denied" });
    expect(bindings.size).toBe(0);
    const reusable = await bindings.reserveCapacity();
    await reusable.release();
  });

  it("releases a capacity-one lease after timed-out compensation", async () => {
    const fixture = setup();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "one",
      limits: { bindingLimit: 1 },
      dispose: () => Promise.resolve(),
    });
    fixture.options.creator.subscribe = () => Promise.resolve();
    const subscriptionGateway = new SubscriptionGateway({
      ...fixture.options,
      bindings,
      limits: { operationTimeoutMs: 1, maxBackendEnvelopeBytes: 1 },
    });
    await expect(subscriptionGateway.handle(request("Subscribe", topic))).resolves.toMatchObject({
      kind: "subscribed",
    });
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
    expect(cleanupAborted).toBe(true);
    expect(bindings.size).toBe(0);
  });
});
