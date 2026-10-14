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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import { AnyMessages, StringifierRegistry, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import {
  QueryIdSchema,
  QuerySchema,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { UserIdSchema } from "@spine-event-engine/proto";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { EnvironmentType, ServerEnvironment, SpineServices } from "@spine-event-engine/server";
import { BrowserServer } from "@spine-event-engine/server/browser";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";

import { Client as NodeClient } from "../../client-node/dist/index.js";
import { Client as WebClient } from "../../client-web/dist/index.js";
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

const root = fileURLToPath(new URL("../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const providerName = process.argv[2];
const protocol = process.argv[3] ?? "native";
const scenario = process.argv[4] ?? "basic";
const deliveryMode = process.argv[5] ?? "db-only";
assert.ok(["native", "grpc-web", "connect"].includes(protocol));
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
  ].includes(scenario),
);
assert.ok(["db-only", "shared-memory"].includes(deliveryMode));
const registry = JSON.parse(await readFile(resolve(task, "evidence/databases.json"), "utf8"));
const provider = registry.records.find((record) => record.name === providerName);
assert.ok(provider, `Unknown task SQL provider ${String(providerName)}.`);
const postgres = provider.engine === "postgres";
const runId = randomUUID().replaceAll("-", "");
const database = `sqlrel_sub_${runId}`;
const evidencePath = resolve(task, "evidence/transport-runs", runId);
await mkdir(evidencePath, { recursive: true });
const artifactPaths = [
  "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
  "packages/server/dist/index.js",
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
const gate = Promise.withResolvers();
const entered = Promise.withResolvers();
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
    ServerEnvironment.when(EnvironmentType.Local).use({ delivery: remoteDelivery });
    await remoteDelivery.open();
  }
  const organization = `subscription-${database}`;
  const ids = projectWorkflowIds(organization, 1);
  context = projectWorkflow(
    `ProjectSubscription_${database}`,
    (entry) => entries.push(entry),
    factory,
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
                    const firstResponse = first;
                    if (first) {
                      first = false;
                      entered.resolve();
                      await gate.promise;
                      counters.ackReleased++;
                    }
                    yield update;
                    if (
                      firstResponse &&
                      ([
                        "child-stream-fault",
                        "child-stream-eof",
                        "child-fanout-fault",
                        "child-retry-exhaustion",
                        "child-retry-cancel",
                      ].includes(scenario) ||
                        (scenario === "stream-reconnect" && protocol === "native")) &&
                      (scenario === "child-retry-exhaustion" || counters.streamFaults === 0)
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
                if (scenario === "cancel-retry" && counters.cancelFaults === 0) {
                  counters.cancelFaults++;
                  throw new ConnectError("injected transient Cancel failure", Code.Unavailable);
                }
                const response = await implementation.cancel(subscription);
                counters.cancelSuccesses++;
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
  if (scenario === "child-fanout-fault") {
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
                  return implementation.subscribe(topic);
                },
                activate: async function* (subscription) {
                  secondaryCounters.activate++;
                  secondaryCounters.iterators++;
                  try {
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
  if (protocol !== "native") {
    browser = await BrowserServer.open(undefined, {
      backend:
        secondaryEndpoint === undefined
          ? { baseUrl: endpoint }
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
  if (protocol !== "native" && scenario === "stream-reconnect") {
    streamProxy = await streamFaultProxy(browser.baseUrl, counters);
  }
  const browserEndpoint = streamProxy?.baseUrl ?? browser?.baseUrl;
  const retryOptions = ["child-retry-exhaustion", "child-retry-cancel"].includes(scenario)
    ? {
        subscriptions: {
          retryPolicy: {
            maxAttempts: 2,
            maxElapsedMs: 5_000,
            delayMs: () => (scenario === "child-retry-cancel" ? 500 : 50),
          },
        },
      }
    : {};
  client =
    protocol === "native"
      ? NodeClient.connectTo(endpoint, retryOptions)
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
  if (scenario === "pending-cancel") {
    const updates = subscription.updates[Symbol.asyncIterator]();
    const next = updates.next();
    const cancellation = subscription.cancel();
    await bounded(
      waitUntil(() => counters.cancel === 1),
      5_000,
      "server Cancel during held ACK",
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
    await bounded(
      waitUntil(() => counters.iterators === 0),
      5_000,
      "activation stream close",
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
    gate.resolve();
    await bounded(activation, 10_000, "validated client activation ACK");
    if (scenario === "child-retry-exhaustion") {
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
      };
    } else if (scenario === "child-retry-cancel") {
      await bounded(
        waitUntil(() => counters.streamFaults === 1 && counters.cancel >= 1),
        5_000,
        "first failed child cleanup before retry wait",
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
      };
    } else if (
      ["child-stream-fault", "child-stream-eof", "child-fanout-fault"].includes(scenario)
    ) {
      await bounded(
        waitUntil(
          () =>
            counters.streamFaults === 1 &&
            counters.ackReleased === 2 &&
            (scenario !== "child-fanout-fault" || secondaryCounters.ackReleased === 2),
        ),
        10_000,
        "logical reconnect after backend child stream fault",
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
      const event = update.value.update.update.value.event[0];
      assert.ok(event?.id?.value);
      const payload = AnyMessages.unpack(event.message, ProjectCreatedSchema);
      assert.equal(payload?.project?.number, 1);
      assert.equal(payload?.project?.organization?.code, organization);
      assert.equal(payload?.name, "faulted-child-roadmap");
      await bounded(subscription.cancel(), 10_000, "child-fault cancellation");
      assert.equal(counters.subscribe, 2);
      assert.equal(counters.activate, 2);
      assert.equal(counters.cancel, 2);
      assert.equal(counters.cancelSuccesses, 2);
      assert.equal(entries.filter((entry) => entry.method === "create").length, 1);
      if (scenario === "child-fanout-fault")
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
      };
    } else {
      if (scenario === "stream-reconnect")
        await bounded(
          waitUntil(() => counters.ackReleased === 2),
          10_000,
          "stream reconnect",
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
                    idFilter: { id: [AnyMessages.pack(ProjectIdSchema, ids.project)] },
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
      const payload = AnyMessages.unpack(event.message, ProjectCreatedSchema);
      assert.equal(payload?.project?.number, 1);
      assert.equal(payload?.project?.organization?.code, organization);
      assert.equal(payload?.name, "transport-roadmap");
      const stateReceived = await stateUpdate;
      assert.equal(stateReceived.done, false);
      assert.equal(stateReceived.value.kind, "update");
      assert.equal(stateReceived.value.update.update.case, "entityUpdates");
      const stateChange = stateReceived.value.update.update.value.update[0]?.kind;
      assert.equal(stateChange?.case, "state");
      const state = AnyMessages.unpack(stateChange.value, ProjectStateSchema);
      assert.equal(state?.id?.organization?.code, organization);
      assert.equal(state?.id?.number, 1);
      assert.equal(state?.name, "transport-roadmap");
      if (scenario === "concurrent-teardown") {
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
      assert.equal(entries.filter((entry) => entry.method === "create").length, 1);
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
      };
    }
  }
} catch (error) {
  failure = error;
} finally {
  gate.resolve();
  const cleanup = [];
  let databaseDropped = false;
  for (const action of [
    async () => client?.close(),
    async () => streamProxy?.close(),
    async () => browser?.close(),
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

async function waitUntil(predicate) {
  while (!predicate()) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function streamFaultProxy(backendBaseUrl, counters) {
  const sockets = new Set();
  const proxy = http.createServer((incoming, outgoing) => {
    const target = new URL(incoming.url, backendBaseUrl);
    const forwarded = http.request(target, {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    });
    forwarded.on("response", (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      if (!target.pathname.endsWith("/Activate") || counters.streamFaults !== 0) {
        response.pipe(outgoing);
        return;
      }
      let firstFrame = Buffer.alloc(0);
      response.on("data", (chunk) => {
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
        outgoing.write(firstFrame.subarray(0, 5 + frameLength));
        counters.streamFaults++;
        setTimeout(() => {
          response.destroy();
          outgoing.destroy();
        }, 10);
      });
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
