/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */

import { create, type Message, type MessageShape } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { Transport } from "@connectrpc/connect";
import {
  ActorContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventSchema,
  ErrorSchema,
  ResponseSchema,
  StatusSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
  VersionSchema,
  type Command,
} from "@spine-ts/proto";
import { QuerySchema, TopicSchema } from "@spine-ts/proto/client";
import { AckSchema } from "@spine-ts/proto";
import {
  EventUpdatesSchema,
  QueryResponseSchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
} from "@spine-ts/proto/client";
import { describe, expect, it, vi } from "vitest";
import { packAny } from "@spine-ts/core";

import { Client, ProjectionQuery } from "../src/index.js";
import { ProjectionStateSchema } from "../test-fixtures/projection-column-fixtures.js";

describe("Client", () => {
  it("resolves the default zone once and retains the first resolution", async () => {
    let resolutions = 0;
    const dateTimeFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({
            timeZone: resolutions++ === 0 ? "Europe/Lisbon" : "America/New_York",
          }),
        }) as Intl.DateTimeFormat,
    );
    const contexts: Message[] = [];
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        contexts.push((input as Command).context?.actorContext ?? create(ActorContextSchema));
        return create(AckSchema, {
          messageId: commandId(input as Command),
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        });
      }),
    );
    try {
      await client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema));
      await client.onBehalfOf("alice").post(ProjectionStateSchema, create(ProjectionStateSchema));
      expect(resolutions).toBe(1);
      expect(contexts).toEqual([
        expect.objectContaining({ zoneId: expect.objectContaining({ value: "Europe/Lisbon" }) }),
        expect.objectContaining({ zoneId: expect.objectContaining({ value: "Europe/Lisbon" }) }),
      ]);
    } finally {
      dateTimeFormat.mockRestore();
      await client.close();
    }
  });

  it("freezes cloned tenant and zone values across concurrent command and query scopes", async () => {
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const zone = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    const contexts: unknown[] = [];
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        if (method.name === "Post") {
          contexts.push((input as Command).context?.actorContext);
          return create(AckSchema, {
            messageId: commandId(input as Command),
            status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
          });
        }
        if (method.name === "Read") {
          contexts.push((input as MessageShape<typeof QuerySchema>).context);
          return create(QueryResponseSchema, {
            response: create(ResponseSchema, {
              status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
            }),
          });
        }
        throw new Error(`unexpected ${method.name}`);
      }),
      { tenant, zoneId: zone },
    );
    tenant.kind = { case: "value", value: "mutated-tenant" };
    zone.value = "mutated-zone";
    const query = ProjectionQuery.select({
      schema: ProjectionStateSchema,
      columns: {} as never,
      context: create(ActorContextSchema),
    }).build();

    await Promise.all([
      client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema)),
      client.onBehalfOf("alice").query(ProjectionStateSchema, query),
    ]);

    expect(contexts).toEqual([
      expect.objectContaining({
        actor: expect.objectContaining({ value: "guest" }),
        tenantId: expect.objectContaining({ kind: { case: "value", value: "tenant-a" } }),
        zoneId: expect.objectContaining({ value: "Europe/Lisbon" }),
      }),
      expect.objectContaining({
        actor: expect.objectContaining({ value: "alice" }),
        tenantId: expect.objectContaining({ kind: { case: "value", value: "tenant-a" } }),
        zoneId: expect.objectContaining({ value: "Europe/Lisbon" }),
      }),
    ]);
    await client.close();
  });

  it("uses the exact operation context for preliminary command-event subscription and post", async () => {
    let subscribed: unknown;
    let posted: unknown;
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe") {
          subscribed = (input as MessageShape<typeof TopicSchema>).context;
          return response(
            method,
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-context" }),
            }),
          );
        }
        if (method.name === "Post") {
          posted = (input as Command).context?.actorContext;
          return response(
            method,
            create(AckSchema, {
              messageId: commandId(input as Command),
              status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
            }),
          );
        }
        if (method.name === "Cancel") return response(method, create(ResponseSchema));
        throw new Error(`unexpected ${method.name}`);
      },
      async stream(method, signal) {
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: endingStream(
            new Promise<void>((resolve) =>
              signal?.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              ),
            ),
          ),
        } as never;
      },
    });

    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });

    expect(result.kind).toBe("ok");
    expect(subscribed).toStrictEqual(posted);
    if (result.kind === "ok") await result.events.cancel();
    await client.close();
  });

  it("rejects empty tenant or zone options before opening a client", () => {
    const transport = unaryTransport(() => create(AckSchema));
    expect(() => Client.usingTransport(transport, { tenant: "" })).toThrow(
      "tenant must not be empty",
    );
    expect(() => Client.usingTransport(transport, { zoneId: "" })).toThrow(
      "zoneId must not be empty",
    );
    expect(() =>
      Client.usingTransport(transport, { tenant: create(TenantIdSchema), zoneId: "Europe/Lisbon" }),
    ).toThrow("tenant must not be empty");
    expect(() => Client.usingTransport(transport, { zoneId: create(ZoneIdSchema) })).toThrow(
      "zoneId must not be empty",
    );
    expect(() => Client.connectTo("http://127.0.0.1:8080", { tenant: "" })).toThrow(
      "tenant must not be empty",
    );
    expect(() => Client.connectTo("http://127.0.0.1:8080", { zoneId: "" })).toThrow(
      "zoneId must not be empty",
    );
  });

  it("resolves a nonempty system zone once for the client lifecycle", async () => {
    const contexts: unknown[] = [];
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        if (method.name !== "Post") throw new Error(`unexpected ${method.name}`);
        contexts.push((input as Command).context?.actorContext);
        return create(AckSchema, {
          messageId: commandId(input as Command),
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        });
      }),
    );

    await client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema));
    await client.onBehalfOf("alice").post(ProjectionStateSchema, create(ProjectionStateSchema));

    const zones = contexts.map(
      (context) => (context as MessageShape<typeof ActorContextSchema>).zoneId?.value,
    );
    expect(zones[0]).toEqual(expect.any(String));
    expect(zones[0]).not.toBe("");
    expect(zones[1]).toBe(zones[0]);
    await client.close();
  });

  it("uses one cloned client-wide zone in command contexts", async () => {
    const zone = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    const contexts: unknown[] = [];
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        if (method.name === "Post") {
          contexts.push((input as Command).context?.actorContext);
          return create(AckSchema, {
            messageId: commandId(input as Command),
            status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
          });
        }
        throw new Error(`unexpected ${method.name}`);
      }),
      { zoneId: zone },
    );
    zone.value = "mutated-after-construction";

    await Promise.all([
      client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema)),
      client.onBehalfOf("actor-1").post(ProjectionStateSchema, create(ProjectionStateSchema)),
    ]);

    expect(contexts).toEqual([
      expect.objectContaining({ zoneId: expect.objectContaining({ value: "Europe/Lisbon" }) }),
      expect.objectContaining({ zoneId: expect.objectContaining({ value: "Europe/Lisbon" }) }),
    ]);
    await client.close();
  });

  it.each([
    ["missing", undefined],
    ["malformed", { typeUrl: "type.googleapis.com/example.WrongId", value: new Uint8Array() }],
    ["mismatched", packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "wrong" }))],
  ])("rejects a %s acknowledgement command ID", async (_case, messageId) => {
    const client = Client.usingTransport(
      unaryTransport(() =>
        create(AckSchema, {
          messageId,
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        }),
      ),
    );

    await expect(
      client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema)),
    ).rejects.toThrow("Client protocol error");
  });

  it("posts a packed command with a fresh guest actor context and returns an ok outcome", async () => {
    let command: unknown;
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        command = input;
        expect(method.name).toBe("Post");
        return create(AckSchema, {
          messageId: commandId(input as Command),
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        });
      }),
    );

    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema, { id: "task-1", title: "First" }));

    expect(result.kind).toBe("ok");
    expect(command).toMatchObject({
      context: { actorContext: { actor: { value: "guest" }, timestamp: expect.any(Object) } },
      message: { typeUrl: expect.stringContaining(ProjectionStateSchema.typeName) },
    });
    await client.close();
  });

  it("replaces query actor context with the immutable request scope and decodes versioned states", async () => {
    let received: unknown;
    const client = Client.usingTransport(
      unaryTransport((method, input) => {
        received = input;
        expect(method.name).toBe("Read");
        return create(QueryResponseSchema, {
          response: create(ResponseSchema, {
            status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
          }),
          message: [
            {
              state: { typeUrl: "type.googleapis.com/example.WrongState", value: new Uint8Array() },
              version: create(VersionSchema, { number: 3 }),
            },
          ],
        });
      }),
    );
    const query = ProjectionQuery.select({
      schema: ProjectionStateSchema,
      columns: {} as never,
      context: create(ActorContextSchema, { actor: create(UserIdSchema, { value: "wrong" }) }),
    }).build();

    await expect(client.onBehalfOf("user-1").query(ProjectionStateSchema, query)).rejects.toThrow(
      "Client protocol error",
    );
    expect(received).toMatchObject({ context: { actor: { value: "user-1" } } });
    await client.close();
  });

  it("returns a cancellable handle for an observed successful post", async () => {
    const client = Client.usingTransport(streamingTransport());

    const result = await client
      .asGuest()
      .post(
        ProjectionStateSchema,
        create(ProjectionStateSchema, { id: "task-1", title: "First" }),
        { observe: [ProjectionStateSchema] },
      );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");
    expect(result.events).toBeDefined();
    await result.events.cancel();
    await client.close();
  });

  it("removes events from observed error outcomes and completes remote cleanup", async () => {
    const observed = observationTransport("error");
    const client = Client.usingTransport(observed.transport);

    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });

    expect(result.kind).toBe("error");
    expect("events" in result).toBe(false);
    if (result.kind !== "error") throw new Error("expected an error outcome");
    expect(Object.isFrozen(result.error)).toBe(true);
    expect(observed.cancelled()).toBe(1);
    await client.close();
  });

  it("removes events from observed rejection outcomes", async () => {
    const observed = observationTransport("rejection");
    const client = Client.usingTransport(observed.transport);

    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });

    expect(result.kind).toBe("rejection");
    expect("events" in result).toBe(false);
    expect(observed.cancelled()).toBe(1);
    await client.close();
  });

  it("reuses one actor context for observation and command posting", async () => {
    const base = streamingTransport();
    let topicContext: unknown;
    let commandContext: unknown;
    const transport: Transport = {
      ...base,
      async unary(method, signal, timeoutMs, header, input, contextValues) {
        if (method.name === "Subscribe") topicContext = Reflect.get(input, "context");
        if (method.name === "Post") {
          const context = Reflect.get(input, "context") as { readonly actorContext?: unknown };
          commandContext = context.actorContext;
        }
        return base.unary(method, signal, timeoutMs, header, input, contextValues);
      },
    };
    const client = Client.usingTransport(transport);

    const result = await client
      .onBehalfOf("actor-1")
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });

    expect(topicContext).toEqual(commandContext);
    if (result.kind === "ok") await result.events.cancel();
    await client.close();
  });

  it("allows one event iterator consumer and shares cancellation", async () => {
    const observed = observationTransport("ok");
    const client = Client.usingTransport(observed.transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    result.events[Symbol.asyncIterator]();
    expect(() => result.events[Symbol.asyncIterator]()).toThrow("only one iterator consumer");
    const first = result.events.cancel();
    expect(result.events.cancel()).toBe(first);
    await first;
    expect(observed.cancelled()).toBe(1);
    await client.close();
  });

  it("keeps caller abort attached after an observed post succeeds", async () => {
    const observed = observationTransport("ok");
    const controller = new AbortController();
    const client = Client.usingTransport(observed.transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
        signal: controller.signal,
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    controller.abort(new Error("caller stopped observing"));
    await vi.waitFor(() => {
      expect(observed.cancelled()).toBe(1);
    });
    await result.events.cancel();
    await client.close();
  });

  it("reports failed automatic cancellation on later close without retaining the stream", async () => {
    const failure = new Error("automatic cancel failed");
    let cancellations = 0;
    const rejected = cleanupTransport(() => {
      cancellations += 1;
      return Promise.reject(failure);
    });
    const controller = new AbortController();
    const client = Client.usingTransport(rejected.transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
        signal: controller.signal,
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    controller.abort(new Error("caller stopped observing"));
    await vi.waitFor(() => {
      expect(cancellations).toBe(1);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await expect(client.close()).rejects.toBe(failure);
    expect(cancellations).toBe(1);
  });

  it("does not duplicate an automatic cancellation failure while close awaits another operation", async () => {
    const failure = new Error("captured cancel failed");
    let rejectCancel!: (error: unknown) => void;
    const remoteCancel = new Promise<void>((_resolve, reject) => {
      rejectCancel = reject;
    });
    let releaseOperation!: () => void;
    const delayedOperation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let operationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    let postCount = 0;
    const observed = observationTransport("ok");
    const transport: Transport = {
      ...observed.transport,
      async unary(method, signal, timeoutMs, header, input, contextValues) {
        if (method.name === "Cancel") {
          await remoteCancel;
          return response(method, create(ResponseSchema));
        }
        if (method.name === "Post") {
          postCount += 1;
          if (postCount === 2) {
            operationStarted();
            await delayedOperation;
          }
        }
        return observed.transport.unary(method, signal, timeoutMs, header, input, contextValues);
      },
    };
    const controller = new AbortController();
    const client = Client.usingTransport(transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
        signal: controller.signal,
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    const pendingOperation = client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema));
    await started;
    controller.abort(new Error("caller stopped observing"));
    const closing = client.close();
    rejectCancel(failure);
    await Promise.resolve();
    releaseOperation();

    await expect(closing).rejects.toBe(failure);
    await pendingOperation;
  });

  it("reports rejected remote cancellation from explicit cancel and close", async () => {
    const failure = new Error("remote cancel failed");
    const rejected = cleanupTransport(() => Promise.reject(failure));
    const firstClient = Client.usingTransport(rejected.transport);
    const first = await firstClient
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (first.kind !== "ok") throw new Error("expected an acknowledgement");

    await expect(first.events.cancel()).rejects.toBe(failure);
    await expect(firstClient.close()).resolves.toBeUndefined();

    const closing = cleanupTransport(() => Promise.reject(failure));
    const secondClient = Client.usingTransport(closing.transport);
    await secondClient.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
      observe: [ProjectionStateSchema],
    });
    await expect(secondClient.close()).rejects.toBe(failure);
  });

  it("bounds a stalled remote cancellation for explicit cancel and close", async () => {
    vi.useFakeTimers();
    try {
      const stalled = cleanupTransport(() => new Promise(() => undefined));
      const client = Client.usingTransport(stalled.transport);
      const result = await client
        .asGuest()
        .post(ProjectionStateSchema, create(ProjectionStateSchema), {
          observe: [ProjectionStateSchema],
        });
      if (result.kind !== "ok") throw new Error("expected an acknowledgement");

      const cancelling = result.events.cancel();
      const timedOut = expect(cancelling).rejects.toThrow("cancellation timed out");
      await vi.advanceTimersByTimeAsync(1_000);
      await timedOut;
      await expect(client.close()).resolves.toBeUndefined();

      const closingStall = cleanupTransport(() => new Promise(() => undefined));
      const closingClient = Client.usingTransport(closingStall.transport);
      await closingClient.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
      const closing = expect(closingClient.close()).rejects.toThrow("cancellation timed out");
      await vi.advanceTimersByTimeAsync(1_000);
      await closing;
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends pending and future reads when activation ends normally", async () => {
    const observed = terminalObservationTransport();
    const client = Client.usingTransport(observed.transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");
    const iterator = result.events[Symbol.asyncIterator]();
    const pending = iterator.next();

    observed.end();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await client.close();
  });

  it("preserves activation errors for pending and future reads", async () => {
    const observed = terminalObservationTransport();
    const client = Client.usingTransport(observed.transport);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");
    const iterator = result.events[Symbol.asyncIterator]();
    const pending = iterator.next();
    const failure = new Error("activation failed");

    observed.fail(failure);
    await expect(pending).rejects.toBe(failure);
    await expect(iterator.next()).rejects.toBe(failure);
    await client.close();
  });

  it("filters unrelated updates and decodes matching command events", async () => {
    const observed = bufferedObservationTransport(1, true);
    const client = Client.usingTransport(observed);
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    const iterator = result.events[Symbol.asyncIterator]();
    const next = await iterator.next();
    if (next.done) throw new Error("expected a matching event");
    expect(next.value.message).toMatchObject({ id: "event-1" });
    await result.events.cancel();
    await client.close();
  });

  it("fails explicitly and cleans up when matching events overflow the buffer", async () => {
    const client = Client.usingTransport(bufferedObservationTransport(33, false));
    const result = await client
      .asGuest()
      .post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
      });
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");
    await Promise.resolve();
    const iterator = result.events[Symbol.asyncIterator]();

    for (let index = 0; index < 32; index += 1) {
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
    }
    await expect(iterator.next()).rejects.toThrow("buffer overflowed");
    await client.close();
  });

  it("never closes a caller-supplied transport", async () => {
    let closed = 0;
    const transport = Object.assign(
      unaryTransport((_method, input) =>
        create(AckSchema, {
          messageId: commandId(input as Command),
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        }),
      ),
      {
        close: () => {
          closed += 1;
        },
      },
    );
    const client = Client.usingTransport(transport);

    await client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema));
    await Promise.all([client.close(), client.close()]);

    expect(closed).toBe(0);
  });

  it("closes without waiting for a supplied activation stream that ignores abort", async () => {
    const observed = observationTransport("ok");
    const transport: Transport = {
      ...observed.transport,
      async stream(method) {
        const messages = endingStream(new Promise<void>(() => undefined));
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: messages,
        } as never;
      },
    };
    const client = Client.usingTransport(transport);
    await client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
      observe: [ProjectionStateSchema],
    });

    await expect(client.close()).resolves.toBeUndefined();
    expect(observed.cancelled()).toBe(1);
  });

  it("cancels a subscription that resolves after caller abort without activating it", async () => {
    vi.useFakeTimers();
    let resolveSubscribe!: (message: Message) => void;
    let activated = 0;
    let cancelled = 0;
    const subscription = new Promise<Message>((resolve) => {
      resolveSubscribe = resolve;
    });
    const transport: Transport = {
      async unary(method) {
        if (method.name === "Subscribe") return response(method, await subscription);
        if (method.name === "Cancel") {
          cancelled += 1;
          await new Promise(() => undefined);
        }
        throw new Error("post must not start after abort");
      },
      async stream() {
        activated += 1;
        throw new Error("activation must not start");
      },
    };
    try {
      const controller = new AbortController();
      const client = Client.usingTransport(transport);
      const posting = client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
        observe: [ProjectionStateSchema],
        signal: controller.signal,
      });
      const originalFailure = expect(posting).rejects.toThrow("caller aborted");

      controller.abort(new Error("caller aborted"));
      resolveSubscribe(
        create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-late" }),
        }),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await originalFailure;
      expect(activated).toBe(0);
      expect(cancelled).toBe(1);
      await expect(client.close()).rejects.toThrow("cancellation timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves caller abort when multi-schema startup cleanup fails", async () => {
    const abortFailure = new Error("caller aborted multi-schema startup");
    const cleanupFailure = new Error("first subscription cancel failed");
    let resolveSecondSubscribe!: () => void;
    const secondSubscribe = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    let subscriptions = 0;
    let cancellations = 0;
    let activations = 0;
    const transport: Transport = {
      async unary(method) {
        if (method.name === "Subscribe") {
          subscriptions += 1;
          if (subscriptions === 2) {
            markSecondStarted();
            await secondSubscribe;
          }
          return response(
            method,
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: `s-${String(subscriptions)}` }),
            }),
          );
        }
        if (method.name === "Cancel") {
          cancellations += 1;
          if (cancellations === 1) throw cleanupFailure;
          return response(method, create(ResponseSchema));
        }
        throw new Error("post must not start after abort");
      },
      async stream(method) {
        activations += 1;
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: endingStream(new Promise<void>(() => undefined)),
        } as never;
      },
    };
    const controller = new AbortController();
    const client = Client.usingTransport(transport);
    const posting = client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
      observe: [ProjectionStateSchema, ProjectionStateSchema],
      signal: controller.signal,
    });
    await secondStarted;

    controller.abort(abortFailure);
    await vi.waitFor(() => {
      expect(cancellations).toBe(1);
    });
    resolveSecondSubscribe();

    await expect(posting).rejects.toBe(abortFailure);
    expect(activations).toBe(1);
    expect(cancellations).toBe(2);
    await expect(client.close()).rejects.toBe(cleanupFailure);
    expect(cancellations).toBe(2);
  });

  it("releases successful late-subscription cleanup before a later close", async () => {
    let resolveSubscribe!: (message: Message) => void;
    let activated = 0;
    let cancelled = 0;
    const subscription = new Promise<Message>((resolve) => {
      resolveSubscribe = resolve;
    });
    const transport: Transport = {
      async unary(method) {
        if (method.name === "Subscribe") return response(method, await subscription);
        if (method.name === "Cancel") {
          cancelled += 1;
          return response(method, create(ResponseSchema));
        }
        throw new Error("post must not start after abort");
      },
      async stream() {
        activated += 1;
        throw new Error("activation must not start");
      },
    };
    const controller = new AbortController();
    const client = Client.usingTransport(transport);
    const posting = client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema), {
      observe: [ProjectionStateSchema],
      signal: controller.signal,
    });

    controller.abort(new Error("caller aborted"));
    resolveSubscribe(
      create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-late-success" }),
      }),
    );

    await expect(posting).rejects.toThrow("caller aborted");
    expect(activated).toBe(0);
    expect(cancelled).toBe(1);
    await expect(client.close()).resolves.toBeUndefined();
    expect(cancelled).toBe(1);
  });

  it("deeply freezes decoded query state and version", async () => {
    const client = Client.usingTransport(
      unaryTransport(() =>
        create(QueryResponseSchema, {
          response: create(ResponseSchema, {
            status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
          }),
          message: [
            {
              state: packAny(
                ProjectionStateSchema,
                create(ProjectionStateSchema, {
                  id: "task-1",
                  fingerprint: new Uint8Array([1, 2]),
                }),
              ),
              version: create(VersionSchema, { number: 1 }),
            },
          ],
        }),
      ),
    );
    const query = ProjectionQuery.select({
      schema: ProjectionStateSchema,
      columns: {} as never,
      context: create(ActorContextSchema),
    });

    const result = await client.asGuest().query(ProjectionStateSchema, query);
    if (result.kind !== "ok") throw new Error("expected query success");
    expect(Object.isFrozen(result.states[0]?.state)).toBe(true);
    expect(Object.isFrozen(result.states[0]?.version)).toBe(true);
    const first = result.states[0];
    if (first === undefined) throw new Error("expected one query state");
    expect(() => Object.assign(first.state, { id: "changed" })).toThrow();
    const fingerprint = first.state.fingerprint as unknown as Uint8Array;
    expect(() => {
      fingerprint[0] = 9;
    }).toThrow();
    expect(() => {
      fingerprint.set([9]);
    }).toThrow();
    fingerprint.forEach((_value, index, bytes) => {
      bytes[index] = 9;
    });
    expect([...fingerprint]).toEqual([1, 2]);
    await client.close();
  });

  it("close aborts an in-flight post and rejects work started after closing", async () => {
    let aborted = false;
    const client = Client.usingTransport({
      async unary(method, signal) {
        if (method.name === "Post") {
          if (signal === undefined) throw new Error("expected operation signal");
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("client closed"));
              },
              { once: true },
            );
          });
        }
        return response(method, create(AckSchema));
      },
      async stream() {
        throw new Error("not used");
      },
    });
    const pending = client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema));

    await client.close();
    await expect(pending).rejects.toBeDefined();
    expect(aborted).toBe(true);
    await expect(
      client.asGuest().post(ProjectionStateSchema, create(ProjectionStateSchema)),
    ).rejects.toThrow("client is closing");
  });

  it("propagates an already-aborted caller signal before starting a post", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const client = Client.usingTransport(unaryTransport((_method, _input) => create(AckSchema)));

    await expect(
      client
        .asGuest()
        .post(ProjectionStateSchema, create(ProjectionStateSchema), { signal: controller.signal }),
    ).rejects.toThrow("caller cancelled");
    await client.close();
  });
});

function unaryTransport(
  onUnary: (method: { readonly name: string }, input: unknown) => Message,
): Transport {
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      return {
        stream: false,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: onUnary(method, input),
      } as never;
    },
    async stream() {
      throw new Error("This test transport does not support streaming.");
    },
  };
}

function streamingTransport(): Transport {
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        return response(
          method,
          create(SubscriptionSchema, { id: create(SubscriptionIdSchema, { value: "s-1" }) }),
        );
      }
      if (method.name === "Post") {
        return response(
          method,
          create(AckSchema, {
            messageId: commandId(input as Command),
            status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
          }),
        );
      }
      return response(
        method,
        create(ResponseSchema, {
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        }),
      );
    },
    async stream(method) {
      const updates = (async function* () {
        yield create(SubscriptionUpdateSchema, {
          update: {
            case: "eventUpdates",
            value: create(EventUpdatesSchema, {
              event: [
                create(EventSchema, {
                  message: {
                    typeUrl: `type.googleapis.com/${ProjectionStateSchema.typeName}`,
                    value: new Uint8Array(),
                  },
                  context: create(EventContextSchema, {
                    originId: {
                      case: "commandId",
                      value: create(CommandIdSchema, { uuid: "other" }),
                    },
                  }),
                }),
              ],
            }),
          },
        });
      })();
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: updates,
      } as never;
    },
  };
}

function response(method: { readonly parent: unknown }, message: Message) {
  return {
    stream: false,
    method,
    header: new Headers(),
    trailer: new Headers(),
    service: method.parent,
    message,
  } as never;
}

function observationTransport(status: "ok" | "error" | "rejection") {
  let cancelCount = 0;
  const transport: Transport = {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        return response(
          method,
          create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-observed" }),
          }),
        );
      }
      if (method.name === "Cancel") {
        cancelCount += 1;
        return response(method, create(ResponseSchema));
      }
      const outcomeStatus =
        status === "ok"
          ? { case: "ok" as const, value: create(EmptySchema) }
          : status === "error"
            ? { case: "error" as const, value: create(ErrorSchema) }
            : { case: "rejection" as const, value: create(EventSchema) };
      return response(
        method,
        create(AckSchema, {
          messageId: commandId(input as Command),
          status: create(StatusSchema, { status: outcomeStatus }),
        }),
      );
    },
    async stream(method, signal) {
      const ended = new Promise<void>((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      const messages = endingStream(ended);
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: messages,
      } as never;
    },
  };
  return { transport, cancelled: () => cancelCount };
}

function cleanupTransport(onCancel: () => Promise<unknown>) {
  const observed = observationTransport("ok");
  const transport: Transport = {
    ...observed.transport,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === "Cancel") {
        await onCancel();
        return response(method, create(ResponseSchema));
      }
      return observed.transport.unary(method, signal, timeoutMs, header, input, contextValues);
    },
  };
  return { transport };
}

function terminalObservationTransport() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const terminal = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const observed = observationTransport("ok");
  const transport: Transport = {
    ...observed.transport,
    async stream(method) {
      const messages = endingStream(terminal);
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: messages,
      } as never;
    },
  };
  return { transport, end: resolve, fail: reject };
}

function bufferedObservationTransport(count: number, includeUnrelated: boolean): Transport {
  let postedId = "";
  let release!: () => void;
  const posted = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        return response(
          method,
          create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-buffered" }),
          }),
        );
      }
      if (method.name === "Cancel") return response(method, create(ResponseSchema));
      const command = input as Command;
      postedId = command.id?.uuid ?? "";
      release();
      return response(
        method,
        create(AckSchema, {
          messageId: commandId(command),
          status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
        }),
      );
    },
    async stream(method) {
      const messages = (async function* () {
        await posted;
        const ids = includeUnrelated
          ? ["unrelated", ...Array.from({ length: count }, () => postedId)]
          : Array.from({ length: count }, () => postedId);
        yield create(SubscriptionUpdateSchema, {
          update: {
            case: "eventUpdates",
            value: create(EventUpdatesSchema, {
              event: ids.map((id, index) =>
                create(EventSchema, {
                  message: packAny(
                    ProjectionStateSchema,
                    create(ProjectionStateSchema, { id: `event-${String(index)}` }),
                  ),
                  context: create(EventContextSchema, {
                    originId: { case: "commandId", value: create(CommandIdSchema, { uuid: id }) },
                  }),
                }),
              ),
            }),
          },
        });
      })();
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: messages,
      } as never;
    },
  };
}

function endingStream(completion: Promise<void>): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          await completion;
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function commandId(command: Command) {
  if (command.id === undefined) throw new Error("command ID required");
  return packAny(CommandIdSchema, command.id);
}
