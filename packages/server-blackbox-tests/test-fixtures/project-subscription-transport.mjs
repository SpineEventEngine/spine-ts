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

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import http2 from "node:http2";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { create, toBinary } from "@bufbuild/protobuf";
import { AnyPacker, StringifierRegistry, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import {
  QueryIdSchema,
  QuerySchema,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { EventSchema, UserIdSchema } from "@spine-event-engine/proto";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { EnvironmentType, ServerEnvironment, SpineServices } from "@spine-event-engine/server";
import { BrowserServer } from "@spine-event-engine/server/browser";
import { NodeCoordinator } from "@spine-event-engine/server-test-fixtures/internal";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";

import { Client as NodeClient } from "@spine-event-engine/client-node";
import { Client as WebClient } from "@spine-event-engine/client-web";
import { CreateProjectSchema } from "../dist/generated/spine/server/testing/project_commands_pb.js";
import { ProjectCreatedSchema } from "../dist/generated/spine/server/testing/project_events_pb.js";
import {
  OrganizationIdSchema,
  PlanningIdSchema,
  PlanningStateSchema,
  PortfolioIdSchema,
  PortfolioStateSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
  ProjectStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflow, projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";
import { waitUntil } from "./project-subscription-wait.mjs";

import { sqlProvider, sqlRunDirectory } from "./sql-run-config.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const providerName = process.argv[2];
const protocol = process.argv[3] ?? "native";
const scenario = process.argv[4] ?? "basic";
const deliveryMode = process.argv[5] ?? "db-only";
assert.ok(["native", "grpc-web", "connect"].includes(protocol));
assert.ok(
  !(scenario === "child-fanout-fault" && protocol === "native"),
  "Native direct transport has no browser gateway child fanout; use coordinator-fanout-fault.",
);
assert.ok(
  [
    "basic",
    "cancel-retry",
    "pending-cancel",
    "concurrent-teardown",
    "stream-reconnect",
    "child-stream-fault",
    "child-stream-eof",
    "child-fanout-fault",
    "child-retry-exhaustion",
    "child-retry-cancel",
    "coordinator-child-fault",
    "coordinator-fanout-fault",
    "coordinator-retry-exhaustion",
    "coordinator-retry-cancel",
    "partial-activation-failure",
    "cancel-publication-race",
    "duplicate-ack-terminal",
  ].includes(scenario),
);
assert.ok(["db-only", "shared-memory"].includes(deliveryMode));
const provider = sqlProvider(providerName);
const postgres = provider.engine === "postgres";
const runId = randomUUID().replaceAll("-", "");
const database = `sqlrel_sub_${runId}`;
const evidencePath = await sqlRunDirectory("transport");
const artifactPaths = [
  "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
  "packages/server/dist/index.js",
  "packages/server/dist/server/node-coordinator.js",
  "packages/deployment/dist/internal/backend-membership-kernel.js",
  "packages/proto/dist/src/index.js",
  "packages/storage-postgres/dist/index.js",
  "packages/storage-mysql/dist/index.js",
  "packages/client-node/dist/index.js",
  "packages/client-web/dist/index.js",
  "packages/delivery-server/dist/index.js",
];
const artifacts = await Promise.all(
  artifactPaths.map(async (path) => ({
    path: resolve(root, path),
    sha256: createHash("sha256")
      .update(await readFile(resolve(root, path)))
      .digest("hex"),
  })),
);
const resource = {
  runId,
  database,
  evidencePath,
  pid: process.pid,
  providerName,
  protocol,
  scenario,
  deliveryMode,
  artifacts,
};
await writeFile(resolve(evidencePath, "resource.json"), `${JSON.stringify(resource, null, 2)}\n`);
process.stdout.write(`TRANSPORT_RESOURCE ${JSON.stringify(resource)}\n`);
const requireProvider = createRequire(
  resolve(root, `packages/${postgres ? "storage-postgres" : "storage-mysql"}/package.json`),
);
const admin = postgres
  ? new (requireProvider("pg").Client)({ connectionString: provider.urls.spine_test })
  : await requireProvider("mysql2/promise").createConnection(provider.urls.spine_test);
const quotedDatabase = postgres ? `"${database}"` : `\`${database}\``;
let factory;
let context;
let server;
let secondaryServer;
let browser;
let coordinator;
let coordinatorChildActivations = 0;
let client;
let deliveryServer;
let remoteDelivery;
let streamProxy;
let created = false;
let failure;
let result;
const sessions = new Set();
const entries = [];
const subscriptionTrace = [];
const secondaryTrace = [];
const serverEventTrace = [];
const gate = Promise.withResolvers();
const entered = Promise.withResolvers();
const failSecondary = Promise.withResolvers();
const cancelEntered = Promise.withResolvers();
const finishCancel = Promise.withResolvers();
const termination = Promise.withResolvers();
void termination.promise.catch(() => undefined);
process.once("SIGTERM", () => termination.reject(new Error("Transport fixture received SIGTERM.")));
const counters = {
  subscribe: 0,
  activate: 0,
  ackReleased: 0,
  cancel: 0,
  cancelFaults: 0,
  cancelSuccesses: 0,
  streamFaults: 0,
  iterators: 0,
};
const secondaryCounters = { subscribe: 0, activate: 0, ackReleased: 0, cancel: 0, iterators: 0 };

try {
  if (postgres) await admin.connect();
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  created = true;
  const databaseUrl = new URL(provider.urls.spine_test);
  databaseUrl.pathname = `/${database}`;
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(
    new TypeRegistry([
      OrganizationIdSchema,
      ProjectIdSchema,
      PlanningIdSchema,
      StaffingIdSchema,
      PortfolioIdSchema,
      CreateProjectSchema,
      ProjectCreatedSchema,
      ProjectStateSchema,
      PlanningStateSchema,
      StaffingStateSchema,
      PortfolioStateSchema,
      ProjectProjectionStateSchema,
    ]),
  );
  const Factory = postgres ? PostgresStorageFactory : MysqlStorageFactory;
  factory = await Factory.newBuilder()
    .setOptions({ url: databaseUrl.href })
    .setStringifierRegistry(stringifiers)
    .build();
  if (deliveryMode === "shared-memory") {
    deliveryServer = await new DeliveryServer({ port: 0 }).start();
    remoteDelivery = RemoteDelivery.connectTo({ endpoint: deliveryServer.baseUrl });
  }
  ServerEnvironment.when(EnvironmentType.Local).use({
    storageFactory: factory,
    ...(remoteDelivery === undefined ? {} : { delivery: remoteDelivery }),
  });
  await ServerEnvironment.instance().completeSetup();
  const organization = `subscription-${database}`;
  const ids = projectWorkflowIds(organization, 1);
  context = projectWorkflow(
    `ProjectSubscription_${database}`,
    (entry) => entries.push(entry),
  );
  const services = new SpineServices({ contexts: [context] });
  server = http2.createServer(
    connectNodeAdapter({
      routes: (router) =>
        services.register({
          service(schema, implementation) {
            if (schema !== SubscriptionService) return router.service(schema, implementation);
            return router.service(schema, {
              ...implementation,
              subscribe: async (topic) => {
                counters.subscribe++;
                const accepted = await implementation.subscribe(topic);
                subscriptionTrace.push({ operation: "subscribe", id: accepted.id?.value });
                return accepted;
              },
              activate: async function* (subscription) {
                counters.activate++;
                subscriptionTrace.push({ operation: "activate", id: subscription.id?.value });
                counters.iterators++;
                try {
                  let first = true;
                  for await (const update of implementation.activate(subscription)) {
                    if (
                      scenario === "cancel-publication-race" &&
                      update.update.case === "eventUpdates"
                    ) {
                      for (const event of update.update.value.event) {
                        const message = AnyPacker.tryUnpack(event.message, ProjectCreatedSchema);
                        serverEventTrace.push({
                          subscriptionId: subscription.id?.value,
                          eventId: event.id?.value,
                          projectNumber: message?.project?.number,
                          sha256: createHash("sha256")
                            .update(toBinary(EventSchema, event))
                            .digest("hex"),
                        });
                      }
                    }
                    const firstResponse = first;
                    if (first) {
                      first = false;
                      entered.resolve();
                      await gate.promise;
                      counters.ackReleased++;
                    }
                    yield update;
                    if (firstResponse && scenario === "duplicate-ack-terminal") yield update;
                    if (
                      firstResponse &&
                      ([
                        "child-stream-fault",
                        "child-stream-eof",
                        "child-fanout-fault",
                        "child-retry-exhaustion",
                        "child-retry-cancel",
                        "coordinator-child-fault",
                        "coordinator-fanout-fault",
                        "coordinator-retry-exhaustion",
                        "coordinator-retry-cancel",
                      ].includes(scenario) ||
                        (scenario === "stream-reconnect" && protocol === "native")) &&
                      (["child-retry-exhaustion", "coordinator-retry-exhaustion"].includes(
                        scenario,
                      ) ||
                        counters.streamFaults === 0)
                    ) {
                      counters.streamFaults++;
                      if (scenario === "child-stream-eof") return;
                      throw new ConnectError(
                        "injected retryable Activate stream fault",
                        Code.Unavailable,
                      );
                    }
                  }
                } finally {
                  counters.iterators--;
                }
              },
              cancel: async (subscription) => {
                counters.cancel++;
                subscriptionTrace.push({ operation: "cancel", id: subscription.id?.value });
                if (scenario === "cancel-publication-race" && counters.cancel === 1) {
                  cancelEntered.resolve();
                  await finishCancel.promise;
                }
                if (scenario === "partial-activation-failure" && counters.cancelFaults === 0) {
                  counters.cancelFaults++;
                  subscriptionTrace.push({
                    operation: "cancel-failed",
                    id: subscription.id?.value,
                  });
                  throw new ConnectError("injected partial cleanup failure", Code.Unavailable);
                }
                if (scenario === "cancel-retry" && counters.cancelFaults === 0) {
                  counters.cancelFaults++;
                  throw new ConnectError("injected transient Cancel failure", Code.Unavailable);
                }
                const response = await implementation.cancel(subscription);
                counters.cancelSuccesses++;
                subscriptionTrace.push({
                  operation: "cancel-succeeded",
                  id: subscription.id?.value,
                });
                return response;
              },
            });
          },
        }),
    }),
  );
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${String(address.port)}`;
  let secondaryEndpoint;
  if (
    ["child-fanout-fault", "coordinator-fanout-fault", "partial-activation-failure"].includes(
      scenario,
    )
  ) {
    secondaryServer = http2.createServer(
      connectNodeAdapter({
        routes: (router) =>
          services.register({
            service(schema, implementation) {
              if (schema !== SubscriptionService) return router.service(schema, implementation);
              return router.service(schema, {
                ...implementation,
                subscribe: async (topic) => {
                  secondaryCounters.subscribe++;
                  const accepted = await implementation.subscribe(topic);
                  secondaryTrace.push({ operation: "subscribe", id: accepted.id?.value });
                  return accepted;
                },
                activate: async function* (subscription) {
                  secondaryCounters.activate++;
                  secondaryTrace.push({ operation: "activate", id: subscription.id?.value });
                  secondaryCounters.iterators++;
                  try {
                    if (scenario === "partial-activation-failure") {
                      await failSecondary.promise;
                      throw new ConnectError(
                        "injected partial child Activate failure",
                        Code.Unavailable,
                      );
                    }
                    let first = true;
                    for await (const update of implementation.activate(subscription)) {
                      if (first) {
                        first = false;
                        secondaryCounters.ackReleased++;
                      }
                      yield update;
                    }
                  } finally {
                    secondaryCounters.iterators--;
                  }
                },
                cancel: async (subscription) => {
                  secondaryCounters.cancel++;
                  secondaryTrace.push({ operation: "cancel", id: subscription.id?.value });
                  return implementation.cancel(subscription);
                },
              });
            },
          }),
      }),
    );
    secondaryServer.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
    await new Promise((resolve, reject) => {
      secondaryServer.once("error", reject);
      secondaryServer.listen(0, "127.0.0.1", resolve);
    });
    const secondaryAddress = secondaryServer.address();
    assert.ok(secondaryAddress && typeof secondaryAddress !== "string");
    secondaryEndpoint = `http://127.0.0.1:${String(secondaryAddress.port)}`;
  }
  if (
    [
      "coordinator-child-fault",
      "coordinator-fanout-fault",
      "coordinator-retry-exhaustion",
      "coordinator-retry-cancel",
      "partial-activation-failure",
    ].includes(scenario)
  ) {
    const membersList = [
      { endpoint, incarnation: runId, pid: process.pid, slot: 0 },
      ...(secondaryEndpoint === undefined
        ? []
        : [{ endpoint: secondaryEndpoint, incarnation: runId, pid: process.pid, slot: 1 }]),
    ];
    const members = {
      readyMembers: () => membersList,
      relayMembers: () => membersList,
      onReadyMembersChange: () => () => undefined,
      onRelayMembersChange: () => () => undefined,
      onChildSubscriptionActivated: () => {
        coordinatorChildActivations++;
      },
    };
    coordinator = await NodeCoordinator.open({ members, port: 0 });
  }
  const coordinatorEndpoint = coordinator?.baseUrl ?? endpoint;
  if (protocol !== "native") {
    browser = await BrowserServer.open(undefined, {
      backend:
        secondaryEndpoint === undefined || coordinator !== undefined
          ? { baseUrl: coordinatorEndpoint }
          : { baseUrls: [endpoint, secondaryEndpoint] },
      host: "127.0.0.1",
      port: 0,
      production: false,
      origins: ["http://127.0.0.1:5173"],
      publicAccess: true,
      authorize: () => Promise.resolve(true),
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "guest" }),
            timestamp: create(TimestampSchema),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "guest" }),
            timestamp: create(TimestampSchema),
          }),
      },
      clock: { now: () => create(TimestampSchema) },
    });
  }
  if (protocol !== "native" && ["stream-reconnect", "duplicate-ack-terminal"].includes(scenario)) {
    streamProxy = await streamFaultProxy(browser.baseUrl, counters, scenario);
  }
  const browserEndpoint = streamProxy?.baseUrl ?? browser?.baseUrl;
  const retryOptions = [
    "child-retry-exhaustion",
    "child-retry-cancel",
    "coordinator-retry-exhaustion",
    "coordinator-retry-cancel",
    "partial-activation-failure",
  ].includes(scenario)
    ? {
        subscriptions: {
          retryPolicy: {
            maxAttempts: scenario === "partial-activation-failure" ? 1 : 2,
            maxElapsedMs: 5_000,
            delayMs: () =>
              ["child-retry-cancel", "coordinator-retry-cancel"].includes(scenario) ? 500 : 50,
          },
        },
      }
    : {};
  client =
    protocol === "native"
      ? NodeClient.connectTo(coordinatorEndpoint, retryOptions)
      : protocol === "grpc-web"
        ? WebClient.forGrpcWeb(browserEndpoint, {
            ...retryOptions,
            onRequestMetadata: () => ({ origin: "http://127.0.0.1:5173" }),
          })
        : WebClient.forConnect(browserEndpoint, {
            ...retryOptions,
            onRequestMetadata: () => ({ origin: "http://127.0.0.1:5173" }),
          });
  const subscription = await client.asGuest().createSubscription(
    create(TopicSchema, {
      id: create(TopicIdSchema, { value: `topic-${database}` }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ProjectCreatedSchema),
        criterion: { case: "includeAll", value: true },
      }),
    }),
    { kind: "event" },
  );
  let activated = false;
  const activation = subscription.activate().then(() => {
    activated = true;
  });
  const activationResult = activation.then(
    () => undefined,
    (error) => error,
  );
  await bounded(entered.promise, 10_000, "server Activate entry");
  assert.equal(activated, false, "Readiness must remain pending before the wire ACK.");
  if (scenario === "partial-activation-failure") {
    await waitUntil(
      () => secondaryCounters.activate === 1,
      5_000,
      "second child Activate entry",
      termination.promise,
    );
    assert.equal(activated, false);
    assert.equal(counters.ackReleased, 0);
    failSecondary.resolve();
    gate.resolve();
    const terminal = await bounded(activationResult, 10_000, "failed child activation");
    assert.ok(terminal instanceof ConnectError);
    assert.equal(terminal.code, Code.Unavailable);
    assert.match(terminal.message, /injected partial child Activate failure/u);
    assert.equal(counters.cancelFaults, 1);
    await bounded(subscription.cancel(), 10_000, "same-handle partial cleanup retry");
    await waitUntil(
      () => counters.cancel >= 1 && counters.iterators === 0 && secondaryCounters.iterators === 0,
      5_000,
      "partial child activation cleanup",
      termination.promise,
    );
    assert.equal(counters.subscribe, 2, "One configured retry remains finite.");
    assert.equal(secondaryCounters.subscribe, counters.subscribe);
    assert.equal(counters.activate, counters.subscribe);
    assert.equal(secondaryCounters.activate, counters.subscribe);
    assert.equal(counters.cancelSuccesses, counters.subscribe);
    assert.equal(counters.cancel, 3, "The failed Cancel is retried on the same handle.");
    const primarySubscriptions = subscriptionTrace
      .filter((item) => item.operation === "subscribe")
      .map((item) => item.id);
    const primarySucceeded = subscriptionTrace
      .filter((item) => item.operation === "cancel-succeeded")
      .map((item) => item.id);
    const primaryFailed = subscriptionTrace
      .filter((item) => item.operation === "cancel-failed")
      .map((item) => item.id);
    assert.equal(new Set(primarySubscriptions).size, 2);
    assert.deepEqual(primarySucceeded.sort(), [...primarySubscriptions].sort());
    assert.deepEqual(primaryFailed, [primarySubscriptions[0]]);
    const secondarySubscriptions = secondaryTrace
      .filter((item) => item.operation === "subscribe")
      .map((item) => item.id);
    const secondaryCancels = secondaryTrace
      .filter((item) => item.operation === "cancel")
      .map((item) => item.id);
    assert.equal(new Set(secondarySubscriptions).size, 2);
    assert.ok(
      secondarySubscriptions.every((id) => secondaryCancels.includes(id)),
      "Every admitted secondary child must receive Cancel.",
    );
    assert.ok(secondaryCancels.length >= 2 && secondaryCancels.length <= 3);
    assert.equal(entries.length, 0);
    result = {
      provider: providerName,
      protocol,
      scenario,
      deliveryMode,
      database,
      terminalName: terminal.name,
      terminalMessage: terminal.message,
      counters,
      secondaryCounters,
      subscriptionTrace,
      secondaryTrace,
      entries,
    };
  } else if (scenario === "pending-cancel") {
    const updates = subscription.updates[Symbol.asyncIterator]();
    const next = updates.next();
    const cancellation = subscription.cancel();
    await waitUntil(
      () => counters.cancel === 1,
      5_000,
      "server Cancel during held ACK",
      termination.promise,
    );
    assert.equal(counters.ackReleased, 0, "Cancel reached the server before readiness ACK.");
    gate.resolve();
    const activationError = await bounded(activationResult, 10_000, "cancelled activation");
    assert.ok(activationError instanceof Error, "Cancellation must reject pending readiness.");
    await bounded(cancellation, 10_000, "Cancel during pending activation");
    const pending = await bounded(next, 10_000, "closed pending update iterator");
    assert.equal(pending.done, true);
    assert.equal(counters.cancel, 1);
    assert.equal(counters.cancelSuccesses, 1);
    await waitUntil(
      () => counters.iterators === 0,
      5_000,
      "activation stream close",
      termination.promise,
    );
    assert.equal(counters.iterators, 0);
    assert.equal(entries.length, 0);
    result = {
      provider: providerName,
      protocol,
      scenario,
      deliveryMode,
      database,
      counters,
      entries,
      subscriptionTrace,
    };
  } else {
    if (["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario)) {
      await waitUntil(
        () => secondaryCounters.ackReleased === 1,
        5_000,
        "second child ACK before logical readiness",
        termination.promise,
      );
      assert.equal(counters.ackReleased, 0, "First child ACK remains held.");
      assert.equal(activated, false, "One child ACK cannot complete logical readiness.");
    }
    gate.resolve();
    await bounded(activation, 10_000, "validated client activation ACK");
    if (scenario === "duplicate-ack-terminal") {
      const updates = subscription.updates[Symbol.asyncIterator]();
      const terminal = await bounded(
        updates.next().then(
          () => undefined,
          (error) => error,
        ),
        5_000,
        "duplicate wire ACK protocol error",
      );
      assert.ok(terminal instanceof Error);
      assert.equal(terminal.name, "ClientProtocolError");
      await bounded(subscription.cancel(), 10_000, "terminal subscription cancellation");
      assert.equal(counters.subscribe, 1);
      assert.equal(counters.activate, 1);
      assert.equal(counters.ackReleased, 1);
      assert.equal(counters.cancelSuccesses, 1);
      assert.equal(entries.length, 0);
      result = {
        provider: providerName,
        protocol,
        scenario,
        deliveryMode,
        database,
        terminalName: terminal.name,
        terminalMessage: terminal.message,
        counters,
        entries,
      };
    } else if (["child-retry-exhaustion", "coordinator-retry-exhaustion"].includes(scenario)) {
      const updates = subscription.updates[Symbol.asyncIterator]();
      const terminal = await bounded(
        updates.next().then(
          () => undefined,
          (error) => error,
        ),
        10_000,
        "bounded child recovery exhaustion",
      );
      assert.ok(terminal instanceof Error, "Exhausted recovery must fail the update consumer.");
      assert.equal(counters.subscribe, 3);
      assert.equal(counters.activate, 3);
      assert.equal(counters.ackReleased, 3);
      assert.equal(counters.streamFaults, 3);
      assert.equal(entries.length, 0);
      result = {
        provider: providerName,
        protocol,
        scenario,
        deliveryMode,
        database,
        counters,
        entries,
        coordinator:
          coordinator === undefined
            ? undefined
            : { endpoint: coordinator.baseUrl, childActivations: coordinatorChildActivations },
      };
    } else if (["child-retry-cancel", "coordinator-retry-cancel"].includes(scenario)) {
      await waitUntil(
        () => counters.streamFaults === 1 && counters.cancel >= 1,
        5_000,
        "first failed child cleanup before retry wait",
        termination.promise,
      );
      await bounded(subscription.cancel(), 10_000, "cancel during child retry delay");
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(counters.subscribe, 1);
      assert.equal(counters.activate, 1);
      assert.equal(counters.streamFaults, 1);
      assert.equal(entries.length, 0);
      result = {
        provider: providerName,
        protocol,
        scenario,
        deliveryMode,
        database,
        counters,
        entries,
        coordinator:
          coordinator === undefined
            ? undefined
            : { endpoint: coordinator.baseUrl, childActivations: coordinatorChildActivations },
      };
    } else if (
      [
        "child-stream-fault",
        "child-stream-eof",
        "child-fanout-fault",
        "coordinator-child-fault",
        "coordinator-fanout-fault",
      ].includes(scenario)
    ) {
      await waitUntil(
        () =>
          counters.streamFaults === 1 &&
          counters.ackReleased === 2 &&
          (!["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario) ||
            secondaryCounters.ackReleased === 2),
        10_000,
        "logical reconnect after backend child stream fault",
        termination.promise,
      );
      const updates = subscription.updates[Symbol.asyncIterator]();
      const received = bounded(updates.next(), 2_000, "update after native child stream fault");
      void received.catch(() => undefined);
      const outcome = await client
        .asGuest()
        .post(
          CreateProjectSchema,
          create(CreateProjectSchema, { project: ids.project, name: "faulted-child-roadmap" }),
        );
      assert.equal(outcome.kind, "ok");
      const update = await received;
      assert.equal(update.done, false, "The logical stream must deliver after child failure.");
      assert.equal(update.value.kind, "update");
      assert.equal(update.value.update.update.case, "eventUpdates");
      assert.equal(update.value.update.update.value.event.length, 1);
      const event = update.value.update.update.value.event[0];
      assert.ok(event?.id?.value);
      const relayedEvents = [
        {
          id: event.id.value,
          sha256: createHash("sha256").update(toBinary(EventSchema, event)).digest("hex"),
        },
      ];
      const payload = AnyPacker.tryUnpack(event.message, ProjectCreatedSchema);
      assert.equal(payload?.project?.number, 1);
      assert.equal(payload?.project?.organization?.code, organization);
      assert.equal(payload?.name, "faulted-child-roadmap");
      if (["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario)) {
        const sibling = await bounded(updates.next(), 2_000, "second relayed Event update");
        assert.equal(sibling.done, false);
        assert.equal(sibling.value.kind, "update");
        assert.equal(sibling.value.update.update.case, "eventUpdates");
        assert.equal(sibling.value.update.update.value.event.length, 1);
        const siblingEvent = sibling.value.update.update.value.event[0];
        assert.ok(siblingEvent?.id?.value);
        assert.equal(siblingEvent.id.value, event.id.value);
        assert.deepEqual(toBinary(EventSchema, siblingEvent), toBinary(EventSchema, event));
        relayedEvents.push({
          id: siblingEvent.id.value,
          sha256: createHash("sha256").update(toBinary(EventSchema, siblingEvent)).digest("hex"),
        });
        const third = updates.next();
        void third.catch(() => undefined);
        const quiet = await Promise.race([
          third.then(() => false),
          new Promise((resolve) => setTimeout(() => resolve(true), 200)),
        ]);
        assert.equal(quiet, true, "Two backend subscriptions relay exactly two updates.");
        await bounded(subscription.cancel(), 10_000, "child-fault cancellation");
        assert.equal((await bounded(third, 2_000, "canceled fanout iterator")).done, true);
      } else {
        await bounded(subscription.cancel(), 10_000, "child-fault cancellation");
      }
      assert.equal(counters.subscribe, 2);
      assert.equal(counters.activate, 2);
      assert.equal(counters.cancel, 2);
      assert.equal(counters.cancelSuccesses, 2);
      assert.equal(entries.filter((entry) => entry.method === "create").length, 1);
      if (["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario))
        assert.deepEqual(secondaryCounters, {
          subscribe: 2,
          activate: 2,
          ackReleased: 2,
          cancel: 2,
          iterators: 0,
        });
      result = {
        provider: providerName,
        protocol,
        scenario,
        deliveryMode,
        database,
        counters,
        secondaryCounters,
        entries,
        subscriptionTrace,
        eventId: event.id.value,
        relayedEvents,
        coordinator:
          coordinator === undefined
            ? undefined
            : { endpoint: coordinator.baseUrl, childActivations: coordinatorChildActivations },
      };
    } else {
      if (scenario === "stream-reconnect")
        await waitUntil(
          () => counters.ackReleased === 2,
          10_000,
          "stream reconnect",
          termination.promise,
        );
      assert.equal(counters.ackReleased, scenario === "stream-reconnect" ? 2 : 1);
      const entitySubscription = await client.asGuest().createSubscription(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: `state-topic-${database}` }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(ProjectStateSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
        {
          kind: "entity",
          authoritativeQuery: () =>
            create(QuerySchema, {
              id: create(QueryIdSchema, { value: `query-${database}` }),
              target: create(TargetSchema, {
                type: TypeUrls.derive(ProjectStateSchema),
                criterion: {
                  case: "filters",
                  value: create(TargetFiltersSchema, {
                    idFilter: { id: [AnyPacker.pack(ProjectIdSchema, ids.project)] },
                  }),
                },
              }),
            }),
        },
      );
      await bounded(entitySubscription.activate(), 10_000, "validated Entity activation ACK");
      assert.equal(counters.ackReleased, scenario === "stream-reconnect" ? 3 : 2);
      const updates = subscription.updates[Symbol.asyncIterator]();
      const update = bounded(updates.next(), 15_000, "ProjectCreated event update");
      const stateUpdates = entitySubscription.updates[Symbol.asyncIterator]();
      const stateUpdate = bounded(stateUpdates.next(), 15_000, "ProjectState Entity update");
      const outcome = await client
        .asGuest()
        .post(
          CreateProjectSchema,
          create(CreateProjectSchema, { project: ids.project, name: "transport-roadmap" }),
        );
      assert.equal(outcome.kind, "ok");
      const received = await update;
      assert.equal(received.done, false);
      assert.equal(received.value.kind, "update");
      assert.equal(received.value.update.update.case, "eventUpdates");
      const event = received.value.update.update.value.event[0];
      assert.ok(event?.id?.value);
      const payload = AnyPacker.tryUnpack(event.message, ProjectCreatedSchema);
      assert.equal(payload?.project?.number, 1);
      assert.equal(payload?.project?.organization?.code, organization);
      assert.equal(payload?.name, "transport-roadmap");
      const stateReceived = await stateUpdate;
      assert.equal(stateReceived.done, false);
      assert.equal(stateReceived.value.kind, "update");
      assert.equal(stateReceived.value.update.update.case, "entityUpdates");
      const stateChange = stateReceived.value.update.update.value.update[0]?.kind;
      assert.equal(stateChange?.case, "state");
      const state = AnyPacker.tryUnpack(stateChange.value, ProjectStateSchema);
      assert.equal(state?.id?.organization?.code, organization);
      assert.equal(state?.id?.number, 1);
      assert.equal(state?.name, "transport-roadmap");
      if (scenario === "cancel-publication-race") {
        const beforeCancelUpdate = bounded(updates.next(), 15_000, "Event before Cancel");
        const secondIds = projectWorkflowIds(organization, 2);
        const beforeCancelPost = await client
          .asGuest()
          .post(
            CreateProjectSchema,
            create(CreateProjectSchema, { project: secondIds.project, name: "earlier-roadmap" }),
          );
        assert.equal(beforeCancelPost.kind, "ok");
        const earlier = await beforeCancelUpdate;
        assert.equal(earlier.done, false);
        assert.equal(earlier.value.kind, "update");
        assert.equal(earlier.value.update.update.case, "eventUpdates");
        assert.equal(earlier.value.update.update.value.event.length, 1);
        const earlierEvent = earlier.value.update.update.value.event[0];
        assert.ok(earlierEvent?.id?.value);
        assert.notEqual(earlierEvent.id.value, event.id.value);
        const earlierPayload = AnyPacker.tryUnpack(earlierEvent.message, ProjectCreatedSchema);
        assert.equal(earlierPayload?.project?.number, 2);
        assert.equal(earlierPayload?.name, "earlier-roadmap");

        const cancellation = subscription.cancel();
        await bounded(cancelEntered.promise, 5_000, "server Cancel held before removal");
        const thirdIds = projectWorkflowIds(organization, 3);
        const duringCancelPost = await client
          .asGuest()
          .post(
            CreateProjectSchema,
            create(CreateProjectSchema, { project: thirdIds.project, name: "racing-roadmap" }),
          );
        assert.equal(duringCancelPost.kind, "ok");
        await waitUntil(
          () => serverEventTrace.some((item) => item.projectNumber === 3),
          5_000,
          "racing Event yielded by server before Cancel removal",
          termination.promise,
        );
        const racingEvents = serverEventTrace.filter((item) => item.projectNumber === 3);
        assert.equal(racingEvents.length, 1);
        assert.ok(racingEvents[0].eventId);
        assert.equal(
          racingEvents[0].subscriptionId,
          subscriptionTrace.find((item) => item.operation === "subscribe")?.id,
        );
        assert.match(racingEvents[0].sha256, /^[0-9a-f]{64}$/u);
        assert.equal((await bounded(updates.next(), 2_000, "updates during Cancel")).done, true);
        finishCancel.resolve();
        await bounded(cancellation, 10_000, "held Cancel completion");
        assert.equal((await bounded(updates.next(), 2_000, "updates after Cancel")).done, true);
        const cancelledId = subscriptionTrace.find((item) => item.operation === "subscribe")?.id;
        assert.ok(cancelledId);
        const observer = await client.asGuest().createSubscription(
          create(TopicSchema, {
            id: create(TopicIdSchema, { value: `observer-${database}` }),
            target: create(TargetSchema, {
              type: TypeUrls.derive(ProjectCreatedSchema),
              criterion: { case: "includeAll", value: true },
            }),
          }),
          { kind: "event" },
        );
        await bounded(observer.activate(), 10_000, "post-Cancel observer readiness");
        const observedFourth = bounded(
          observer.updates[Symbol.asyncIterator]().next(),
          15_000,
          "Project 4 observed after Cancel",
        );
        const fourthIds = projectWorkflowIds(organization, 4);
        const afterCancelPost = await client
          .asGuest()
          .post(
            CreateProjectSchema,
            create(CreateProjectSchema, { project: fourthIds.project, name: "later-roadmap" }),
          );
        assert.equal(afterCancelPost.kind, "ok");
        const fourthUpdate = await observedFourth;
        assert.equal(fourthUpdate.done, false);
        assert.equal(fourthUpdate.value.kind, "update");
        assert.equal(fourthUpdate.value.update.update.case, "eventUpdates");
        assert.equal(fourthUpdate.value.update.update.value.event.length, 1);
        const fourthEvent = fourthUpdate.value.update.update.value.event[0];
        assert.ok(fourthEvent?.id?.value);
        assert.equal(
          AnyPacker.tryUnpack(fourthEvent.message, ProjectCreatedSchema)?.project?.number,
          4,
        );
        await bounded(observer.cancel(), 10_000, "observer cancellation");
        await bounded(entitySubscription.cancel(), 10_000, "Entity subscription cancellation");
        await waitUntil(
          () => entries.filter((entry) => entry.method === "create").length === 4,
          5_000,
          "four Project Command handler entries",
          termination.promise,
        );
        const admittedIds = subscriptionTrace
          .filter((item) => item.operation === "subscribe")
          .map((item) => item.id);
        const removedIds = subscriptionTrace
          .filter((item) => item.operation === "cancel-succeeded")
          .map((item) => item.id);
        assert.deepEqual(removedIds.sort(), [...admittedIds].sort());
        assert.equal(new Set(admittedIds).size, 3);
        const fourthYields = serverEventTrace.filter((item) => item.projectNumber === 4);
        assert.equal(fourthYields.length, 1);
        assert.equal(fourthYields[0].eventId, fourthEvent.id.value);
        assert.notEqual(fourthYields[0].subscriptionId, cancelledId);
        assert.equal(
          serverEventTrace.filter(
            (item) => item.projectNumber === 4 && item.subscriptionId === cancelledId,
          ).length,
          0,
        );
      } else if (scenario === "concurrent-teardown") {
        const cancellation = subscription.cancel();
        const duplicateCancellation = subscription.cancel();
        const entityCancellation = entitySubscription.cancel();
        const closed = client.close();
        await bounded(
          Promise.all([cancellation, duplicateCancellation, entityCancellation, closed]),
          10_000,
          "concurrent teardown",
        );
        assert.equal(counters.cancel, 2);
        assert.equal(counters.cancelSuccesses, 2);
      } else if (scenario === "cancel-retry") {
        const first = await bounded(
          subscription.cancel().then(
            () => undefined,
            (error) => error,
          ),
          10_000,
          "first transient Cancel failure",
        );
        assert.ok(first instanceof Error);
        if (protocol === "native")
          assert.match(first.message, /injected transient Cancel failure/u);
        else {
          assert.match(first.message, /internal error/u);
          assert.doesNotMatch(first.message, /injected transient Cancel failure/u);
        }
        assert.equal(counters.cancelFaults, 1);
        assert.equal(counters.cancelSuccesses, 0);
        assert.equal(counters.iterators, 2, "Failed Cancel retains the remote registration.");
        await bounded(subscription.cancel(), 10_000, "same-handle Cancel retry");
        await bounded(entitySubscription.cancel(), 10_000, "Entity cancellation");
        assert.equal(counters.cancel, 3);
        assert.equal(counters.cancelSuccesses, 2);
      } else {
        await bounded(
          Promise.all([subscription.cancel(), entitySubscription.cancel()]),
          10_000,
          "subscription cancellation",
        );
        assert.equal(counters.cancel, scenario === "stream-reconnect" ? 3 : 2);
        assert.equal(counters.cancelSuccesses, scenario === "stream-reconnect" ? 3 : 2);
      }
      if (scenario === "stream-reconnect") {
        assert.equal(counters.subscribe, 3);
        assert.equal(counters.activate, 3);
        assert.equal(counters.streamFaults, 1);
        const subscribed = subscriptionTrace
          .filter((record) => record.operation === "subscribe")
          .map((record) => record.id);
        const cancelled = subscriptionTrace
          .filter((record) => record.operation === "cancel")
          .map((record) => record.id);
        assert.equal(new Set(subscribed).size, 3);
        assert.deepEqual(cancelled.sort(), subscribed.sort());
      }
      assert.equal(counters.iterators, 0);
      assert.equal(
        entries.filter((entry) => entry.method === "create").length,
        scenario === "cancel-publication-race" ? 4 : 1,
      );
      result = {
        provider: providerName,
        protocol,
        scenario,
        deliveryMode,
        database,
        endpoint,
        browserEndpoint: browser?.baseUrl,
        eventId: event.id.value,
        stateId: state.id,
        counters,
        entries,
        subscriptionTrace,
        serverEventTrace,
      };
    }
  }
} catch (error) {
  failure = error;
} finally {
  gate.resolve();
  failSecondary.resolve();
  finishCancel.resolve();
  const cleanup = [];
  let databaseDropped = false;
  for (const action of [
    async () => client?.close(),
    async () => streamProxy?.close(),
    async () => browser?.close(),
    async () => coordinator?.close(),
    async () => context?.close(),
    async () => remoteDelivery?.close(),
    async () => deliveryServer?.close(),
    async () =>
      secondaryServer === undefined
        ? undefined
        : new Promise((resolve, reject) =>
            secondaryServer.close((error) => (error ? reject(error) : resolve())),
          ),
    async () =>
      server === undefined
        ? undefined
        : new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
    async () => factory?.close(),
    async () => {
      if (created) await admin.query(`DROP DATABASE ${quotedDatabase}`);
      databaseDropped = true;
    },
    async () => admin.end(),
  ]) {
    try {
      await bounded(action(), 10_000, "subscription fixture cleanup", true);
    } catch (error) {
      cleanup.push(error);
    }
  }
  if (sessions.size !== 0)
    cleanup.push(new Error(`${sessions.size} backend HTTP/2 sessions remain.`));
  await writeFile(
    resolve(evidencePath, "cleanup.json"),
    `${JSON.stringify({ databaseDropped, remainingSessions: sessions.size, errors: cleanup.map(String) }, null, 2)}\n`,
  );
  if (cleanup.length > 0) {
    const errors = [...(failure === undefined ? [] : [failure]), ...cleanup];
    failure = new AggregateError(errors, "SQL subscription fixture or cleanup failed.");
  }
}
await writeFile(
  resolve(evidencePath, "result.json"),
  `${JSON.stringify({ status: failure === undefined ? "PASS" : "FAIL", result, counters, secondaryCounters, entries, subscriptionTrace, error: failure === undefined ? undefined : String(failure) }, null, 2)}\n`,
);
if (failure !== undefined) throw failure;
process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);

async function bounded(work, durationMs, label, cleanup = false) {
  let timer;
  try {
    const candidates = [
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), durationMs);
      }),
    ];
    if (!cleanup) candidates.push(termination.promise);
    return await Promise.race(candidates);
  } finally {
    clearTimeout(timer);
  }
}

async function streamFaultProxy(backendBaseUrl, counters, fault) {
  const sockets = new Set();
  let injected = false;
  const proxy = http.createServer((incoming, outgoing) => {
    const target = new URL(incoming.url, backendBaseUrl);
    const forwarded = http.request(target, {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    });
    forwarded.on("response", (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      if (!target.pathname.endsWith("/Activate") || injected) {
        response.pipe(outgoing);
        return;
      }
      let firstFrame = Buffer.alloc(0);
      const onData = (chunk) => {
        firstFrame = Buffer.concat([firstFrame, chunk]);
        if (firstFrame.length < 5) return;
        const frameLength = firstFrame.readUInt32BE(1);
        if (frameLength > 1_048_576) {
          outgoing.destroy(new Error("Activation ACK frame exceeds the test proxy limit."));
          response.destroy();
          return;
        }
        if (firstFrame.length < 5 + frameLength) return;
        response.pause();
        injected = true;
        const ackFrame = firstFrame.subarray(0, 5 + frameLength);
        outgoing.write(ackFrame);
        if (fault === "duplicate-ack-terminal") {
          outgoing.write(ackFrame);
          response.off("data", onData);
          outgoing.write(firstFrame.subarray(5 + frameLength));
          response.pipe(outgoing);
          response.resume();
        } else {
          counters.streamFaults++;
          setTimeout(() => {
            response.destroy();
            outgoing.destroy();
          }, 10);
        }
      };
      response.on("data", onData);
      response.on("end", () => outgoing.end());
      response.on("error", () => outgoing.destroy());
    });
    forwarded.on("error", (error) => outgoing.destroy(error));
    incoming.pipe(forwarded);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        proxy.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
