/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */

import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { AnySchema, EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  EventContextSchema,
  EventSchema,
  ResponseSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-ts/proto";
import {
  EntityUpdatesSchema,
  QueryResponseSchema,
  QuerySchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
  type Subscription,
} from "@spine-ts/proto/client";
import { packAny } from "@spine-ts/core";
import { describe, expect, it, vi } from "vitest";

import { Client, ProjectionColumn } from "../src/index.js";
import { defineGeneratedProjectionColumns } from "../src/codegen/index.js";
import { ProjectionStateSchema } from "../test-fixtures/projection-column-fixtures.js";

const subscriptionColumns = ProjectionColumn.register(
  ProjectionStateSchema,
  defineGeneratedProjectionColumns(ProjectionStateSchema, {
    title: { field: ProjectionStateSchema.field.title, comparison: "ordering" as const },
    priority: { field: ProjectionStateSchema.field.priority, comparison: "ordering" as const },
    status: { field: ProjectionStateSchema.field.status, comparison: "equality" as const },
    dueAt: { field: ProjectionStateSchema.field.dueAt, comparison: "ordering" as const },
    owner: { field: ProjectionStateSchema.field.owner, comparison: "equality" as const },
    fingerprint: {
      field: ProjectionStateSchema.field.fingerprint,
      comparison: "equality" as const,
    },
    active: { field: ProjectionStateSchema.field.active, comparison: "equality" as const },
    sequence: { field: ProjectionStateSchema.field.sequence, comparison: "ordering" as const },
  }),
);

describe("Client subscriptions", () => {
  it("builds a scoped state topic and decodes state and no-longer-matching IDs", async () => {
    const observed: unknown[] = [];
    const client = Client.usingTransport(subscriptionTransport(observed, "state"));

    const states = await client
      .onBehalfOf("alice")
      .subscribeToState(ProjectionStateSchema, UserIdSchema, {
        ids: [create(UserIdSchema, { value: "task-1" })],
        mask: ["id", "title"],
      });
    const iterator = states[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "state", state: { id: "task-1" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "noLongerMatching", id: { value: "task-1" } },
    });
    expect(observed[0]).toMatchObject({
      id: { value: expect.stringMatching(/^t-/u) },
      target: {
        type: expect.stringContaining(ProjectionStateSchema.typeName),
        criterion: { case: "filters" },
      },
      fieldMask: { paths: ["id", "title"] },
      context: { actor: { value: "alice" } },
    });

    await states.cancel();
    await client.close();
  });

  it("decodes immutable event messages with their contexts", async () => {
    const client = Client.usingTransport(subscriptionTransport([], "event"));
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    const next = await events[Symbol.asyncIterator]().next();

    expect(next).toMatchObject({ value: { message: { id: "event-1" }, context: {} } });
    if (next.done) throw new Error("expected event");
    expect(Object.isFrozen(next.value.message)).toBe(true);
    expect(Object.isFrozen(next.value.context)).toBe(true);
    await events.cancel();
    await client.close();
  });

  it("exposes state bytes as immutable snapshots through every public view", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const update = protocolUpdate({
      case: "entityUpdates",
      value: {
        update: [
          {
            kind: {
              case: "state",
              value: packAny(
                ProjectionStateSchema,
                create(ProjectionStateSchema, { id: "bytes", fingerprint: source }),
              ),
            },
          },
        ],
      },
    });
    source.fill(9);
    const client = Client.usingTransport(protocolTransport(update));
    const states = await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema);
    const next = await states[Symbol.asyncIterator]().next();
    if (next.done || next.value.kind !== "state") throw new Error("expected state bytes");
    const bytes = next.value.state.fingerprint as unknown as Uint8Array;

    expect(bytes.length).toBe(3);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(bytes.at(1)).toBe(2);
    const buffer = bytes.buffer;
    new Uint8Array(buffer)[0] = 8;
    expect([...bytes]).toEqual([1, 2, 3]);
    expect([...bytes.valueOf()]).toEqual([1, 2, 3]);
    expect([...bytes.slice(1)]).toEqual([2, 3]);
    expect([...bytes.subarray(0, 2)]).toEqual([1, 2]);
    expect(() => bytes.fill(0)).toThrow("immutable");
    expect(() => {
      bytes[0] = 8;
    }).toThrow("immutable");
    expect(() => Object.defineProperty(bytes, "0", { value: 8 })).toThrow("immutable");
    expect(() => {
      delete bytes[0];
    }).toThrow("immutable");
    expect([...bytes]).toEqual([1, 2, 3]);
    await states.cancel();
    await client.close();
  });

  it("rejects ordered subscription predicates before contacting the service", async () => {
    const client = Client.usingTransport(subscriptionTransport([], "state"));

    await expect(
      client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema, {
        where: {
          kind: "comparison",
          column: { name: "priority" },
          operator: "greaterThan",
          value: 1,
        } as never,
      }),
    ).rejects.toThrow("equality comparisons only");

    await client.close();
  });

  it("builds include-all, ID, predicate, and combined state criteria", async () => {
    const comparison = {
      kind: "comparison",
      column: subscriptionColumns.title,
      operator: "equal",
      value: "Task",
    } as const;
    const cases = [
      { options: {}, criterion: "includeAll", ids: 0, filters: 0 },
      {
        options: { ids: [create(UserIdSchema, { value: "task-1" })] },
        criterion: "filters",
        ids: 1,
        filters: 0,
      },
      { options: { where: comparison }, criterion: "filters", ids: 0, filters: 1 },
      {
        options: {
          ids: [create(UserIdSchema, { value: "task-1" })],
          where: comparison,
        },
        criterion: "filters",
        ids: 1,
        filters: 1,
      },
    ] as const;

    for (const expected of cases) {
      const observed: Message[] = [];
      const client = Client.usingTransport(topicCaptureTransport(observed));
      const states = await client
        .asGuest()
        .subscribeToState(ProjectionStateSchema, UserIdSchema, expected.options);
      const topic = observed[0] as MessageShape<typeof TopicSchema>;
      expect(topic.target?.criterion.case).toBe(expected.criterion);
      const filters =
        topic.target?.criterion.case === "filters" ? topic.target.criterion.value : undefined;
      expect(filters?.idFilter?.id.length ?? 0).toBe(expected.ids);
      expect(filters?.filter.length ?? 0).toBe(expected.filters);
      await states.cancel();
      await client.close();
    }
  });

  it("accepts an empty mask and rejects an unknown mask before transport", async () => {
    const observed: Message[] = [];
    const client = Client.usingTransport(topicCaptureTransport(observed));
    const states = await client
      .asGuest()
      .subscribeToState(ProjectionStateSchema, UserIdSchema, { mask: [] });
    expect((observed[0] as MessageShape<typeof TopicSchema>).fieldMask).toBeUndefined();
    await states.cancel();

    await expect(
      client
        .asGuest()
        .subscribeToState(ProjectionStateSchema, UserIdSchema, { mask: ["unknown"] as never }),
    ).rejects.toThrow('mask path "unknown"');
    expect(observed).toHaveLength(1);
    await client.close();
  });

  it("freezes string and message tenant scopes into submitted topics", async () => {
    const messageTenant = create(TenantIdSchema, {
      kind: { case: "value", value: "message-tenant" },
    });
    for (const [tenant, expected] of [
      ["string-tenant", "string-tenant"],
      [messageTenant, "message-tenant"],
    ] as const) {
      const observed: Message[] = [];
      const client = Client.usingTransport(topicCaptureTransport(observed), { tenant });
      if (typeof tenant !== "string") tenant.kind = { case: "value", value: "mutated" };
      const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
      expect((observed[0] as MessageShape<typeof TopicSchema>).context?.tenantId?.kind).toEqual({
        case: "value",
        value: expected,
      });
      await events.cancel();
      await client.close();
    }

    expect(() => Client.usingTransport(topicCaptureTransport([]), { tenant: "" })).toThrow(
      "tenant must not be empty",
    );
  });

  it.each([
    {
      name: "cyclic",
      build() {
        const cyclic: { kind: "all"; predicates: unknown[] } = { kind: "all", predicates: [] };
        cyclic.predicates.push(cyclic);
        return cyclic;
      },
      error: "must not contain cycles",
    },
    {
      name: "empty group",
      build: () => ({ kind: "either", predicates: [] }),
      error: "predicate must not be empty",
    },
    {
      name: "over-depth",
      build() {
        let predicate: unknown = {
          kind: "comparison",
          column: { name: "title" },
          operator: "equal",
          value: "Task",
        };
        for (let depth = 0; depth < 66; depth += 1) {
          predicate = { kind: "all", predicates: [predicate] };
        }
        return predicate;
      },
      error: "maximum depth 64",
    },
    {
      name: "over-wide",
      build: () => ({
        kind: "all",
        predicates: Array.from({ length: 10_001 }, (_, index) => ({
          kind: "comparison",
          column: { name: "title" },
          operator: "equal",
          value: `Task ${String(index)}`,
        })),
      }),
      error: "maximum node count 10000",
    },
  ])("rejects $name subscription predicates before transport", async (testCase) => {
    const observed: Message[] = [];
    const client = Client.usingTransport(topicCaptureTransport(observed));
    await expect(
      client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema, {
        where: testCase.build() as never,
      }),
    ).rejects.toThrow(testCase.error);
    expect(observed).toHaveLength(0);
    await client.close();
  });

  it("makes malformed state and event updates terminal protocol errors", async () => {
    const stateClient = Client.usingTransport(
      protocolTransport(
        create(SubscriptionUpdateSchema, { update: { case: "eventUpdates", value: {} } }),
      ),
    );
    const states = await stateClient
      .asGuest()
      .subscribeToState(ProjectionStateSchema, UserIdSchema);
    await expect(states[Symbol.asyncIterator]().next()).rejects.toThrow("missing or not OK");
    await stateClient.close();

    const eventClient = Client.usingTransport(
      protocolTransport(
        create(SubscriptionUpdateSchema, {
          response: create(ResponseSchema, {
            status: { status: { case: "ok", value: create(EmptySchema) } },
          }),
          update: { case: "entityUpdates", value: { update: [] } },
        }),
      ),
    );
    const events = await eventClient.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(events[Symbol.asyncIterator]().next()).rejects.toThrow("non-event update");
    await eventClient.close();
  });

  it.each([
    {
      name: "state update with the wrong branch",
      mode: "state" as const,
      update: protocolUpdate({ case: "eventUpdates", value: { event: [] } }),
      error: "non-entity update",
    },
    {
      name: "state update with an empty packed state",
      mode: "state" as const,
      update: protocolUpdate({
        case: "entityUpdates",
        value: { update: [{ kind: { case: "state", value: create(AnySchema) } }] },
      }),
      error: "state does not match",
    },
    {
      name: "state update with the wrong packed state schema",
      mode: "state" as const,
      update: protocolUpdate({
        case: "entityUpdates",
        value: {
          update: [
            {
              kind: {
                case: "state",
                value: packAny(UserIdSchema, create(UserIdSchema, { value: "wrong" })),
              },
            },
          ],
        },
      }),
      error: "state does not match",
    },
    {
      name: "no-longer-matching update without an ID",
      mode: "state" as const,
      update: protocolUpdate({
        case: "entityUpdates",
        value: { update: [{ kind: { case: "noLongerMatching", value: true } }] },
      }),
      error: "no-longer-matching ID",
    },
    {
      name: "no-longer-matching update with the wrong ID schema",
      mode: "state" as const,
      update: protocolUpdate({
        case: "entityUpdates",
        value: {
          update: [
            {
              id: packAny(ProjectionStateSchema, create(ProjectionStateSchema, { id: "wrong" })),
              kind: { case: "noLongerMatching", value: true },
            },
          ],
        },
      }),
      error: "no-longer-matching ID",
    },
    {
      name: "state update without a kind",
      mode: "state" as const,
      update: protocolUpdate({ case: "entityUpdates", value: { update: [{}] } }),
      error: "kind is missing or invalid",
    },
    {
      name: "event update without a message",
      mode: "event" as const,
      update: protocolUpdate({
        case: "eventUpdates",
        value: { event: [create(EventSchema, { context: create(EventContextSchema) })] },
      }),
      error: "event does not match",
    },
    {
      name: "event update with the wrong message schema",
      mode: "event" as const,
      update: protocolUpdate({
        case: "eventUpdates",
        value: {
          event: [
            create(EventSchema, {
              message: packAny(UserIdSchema, create(UserIdSchema, { value: "wrong" })),
              context: create(EventContextSchema),
            }),
          ],
        },
      }),
      error: "event does not match",
    },
    {
      name: "event update without a context",
      mode: "event" as const,
      update: protocolUpdate({
        case: "eventUpdates",
        value: {
          event: [
            create(EventSchema, {
              message: packAny(
                ProjectionStateSchema,
                create(ProjectionStateSchema, { id: "event" }),
              ),
            }),
          ],
        },
      }),
      error: "context is missing",
    },
  ])("rejects malformed $name", async ({ mode, update, error }) => {
    await expectMalformedUpdate(mode, update, error);
  });

  it("rejects a subscription update without an identity", async () => {
    await expectMalformedUpdate(
      "event",
      protocolUpdate({ case: "eventUpdates", value: { event: [] } }),
      "identity is missing",
      false,
    );
  });

  it("rejects a subscription update with a non-OK response", async () => {
    const update = create(SubscriptionUpdateSchema, {
      response: create(ResponseSchema, {
        status: { status: { case: "error", value: {} as never } },
      }),
      update: { case: "eventUpdates", value: { event: [] } } as never,
    });
    await expectMalformedUpdate("event", update, "missing or not OK");
  });

  it("rejects a query response whose status is missing", async () => {
    const client = Client.usingTransport({
      async unary(method) {
        return response(method, create(QueryResponseSchema));
      },
      async stream() {
        throw new Error("unexpected stream");
      },
    });
    await expect(
      client.asGuest().query(ProjectionStateSchema, create(QuerySchema)),
    ).rejects.toThrow("response status is missing or invalid");
    await client.close();
  });

  it("rejects and cancels a Subscribe response whose echoed topic differs", async () => {
    let cancelled = 0;
    const client = Client.usingTransport({
      async unary(method) {
        if (method.name === "Subscribe") {
          return response(
            method,
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-wrong" }),
              topic: { id: { value: "t-wrong" } },
            }),
          );
        }
        if (method.name === "Cancel") cancelled += 1;
        return response(method, create(ResponseSchema));
      },
      async stream() {
        throw new Error("activation must not start");
      },
    });
    await expect(client.asGuest().subscribeToEvents(ProjectionStateSchema)).rejects.toThrow(
      "topic does not match",
    );
    expect(cancelled).toBe(1);
    await client.close();
  });

  it.each([
    { name: "missing ID", subscription: { topic: "echo" } },
    { name: "empty ID", subscription: { id: { value: "" }, topic: "echo" } },
    { name: "missing topic", subscription: { id: { value: "s-valid" } } },
  ])("rejects and cancels a Subscribe response with $name", async ({ subscription }) => {
    let cancelled = 0;
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe") {
          return response(
            method,
            create(SubscriptionSchema, {
              ...(subscription.id === undefined ? {} : { id: subscription.id }),
              ...(subscription.topic === "echo" ? { topic: input as never } : {}),
            }),
          );
        }
        if (method.name === "Cancel") cancelled += 1;
        return response(method, create(ResponseSchema));
      },
      async stream() {
        throw new Error("activation must not start");
      },
    });
    await expect(client.asGuest().subscribeToEvents(ProjectionStateSchema)).rejects.toThrow(
      subscription.id === undefined || subscription.id.value.length === 0
        ? "ID is missing or invalid"
        : "topic does not match",
    );
    expect(cancelled).toBe(1);
    await client.close();
  });

  it("rejects an update whose complete subscription identity differs", async () => {
    let accepted: Subscription | undefined;
    let cancelled = 0;
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe") {
          accepted = create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-accepted" }),
            topic: input as never,
          });
          return response(method, accepted);
        }
        if (method.name === "Cancel") cancelled += 1;
        return response(method, create(ResponseSchema));
      },
      async stream(method) {
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: (async function* () {
            yield create(SubscriptionUpdateSchema, {
              subscription: create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "s-swapped" }),
                topic: accepted?.topic,
              }),
              response: create(ResponseSchema, {
                status: { status: { case: "ok", value: create(EmptySchema) } },
              }),
              update: { case: "eventUpdates", value: { event: [] } },
            });
          })(),
        } as never;
      },
    });
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(events[Symbol.asyncIterator]().next()).rejects.toThrow("identity does not match");
    await vi.waitFor(() => {
      expect(cancelled).toBe(1);
    });
    await client.close();
  });

  it.each(["state", "event"] as const)(
    "rejects %s creation when activation iterator setup throws synchronously",
    async (kind) => {
      let cancelled = 0;
      const failure = new Error("iterator setup failed");
      const client = Client.usingTransport({
        async unary(method, _signal, _timeoutMs, _header, input) {
          if (method.name === "Subscribe") {
            return response(
              method,
              create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "s-setup" }),
                topic: input as never,
              }),
            );
          }
          if (method.name === "Cancel") cancelled += 1;
          return response(method, create(ResponseSchema));
        },
        stream() {
          throw failure;
        },
      });
      const creation =
        kind === "state"
          ? client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema)
          : client.asGuest().subscribeToEvents(ProjectionStateSchema);
      await expect(creation).rejects.toBe(failure);
      expect(cancelled).toBe(1);
      await client.close();
    },
  );

  it.each(["state", "event"] as const)(
    "rejects %s creation when the activation response iterator throws",
    async (kind) => {
      let cancelled = 0;
      let listenersAdded = 0;
      let listenersRemoved = 0;
      const failure = new Error("response iterator failed");
      const controller = new AbortController();
      const signal = controller.signal;
      const add = signal.addEventListener.bind(signal);
      const remove = signal.removeEventListener.bind(signal);
      Object.defineProperty(signal, "addEventListener", {
        value: (...arguments_: Parameters<typeof add>) => {
          listenersAdded += 1;
          add(...arguments_);
        },
      });
      Object.defineProperty(signal, "removeEventListener", {
        value: (...arguments_: Parameters<typeof remove>) => {
          listenersRemoved += 1;
          remove(...arguments_);
        },
      });
      const client = Client.usingTransport({
        async unary(method, _signal, _timeoutMs, _header, input) {
          if (method.name === "Subscribe") {
            return response(
              method,
              create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "s-response-iterator" }),
                topic: input as never,
              }),
            );
          }
          if (method.name === "Cancel") cancelled += 1;
          return response(method, create(ResponseSchema));
        },
        async stream(method) {
          return {
            stream: true,
            method,
            header: new Headers(),
            trailer: new Headers(),
            service: method.parent,
            message: {
              [Symbol.asyncIterator]() {
                throw failure;
              },
            },
          } as never;
        },
      });
      const creation =
        kind === "state"
          ? client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema, { signal })
          : client.asGuest().subscribeToEvents(ProjectionStateSchema, { signal });
      await expect(creation).rejects.toBe(failure);
      expect(cancelled).toBe(1);
      expect(listenersAdded).toBeGreaterThan(0);
      expect(listenersRemoved).toBe(listenersAdded);
      await expect(client.close()).resolves.toBeUndefined();
      expect(cancelled).toBe(1);
    },
  );

  it.each(["state", "event"] as const)(
    "bounds %s updates and cancels remotely once",
    async (kind) => {
      const updates = [kind === "state" ? stateBatch(34) : eventBatch(34)];
      const observed = bufferedTransport(updates);
      const client = Client.usingTransport(observed.transport);
      const handle =
        kind === "state"
          ? await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema)
          : await client.asGuest().subscribeToEvents(ProjectionStateSchema);
      await vi.waitFor(() => {
        expect(observed.cancelled()).toBe(1);
      });
      await expect(handle[Symbol.asyncIterator]().next()).rejects.toThrow("buffer overflowed");
      await handle.cancel().catch(() => undefined);
      expect(observed.cancelled()).toBe(1);
      await client.close();
    },
  );

  it("preserves state update order and permits one iterator and pending read", async () => {
    const observed = bufferedTransport([stateUpdate("one"), stateUpdate("two")]);
    const client = Client.usingTransport(observed.transport);
    const states = await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema);
    const iterator = states[Symbol.asyncIterator]();
    expect(() => states[Symbol.asyncIterator]()).toThrow("only one iterator");
    await expect(iterator.next()).resolves.toMatchObject({ value: { state: { id: "one" } } });
    await expect(iterator.next()).resolves.toMatchObject({ value: { state: { id: "two" } } });
    await states.cancel();
    await client.close();
  });

  it("aborts an active topic once and settles a pending read locally", async () => {
    const observed = bufferedTransport([], undefined, true);
    const controller = new AbortController();
    const client = Client.usingTransport(observed.transport);
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema, {
      signal: controller.signal,
    });
    const pending = events[Symbol.asyncIterator]().next();
    controller.abort(new Error("stop"));
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => {
      expect(observed.cancelled()).toBe(1);
    });
    await events.cancel();
    expect(observed.cancelled()).toBe(1);
    await client.close();
  });

  it("finishes a topic normally before its first update", async () => {
    const observed = bufferedTransport([]);
    const client = Client.usingTransport(observed.transport);
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(events[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await client.close();
    expect(observed.cancelled()).toBe(0);
  });

  it("rejects a pre-aborted subscription before contacting transport", async () => {
    const observed: Message[] = [];
    const controller = new AbortController();
    const failure = new Error("already stopped");
    controller.abort(failure);
    const client = Client.usingTransport(topicCaptureTransport(observed));
    await expect(
      client.asGuest().subscribeToEvents(ProjectionStateSchema, { signal: controller.signal }),
    ).rejects.toBe(failure);
    expect(observed).toHaveLength(0);
    await client.close();
  });

  it("rejects a second pending read with a stable protocol error", async () => {
    const observed = bufferedTransport([], undefined, true);
    const client = Client.usingTransport(observed.transport);
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    const iterator = events[Symbol.asyncIterator]();
    const pending = iterator.next();
    await expect(iterator.next()).rejects.toThrow("read is already pending");
    await events.cancel();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await client.close();
  });

  it("surfaces an explicit cancel failure while closing other active topics", async () => {
    let cancels = 0;
    const observed = bufferedTransport(
      [],
      () => {
        cancels += 1;
        return cancels === 1 ? Promise.reject(new Error("cancel failed")) : Promise.resolve();
      },
      true,
    );
    const client = Client.usingTransport(observed.transport);
    const state = await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema);
    const event = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(state.cancel()).rejects.toThrow("cancel failed");
    await expect(client.close()).resolves.toBeUndefined();
    expect(observed.cancelled()).toBe(2);
    await event.cancel();
  });

  it("cancels a subscription resolved after caller abort without activating it", async () => {
    let resolveSubscribe!: (value: Message) => void;
    let submittedTopic: Message | undefined;
    let activated = 0;
    let cancelled = 0;
    const subscription = new Promise<Message>((resolve) => {
      resolveSubscribe = resolve;
    });
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe") {
          submittedTopic = clone(TopicSchema, input as MessageShape<typeof TopicSchema>);
          return response(method, await subscription);
        }
        if (method.name === "Cancel") {
          cancelled += 1;
          return response(method, create(ResponseSchema));
        }
        throw new Error("unexpected unary");
      },
      async stream() {
        activated += 1;
        throw new Error("activation must not start");
      },
    });
    const controller = new AbortController();
    const starting = client
      .asGuest()
      .subscribeToEvents(ProjectionStateSchema, { signal: controller.signal });
    controller.abort(new Error("stopped"));
    resolveSubscribe(
      create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-late" }),
        topic: submittedTopic as never,
      }),
    );
    await expect(starting).rejects.toThrow("stopped");
    expect(activated).toBe(0);
    expect(cancelled).toBe(1);
    await client.close();
  });

  it("propagates activation iterator failure and cancels once", async () => {
    let cancelled = 0;
    const failure = new Error("activation failed");
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe")
          return response(
            method,
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-fail" }),
              topic: input as never,
            }),
          );
        if (method.name === "Cancel") cancelled += 1;
        return response(method, create(ResponseSchema));
      },
      async stream(method) {
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: {
            [Symbol.asyncIterator]: () => ({
              next: () =>
                new Promise((_resolve, reject) => {
                  setTimeout(() => {
                    reject(failure);
                  }, 0);
                }),
            }),
          },
        } as never;
      },
    });
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(events[Symbol.asyncIterator]().next()).rejects.toBe(failure);
    await vi.waitFor(() => {
      expect(cancelled).toBe(1);
    });
    await client.close();
  });

  it("normalizes non-Error activation and cleanup failures", async () => {
    let cancelled = 0;
    const client = Client.usingTransport({
      async unary(method, _signal, _timeoutMs, _header, input) {
        if (method.name === "Subscribe") {
          return response(
            method,
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-string-failure" }),
              topic: input as never,
            }),
          );
        }
        if (method.name === "Cancel") {
          cancelled += 1;
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- hostile transports can throw any value.
          throw "cleanup failed";
        }
        return response(method, create(ResponseSchema));
      },
      async stream(method) {
        return {
          stream: true,
          method,
          header: new Headers(),
          trailer: new Headers(),
          service: method.parent,
          message: {
            [Symbol.asyncIterator]: () => ({
              next: () =>
                new Promise((_resolve, reject) => {
                  setTimeout(() => {
                    // Verifies defensive normalization of non-Error rejections.
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    reject("wire failed");
                  }, 0);
                }),
            }),
          },
        } as never;
      },
    });
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    await expect(events[Symbol.asyncIterator]().next()).rejects.toThrow("wire failed");
    await vi.waitFor(() => {
      expect(cancelled).toBe(1);
    });
    await expect(client.close()).rejects.toThrow("cleanup failed");
  });

  it("removes caller abort listeners after explicit cancellation", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    let added = 0;
    let removed = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    Object.defineProperty(signal, "addEventListener", {
      value: (...args: Parameters<typeof add>) => {
        added += 1;
        add(...args);
      },
    });
    Object.defineProperty(signal, "removeEventListener", {
      value: (...args: Parameters<typeof remove>) => {
        removed += 1;
        remove(...args);
      },
    });
    const observed = bufferedTransport([], undefined, true);
    const client = Client.usingTransport(observed.transport);
    const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema, { signal });
    await events.cancel();
    expect(added).toBe(removed);
    await client.close();
  });

  it("attempts every active cancel before close reports aggregate cleanup failures", async () => {
    let cancelled = 0;
    const observed = bufferedTransport(
      [],
      () => {
        cancelled += 1;
        return Promise.reject(new Error(`cancel-${String(cancelled)}`));
      },
      true,
    );
    const client = Client.usingTransport(observed.transport);
    const state = await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema);
    const event = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
    const stateNext = state[Symbol.asyncIterator]().next();
    const eventNext = event[Symbol.asyncIterator]().next();
    await expect(client.close()).rejects.toBeInstanceOf(AggregateError);
    expect(observed.cancelled()).toBe(2);
    await expect(stateNext).resolves.toEqual({ done: true, value: undefined });
    await expect(eventNext).resolves.toEqual({ done: true, value: undefined });
    await expect(client.asGuest().subscribeToEvents(ProjectionStateSchema)).rejects.toThrow(
      "client is closing",
    );
  });
});

function protocolUpdate(update: unknown): Message {
  return create(SubscriptionUpdateSchema, {
    response: create(ResponseSchema, {
      status: { status: { case: "ok", value: create(EmptySchema) } },
    }),
    update: update as never,
  });
}

async function expectMalformedUpdate(
  mode: "state" | "event",
  update: Message,
  error: string,
  attachIdentity = true,
): Promise<void> {
  const client = Client.usingTransport(protocolTransport(update, attachIdentity));
  const stream =
    mode === "state"
      ? await client.asGuest().subscribeToState(ProjectionStateSchema, UserIdSchema)
      : await client.asGuest().subscribeToEvents(ProjectionStateSchema);
  await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(error);
  await client.close();
}

function topicCaptureTransport(observed: Message[]): Transport {
  let accepted: Subscription | undefined;
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        const topic = clone(TopicSchema, input as MessageShape<typeof TopicSchema>);
        observed.push(topic);
        accepted = create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-capture" }),
          topic,
        });
        return response(method, accepted);
      }
      return response(method, create(ResponseSchema));
    },
    async stream(method) {
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {
          await new Promise<void>(() => undefined);
          yield create(SubscriptionUpdateSchema, { subscription: accepted });
        })(),
      } as never;
    },
  };
}

function protocolTransport(update: Message, attachIdentity = true): Transport {
  let accepted: Subscription | undefined;
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        accepted = create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-protocol" }),
          topic: input as never,
        });
        return response(method, accepted);
      }
      return response(method, create(ResponseSchema));
    },
    async stream(method, _signal, _timeoutMs, _header, input) {
      const request = input[Symbol.asyncIterator]();
      expect(typeof request.next).toBe("function");
      expect(typeof request.return).toBe("function");
      expect(typeof request.throw).toBe("function");
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {
          const envelope = clone(SubscriptionUpdateSchema, update as never);
          if (attachIdentity) envelope.subscription = accepted;
          yield envelope;
        })(),
      } as never;
    },
  };
}

function bufferedTransport(
  updates: readonly Message[],
  onCancel?: () => Promise<void>,
  remainActive = false,
) {
  let cancelCount = 0;
  let accepted: Subscription | undefined;
  const transport: Transport = {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        accepted = create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-buffer" }),
          topic: input as never,
        });
        return response(method, accepted);
      }
      if (method.name === "Cancel") {
        cancelCount += 1;
        await onCancel?.();
      }
      return response(method, create(ResponseSchema));
    },
    async stream(method) {
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {
          for (const update of updates) {
            const envelope = clone(SubscriptionUpdateSchema, update as never);
            envelope.subscription = accepted;
            yield envelope;
          }
          if (remainActive) await new Promise<void>(() => undefined);
        })(),
      } as never;
    },
  };
  return { transport, cancelled: () => cancelCount };
}

function stateUpdate(id: string): Message {
  return create(SubscriptionUpdateSchema, {
    response: create(ResponseSchema, {
      status: { status: { case: "ok", value: create(EmptySchema) } },
    }),
    update: {
      case: "entityUpdates",
      value: {
        update: [
          {
            kind: {
              case: "state",
              value: packAny(ProjectionStateSchema, create(ProjectionStateSchema, { id })),
            },
          },
        ],
      },
    },
  });
}

function stateBatch(count: number): Message {
  return create(SubscriptionUpdateSchema, {
    response: create(ResponseSchema, {
      status: { status: { case: "ok", value: create(EmptySchema) } },
    }),
    update: {
      case: "entityUpdates",
      value: {
        update: Array.from({ length: count }, (_, index) => ({
          kind: {
            case: "state" as const,
            value: packAny(
              ProjectionStateSchema,
              create(ProjectionStateSchema, { id: `state-${String(index)}` }),
            ),
          },
        })),
      },
    },
  });
}

function eventBatch(count: number): Message {
  return create(SubscriptionUpdateSchema, {
    response: create(ResponseSchema, {
      status: { status: { case: "ok", value: create(EmptySchema) } },
    }),
    update: {
      case: "eventUpdates",
      value: {
        event: Array.from({ length: count }, (_, index) =>
          create(EventSchema, {
            message: packAny(
              ProjectionStateSchema,
              create(ProjectionStateSchema, { id: `event-${String(index)}` }),
            ),
            context: create(EventContextSchema),
          }),
        ),
      },
    },
  });
}

function subscriptionTransport(observed: unknown[], mode: "state" | "event"): Transport {
  let accepted: Subscription | undefined;
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        observed.push(input);
        accepted = create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-1" }),
          topic: input as never,
        });
        return response(method, accepted);
      }
      return response(
        method,
        create(ResponseSchema, { status: { status: { case: "ok", value: create(EmptySchema) } } }),
      );
    },
    async stream(method) {
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {
          if (mode === "state") {
            yield create(SubscriptionUpdateSchema, {
              subscription: accepted,
              response: create(ResponseSchema, {
                status: { status: { case: "ok", value: create(EmptySchema) } },
              }),
              update: {
                case: "entityUpdates",
                value: create(EntityUpdatesSchema, {
                  update: [
                    {
                      kind: {
                        case: "state",
                        value: packAny(
                          ProjectionStateSchema,
                          create(ProjectionStateSchema, { id: "task-1" }),
                        ),
                      },
                    },
                    {
                      id: packAny(UserIdSchema, create(UserIdSchema, { value: "task-1" })),
                      kind: { case: "noLongerMatching", value: true },
                    },
                  ],
                }),
              },
            });
            return;
          }
          yield create(SubscriptionUpdateSchema, {
            subscription: accepted,
            response: create(ResponseSchema, {
              status: { status: { case: "ok", value: create(EmptySchema) } },
            }),
            update: {
              case: "eventUpdates",
              value: {
                event: [
                  create(EventSchema, {
                    message: packAny(
                      ProjectionStateSchema,
                      create(ProjectionStateSchema, { id: "event-1" }),
                    ),
                    context: create(EventContextSchema),
                  }),
                ],
              },
            },
          });
        })(),
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
