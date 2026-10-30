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

import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { clone, create, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import {
  DynamicSubscriptionCreator,
  DynamicUnaryForwarder,
  NativeSubscriptionCreator,
  type DynamicUnaryClient,
} from "@spine-event-engine/auth";
import { ApplicationNode } from "@spine-event-engine/deployment";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS } from "@spine-event-engine/core/spi/subscription-lifecycle";
import {
  ActorContextSchema,
  AckSchema,
  ErrorSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  ResponseSchema,
  StatusSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { GatewayAuthenticatedSubscriptionSchema } from "@spine-event-engine/proto/auth";
import {
  CommandService,
  QueryService,
  QueryResponseSchema,
  QueryIdSchema,
  QuerySchema,
  EventUpdatesSchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionService,
  SubscriptionValidationError,
  SubscriptionUpdateSchema,
  TopicSchema,
  TopicIdSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  InMemoryStorageFactory,
  type RecordSpec as StorageRecordSpec,
  type StorageContext,
} from "@spine-event-engine/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NodeCoordinator,
  SubscriptionUpdateQueue,
  type ReadyMemberSource,
} from "../../src/server/node-coordinator.js";
import { DurableSubscriptionBindings } from "../../src/browser/durable-subscription-bindings.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { ProjectOverviewStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";

type RecordSpec<I, R> = StorageRecordSpec<I, R extends Message ? R : Message>;

describe("NodeCoordinator", () => {
  const closeables: (() => Promise<void>)[] = [];

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const closeable of closeables.splice(0).reverse()) {
      try {
        await closeable();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Coordinator fixture cleanup failed.");
  });

  it("forwards each generated command call once to ready replicas in round-robin order", async () => {
    const first = await backend("first");
    const second = await backend("second");
    closeables.push(first.close, second.close);
    const members = new TestReadyMembers([first.member, second.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());

    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    const firstAck = await createClient(CommandService, transport).post(
      create(CommandService.method.post.input),
    );
    const secondAck = await createClient(CommandService, transport).post(
      create(CommandService.method.post.input),
    );

    expect(firstAck.status).toBeDefined();
    expect(secondAck.status).toBeDefined();
    expect(first.commands()).toBe(1);
    expect(second.commands()).toBe(1);
  });

  it("returns unavailable without invoking an application replica when membership is empty", async () => {
    const coordinator = await NodeCoordinator.open({ members: new TestReadyMembers([]), port: 0 });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).post(
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: 14 });
  });

  it("returns unavailable when a subscription has no ready replica", async () => {
    const coordinator = await NodeCoordinator.open({ members: new TestReadyMembers([]), port: 0 });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      ).subscribe(coordinatorTopic()),
    ).rejects.toMatchObject({ code: Code.Unavailable });
  });

  it("forwards generated queries through the selected ready replica", async () => {
    const replica = await backend("query");
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(QueryService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).read(
        coordinatorQuery(),
      ),
    ).resolves.toEqual(create(QueryResponseSchema));
  });

  it("rejects malformed read-side requests before forwarding to a replica", async () => {
    const replica = await backend("invalid-read");
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    const queries = createClient(QueryService, transport);
    const subscriptions = createClient(SubscriptionService, transport);

    await expect(queries.read(create(QueryService.method.read.input))).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
    await expect(subscriptions.subscribe(create(TopicSchema))).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
    await expect(subscriptions.cancel(create(SubscriptionSchema))).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
    expect(replica.subscriptions()).toBe(0);
    expect(replica.cancellations()).toBe(0);
  });

  it("preserves backend Query validation details through native Coordinator forwarding", async () => {
    const detail = create(ErrorSchema, {
      type: "spine.client.QueryValidationError",
      code: 2,
      message: "query validation failed.",
    });
    const failure = new ConnectError(
      "query validation failed.",
      Code.InvalidArgument,
      {
        "spine-error-bin": Buffer.from(toBinary(ErrorSchema, detail)).toString("base64"),
      },
      [{ desc: ErrorSchema, value: detail }],
    );
    const replica = await backend("query-error", { read: () => Promise.reject(failure) });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const actual = await createClient(
      QueryService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    )
      .read(coordinatorQuery())
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(actual).toBeInstanceOf(ConnectError);
    expect((actual as ConnectError).code).toBe(Code.InvalidArgument);
    expect((actual as ConnectError).findDetails(ErrorSchema)[0]).toMatchObject({
      type: "spine.client.QueryValidationError",
      code: 2,
    });
    expect((actual as ConnectError).metadata.get("spine-error-bin")).toBeDefined();
  });

  it("creates a native subscription on every current replica", async () => {
    const first = await backend("first");
    const second = await backend("second");
    closeables.push(first.close, second.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([first.member, second.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    const subscription = await createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    ).subscribe(coordinatorTopic());

    expect(subscription.id?.value).toMatch(/^s-[0-9a-f-]{36}$/u);
    expect(first.subscriptions()).toBe(1);
    expect(second.subscriptions()).toBe(1);
    expect(
      (
        await createClient(
          SubscriptionService,
          createGrpcTransport({ baseUrl: coordinator.baseUrl }),
        ).cancel(subscription)
      ).status?.status.case,
    ).toBe("ok");
    expect(first.cancellations()).toBe(1);
    expect(second.cancellations()).toBe(1);
    await coordinator.close();
  });

  it("cancels an unactivated definition at the shared activation-handshake deadline", async () => {
    vi.useFakeTimers();
    try {
      const replica = await backend("pending-handshake");
      closeables.push(replica.close);
      const coordinator = await NodeCoordinator.open({
        members: new TestReadyMembers([replica.member]),
        port: 0,
      });
      closeables.push(() => coordinator.close());
      const subscriptions = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      );
      await subscriptions.subscribe(coordinatorTopic());
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS);

      await expect.poll(() => replica.cancellations()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a pending activation after malformed lifecycle criteria", async () => {
    vi.useFakeTimers();
    try {
      const replica = await backend("malformed-pending");
      closeables.push(replica.close);
      const coordinator = await NodeCoordinator.open({
        members: new TestReadyMembers([replica.member]),
        port: 0,
      });
      closeables.push(() => coordinator.close());
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      );
      const subscription = await client.subscribe(coordinatorTopic());
      const malformed = clone(SubscriptionSchema, subscription);
      if (malformed.topic?.target === undefined) throw new Error("Expected topic target.");
      malformed.topic.target.criterion = { case: "includeAll", value: false };

      await expect(client.cancel(malformed)).rejects.toMatchObject({ code: Code.InvalidArgument });
      const iterator = client.activate(malformed)[Symbol.asyncIterator]();
      const failure = await iterator.next().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ConnectError);
      expect((failure as ConnectError).findDetails(ErrorSchema)[0]).toMatchObject({
        type: "spine.client.SubscriptionValidationError",
        code: 2,
      });
      expect(replica.cancellations()).toBe(0);
      expect(replica.activations()).toBe(0);

      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS);
      await expect.poll(() => replica.cancellations()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries failed pending cleanup without accumulating cancellation work", async () => {
    vi.useFakeTimers();
    try {
      const replica = await backend("pending-retry", { cancelFailures: 1 });
      closeables.push(replica.close);
      const coordinator = await NodeCoordinator.open({
        members: new TestReadyMembers([replica.member]),
        port: 0,
      });
      closeables.push(() => coordinator.close());
      const subscriptions = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      );
      await subscriptions.subscribe(coordinatorTopic());

      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS);
      await expect.poll(() => replica.cancellations()).toBe(1);
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS);
      await expect.poll(() => replica.cancellations()).toBe(2);
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS * 2);
      expect(replica.cancellations()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an active Coordinator stream alive beyond the handshake window", async () => {
    vi.useFakeTimers();
    try {
      const replica = await backend("active-no-expiry", {
        holdActivation: true,
      });
      closeables.push(replica.close);
      const coordinator = await NodeCoordinator.open({
        members: new TestReadyMembers([replica.member]),
        port: 0,
      });
      closeables.push(() => coordinator.close());
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      );
      const subscription = await client.subscribe(coordinatorTopic());
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS - 1);
      const controller = new AbortController();
      const updates = client
        .activate(subscription, { signal: controller.signal })
        [Symbol.asyncIterator]();
      await expect(updates.next()).resolves.toMatchObject({
        value: { response: { status: { status: { case: "ok" } } } },
      });
      const pending = updates.next();
      await expect.poll(() => replica.activations()).toBe(1);

      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS * 2);
      expect(replica.cancellations()).toBe(0);
      expect(replica.activationAborts()).toBe(0);

      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
      await expect.poll(() => replica.cancellations()).toBe(1);
      await expect.poll(() => replica.activationAborts()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rehydrates the Gateway durable logical definition into a replacement Coordinator only", async () => {
    const replica = await backend("durable-recovery");
    closeables.push(replica.close);
    const storageFactory = new InMemoryStorageFactory();
    const openStorage = storageFactory.createRecordStorage.bind(storageFactory);
    const storageContexts: string[] = [];
    const recordTypes: unknown[] = [];
    storageFactory.createRecordStorage = ((
      context: StorageContext,
      spec: RecordSpec<unknown, never>,
    ) => {
      storageContexts.push(context.name);
      recordTypes.push(spec.recordType);
      return openStorage(context, spec as never);
    }) as never;
    const members = new TestReadyMembers([replica.member]);
    const firstCoordinator = await NodeCoordinator.open({ members, port: 0 });
    let firstClosed = false;
    const firstOwner = dynamicOwner(firstCoordinator.baseUrl);
    const firstBindings = new DurableSubscriptionBindings({
      storageFactory,
      namespace: "gateway",
      nextId: () => "s-public",
      cleanup: () => Promise.resolve(),
    });
    let replacementCoordinator: NodeCoordinator | undefined;
    let replacementOwner: ReturnType<typeof dynamicOwner> | undefined;
    let reopenedBindings: DurableSubscriptionBindings | undefined;
    try {
      await firstOwner.reconcile([
        new ApplicationNode({ id: "coordinator", endpoint: firstCoordinator.baseUrl }),
      ]);
      const definition = await firstBindings.create({
        topic: { kind: "subscription-topic", bytes: trustedTopic() },
        whenExpires: 10_000,
      });
      await new DynamicSubscriptionCreator(firstOwner).subscribe(
        definition,
        new AbortController().signal,
      );
      expect(replica.subscriptions()).toBe(1);

      await firstOwner.close();
      await firstCoordinator.close();
      await firstBindings.close();
      firstClosed = true;

      replacementCoordinator = await NodeCoordinator.open({ members, port: 0 });
      replacementOwner = dynamicOwner(replacementCoordinator.baseUrl);
      const activeReplacementOwner = replacementOwner;
      await replacementOwner.reconcile([
        new ApplicationNode({ id: "coordinator", endpoint: replacementCoordinator.baseUrl }),
      ]);
      reopenedBindings = new DurableSubscriptionBindings({
        storageFactory,
        namespace: "gateway",
        nextId: () => "s-next",
        cleanup: () => Promise.resolve(),
      });

      expect(replica.subscriptions()).toBe(1);
      await reopenedBindings.recoverActive({
        nowMs: 1,
        onDefinition: (wire) =>
          new DynamicSubscriptionCreator(activeReplacementOwner).rehydrate(wire),
      });

      expect(replica.subscriptions()).toBe(2);
      expect(storageContexts).toEqual(["spine.auth.gateway", "spine.auth.gateway"]);
      expect(recordTypes).toEqual([
        GatewayAuthenticatedSubscriptionSchema,
        GatewayAuthenticatedSubscriptionSchema,
      ]);
    } finally {
      const cleanupFailures: unknown[] = [];
      for (const close of [
        () => replacementOwner?.close(),
        () => replacementCoordinator?.close(),
        () => reopenedBindings?.close(),
      ])
        try {
          await close();
        } catch (error) {
          cleanupFailures.push(error);
        }
      if (!firstClosed) {
        for (const close of [
          () => firstOwner.close(),
          () => firstCoordinator.close(),
          () => firstBindings.close(),
        ])
          try {
            await close();
          } catch (error) {
            cleanupFailures.push(error);
          }
      }
      if (cleanupFailures.length > 0)
        // eslint-disable-next-line no-unsafe-finally -- reports only after every owned cleanup ran.
        throw new AggregateError(cleanupFailures, "Gateway recovery cleanup failed.");
    }
  });

  it("merges native update streams and relays the Coordinator logical subscription", async () => {
    const first = await backend("first", { updates: 1 });
    const second = await backend("second", { updates: 1 });
    closeables.push(first.close, second.close);
    const members = new TestReadyMembers([first.member, second.member]);
    const coordinator = await NodeCoordinator.open({
      members,
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    expect(members.childActivations()).toBe(0);
    const updates = client.activate(subscription)[Symbol.asyncIterator]();

    const firstUpdate = await updates.next();
    const secondUpdate = await updates.next();
    if (firstUpdate.done || secondUpdate.done)
      throw new Error("expected native subscription updates");
    expect(firstUpdate.value.subscription?.id).toEqual(subscription.id);
    expect(secondUpdate.value.subscription?.id).toEqual(subscription.id);
    expect(members.childActivations()).toBe(2);

    await coordinator.close();
  });

  it("rejects a native child ACK with a different subscription ID before logical readiness", async () => {
    const replica = await backend("invalid-child-ack", { mismatchedActivationAck: true });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const updates = client.activate(subscription)[Symbol.asyncIterator]();

    await expect(updates.next()).rejects.toMatchObject({ code: Code.Internal });
    await vi.waitFor(() => {
      expect(replica.cancellations()).toBe(1);
    });
  });

  it("forwards a child's structured unknown-subscription activation failure", async () => {
    const detail = create(ErrorSchema, {
      type: "spine.client.SubscriptionValidationError",
      code: SubscriptionValidationError.UNKNOWN_SUBSCRIPTION,
      message: "Subscription is unknown to this server.",
    });
    const replica = await backend("unknown-child", {
      activateError: new ConnectError(detail.message, Code.NotFound, undefined, [
        { desc: ErrorSchema, value: detail },
      ]),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const iterator = client.activate(subscription)[Symbol.asyncIterator]();
    const failure = await iterator.next().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).findDetails(ErrorSchema)).toEqual([detail]);
    expect(replica.activations()).toBe(1);
  });

  it("cancels active native streams when the public subscription stream aborts", async () => {
    const replica = await backend("cancel-activation", { holdActivation: true });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const controller = new AbortController();
    const updates = client
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();

    await expect(updates.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    const pending = updates.next();
    await expect.poll(() => replica.activations()).toBe(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    await expect.poll(() => replica.activationAborts()).toBe(1);
    await coordinator.close();
  });

  it("rejects cancellation without a Coordinator subscription ID", async () => {
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );

    await expect(client.cancel(create(SubscriptionSchema))).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
  });

  it("bounds Coordinator close when a native activation ignores abort", async () => {
    vi.useFakeTimers();
    const replica = await backend("close-ignores-abort", {
      ignoreActivationAbort: true,
      observeActivationAbort: true,
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const updates = client.activate(subscription)[Symbol.asyncIterator]();
    await expect(updates.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    const pending = updates.next().then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(replica.activations()).toBe(1);
    });

    const closing = coordinator.close();
    const complete = expect(closing).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await complete;
    await expect(pending).resolves.toMatchObject({ code: Code.Canceled });
    expect(replica.activationAborts()).toBe(1);
    vi.useRealTimers();
  }, 5_000);

  it("cancels an active public iterator from a second client", async () => {
    const replica = await backend("cancel-second-client", { holdActivation: true });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    const subscription = await createClient(SubscriptionService, transport).subscribe(
      coordinatorTopic(),
    );
    const iterator = createClient(SubscriptionService, transport)
      .activate(subscription)
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    const pending = iterator.next();
    await expect.poll(() => replica.activations()).toBe(1);

    await createClient(SubscriptionService, transport).cancel(subscription);
    await expect(pending).resolves.toMatchObject({ done: true });
    await expect.poll(() => replica.activationAborts()).toBe(1);
  });

  it("releases a queued update producer when the public stream aborts after ACK", async () => {
    const replica = await backend("queued-return", {
      updates: 1,
      holdActivation: true,
      observeActivationAbort: true,
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const controller = new AbortController();
    const iterator = client
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: Code.Canceled });
    await expect.poll(() => replica.cancellations()).toBe(1);
    await expect.poll(() => replica.activationAborts()).toBeGreaterThan(0);
  });

  it("requires a new Subscribe after an aborted native activation removes its definition", async () => {
    const release = deferred<undefined>();
    const replica = await backend("reconnect-held", {
      holdActivation: true,
      releaseActivation: release.promise,
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const firstAbort = new AbortController();
    const firstUpdates = client
      .activate(subscription, { signal: firstAbort.signal })
      [Symbol.asyncIterator]();
    await expect(firstUpdates.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    const first = firstUpdates.next();
    await expect.poll(() => replica.activations()).toBe(1);
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ code: Code.Canceled });
    await expect.poll(() => replica.cancellations()).toBe(1);
    release.resolve(undefined);
    const replacement = await client.subscribe(coordinatorTopic());
    const second = client.activate(replacement)[Symbol.asyncIterator]();
    await expect(second.next()).resolves.toMatchObject({
      value: { response: { status: { status: { case: "ok" } } } },
    });
    await expect.poll(() => replica.activations()).toBe(2);
    await second.return?.();
  });

  it("aborts a stalled native stream when merged updates exceed the existing bound", async () => {
    const replica = await backend("overflow", { updates: 102, observeActivationAbort: true });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const subscription = await client.subscribe(coordinatorTopic());
    const controller = new AbortController();
    const iterator = client
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      expect(first.done).toBe(false);
      await expect.poll(() => replica.activationAborts()).toBe(1);
    } finally {
      controller.abort();
      await iterator.return?.();
    }
  });

  it("installs retained definitions on a late replica before it enters unary selection", async () => {
    const current = await backend("current");
    const joining = await backend("joining");
    closeables.push(current.close, joining.close);
    const members = new TestReadyMembers([current.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());
    const subscriptions = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    await subscriptions.subscribe(coordinatorTopic());

    members.set([current.member, joining.member]);
    await expect.poll(() => joining.subscriptions()).toBe(1);

    const commands = createClient(
      CommandService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    await commands.post(create(CommandService.method.post.input));
    await commands.post(create(CommandService.method.post.input));
    expect(joining.commands()).toBe(1);
    await coordinator.close();
  });

  it("keeps a joining replica out of unary selection while its retained subscription installs", async () => {
    const releaseSubscription = deferred<undefined>();
    const subscriptionStarted = deferred<undefined>();
    const current = await backend("current");
    const joining = await backend("joining", {
      subscribeGate: releaseSubscription.promise,
      subscriptionStarted,
    });
    const members = new TestReadyMembers([current.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(async () => {
      await coordinator.close();
      await Promise.all([current.close(), joining.close()]);
    });
    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    await createClient(SubscriptionService, transport).subscribe(coordinatorTopic());

    members.setReady([current.member], [current.member, joining.member]);
    await subscriptionStarted.promise;

    try {
      const commands = createClient(CommandService, transport);
      await commands.post(create(CommandService.method.post.input));
      await commands.post(create(CommandService.method.post.input));
      expect(current.commands()).toBe(2);
      expect(joining.commands()).toBe(0);

      releaseSubscription.resolve(undefined);
      members.set([current.member, joining.member]);
      await expect
        .poll(async () => {
          await commands.post(create(CommandService.method.post.input));
          return joining.commands();
        })
        .toBe(1);
    } finally {
      releaseSubscription.resolve(undefined);
    }
  });

  it("removes a draining child from unary admission while retaining its subscription relay", async () => {
    const draining = await backend("draining");
    closeables.push(draining.close);
    const members = new TestReadyMembers([draining.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());
    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    await createClient(SubscriptionService, transport).subscribe(coordinatorTopic());
    expect(draining.subscriptions()).toBe(1);

    members.setReady([], [draining.member]);

    await expect(
      createClient(CommandService, transport).post(create(CommandService.method.post.input)),
    ).rejects.toMatchObject({ code: Code.Unavailable });
    expect(draining.subscriptions()).toBe(1);
    members.setReady([], []);
    await expect.poll(() => draining.cancellations()).toBe(1);
  });

  it("rejects new subscription work after drain while allowing Cancel", async () => {
    const replica = await backend("drain-subscriptions");
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const client = createClient(
      SubscriptionService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );
    const topic = create(TopicSchema, {
      id: { value: "drain-topic" },
      target: coordinatorTarget(),
      context: create(ActorContextSchema, {
        actor: { value: "actor" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
      }),
    });
    const accepted = await client.subscribe(topic);

    await coordinator.beginDrain();

    await expect(client.subscribe(topic)).rejects.toMatchObject({ code: Code.Unavailable });
    await expect(client.activate(accepted)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: Code.Unavailable,
    });
    await expect(client.cancel(accepted)).resolves.toBeDefined();
    expect(replica.subscriptions()).toBe(1);
    await expect.poll(() => replica.cancellations()).toBe(1);
  });

  it("reconciles replacement membership without exposing or polling child topology", async () => {
    const first = await backend("first");
    const replacement = await backend("replacement");
    closeables.push(first.close, replacement.close);
    const members = new TestReadyMembers([first.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());
    const client = createClient(
      CommandService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );

    await client.post(create(CommandService.method.post.input));
    members.set([replacement.member]);
    await expect
      .poll(async () => {
        await client.post(create(CommandService.method.post.input));
        return replacement.commands();
      })
      .toBe(1);
    expect(first.commands()).toBe(1);
  });

  it("does not retry an admitted command after the selected child fails", async () => {
    const failing = await backend("failing", {
      post: () => Promise.reject(new ConnectError("child lost", Code.Unavailable)),
    });
    const sibling = await backend("sibling");
    closeables.push(failing.close, sibling.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([failing.member, sibling.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).post(
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: Code.Unavailable });
    expect(failing.commands()).toBe(1);
    expect(sibling.commands()).toBe(0);
  });

  it("propagates cancellation and application metadata to the selected child", async () => {
    let aborted = false;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const replica = await backend("cancel", {
      post: (context) =>
        new Promise((_, reject) => {
          startedResolve?.();
          context.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new ConnectError("cancelled", Code.Canceled));
            },
            { once: true },
          );
          context.responseHeader.set("x-child", context.requestHeader.get("x-tenant") ?? "missing");
          context.responseTrailer.set("x-trailer", "child");
        }),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const controller = new AbortController();
    const request = createGrpcTransport({ baseUrl: coordinator.baseUrl }).unary(
      CommandService.method.post,
      controller.signal,
      undefined,
      { "x-tenant": "acme" },
      create(CommandService.method.post.input),
    );
    await started;
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: Code.Canceled });
    await expect.poll(() => aborted).toBe(true);
  });

  it("preserves application metadata and downstream response headers and trailers", async () => {
    const replica = await backend("metadata", {
      post: (context) => {
        context.responseHeader.set("x-child", context.requestHeader.get("x-tenant") ?? "missing");
        context.responseTrailer.set("x-trailer", "child");
        return create(AckSchema, {
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        });
      },
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    const response = await createGrpcTransport({ baseUrl: coordinator.baseUrl }).unary(
      CommandService.method.post,
      undefined,
      undefined,
      { "x-tenant": "acme" },
      create(CommandService.method.post.input),
    );
    expect(response.header.get("x-child")).toBe("acme");
    expect(response.trailer.get("x-trailer")).toBe("child");
  });

  it("forwards the remaining deadline to the selected child", async () => {
    let deadlineObserved = false;
    const replica = await backend("deadline", {
      post: (context) =>
        new Promise((_, reject) => {
          context.signal.addEventListener(
            "abort",
            () => {
              deadlineObserved = true;
              reject(new ConnectError("deadline", Code.DeadlineExceeded));
            },
            { once: true },
          );
        }),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createGrpcTransport({ baseUrl: coordinator.baseUrl, defaultTimeoutMs: 20 }).unary(
        CommandService.method.post,
        undefined,
        undefined,
        undefined,
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: Code.DeadlineExceeded });
    await expect.poll(() => deadlineObserved).toBe(true);
  });

  it("enforces configured inbound and outbound message bounds at the Coordinator", async () => {
    const replica = await backend("bounds");
    closeables.push(replica.close);
    const request = create(CommandService.method.post.input, {
      id: create(CommandIdSchema, { uuid: "request" }),
    });
    const inbound = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
      readMaxBytes: 1,
    });
    closeables.push(() => inbound.close());
    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: inbound.baseUrl })).post(request),
    ).rejects.toBeInstanceOf(ConnectError);

    const outbound = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
      writeMaxBytes: 1,
    });
    closeables.push(() => outbound.close());
    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: outbound.baseUrl })).post(
        request,
      ),
    ).rejects.toBeInstanceOf(ConnectError);
  });

  it.each([
    [{ host: " " }, "Server host must not be blank."],
    [{ port: -1 }, "Managed server port must be a safe integer between 0 and 65535."],
    [{ port: 65_536 }, "Managed server port must be a safe integer between 0 and 65535."],
    [
      { readMaxBytes: 0 },
      "Managed server message limit must be a safe integer between 1 and 4294967295.",
    ],
  ] as const)("rejects invalid Coordinator listener configuration", async (options, message) => {
    await expect(
      NodeCoordinator.open({ members: new TestReadyMembers([]), ...options }),
    ).rejects.toThrow(message);
  });

  it("closes idempotently after membership reconciliation", async () => {
    const replica = await backend("close");
    closeables.push(replica.close);
    const members = new TestReadyMembers([replica.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    const first = coordinator.close();
    expect(coordinator.close()).toBe(first);
    members.set([]);
    await expect(first).resolves.toBeUndefined();
  });

  it("clears pending activation deadlines during close", async () => {
    vi.useFakeTimers();
    try {
      const replica = await backend("close-pending");
      closeables.push(replica.close);
      const coordinator = await NodeCoordinator.open({
        members: new TestReadyMembers([replica.member]),
        port: 0,
      });
      const subscriptions = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: coordinator.baseUrl }),
      );
      await subscriptions.subscribe(coordinatorTopic());

      await coordinator.close();
      const cancellationsAfterClose = replica.cancellations();
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS * 2);

      expect(replica.cancellations()).toBe(cancellationsAfterClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back a listener-open failure without retaining a second coordinator", async () => {
    const first = await NodeCoordinator.open({ members: new TestReadyMembers([]), port: 0 });
    closeables.push(() => first.close());
    await expect(
      NodeCoordinator.open({
        members: new TestReadyMembers([]),
        host: first.host,
        port: first.port,
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("formats an IPv6 listener endpoint as a valid Connect base URL", async () => {
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([]),
      host: "::1",
      port: 0,
    });
    closeables.push(() => coordinator.close());

    expect(coordinator.baseUrl).toMatch(/^http:\/\/\[::1\]:\d+$/);
  });

  it("bounds close for an active child call by closing the public HTTP2 session", async () => {
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const replica = await backend("drain", {
      post: () =>
        new Promise(() => {
          enteredResolve?.();
        }),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    const request = createClient(
      CommandService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    ).post(create(CommandService.method.post.input));
    void request.catch(() => undefined);
    await entered;
    await expect(coordinator.close()).resolves.toBeUndefined();
    await expect(request).rejects.toBeInstanceOf(ConnectError);
  }, 5_000);
});

describe("SubscriptionUpdateQueue", () => {
  it("closes terminally on overflow, resolves blocked producers, and ignores later updates", async () => {
    let overflowed = false;
    const queue = new SubscriptionUpdateQueue(1, () => {
      overflowed = true;
    });
    const first = queue.push(create(SubscriptionUpdateSchema));
    await queue.push(create(SubscriptionUpdateSchema));
    await expect(first).resolves.toBeUndefined();
    await expect(queue[Symbol.asyncIterator]().next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await expect(queue.push(create(SubscriptionUpdateSchema))).resolves.toBeUndefined();
    expect(overflowed).toBe(true);
  });

  it("delivers directly to an awaiting consumer", async () => {
    const queue = new SubscriptionUpdateQueue(1);
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    const update = create(SubscriptionUpdateSchema);
    await expect(queue.push(update)).resolves.toBeUndefined();
    await expect(pending).resolves.toEqual({ value: update, done: false });
    queue.close();
  });
});

class TestReadyMembers implements ReadyMemberSource {
  readonly #listeners = new Set<() => void>();
  #childActivations = 0;

  #members: readonly ReadyMember[];
  #relays: readonly ReadyMember[];

  constructor(members: readonly ReadyMember[]) {
    this.#members = members;
    this.#relays = members;
  }

  relayMembers(): readonly ReadyMember[] {
    return this.#relays;
  }

  onRelayMembersChange(onChange: () => void): () => void {
    return this.onReadyMembersChange(onChange);
  }

  readyMembers(): readonly ReadyMember[] {
    return this.#members;
  }

  onReadyMembersChange(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  onChildSubscriptionActivated(): void {
    this.#childActivations++;
  }

  childActivations(): number {
    return this.#childActivations;
  }

  set(members: readonly ReadyMember[]): void {
    this.setReady(members, members);
  }

  setReady(members: readonly ReadyMember[], relays: readonly ReadyMember[]): void {
    this.#members = members;
    this.#relays = relays;
    for (const listener of this.#listeners) listener();
  }
}

interface ReadyMember {
  readonly endpoint: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly slot: number;
}

function dynamicOwner(endpoint: string): DynamicUnaryForwarder {
  return new DynamicUnaryForwarder({
    create: () => Promise.resolve(dynamicCoordinatorClient(endpoint)),
  });
}

function dynamicCoordinatorClient(endpoint: string): DynamicUnaryClient {
  const native = new NativeSubscriptionCreator(createGrpcTransport({ baseUrl: endpoint }));
  return {
    forward: native.forward.bind(native),
    subscribe: native.subscribe.bind(native),
    activate: native.activate.bind(native),
    cancel: native.cancel.bind(native),
    dispose: native.dispose.bind(native),
    close: () => Promise.resolve(),
  };
}

function coordinatorTarget() {
  return create(TargetSchema, {
    type: TypeUrls.derive(ProjectOverviewStateSchema),
    criterion: { case: "includeAll", value: true },
  });
}

function coordinatorActorContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "actor" }),
    timestamp: create(TimestampSchema, { seconds: 1n }),
  });
}

function coordinatorTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "topic" }),
    target: coordinatorTarget(),
    context: coordinatorActorContext(),
  });
}

function coordinatorQuery() {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query" }),
    target: coordinatorTarget(),
    context: coordinatorActorContext(),
  });
}

function trustedTopic(): Uint8Array {
  return toBinary(
    TopicSchema,
    create(TopicSchema, {
      id: { value: "topic" },
      target: coordinatorTarget(),
      context: create(ActorContextSchema, {
        actor: { value: "actor" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
      }),
    }),
  );
}

async function backend(
  name: string,
  options: {
    readonly post?: (context: HandlerContext) => Promise<never> | MessageShape<typeof AckSchema>;
    readonly read?: (
      context: HandlerContext,
    ) => Promise<never> | MessageShape<typeof QueryResponseSchema>;
    readonly updates?: number;
    readonly mismatchedActivationAck?: boolean;
    readonly holdActivation?: boolean;
    readonly ignoreActivationAbort?: boolean;
    readonly releaseActivation?: Promise<void>;
    readonly observeActivationAbort?: boolean;
    readonly cancelFailures?: number;
    readonly subscribeGate?: Promise<undefined>;
    readonly subscriptionStarted?: { readonly resolve: (value: undefined) => void };
    readonly activateError?: ConnectError;
  } = {},
): Promise<{
  readonly member: ReadyMember;
  readonly close: () => Promise<void>;
  readonly commands: () => number;
  readonly subscriptions: () => number;
  readonly cancellations: () => number;
  readonly activations: () => number;
  readonly activationAborts: () => number;
}> {
  const value = {
    commands: 0,
    subscriptions: 0,
    cancellations: 0,
    activations: 0,
    activationAborts: 0,
  };
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        router.service(CommandService, {
          post: (_command, context) => {
            value.commands++;
            if (options.post !== undefined) return options.post(context);
            return create(AckSchema, {
              status: create(StatusSchema, { status: { case: "ok", value: {} } }),
            });
          },
        });
        router.service(QueryService, {
          read: (_query, context): MessageShape<typeof QueryResponseSchema> | Promise<never> =>
            options.read?.(context) ?? create(QueryResponseSchema),
        });
        router.service(SubscriptionService, {
          subscribe: (topic) => {
            value.subscriptions++;
            options.subscriptionStarted?.resolve(undefined);
            const subscription = create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: `${name}-native` }),
              topic,
            });
            return options.subscribeGate?.then(() => subscription) ?? subscription;
          },
          activate: async function* (subscription, context) {
            value.activations++;
            if (options.activateError !== undefined) throw options.activateError;
            if (options.observeActivationAbort)
              context.signal.addEventListener(
                "abort",
                () => {
                  value.activationAborts++;
                },
                { once: true },
              );
            yield create(SubscriptionUpdateSchema, {
              subscription: options.mismatchedActivationAck
                ? create(SubscriptionSchema, {
                    id: create(SubscriptionIdSchema, { value: `${name}-foreign` }),
                    topic: subscription.topic,
                  })
                : subscription,
              response: create(ResponseSchema, {
                status: create(StatusSchema, { status: { case: "ok", value: {} } }),
              }),
            });
            for (let update = 0; update < (options.updates ?? 0); update += 1)
              yield create(SubscriptionUpdateSchema, {
                subscription,
                response: create(ResponseSchema, {
                  status: create(StatusSchema, { status: { case: "ok", value: {} } }),
                }),
                update: {
                  case: "eventUpdates",
                  value: create(EventUpdatesSchema, {
                    event: [coordinatorEvent(subscription.id?.value ?? name, update)],
                  }),
                },
              });
            if (options.ignoreActivationAbort) await new Promise<void>(() => undefined);
            if (options.holdActivation)
              await new Promise<void>((resolve) => {
                if (context.signal.aborted) {
                  resolve();
                  return;
                }
                context.signal.addEventListener(
                  "abort",
                  () => {
                    value.activationAborts++;
                    resolve();
                  },
                  { once: true },
                );
                void options.releaseActivation?.then(resolve);
              });
          },
          cancel: () => {
            value.cancellations++;
            if (value.cancellations <= (options.cancelFailures ?? 0))
              throw new ConnectError("native cancellation failed", Code.Unavailable);
            return create(SubscriptionService.method.cancel.output);
          },
        });
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  return {
    member: {
      slot: value.commands,
      incarnation: name,
      pid: 1,
      endpoint: `http://127.0.0.1:${address.port.toString()}`,
    },
    commands: () => value.commands,
    subscriptions: () => value.subscriptions,
    cancellations: () => value.cancellations,
    activations: () => value.activations,
    activationAborts: () => value.activationAborts,
    close,
  };
}

function coordinatorEvent(target: string, index: number) {
  const id = create(TaskIdSchema, { value: `${target}-${index.toString()}` });
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${target}-${index.toString()}` }),
    context: create(EventContextSchema, { producerId: AnyPacker.pack(TaskIdSchema, id) }),
    message: AnyPacker.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id,
        title: `Task ${index.toString()}`,
        taskListId: create(TaskListIdSchema, { value: `list-${target}` }),
      }),
    ),
  });
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
