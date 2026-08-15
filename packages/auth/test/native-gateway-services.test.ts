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

import { create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import {
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "@spine-event-engine/proto/auth";
import {
  AckSchema,
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { TypeRegistry, AnyMessages } from "@spine-event-engine/core";
import {
  CommandService,
  EventUpdatesSchema,
  CompositeFilterSchema,
  FilterSchema,
  QueryService,
  SubscriptionSchema,
  SubscriptionService,
  type SubscriptionUpdate,
  SubscriptionUpdateSchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";
import {
  createNativeGatewayServices,
  SubscriptionUpdateRelay,
  UnaryGateway,
  type NativeGatewayRequestContext,
  type SubscriptionGateway,
  type SubscriptionGatewayRequest,
  type SubscriptionGatewayResult,
  type UnaryGatewayRequest,
  type UnaryGatewayResult,
} from "../src/index.js";

type UnaryFake = Pick<UnaryGateway, "handle">;
type SubscriptionFake = Pick<SubscriptionGateway, "handle">;

const credential = { kind: "bearer" as const, value: "session" };
const transport = {
  service: "ignored",
  method: "ignored",
  requestId: "request-1",
};

function context(signal = new AbortController().signal): HandlerContext {
  return { signal } as unknown as HandlerContext;
}

function updateWithNestedAny(): Uint8Array {
  return toBinary(
    SubscriptionUpdateSchema,
    create(SubscriptionUpdateSchema, {
      subscription: create(SubscriptionSchema, {
        topic: create(TopicSchema, {
          target: create(TargetSchema, {
            type: "example.Target",
            criterion: {
              case: "filters",
              value: create(TargetFiltersSchema, {
                filter: [
                  create(CompositeFilterSchema, {
                    filter: [
                      create(FilterSchema, {
                        value: AnyMessages.pack(
                          TenantIdSchema,
                          create(TenantIdSchema, {
                            kind: { case: "value", value: "nested-bytes" },
                          }),
                        ),
                      }),
                    ],
                  }),
                ],
              }),
            },
          }),
        }),
      }),
    }),
  );
}

function nestedAnyValue(update: SubscriptionUpdate): Uint8Array | undefined {
  const criterion = update.subscription?.topic?.target?.criterion;
  if (criterion?.case !== "filters") return undefined;
  return criterion.value.filter[0]?.filter[0]?.value?.value;
}

function requests(): NativeGatewayRequestContext {
  return {
    credential: () => credential,
    transport: () => transport,
  };
}

function services(unary: UnaryFake, subscriptions: SubscriptionFake) {
  return createNativeGatewayServices({
    unary: unary as UnaryGateway,
    subscriptions: subscriptions as SubscriptionGateway,
    requests: requests(),
  });
}

function unary(result: UnaryGatewayResult): {
  readonly fake: UnaryFake;
  readonly calls: UnaryGatewayRequest[];
} {
  const calls: UnaryGatewayRequest[] = [];
  return { fake: { handle: (request) => (calls.push(request), Promise.resolve(result)) }, calls };
}

function subscriptions(
  handler: (request: SubscriptionGatewayRequest) => Promise<SubscriptionGatewayResult>,
): { readonly fake: SubscriptionFake; readonly calls: SubscriptionGatewayRequest[] } {
  const calls: SubscriptionGatewayRequest[] = [];
  return { fake: { handle: (request) => (calls.push(request), handler(request)) }, calls };
}

async function errorCode(effect: Promise<unknown>): Promise<Code> {
  try {
    await effect;
    throw new Error("expected Connect rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  }
}

describe("createNativeGatewayServices", () => {
  it("delegates ResolveContext through the configured unary gateway", async () => {
    const response = create(ResolveContextResponseSchema);
    const gateway = services(
      unary({ kind: "resolved", value: toBinary(ResolveContextResponseSchema, response) }).fake,
      subscriptions(() => Promise.resolve({ kind: "cancelled" })).fake,
    );

    await expect(
      gateway.authentication.resolveContext(create(ResolveContextRequestSchema), context()),
    ).resolves.toEqual(response);
  });

  it("composes a configured UnaryGateway so native Post policy receives decoded application content", async () => {
    const registry = new TypeRegistry([TenantIdSchema]);
    let policyMessage: unknown;
    const forwarded: unknown[] = [];
    const unaryGateway = new UnaryGateway({
      registry,
      maxRequestBytes: 1_024,
      sessions: {
        resolve: () =>
          Promise.resolve({
            principal: { id: "ada" },
            expiresAt: create(TimestampSchema, { seconds: 10n }),
          }),
      },
      authorize: (_principal, incoming) => {
        policyMessage = incoming.kind === "command" ? incoming.message : undefined;
        return Promise.resolve(true);
      },
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "ada" }),
            timestamp: create(TimestampSchema, { seconds: 2n }),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "ada" }),
            timestamp: create(TimestampSchema, { seconds: 2n }),
          }),
      },
      clock: { now: () => create(TimestampSchema, { seconds: 2n }) },
      forward: (request) => {
        forwarded.push(request);
        return Promise.resolve(toBinary(AckSchema, create(AckSchema)));
      },
    });
    const gateway = createNativeGatewayServices({
      unary: unaryGateway,
      subscriptions: subscriptions(() => Promise.resolve({ kind: "cancelled" }))
        .fake as SubscriptionGateway,
      requests: requests(),
    });
    const command = create(CommandSchema, {
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, { actor: { value: "ada" } }),
      }),
      message: AnyMessages.pack(
        TenantIdSchema,
        create(TenantIdSchema, { kind: { case: "value", value: "application" } }),
      ),
    });

    await gateway.command.post(command, context());

    expect(policyMessage).toMatchObject({ $typeName: TenantIdSchema.typeName });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      service: "spine.client.CommandService",
      method: "Post",
    });
    expect(forwarded[0]).not.toHaveProperty("registry");
    expect(forwarded[0]).not.toHaveProperty("credential");
  });

  it("forwards Post and Read through UnaryGateway with application request facts", async () => {
    const post = unary({ kind: "forwarded", value: toBinary(AckSchema, create(AckSchema)) });
    const read = unary({
      kind: "forwarded",
      value: toBinary(QueryService.method.read.output, create(QueryService.method.read.output)),
    });
    const subscription = subscriptions(() => Promise.resolve({ kind: "cancelled" }));
    const gateway = services(
      {
        handle: async (request) =>
          request.method === "Post" ? post.fake.handle(request) : read.fake.handle(request),
      },
      subscription.fake,
    );

    await gateway.command.post(create(CommandService.method.post.input), context());
    await gateway.query.read(create(QueryService.method.read.input), context());

    expect(post.calls[0]).toMatchObject({
      service: "spine.client.CommandService",
      method: "Post",
      credential,
      transport,
    });
    expect(read.calls[0]).toMatchObject({
      service: "spine.client.QueryService",
      method: "Read",
      credential,
      transport,
    });
    expect(post.calls[0]?.signal).toBeDefined();
    expect(read.calls[0]?.signal).toBeDefined();
  });

  it.each([
    ["unauthenticated", Code.Unauthenticated],
    ["forbidden", Code.PermissionDenied],
    ["request-too-large", Code.ResourceExhausted],
    ["unknown-operation", Code.Unimplemented],
    ["malformed-request", Code.InvalidArgument],
    ["context-stale", Code.InvalidArgument],
  ] as const)("maps UnaryGateway %s rejection to Connect status", async (reason, code) => {
    const unaryGateway = unary({ kind: "rejected", reason });
    const subscription = subscriptions(() => Promise.resolve({ kind: "cancelled" }));
    const gateway = services(unaryGateway.fake, subscription.fake);

    expect(
      await errorCode(
        Promise.resolve(gateway.command.post(create(CommandService.method.post.input), context())),
      ),
    ).toBe(code);
    expect(
      await errorCode(
        Promise.resolve(gateway.query.read(create(QueryService.method.read.input), context())),
      ),
    ).toBe(code);
  });

  it("forwards Subscribe and Cancel through SubscriptionGateway", async () => {
    const subscribed = toBinary(
      SubscriptionSchema,
      create(SubscriptionSchema, { id: { value: "subscription-1" } }),
    );
    const fake = subscriptions((request) =>
      Promise.resolve(
        request.method === "Subscribe"
          ? { kind: "subscribed", wire: { kind: "public-subscription", bytes: subscribed } }
          : { kind: "cancelled" },
      ),
    );
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const subscription = create(SubscriptionSchema, { id: { value: "subscription-1" } });

    await expect(
      gateway.subscription.subscribe(create(TopicSchema), context()),
    ).resolves.toMatchObject({
      id: { value: "subscription-1" },
    });
    await expect(gateway.subscription.cancel(subscription, context())).resolves.toEqual(
      create(SubscriptionService.method.cancel.output),
    );
    expect(fake.calls.map((call) => call.method)).toEqual(["Subscribe", "Cancel"]);
    expect(
      fake.calls.every((call) => call.credential === credential && call.transport === transport),
    ).toBe(true);
  });

  it.each([
    ["unauthenticated", Code.Unauthenticated],
    ["forbidden", Code.PermissionDenied],
    ["denied", Code.PermissionDenied],
    ["request-too-large", Code.ResourceExhausted],
    ["binding-busy", Code.Aborted],
    ["unknown-operation", Code.Unimplemented],
    ["malformed-request", Code.InvalidArgument],
    ["backend-envelope-too-large", Code.InvalidArgument],
  ] as const)("maps SubscriptionGateway %s rejection to Connect status", async (reason, code) => {
    const fake = subscriptions(() => Promise.resolve({ kind: "rejected", reason }));
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);

    expect(
      await errorCode(
        Promise.resolve(gateway.subscription.subscribe(create(TopicSchema), context())),
      ),
    ).toBe(code);
    expect(
      await errorCode(
        Promise.resolve(gateway.subscription.cancel(create(SubscriptionSchema), context())),
      ),
    ).toBe(code);
  });

  it("activates only through SubscriptionGateway, forwards its signal and relays FIFO updates", async () => {
    const controller = new AbortController();
    const source = [
      toBinary(SubscriptionUpdateSchema, create(SubscriptionUpdateSchema)),
      toBinary(SubscriptionUpdateSchema, create(SubscriptionUpdateSchema)),
    ];
    const fake = subscriptions(async (request) => {
      expect(request.method).toBe("Activate");
      expect(request.signal).toBeDefined();
      const first = source[0];
      const second = source[1];
      if (first === undefined || second === undefined || request.updates === undefined)
        throw new Error("expected update sink and source updates");
      await request.updates({ kind: "subscription-update", bytes: first });
      await request.updates({ kind: "subscription-update", bytes: second });
      return { kind: "activated" };
    });
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const stream = gateway.subscription.activate(
      create(SubscriptionSchema),
      context(controller.signal),
    );
    const iterator = stream[Symbol.asyncIterator]();

    expect((await iterator.next()).done).toBe(false);
    expect((await iterator.next()).done).toBe(false);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(fake.calls).toHaveLength(1);
  });

  it("detaches a waiting consumer update before wiping its owned source bytes", async () => {
    const relay = new SubscriptionUpdateRelay();
    const iterator = relay[Symbol.asyncIterator]();
    const waiting = iterator.next();
    const source = updateWithNestedAny();

    await relay.push({ kind: "subscription-update", bytes: source });
    source.fill(0);

    const delivered = await waiting;
    expect(delivered.done).toBe(false);
    if (delivered.done) throw new Error("expected delivered update");
    expect(nestedAnyValue(delivered.value)).toEqual(
      toBinary(
        TenantIdSchema,
        create(TenantIdSchema, { kind: { case: "value", value: "nested-bytes" } }),
      ),
    );
  });

  it("detaches a queued update before wiping its owned source bytes", async () => {
    const relay = new SubscriptionUpdateRelay();
    const source = updateWithNestedAny();

    await relay.push({ kind: "subscription-update", bytes: source });
    source.fill(0);

    const delivered = await relay[Symbol.asyncIterator]().next();
    expect(delivered.done).toBe(false);
    if (delivered.done) throw new Error("expected delivered update");
    expect(nestedAnyValue(delivered.value)).toEqual(
      toBinary(
        TenantIdSchema,
        create(TenantIdSchema, { kind: { case: "value", value: "nested-bytes" } }),
      ),
    );
  });

  it.each([
    [
      "context abort before an update",
      async (iterator: AsyncIterator<unknown>, controller: AbortController) => {
        controller.abort();
        await expect(iterator.next()).rejects.toMatchObject({ code: Code.Canceled });
      },
    ],
    [
      "iterator return",
      async (iterator: AsyncIterator<unknown>) => {
        await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined });
      },
    ],
    [
      "iterator throw",
      async (iterator: AsyncIterator<unknown>) => {
        const failure = new Error("consumer failed");
        await expect(iterator.throw?.(failure)).rejects.toBe(failure);
      },
    ],
  ])("converges %s through one terminal relay path", async (_name, terminate) => {
    let release: (() => void) | undefined;
    const running = new Promise<void>((resolve) => (release = resolve));
    const fake = subscriptions(async (request) => {
      await request.updates?.({
        kind: "subscription-update",
        bytes: toBinary(SubscriptionUpdateSchema, create(SubscriptionUpdateSchema)),
      });
      await running;
      return { kind: "activated" };
    });
    const controller = new AbortController();
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const iterator = gateway.subscription
      .activate(create(SubscriptionSchema), context(controller.signal))
      [Symbol.asyncIterator]();

    const pending = iterator.next();
    await expect(pending).resolves.toMatchObject({ done: false });
    await terminate(iterator, controller);
    release?.();
    expect(fake.calls).toHaveLength(_name === "context abort before an update" ? 2 : 1);
  });

  it("rejects an already-aborted external signal before SubscriptionGateway activation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = subscriptions(() =>
      Promise.reject(new Error("pre-aborted activation must not reach B3")),
    );
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const iterator = gateway.subscription
      .activate(create(SubscriptionSchema), context(controller.signal))
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({ code: Code.Canceled });
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["return", "throw"] as const)(
    "aborts a quiet native activation when the public iterator uses %s",
    async (terminal) => {
      let signal: AbortSignal | undefined;
      let settle: (() => void) | undefined;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      const fake = subscriptions(async (request) => {
        signal = request.signal;
        await new Promise<void>((finish) =>
          signal?.addEventListener(
            "abort",
            () => {
              finish();
            },
            { once: true },
          ),
        );
        settle?.();
        return { kind: "activated" };
      });
      const gateway = services(
        unary({ kind: "forwarded", value: new Uint8Array() }).fake,
        fake.fake,
      );
      const iterator = gateway.subscription
        .activate(create(SubscriptionSchema), context())
        [Symbol.asyncIterator]();
      const pending = iterator.next();
      await new Promise((finish) => setTimeout(finish, 0));

      if (terminal === "return") {
        const returned = iterator.return?.();
        expect(signal?.aborted).toBe(true);
        await expect(returned).resolves.toEqual({ done: true, value: undefined });
      } else {
        const thrown = iterator.throw?.(new Error("consumer stopped"));
        expect(signal?.aborted).toBe(true);
        await expect(thrown).rejects.toThrow("consumer stopped");
      }
      await pending.catch(() => undefined);

      await settled;
      expect(signal?.aborted).toBe(true);
    },
  );

  it("cancels the retained binding when an active transport stream aborts", async () => {
    let activeSignal: AbortSignal | undefined;
    const fake = subscriptions(async (request) => {
      if (request.method === "Cancel") return { kind: "cancelled" };
      activeSignal = request.signal;
      await new Promise<void>((resolve) =>
        activeSignal?.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        ),
      );
      return { kind: "activated" };
    });
    const controller = new AbortController();
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const iterator = gateway.subscription
      .activate(create(SubscriptionSchema), context(controller.signal))
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls.map((request) => request.method)).toEqual(["Activate", "Cancel"]);
  });

  it("absorbs retained-binding cancellation failure after a transport abort", async () => {
    let activeSignal: AbortSignal | undefined;
    const fake = subscriptions(async (request) => {
      if (request.method === "Cancel") throw new Error("cancel transport unavailable");
      activeSignal = request.signal;
      await new Promise<void>((resolve) =>
        activeSignal?.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        ),
      );
      return { kind: "activated" };
    });
    const controller = new AbortController();
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const iterator = gateway.subscription
      .activate(create(SubscriptionSchema), context(controller.signal))
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls.map((request) => request.method)).toEqual(["Activate", "Cancel"]);
  });

  it("maps Activate gateway rejection and backend failure through the stream terminal", async () => {
    const rejected = subscriptions(() =>
      Promise.resolve({ kind: "rejected", reason: "binding-busy" }),
    );
    const rejectedGateway = services(
      unary({ kind: "forwarded", value: new Uint8Array() }).fake,
      rejected.fake,
    );
    await expect(
      rejectedGateway.subscription
        .activate(create(SubscriptionSchema), context())
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: Code.Aborted });

    const failure = new Error("native backend failed");
    const failed = subscriptions(() => Promise.reject(failure));
    const failedGateway = services(
      unary({ kind: "forwarded", value: new Uint8Array() }).fake,
      failed.fake,
    );
    await expect(
      failedGateway.subscription
        .activate(create(SubscriptionSchema), context())
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toBe(failure);
  });

  it("maps an unexpected Activate acknowledgement to an internal stream failure", async () => {
    const fake = subscriptions(() => Promise.resolve({ kind: "cancelled" }));
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);

    await expect(
      gateway.subscription
        .activate(create(SubscriptionSchema), context())
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it("lets iterator termination purge updates after native completion begins graceful drain", async () => {
    const fake = subscriptions(async (request) => {
      await request.updates?.({
        kind: "subscription-update",
        bytes: toBinary(
          SubscriptionUpdateSchema,
          create(SubscriptionUpdateSchema, {
            update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
          }),
        ),
      });
      await request.updates?.({
        kind: "subscription-update",
        bytes: toBinary(
          SubscriptionUpdateSchema,
          create(SubscriptionUpdateSchema, {
            update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
          }),
        ),
      });
      return { kind: "activated" };
    });
    const gateway = services(unary({ kind: "forwarded", value: new Uint8Array() }).fake, fake.fake);
    const iterator = gateway.subscription
      .activate(create(SubscriptionSchema), context())
      [Symbol.asyncIterator]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await iterator.return?.();
    await expect(iterator.next()).rejects.toMatchObject({ code: Code.Canceled });
  });

  it.each([
    ["message", { maxMessages: 1, maxBytes: 100 }, 3, Code.ResourceExhausted],
    ["byte", { maxMessages: 3, maxBytes: 1 }, 2, Code.ResourceExhausted],
  ] as const)(
    "terminates Activate relay on %s overflow without another gateway call",
    async (dimension, relay, count, code) => {
      const fake = subscriptions(async (request) => {
        const update = toBinary(
          SubscriptionUpdateSchema,
          create(SubscriptionUpdateSchema, {
            update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
          }),
        );
        for (let index = 0; index < count; index++)
          await request.updates?.({
            kind: "subscription-update",
            bytes: update,
          });
        return { kind: "activated" };
      });
      const gateway = createNativeGatewayServices({
        unary: unary({ kind: "forwarded", value: new Uint8Array() }).fake as UnaryGateway,
        subscriptions: fake.fake as SubscriptionGateway,
        requests: requests(),
        relay,
      });
      const iterator = gateway.subscription
        .activate(create(SubscriptionSchema), context())
        [Symbol.asyncIterator]();

      if (dimension === "message") {
        await new Promise((finish) => setTimeout(finish, 0));
        await expect(iterator.next()).rejects.toMatchObject({ code });
      } else await expect(iterator.next()).rejects.toMatchObject({ code });
      expect(fake.calls).toHaveLength(1);
    },
  );
});
