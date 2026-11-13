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

import { expect, it, vi } from "vitest";
import http2 from "node:http2";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  CommandService,
  QueryIdSchema,
  QuerySchema,
  QueryService,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";

import { Application } from "../../src/server/application.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { ServerEnvironment } from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { EnvironmentTests } from "../../src/server/environment.js";
import { spineCoreRegistry } from "@spine-event-engine/core";
import { Server } from "../../src/server/server.js";
import { AssignReviewTaskSchema } from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { CreateReviewProjectSchema } from "../../test-fixtures/generated/validation-refusal/project_commands_pb.js";
import { BrowserServer } from "../../src/browser/index.js";
import { ManagedServerApplication } from "../../src/server/managed-server-application.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { NodeCoordinator } from "../../src/server/node-coordinator.js";
import { Projection } from "../../src/entity/entity.js";
import { Repository } from "../../src/repository/repository.js";
import { ProjectOverviewStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";

class ReviewProjectProjection extends Projection<string, typeof ProjectOverviewStateSchema> {}

it("closes one endpoint while another serves the same Application", async () => {
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const first = await Server.atPort(0).setApplication(application).start();
  const second = await Server.atPort(0).setApplication(application).start();
  try {
    await first.close();
    expect(application.contexts()[0]?.stand()).toBeDefined();
    expect(second.port).toBeGreaterThan(0);
  } finally {
    await first.close();
    await second.close();
    await application.close();
  }
});

it("keeps sibling Command, state Query, and active subscription routes after endpoint close", async () => {
  const seen: string[] = [];
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(
      BoundedContext.singleTenant("ReviewProjects")
        .add(
          new Repository({
            entityType: ReviewProjectProjection,
            schema: ProjectOverviewStateSchema,
          }),
        )
        .addCommandDispatcher({
          messageSchemas: () => [CreateReviewProjectSchema],
          dispatch: (command) => {
            seen.push(command.id?.uuid ?? "missing");
            return Promise.resolve();
          },
        })
        .addEventDispatcher({
          messageSchemas: () => [EntityLog.EntityStateChangedSchema],
          dispatch: () => Promise.resolve(),
        }),
    )
    .build({ createStorageStructures: false, startSubscriptionMonitoring: true });
  const context = application.contexts()[0];
  if (context === undefined) throw new Error("Expected ReviewProjects Bounded Context.");
  const first = await Server.atPort(0).setApplication(application).start();
  const second = await Server.atPort(0).setApplication(application).start();
  const transport = createGrpcTransport({ baseUrl: second.baseUrl });
  const commands = createClient(CommandService, transport);
  const queries = createClient(QueryService, transport);
  const subscriptions = createClient(SubscriptionService, transport);
  const actor = create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "reader" }),
    timestamp: create(TimestampSchema, { seconds: 1n }),
  });
  const state = create(ProjectOverviewStateSchema, {
    id: "project-1",
    name: "Review",
    priority: 1,
  });
  try {
    const subscription = await subscriptions.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: "reviews" }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ProjectOverviewStateSchema),
          criterion: { case: "includeAll", value: true },
        }),
        context: actor,
      }),
    );
    const iterator = subscriptions.activate(subscription)[Symbol.asyncIterator]();
    const initial = await iterator.next();
    expect(initial.done).toBe(false);
    await first.close();
    const ack = await commands.post(
      create(CommandSchema, {
        id: create(CommandIdSchema, { uuid: "review-1" }),
        context: create(CommandContextSchema, { actorContext: actor }),
        message: AnyPacker.pack(
          CreateReviewProjectSchema,
          create(CreateReviewProjectSchema, { id: "project-1", name: "Review" }),
        ),
      }),
    );
    expect(ack.status?.status.case).toBe("ok");
    expect(seen).toEqual(["review-1"]);
    await context.stand().update(ProjectOverviewStateSchema, state);
    const response = await queries.read(
      create(QuerySchema, {
        id: create(QueryIdSchema, { value: "review-state" }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ProjectOverviewStateSchema),
          criterion: {
            case: "filters",
            value: create(TargetFiltersSchema, {
              idFilter: {
                id: [
                  AnyPacker.pack(
                    StringValueSchema,
                    create(StringValueSchema, { value: "project-1" }),
                  ),
                ],
              },
            }),
          },
        }),
        context: actor,
      }),
    );
    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(1);
    const packedId = AnyPacker.pack(
      StringValueSchema,
      create(StringValueSchema, { value: "project-1" }),
    );
    await boundedContextAccess.postSystemEvent(
      context,
      create(EventSchema, {
        id: create(EventIdSchema, { value: "project-state-changed" }),
        context: create(EventContextSchema, {
          producerId: AnyPacker.pack(
            StringValueSchema,
            create(StringValueSchema, { value: "review-projects" }),
          ),
        }),
        message: AnyPacker.pack(
          EntityLog.EntityStateChangedSchema,
          create(EntityLog.EntityStateChangedSchema, {
            entity: { id: packedId, typeUrl: TypeUrls.derive(ProjectOverviewStateSchema) },
            newState: AnyPacker.pack(ProjectOverviewStateSchema, state),
            signalId: [{ id: packedId, typeUrl: TypeUrls.derive(StringValueSchema) }],
          }),
        ),
      }),
    );
    let update = await iterator.next();
    while (!update.done && update.value.update.case !== "entityUpdates")
      update = await iterator.next();
    expect(update.done).toBe(false);
    if (update.done) throw new Error("Expected a projected Entity update.");
    const result = update.value;
    expect(result.update.case).toBe("entityUpdates");
    if (result.update.case !== "entityUpdates")
      throw new Error("Expected a projected Entity update.");
    const kind = result.update.value.update[0]?.kind;
    expect(kind?.case).toBe("state");
    if (kind?.case === "state")
      expect(AnyPacker.tryUnpack(kind.value, ProjectOverviewStateSchema)).toEqual(state);
    await subscriptions.cancel(subscription);
    await iterator.return?.();
  } finally {
    await first.close();
    await second.close();
    await application.close();
  }
});

it("drains an accepted Command on one endpoint while its sibling remains usable", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let dispatches = 0;
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(
      BoundedContext.singleTenant("Tasks").addCommandDispatcher({
        messageSchemas: () => [CreateReviewProjectSchema],
        dispatch: async () => {
          if (++dispatches === 1) {
            entered.resolve(undefined);
            await release.promise;
          }
        },
      }),
    )
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const first = await Server.atPort(0).setApplication(application).start();
  const second = await Server.atPort(0).setApplication(application).start();
  const command = (uuid: string) =>
    create(CommandSchema, {
      id: create(CommandIdSchema, { uuid }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "reader" }),
          timestamp: create(TimestampSchema, { seconds: 1n }),
        }),
      }),
      message: AnyPacker.pack(
        CreateReviewProjectSchema,
        create(CreateReviewProjectSchema, { id: uuid, name: "Review" }),
      ),
    });
  const client = (url: string) =>
    createClient(CommandService, createGrpcTransport({ baseUrl: url }));
  try {
    const posting = client(first.baseUrl).post(command("first"));
    void posting.then(
      (ack) => {
        entered.reject(new Error(JSON.stringify(ack.status)));
      },
      (error: unknown) => {
        entered.reject(error);
      },
    );
    void posting.catch(() => undefined);
    await entered.promise;
    const closing = first.close();
    const session = http2.connect(second.baseUrl);
    const sibling = new Promise<number | undefined>((resolve, reject) => {
      const request = session.request({ ":path": "/" });
      request.on("response", (headers) => {
        resolve(headers[":status"]);
      });
      request.on("error", reject);
      request.end();
    });
    await expect(sibling).resolves.toBeDefined();
    session.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release.resolve(undefined);
    await Promise.allSettled([posting]);
    await closing;
    expect(dispatches).toBe(1);
  } finally {
    release.resolve(undefined);
    await first.close();
    await second.close();
    await application.close();
  }
});

it("requires a successful endpoint to close before Application cleanup", async () => {
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const endpoint = await Server.atPort(0).setApplication(application).start();
  try {
    await expect(application.close()).rejects.toThrow(/endpoint/i);
    expect(application.contexts()[0]?.stand()).toBeDefined();
    const session = http2.connect(endpoint.baseUrl);
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = session.request({ ":path": "/" });
        request.on("response", (headers) => {
          resolve(headers[":status"]);
        });
        request.on("error", reject);
        request.end();
      });
      expect(status).toBeDefined();
    } finally {
      session.close();
    }
  } finally {
    await endpoint.close();
    await application.close();
  }
});

it("keeps the first endpoint serving after a second bind fails", async () => {
  const seen: string[] = [];
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(
      BoundedContext.singleTenant("ReviewProjects").addCommandDispatcher({
        messageSchemas: () => [CreateReviewProjectSchema],
        dispatch: (command) => {
          seen.push(command.id?.uuid ?? "missing");
          return Promise.resolve();
        },
      }),
    )
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const first = await Server.atPort(0).setApplication(application).start();
  try {
    await expect(
      Server.atPort(first.port).setApplication(application).start(),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    const commands = createClient(CommandService, createGrpcTransport({ baseUrl: first.baseUrl }));
    const actor = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "reader" }),
      timestamp: create(TimestampSchema, { seconds: 1n }),
    });
    const acknowledgement = await commands.post(
      create(CommandSchema, {
        id: create(CommandIdSchema, { uuid: "after-failed-bind" }),
        context: create(CommandContextSchema, { actorContext: actor }),
        message: AnyPacker.pack(
          CreateReviewProjectSchema,
          create(CreateReviewProjectSchema, { id: "project-1", name: "Review" }),
        ),
      }),
    );
    expect(acknowledgement.status?.status.case).toBe("ok");
    expect(seen).toEqual(["after-failed-bind"]);
  } finally {
    await first.close();
    await application.close();
  }
});

it("rejects duplicate Command handlers when building endpoint services", async () => {
  const dispatcher = () => ({
    messageSchemas: () => [AssignReviewTaskSchema],
    dispatch: () => Promise.resolve(),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("First").addCommandDispatcher(dispatcher()))
    .add(BoundedContext.singleTenant("Second").addCommandDispatcher(dispatcher()))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  try {
    await expect(Server.atPort(0).setApplication(application).start()).rejects.toThrow(
      /Command handler/,
    );
  } finally {
    await application.close();
  }
});

it("waits for a pending endpoint start to stop before closing Application storage", async () => {
  const storage = new InMemoryStorageFactory();
  const storageClose = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const server = Server.atPort(0)
    .setApplication(application)
    .addListenerLifecycle({
      start: () => {
        entered.resolve(undefined);
        return release.promise;
      },
      close: () => undefined,
    });
  const starting = server.start();
  await entered.promise;
  const closing = application.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(storageClose).not.toHaveBeenCalled();
  release.resolve(undefined);
  await expect(starting).rejects.toThrow(/closed/i);
  await closing;
});

it("retries failed listener cleanup before Application storage closes", async () => {
  const storage = new InMemoryStorageFactory();
  const storageClose = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  let closes = 0;
  const server = Server.atPort(0)
    .setApplication(application)
    .addListenerLifecycle({
      start: () => undefined,
      close: () => {
        if (++closes === 1) throw new Error("listener close failed");
      },
    })
    .addListenerLifecycle({
      start: () => {
        throw new Error("start failed");
      },
      close: () => undefined,
    });
  await expect(server.start()).rejects.toThrow(/lifecycle start and rollback failed/);
  expect(storageClose).not.toHaveBeenCalled();
  await application.close();
  expect(closes).toBe(2);
  expect(storageClose).toHaveBeenCalledOnce();
});

it("constructs a Production endpoint using its supplied Application environment", async () => {
  EnvironmentTests.use(EnvironmentType.Production);
  try {
    const application = await Application.newBuilder()
      .setServerEnvironment(
        ServerEnvironment.newBuilder()
          .under(EnvironmentType.Production, (setting) => {
            setting.use({ typeRegistry: spineCoreRegistry });
          })
          .build(),
      )
      .add(BoundedContext.singleTenant("Tasks"))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const endpoint = await Server.atPort(0).setApplication(application).start();
    await endpoint.close();
    await application.close();
  } finally {
    EnvironmentTests.reset();
  }
});

it("closes one run-managed Application after its final endpoint retires", async () => {
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const first = await Server.atPort(0).setApplication(application).run();
  const second = await Server.atPort(0).setApplication(application).run();
  await first.close();
  expect(application.tenantIndex()).toBeDefined();
  await second.close();
  expect(() => application.tenantIndex()).toThrow(/closed/i);
});

it("keeps a run-managed Application open for a pending sibling start", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const first = await Server.atPort(0).setApplication(application).run();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const sibling = Server.atPort(0)
    .setApplication(application)
    .addListenerLifecycle({
      start: () => {
        entered.resolve(undefined);
        return release.promise;
      },
      close: () => undefined,
    })
    .run();
  await entered.promise;
  const retirement = first.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closeStorage).not.toHaveBeenCalled();
  release.resolve(undefined);
  const second = await sibling;
  await retirement;
  expect(closeStorage).not.toHaveBeenCalled();
  await second.close();
  expect(closeStorage).toHaveBeenCalledOnce();
});

it("closes a run-managed Application after its only endpoint fails to start", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await expect(
    Server.atPort(0)
      .setApplication(application)
      .addListenerLifecycle({
        start: () => {
          throw new Error("managed start failed");
        },
        close: () => undefined,
      })
      .run(),
  ).rejects.toThrow(/managed start failed/);
  expect(closeStorage).toHaveBeenCalledOnce();
  expect(() => application.tenantIndex()).toThrow(/closed/i);
});

it("rejects mixing manual and run-managed endpoints for one Application", async () => {
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const manual = await Server.atPort(0).setApplication(application).start();
  try {
    await expect(Server.atPort(0).setApplication(application).run()).rejects.toThrow(
      /mix|managed/i,
    );
  } finally {
    await manual.close();
    await application.close();
  }
});

it("closes a run-managed browser host and its Application", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const browser = await BrowserServer.run(Server.atPort(0).setApplication(application), {
    origins: ["http://127.0.0.1:5173"],
    publicAccess: true,
    authorize: () => Promise.resolve(true),
    contexts: {
      resolve: () =>
        Promise.resolve({
          actor: create(UserIdSchema, { value: "reader" }),
          timestamp: create(TimestampSchema),
        }),
      resolveContext: () =>
        Promise.resolve({
          actor: create(UserIdSchema, { value: "reader" }),
          timestamp: create(TimestampSchema),
        }),
    },
    clock: { now: () => create(TimestampSchema) },
  });
  await browser.close();
  expect(closeStorage).toHaveBeenCalledOnce();
  expect(() => application.tenantIndex()).toThrow(/closed/i);
});

it("opens a Node Coordinator without a process ServerEnvironment singleton", async () => {
  EnvironmentTests.use(EnvironmentType.Production);
  try {
    const members = {
      readyMembers: () => [],
      relayMembers: () => [],
      onReadyMembersChange: () => () => undefined,
      onRelayMembersChange: () => () => undefined,
    };
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    await coordinator.close();
  } finally {
    EnvironmentTests.reset();
  }
});

it("closes a managed child Application when its server factory rejects", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(
      BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(
        new InMemorySubscriptionRegistry(),
      ),
    )
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const previous = process.env.SPINE_MANAGED_SERVER_CHILD;
  process.env.SPINE_MANAGED_SERVER_CHILD = "true";
  try {
    await expect(
      ManagedServerApplication.start({
        processCount: 1,
        port: 0,
        moduleUrl: import.meta.url,
        createServer: () =>
          Server.atPort(0)
            .setApplication(application)
            .addListenerLifecycle({
              start: () => {
                throw new Error("child startup failed");
              },
              close: () => undefined,
            })
            .start(),
      }),
    ).rejects.toThrow(/child startup failed/);
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(() => application.tenantIndex()).toThrow(/closed/i);
  } finally {
    if (previous === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
    else process.env.SPINE_MANAGED_SERVER_CHILD = previous;
  }
});

it("closes a successful managed child Application after its endpoint", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const previousChild = process.env.SPINE_MANAGED_SERVER_CHILD;
  const previousSend = Object.getOwnPropertyDescriptor(process, "send");
  const previousConnected = Object.getOwnPropertyDescriptor(process, "connected");
  const previousDisconnect = Object.getOwnPropertyDescriptor(process, "disconnect");
  const before = new Set(process.listeners("message"));
  const send = vi.fn((_frame: unknown, done: (error: Error | null) => void) => {
    done(null);
    return true;
  });
  Object.defineProperty(process, "send", { configurable: true, value: send });
  Object.defineProperty(process, "connected", { configurable: true, value: true });
  Object.defineProperty(process, "disconnect", { configurable: true, value: vi.fn() });
  process.env.SPINE_MANAGED_SERVER_CHILD = "true";
  let application: Application | undefined;
  try {
    const starting = ManagedServerApplication.start({
      processCount: 1,
      port: 0,
      moduleUrl: import.meta.url,
      createServer: async () => {
        application = await Application.newBuilder()
          .setServerEnvironment(
            ServerEnvironment.newBuilder()
              .under(EnvironmentType.Local, (setting) => {
                setting.use({ storageFactory: storage });
              })
              .build(),
          )
          .add(
            BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(
              new InMemorySubscriptionRegistry(),
            ),
          )
          .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
        return Server.atPort(0).setApplication(application).start();
      },
    });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "synchronizing" }),
        expect.any(Function),
      );
    });
    for (const listener of process.listeners("message")) listener({ type: "activate" }, undefined);
    const child = await starting;
    await child.close();
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(() => application?.tenantIndex()).toThrow(/closed/i);
  } finally {
    if (previousChild === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
    else process.env.SPINE_MANAGED_SERVER_CHILD = previousChild;
    for (const listener of process.listeners("message"))
      if (!before.has(listener)) process.off("message", listener);
    if (previousSend === undefined) delete (process as { send?: unknown }).send;
    else Object.defineProperty(process, "send", previousSend);
    if (previousConnected === undefined) delete (process as { connected?: unknown }).connected;
    else Object.defineProperty(process, "connected", previousConnected);
    if (previousDisconnect === undefined) delete (process as { disconnect?: unknown }).disconnect;
    else Object.defineProperty(process, "disconnect", previousDisconnect);
  }
});

it("closes a managed child Application built before its server is selected", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const previous = process.env.SPINE_MANAGED_SERVER_CHILD;
  process.env.SPINE_MANAGED_SERVER_CHILD = "true";
  let application: Application | undefined;
  try {
    await expect(
      ManagedServerApplication.start({
        processCount: 1,
        port: 0,
        moduleUrl: import.meta.url,
        createServer: async () => {
          application = await Application.newBuilder()
            .setServerEnvironment(
              ServerEnvironment.newBuilder()
                .under(EnvironmentType.Local, (setting) => {
                  setting.use({ storageFactory: storage });
                })
                .build(),
            )
            .add(BoundedContext.singleTenant("Tasks"))
            .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
          throw new Error("factory stopped before Server construction");
        },
      }),
    ).rejects.toThrow(/factory stopped/);
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(() => application?.tenantIndex()).toThrow(/closed/i);
  } finally {
    if (previous === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
    else process.env.SPINE_MANAGED_SERVER_CHILD = previous;
  }
});

it("retries partial Application build cleanup after a managed child factory fails", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: () => Promise.reject(new Error("startup preparation failed")),
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const registry = new InMemorySubscriptionRegistry();
  const closeRegistry = vi
    .spyOn(registry, "close")
    .mockRejectedValueOnce(new Error("first rollback failed"));
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const builder = Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(registry));
  const previous = process.env.SPINE_MANAGED_SERVER_CHILD;
  process.env.SPINE_MANAGED_SERVER_CHILD = "true";
  try {
    const failure = await ManagedServerApplication.start({
      processCount: 1,
      port: 0,
      moduleUrl: import.meta.url,
      createServer: async () => {
        await builder.build();
        throw new Error("unreachable");
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect(closeRegistry).toHaveBeenCalledTimes(2);
  } finally {
    if (previous === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
    else process.env.SPINE_MANAGED_SERVER_CHILD = previous;
    await environment.close().catch(() => undefined);
  }
});

it("retries failed environment facility cleanup after managed Application build failure", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: () => Promise.reject(new Error("required preparation failed")),
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const close = storage.close.bind(storage);
  const closeStorage = vi.spyOn(storage, "close");
  closeStorage
    .mockRejectedValueOnce(new Error("storage close failed"))
    .mockImplementation(() => close());
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const builder = Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("Tasks"));
  const previous = process.env.SPINE_MANAGED_SERVER_CHILD;
  process.env.SPINE_MANAGED_SERVER_CHILD = "true";
  try {
    await expect(
      ManagedServerApplication.start({
        processCount: 1,
        port: 0,
        moduleUrl: import.meta.url,
        createServer: async () => {
          await builder.build();
          throw new Error("unreachable");
        },
      }),
    ).rejects.toThrow();
    expect(closeStorage).toHaveBeenCalledTimes(2);
  } finally {
    if (previous === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
    else process.env.SPINE_MANAGED_SERVER_CHILD = previous;
    await environment.close().catch(() => undefined);
  }
});
