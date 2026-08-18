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

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/require-await */

import * as http2 from "node:http2";
import * as http from "node:http";

import { create, type Message } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import {
  InMemorySubscriptionBindings,
  OpaqueSessionCookies,
  SubscriptionGateway,
} from "@spine-event-engine/auth";
import type { RequestCredential } from "@spine-event-engine/auth";
import { spineCoreRegistry, TypeRegistry } from "@spine-event-engine/core";
import { ApplicationNode } from "@spine-event-engine/deployment";
import { AuthenticationService, ResolveContextRequestSchema } from "@spine-event-engine/proto/auth";
import { EventSchema } from "@spine-event-engine/proto";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  CommandService,
  QuerySchema,
  QueryService,
  SubscriptionService,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
} from "@spine-event-engine/storage";
import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-event-engine/transport";
import {
  InMemoryTransportFactory,
  TransportSubscriptions,
  TransportTopics,
} from "@spine-event-engine/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoundedContext,
  DurableSubscriptionBindings,
  EnvironmentType,
  Server,
  ServerEnvironment,
  type BrowserServerOptions,
  type RunningServer,
  type ServerEnvironmentCloseable,
} from "../../src/index.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import { BrowserServer } from "../../src/server/browser-server.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { attachDurableSubscriptionCleanup } from "../../src/server/durable-subscription-bindings.js";
import { EnvironmentTests } from "../../src/server/environment.js";
import type { ILogLayer } from "loglayer";

describe("Server", () => {
  it("propagates the environment logger child to built context event buses", async () => {
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    const child = {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    };
    const logger = { child: vi.fn(() => child) };
    ServerEnvironment.when(EnvironmentType.Local).use({ logger: logger as unknown as ILogLayer });
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await Server.atPort(0).add(context).start();
    expect(logger.child).toHaveBeenCalledTimes(1);
    expect(
      (
        boundedContextAccess as unknown as { loggerFor(context: BoundedContext): ILogLayer }
      ).loggerFor(context),
    ).toBe(child);
    expect(errors).toEqual([]);

    boundedContextAccess.recordDispatchFailure(
      context,
      create(EventSchema, { message: { typeUrl: "type.googleapis.com/example.Event" } }),
      new Error("must never reach the logger"),
    );
    expect(errors).toEqual([
      {
        message: "Repository follow-up dispatch failed.",
        facts: {
          eventType: "type.googleapis.com/example.Event",
          operation: "repository.follow_up",
          reasonCode: "dispatch_failed",
        },
      },
    ]);
    await server.close();
  });

  it("maps discovered TLS authority to the Node HTTP/2 server name", () => {
    expect(
      BrowserServer.dynamicTransportOptions(
        new ApplicationNode({
          id: "node/a",
          endpoint: "https://10.0.0.1",
          tlsServerName: "api.example.test",
        }),
      ),
    ).toEqual({ baseUrl: "https://10.0.0.1", nodeOptions: { servername: "api.example.test" } });
  });

  it("runs durable subscription recovery with the configured gateway clock", async () => {
    const bindings = inMemoryBindings() as InMemorySubscriptionBindings & {
      recoverActive: NonNullable<
        import("@spine-event-engine/auth").SubscriptionBindings["recoverActive"]
      >;
    };
    let recoveredAt: number | undefined;
    bindings.recoverActive = async ({ nowMs }) => {
      recoveredAt = nowMs;
    };
    const server = await new Server({
      browser: { port: 0, ...browserGateway(), bindings },
    }).start();

    expect(recoveredAt).toBe(0);
    await server.close();
  });

  it("closes subscription resources when durable recovery fails during startup", async () => {
    const bindings = inMemoryBindings() as InMemorySubscriptionBindings & {
      recoverActive: NonNullable<
        import("@spine-event-engine/auth").SubscriptionBindings["recoverActive"]
      >;
    };
    let closed = false;
    const close = bindings.close.bind(bindings);
    bindings.close = async () => {
      closed = true;
      await close();
    };
    bindings.recoverActive = async () => {
      throw new Error("recovery failed");
    };

    await expect(
      new Server({ browser: { port: 0, ...browserGateway(), bindings } }).start(),
    ).rejects.toThrow("recovery failed");
    expect(closed).toBe(true);
  });
  beforeEach(async () => {
    await resetServerEnvironmentForTest();
  });

  afterEach(async () => {
    await resetServerEnvironmentForTest();
  });

  it("accepts every non-empty unique canonical standalone backend origin in configured order", () => {
    expect(
      BrowserServer.backendUrls(["https://first.example.test", "https://second.example.test"]),
    ).toEqual(["https://first.example.test", "https://second.example.test"]);
    expect(
      BrowserServer.backendUrls(
        Array.from({ length: 40 }, (_, index) => `https://node-${index.toString()}.example.test`),
      ),
    ).toHaveLength(40);
  });

  it.each([
    [[], "at least one origin"],
    [["https://same.example.test", "https://same.example.test"], "unique"],
    [["https://backend.example.test/private"], "canonical HTTP(S) origin"],
  ])("rejects invalid standalone backend topology %j", (baseUrls, error) => {
    expect(() => BrowserServer.backendUrls(baseUrls)).toThrow(error);
  });

  it.each([
    [{ baseUrl: "https://backend.example.test", baseUrls: ["https://other.example.test"] }],
    [{}],
  ])("rejects standalone backend configuration with both or neither URL form", (backend) => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend,
          bindings: inMemoryBindings(),
        } as unknown as BrowserServerOptions,
        false,
      );
    }).toThrow("exactly one of baseUrl or baseUrls");
  });

  it.each([
    { baseUrls: [123] },
    { baseUrls: [] },
    { baseUrls: ["https://same.example.test", "https://same.example.test"] },
    { baseUrls: ["https://backend.example.test/path"] },
    { baseUrls: "https://backend.example.test" },
  ])("rejects malformed standalone backend URL lists", (backend) => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend,
          bindings: inMemoryBindings(),
        } as unknown as BrowserServerOptions,
        false,
      );
    }).toThrow();
  });

  it("rejects non-string backend URLs before opening a standalone server", async () => {
    await expect(
      new Server({
        browser: {
          ...browserGateway(),
          backend: { baseUrls: [123] },
        } as unknown as BrowserServerOptions,
      }).start(),
    ).rejects.toThrow("Server browser backend URLs must be strings.");
  });

  it("accepts ordered backend URL lists with direct durable bindings", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "fan-in",
      nextId: () => "binding",
      cleanup: () => Promise.resolve(),
    });
    BrowserServer.requireDurableBindings(
      {
        ...browserGateway(),
        backend: {
          baseUrls: ["https://first.example.test", "https://second.example.test"],
        },
        bindings,
      },
      false,
    );
    const running = await BrowserServer.open(
      ["https://first.example.test", "https://second.example.test"],
      {
        ...browserGateway(),
        bindings,
        host: "127.0.0.1",
        port: 0,
        readMaxBytes: 1_048_576,
        writeMaxBytes: 1_048_576,
        production: false,
      },
    );
    await running.close();
  });

  it("uses discovery membership instead of fixed backend membership when both are supplied", async () => {
    let watches = 0;
    let stops = 0;
    const created: string[] = [];
    const discovery = {
      watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void) {
        watches++;
        onSnapshot([
          new ApplicationNode({
            id: "node/a",
            endpoint: "https://10.0.0.1",
            tlsServerName: "api.example.test",
          }),
        ]);
        return async () => {
          stops++;
        };
      },
    };
    const running = await BrowserServer.open("http://127.0.0.1:65534", {
      ...browserGateway(),
      bindings: inMemoryBindings(),
      discovery,
      dynamicManagerFactory: (node) =>
        ({
          abort: () => {
            created.push(node.id);
          },
        }) as never,
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
    });
    expect(watches).toBe(1);
    await Promise.resolve();
    await Promise.all([running.close(), running.close()]);
    expect(stops).toBe(1);
    expect(created).toEqual(["node/a"]);
  });

  it("rolls back discovery and dynamic resources once when durable cleanup is pre-attached", async () => {
    let stops = 0;
    const aborted: string[] = [];
    const native = {
      baseUrl: "http://127.0.0.1:65534",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "pre-attached",
      nextId: () => "subscription",
      cleanup: () => Promise.resolve(),
    });
    attachDurableSubscriptionCleanup(bindings, () => Promise.resolve());

    await expect(
      BrowserServer.open(native as never, {
        ...browserGateway(),
        bindings,
        discovery: {
          watch: (publish) => {
            publish([
              new ApplicationNode({ id: "node/pre-attached", endpoint: "https://10.0.0.1" }),
            ]);
            return async () => {
              stops++;
            };
          },
        },
        dynamicManagerFactory: (node) =>
          ({
            abort: () => {
              aborted.push(node.id);
            },
          }) as never,
        host: "127.0.0.1",
        port: 0,
        readMaxBytes: 1_048_576,
        writeMaxBytes: 1_048_576,
        production: false,
      }),
    ).rejects.toThrow("already attached");
    expect(stops).toBe(1);
    expect(aborted).toEqual(["node/pre-attached"]);
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("aborts owned dynamic session managers on removal and browser close", async () => {
    let publish: ((nodes: readonly ApplicationNode[]) => void) | undefined;
    const aborted: string[] = [];
    const running = await BrowserServer.open("http://127.0.0.1:65534", {
      ...browserGateway(),
      bindings: inMemoryBindings(),
      discovery: {
        watch: (onSnapshot) => {
          publish = onSnapshot;
          return async () => {};
        },
      },
      dynamicManagerFactory: (node) =>
        ({
          abort: () => {
            aborted.push(node.id);
          },
        }) as never,
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
    });
    publish?.([
      new ApplicationNode({ id: "a", endpoint: "https://10.0.0.1", tlsServerName: "a.test" }),
    ]);
    await Promise.resolve();
    publish?.([]);
    await Promise.resolve();
    publish?.([
      new ApplicationNode({ id: "b", endpoint: "https://10.0.0.2", tlsServerName: "b.test" }),
    ]);
    await Promise.resolve();
    await running.close();
    expect(aborted.sort()).toEqual(["a", "b"]);
  });

  it("retries only a failed discovery-stop phase after later cleanup runs", async () => {
    let stops = 0;
    let nativeCloses = 0;
    const native: RunningServer = {
      host: "127.0.0.1",
      port: 1,
      baseUrl: "http://127.0.0.1:65534",
      close: async () => {
        nativeCloses++;
      },
    };
    const running = await BrowserServer.open(native, {
      ...browserGateway(),
      bindings: inMemoryBindings(),
      discovery: {
        watch: () => async () => {
          stops++;
          if (stops === 1) throw new Error("stop failed");
        },
      },
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
    });
    await expect(running.close()).rejects.toThrow("stop failed");
    expect(nativeCloses).toBe(1);
    await expect(running.close()).resolves.toBeUndefined();
    expect(stops).toBe(2);
    expect(nativeCloses).toBe(1);
  });

  it("keeps discovery and native failures retryable while preserving discovery as primary", async () => {
    let stops = 0;
    let nativeCloses = 0;
    const native: RunningServer = {
      host: "127.0.0.1",
      port: 1,
      baseUrl: "http://127.0.0.1:65534",
      close: async () => {
        nativeCloses++;
        if (nativeCloses === 1) throw new Error("native failed");
      },
    };
    const running = await BrowserServer.open(native, {
      ...browserGateway(),
      bindings: inMemoryBindings(),
      discovery: {
        watch: () => async () => {
          stops++;
          if (stops === 1) throw new Error("discovery failed");
        },
      },
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
    });
    let error: unknown;
    try {
      await running.close();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("discovery failed");
    expect((error as Error & { cleanupErrors?: unknown[] }).cleanupErrors?.[0]).toMatchObject({
      message: "native failed",
    });
    await expect(running.close()).resolves.toBeUndefined();
    expect(stops).toBe(2);
    expect(nativeCloses).toBe(2);
  });

  it("starts one array-configured backend and handles empty browser request facts", async () => {
    const requests = BrowserServer.requests(browserGateway());
    const requestHeader = new Headers();

    expect(requests.credential({ requestHeader })).toEqual({ kind: "bearer", value: "" });
    expect(requests.transport({ requestHeader })).toBeDefined();

    const unopened = http.createServer();
    await expect(BrowserServer.closeListener(unopened)).resolves.toBeUndefined();

    const running = await BrowserServer.open(["http://127.0.0.1:65534"], {
      ...browserGateway(),
      bindings: inMemoryBindings(),
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
    });
    await running.close();
  });

  it("rejects production browser bindings before context assembly or listener startup", async () => {
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      transport: new CloseTrackingTransport([]),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
    });
    let resourceClosed = false;

    await expect(
      new Server({ browser: { port: 0, ...browserGateway() } })
        .addResource({
          close: () => {
            resourceClosed = true;
          },
        })
        .start(),
    ).rejects.toThrow("requires durable subscription bindings");
    expect(resourceClosed).toBe(false);
  });

  it("rejects an invalid standalone backend before context assembly or listener startup", async () => {
    let resourceClosed = false;
    const browser = {
      ...browserGateway(),
      backend: { baseUrl: "https://backend.example.test/private" },
    } as BrowserServerOptions;

    const starting = new Server({ browser })
      .addResource({
        close: () => {
          resourceClosed = true;
        },
      })
      .start();

    try {
      await expect(starting).rejects.toThrow("canonical HTTP(S) origin");
    } finally {
      await starting.then(
        (running) => running.close(),
        () => undefined,
      );
    }

    expect(resourceClosed).toBe(false);
  });

  it("requires a registry before admitting a production standalone gateway", () => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend: { baseUrl: "https://backend.example.test" },
          bindings: { durable: true, namespace: "gateway" },
        } as unknown as BrowserServerOptions,
        true,
      );
    }).toThrow("type registry");
  });

  it("rejects local ownership that standalone mode would otherwise ignore", async () => {
    let closed = false;
    await expect(
      new Server({
        resources: [
          {
            close: () => {
              closed = true;
            },
          },
        ],
        browser: {
          ...browserGateway(),
          backend: { baseUrl: "http://127.0.0.1:65534" },
          bindings: inMemoryBindings(),
        },
      }).start(),
    ).rejects.toThrow("cannot own local contexts, services, or resources");
    expect(closed).toBe(false);
  });

  it("requires a named durable binding registry before admitting a production standalone gateway", () => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend: { baseUrl: "https://backend.example.test" },
          registry: new TypeRegistry(),
          bindings: { durable: true, namespace: " " },
        } as unknown as BrowserServerOptions,
        true,
      );
    }).toThrow("durable subscription bindings");
  });

  it("rejects missing standalone authentication collaborators before listener startup", () => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend: { baseUrl: "https://backend.example.test" },
          sessions: undefined,
        } as unknown as BrowserServerOptions,
        false,
      );
    }).toThrow("sessions");
  });

  it.each([
    [{ sessions: { resolve: "invalid" } }, "sessions"],
    [{ authorize: "invalid" }, "authorization"],
    [{ contexts: {} }, "context resolution"],
    [{ contexts: { resolve: () => undefined } }, "context resolution"],
    [{ contexts: { resolveContext: () => undefined } }, "context resolution"],
    [{ clock: { now: "invalid" } }, "clock"],
    [{ bindings: undefined }, "subscription bindings"],
  ])("rejects malformed standalone collaborator %j", (malformed, expected) => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend: { baseUrl: "https://backend.example.test" },
          ...malformed,
        } as unknown as BrowserServerOptions,
        false,
      );
    }).toThrow(expected);
  });

  it.each([
    ["authorization", { authorize: undefined }, "authorization"],
    ["context resolution", { contexts: undefined }, "context resolution"],
    ["clock", { clock: undefined }, "clock"],
  ] as const)(
    "rejects a standalone browser gateway missing %s before listener startup",
    (_name, missing, expected) => {
      expect(() => {
        BrowserServer.requireDurableBindings(
          {
            ...browserGateway(),
            backend: { baseUrl: "https://backend.example.test" },
            ...missing,
          } as unknown as BrowserServerOptions,
          false,
        );
      }).toThrow(expected);
    },
  );

  it.each([0, 0.5])(
    "rejects an invalid browser auth admission limit before listener startup: %s",
    async (maxActiveAuthRequests) => {
      const starting = BrowserServer.open("http://127.0.0.1:65534", {
        ...browserGateway(),
        host: "127.0.0.1",
        port: 0,
        readMaxBytes: 1_048_576,
        writeMaxBytes: 1_048_576,
        production: false,
        bindings: inMemoryBindings(),
        maxActiveAuthRequests,
      });

      await expect(starting).rejects.toThrow("maxActiveAuthRequests");
    },
  );

  it("requires explicit standalone subscription bindings outside production", () => {
    expect(() => {
      BrowserServer.requireDurableBindings(
        {
          ...browserGateway(),
          backend: { baseUrl: "https://backend.example.test" },
          bindings: undefined,
        } as unknown as BrowserServerOptions,
        false,
      );
    }).toThrow("explicit subscription bindings");
  });

  it("opens the browser pipeline against a standalone backend origin", async () => {
    const server = await BrowserServer.open("http://127.0.0.1:65534", {
      ...browserGateway(),
      host: "127.0.0.1",
      port: 0,
      readMaxBytes: 1_048_576,
      writeMaxBytes: 1_048_576,
      production: false,
      bindings: inMemoryBindings(),
    });

    await server.close();
  });

  it("does not attach a standalone browser gateway to a native server environment", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        backend: { baseUrl: "http://127.0.0.1:65534" },
        bindings: inMemoryBindings(),
      },
    }).start();

    try {
      await expect(ServerEnvironment.instance().close()).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("uses discovery-only browser hosting without a local environment attachment", async () => {
    let watches = 0;
    let stops = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        discovery: {
          watch: () => {
            watches += 1;
            return async () => {
              stops += 1;
            };
          },
        },
        bindings: inMemoryBindings(),
      },
    }).start();

    try {
      expect(watches).toBe(1);
      await expect(ServerEnvironment.instance().close()).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
    expect(stops).toBe(1);
  });

  it("rejects local ownership for discovery-only browser hosting", async () => {
    let closed = false;

    await expect(
      new Server({
        browser: {
          ...browserGateway(),
          discovery: { watch: async () => async () => undefined },
          bindings: inMemoryBindings(),
        },
        resources: [{ close: () => (closed = true) }],
      }).start(),
    ).rejects.toThrow(
      "Standalone browser server cannot own local contexts, services, or resources.",
    );
    expect(closed).toBe(false);
  });

  it("forwards an authenticated browser command through the supplied standalone backend", async () => {
    const paths: string[] = [];
    const backend = http2.createServer();
    backend.on("stream", (stream, headers) => {
      paths.push(String(headers[":path"]));
      stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "0" });
      stream.end();
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    if (address === null || typeof address === "string") throw new Error("backend address missing");
    const actor = create(UserIdSchema, { value: "ada" });
    const context = create(ActorContextSchema, { actor, timestamp: create(TimestampSchema) });
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        backend: { baseUrl: `http://127.0.0.1:${address.port.toString()}` },
        bindings: inMemoryBindings(),
        sessions: {
          resolve: () =>
            Promise.resolve({ principal: { id: "ada" }, expiresAt: create(TimestampSchema) }),
        },
        authorize: () => Promise.resolve(true),
        contexts: {
          resolve: () => Promise.resolve({ actor, timestamp: create(TimestampSchema) }),
          resolveContext: () => Promise.resolve({ actor, timestamp: create(TimestampSchema) }),
        },
      },
    }).start();
    const client = createClient(
      CommandService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );

    try {
      await expect(
        client.post(
          create(CommandSchema, {
            context: create(CommandContextSchema, { actorContext: context }),
          }),
          { headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" } },
        ),
      ).rejects.toMatchObject({ code: 2 });
      expect(paths).toEqual(["/spine.client.CommandService/Post"]);
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) =>
        backend.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it("keeps ResolveContext local while the standalone gateway selects every backend descriptor", async () => {
    const paths: string[] = [];
    const backend = http2.createServer();
    backend.on("stream", (stream, headers) => {
      paths.push(String(headers[":path"]));
      stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "0" });
      stream.end(Buffer.from([0, 0, 0, 0, 0]));
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    if (address === null || typeof address === "string") throw new Error("backend address missing");
    const actor = create(UserIdSchema, { value: "ada" });
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        backend: { baseUrl: `http://127.0.0.1:${address.port.toString()}` },
        bindings: inMemoryBindings(),
        sessions: {
          resolve: () =>
            Promise.resolve({
              principal: { id: "ada" },
              expiresAt: create(TimestampSchema, { seconds: 100n }),
            }),
        },
        authorize: () => Promise.resolve(true),
        contexts: {
          resolve: () => Promise.resolve({ actor, timestamp: create(TimestampSchema) }),
          resolveContext: () => Promise.resolve({ actor, timestamp: create(TimestampSchema) }),
        },
      },
    }).start();
    const transport = createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" });
    const headers = { origin: "http://127.0.0.1:5173", authorization: "Bearer token" };
    try {
      await expect(
        createClient(AuthenticationService, transport).resolveContext(
          create(ResolveContextRequestSchema),
          { headers },
        ),
      ).resolves.toMatchObject({ actor });
      await createClient(CommandService, transport)
        .post(
          create(CommandSchema, {
            context: create(CommandContextSchema, {
              actorContext: create(ActorContextSchema, { actor }),
            }),
          }),
          { headers },
        )
        .catch(() => undefined);
      await createClient(QueryService, transport)
        .read(create(QuerySchema, { context: create(ActorContextSchema, { actor }) }), { headers })
        .catch(() => undefined);
      const subscriptions = createClient(SubscriptionService, transport);
      const subscription = await subscriptions.subscribe(
        create(TopicSchema, { context: create(ActorContextSchema, { actor }) }),
        { headers },
      );
      await subscriptions.activate(subscription, { headers })[Symbol.asyncIterator]().next();
      await subscriptions.cancel(subscription, { headers });
      expect(paths).toEqual([
        "/spine.client.CommandService/Post",
        "/spine.client.QueryService/Read",
        "/spine.client.SubscriptionService/Subscribe",
        "/spine.client.SubscriptionService/Activate",
      ]);
    } finally {
      await server.close();
      await new Promise<void>((resolve) =>
        backend.close(() => {
          resolve();
        }),
      );
    }
  });

  it("dispatches one exact standalone auth callback without an Origin", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/callback",
            origins: ["http://127.0.0.1:5173"],
            allowMissingOrigin: true,
            maxRequestBytes: 1024,
            timeoutMs: 1000,
            onRequest: () => new Response("ok", { status: 200 }),
          },
        ],
      },
    }).start();
    try {
      const response = await fetch(`${server.baseUrl}/auth/callback`);
      await expect(response.text()).resolves.toBe("ok");
      expect(response.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("fails closed for an auth route's wrong origin, method, and bounded body", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/exchange",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 2,
            timeoutMs: 1000,
            onRequest: () => new Response(),
          },
        ],
      },
    }).start();
    try {
      await expect(
        fetch(`${server.baseUrl}/auth/exchange`, {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        fetch(`${server.baseUrl}/auth/exchange`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 405 });
      await expect(
        fetch(`${server.baseUrl}/auth/exchange`, {
          method: "OPTIONS",
          headers: { origin: "https://other.example" },
        }),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        fetch(`${server.baseUrl}/auth/exchange`, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5173" },
          body: "too long",
        }),
      ).resolves.toMatchObject({ status: 413 });
    } finally {
      await server.close();
    }
  });

  it("aborts a timed out auth handler with a fixed gateway timeout", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/wait",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 1024,
            timeoutMs: 5,
            onRequest: () => new Promise<Response>(() => undefined),
          },
        ],
      },
    }).start();
    try {
      await expect(
        fetch(`${server.baseUrl}/auth/wait`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 504 });
    } finally {
      await server.close();
    }
  });

  it("aborts active auth work before close settles", async () => {
    let abort!: () => void;
    let start!: () => void;
    const aborted = new Promise<void>((resolve) => (abort = resolve));
    const started = new Promise<void>((resolve) => (start = resolve));
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/close",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 1024,
            timeoutMs: 10_000,
            onRequest: (_request, signal) => {
              start();
              return new Promise<Response>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    abort();
                    resolve(new Response());
                  },
                  { once: true },
                );
              });
            },
          },
        ],
      },
    }).start();
    const request = fetch(`${server.baseUrl}/auth/close`, {
      headers: { origin: "http://127.0.0.1:5173" },
    }).catch(() => undefined);
    await started;
    await server.close();
    await expect(aborted).resolves.toBeUndefined();
    await request;
  });

  it("rejects retained-connection auth admission while the listener drains", async () => {
    let calls = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/drain",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 1024,
            timeoutMs: 1000,
            onRequest: () => ((calls += 1), new Response()),
          },
        ],
      },
    }).start();
    const close = vi.spyOn(http.Server.prototype, "close").mockImplementationOnce(function (
      this: http.Server,
      callback?: (error?: Error) => void,
    ) {
      setTimeout(() => http.Server.prototype.close.call(this, callback), 50);
      return this;
    });
    try {
      const closing = server.close();
      const response = await fetch(`${server.baseUrl}/auth/drain`, {
        headers: { origin: "http://127.0.0.1:5173" },
      }).catch(() => undefined);
      expect(response?.status).toBe(503);
      expect(calls).toBe(0);
      await closing;
    } finally {
      close.mockRestore();
      await server.close().catch(() => undefined);
    }
  });

  it("aborts auth work when its client disconnects", async () => {
    let start!: () => void;
    let abort!: () => void;
    const started = new Promise<void>((resolve) => (start = resolve));
    const aborted = new Promise<void>((resolve) => (abort = resolve));
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/disconnect",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 1024,
            timeoutMs: 10_000,
            onRequest: (_request, signal) => {
              start();
              return new Promise<Response>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    abort();
                    resolve(new Response());
                  },
                  { once: true },
                );
              });
            },
          },
        ],
      },
    }).start();
    try {
      const request = http.request(`${server.baseUrl}/auth/disconnect`, {
        headers: { origin: "http://127.0.0.1:5173" },
      });
      request.on("error", () => undefined);
      request.end();
      await started;
      request.destroy();
      await expect(aborted).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("uses fixed auth errors without starting application work", async () => {
    let calls = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/fixed",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 2,
            timeoutMs: 1000,
            onRequest: () => ((calls += 1), new Response("unexpected")),
          },
        ],
      },
    }).start();
    try {
      await expect(
        fetch(`${server.baseUrl}/missing`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 404 });
      await expect(
        fetch(`${server.baseUrl}/auth/fixed`, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5173", "content-length": "3" },
          body: "abc",
        }),
      ).resolves.toMatchObject({ status: 413 });
      expect(calls).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("maps auth method, origin, streamed overflow, and handler failure exactly", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/map",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 2,
            timeoutMs: 1000,
            onRequest: () => {
              throw new Error("private");
            },
          },
        ],
      },
    }).start();
    try {
      await expect(
        fetch(`${server.baseUrl}/auth/map`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 405 });
      await expect(
        fetch(`${server.baseUrl}/auth/map`, {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        fetch(`${server.baseUrl}/auth/map`, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5173" },
          body: "abc",
        }),
      ).resolves.toMatchObject({ status: 413 });
      await expect(
        fetch(`${server.baseUrl}/auth/map`, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5173" },
          body: "a",
        }),
      ).resolves.toMatchObject({ status: 500 });
    } finally {
      await server.close();
    }
  });

  it("passes a bounded auth body through its response transfer", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/body",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 1000,
            onRequest: async (request) =>
              new Response(await request.text(), { status: 201, headers: { "x-auth": "ok" } }),
          },
        ],
      },
    }).start();
    try {
      const response = await fetch(`${server.baseUrl}/auth/body`, {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5173" },
        body: "body",
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-auth")).toBe("ok");
      await expect(response.text()).resolves.toBe("body");
    } finally {
      await server.close();
    }
  });

  it("bounds auth response transfer with the server write limit", async () => {
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => (cancelled = resolve));
    const server = await new Server({
      writeMaxBytes: 8,
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/response-limit",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 1000,
            onRequest: () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new Uint8Array(9));
                  },
                  cancel() {
                    cancelled();
                    return Promise.reject(new Error("application cancellation failure"));
                  },
                }),
                { headers: { "x-private": "no" } },
              ),
          },
        ],
      },
    }).start();
    try {
      const response = await fetch(`${server.baseUrl}/auth/response-limit`, {
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(response.status).toBe(413);
      expect(response.headers.get("x-private")).toBeNull();
      await expect(response.text()).resolves.toBe("");
      await expect(cancellation).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("applies the auth deadline while response transfer is pending", async () => {
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => (cancel = resolve));
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/response-timeout",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 5,
            onRequest: () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  pull: () => new Promise<void>(() => undefined),
                  cancel,
                }),
              ),
          },
        ],
      },
    }).start();
    try {
      await expect(
        fetch(`${server.baseUrl}/auth/response-timeout`, {
          headers: { origin: "http://127.0.0.1:5173" },
        }),
      ).resolves.toMatchObject({ status: 504 });
      await expect(cancelled).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("times out body intake before invoking an auth handler", async () => {
    let calls = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/drip",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 5,
            onRequest: () => ((calls += 1), new Response()),
          },
        ],
      },
    }).start();
    try {
      let requestClosed!: () => void;
      const closed = new Promise<void>((resolve) => (requestClosed = resolve));
      const result = await new Promise<{
        readonly connection: string | undefined;
        readonly status: number | undefined;
      }>((resolve, reject) => {
        const request = http.request(`${server.baseUrl}/auth/drip`, {
          method: "POST",
          headers: { origin: "http://127.0.0.1:5173", "transfer-encoding": "chunked" },
        });
        request.once("error", reject);
        request.once("close", requestClosed);
        request.once("response", (response) => {
          response.resume();
          response.once("end", () => {
            resolve({ connection: response.headers.connection, status: response.statusCode });
          });
        });
        request.write("a");
      });
      expect(result.status).toBe(504);
      expect(result.connection).toBe("close");
      await expect(closed).resolves.toBeUndefined();
      expect(calls).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("refuses excess auth admission and recovers after completion", async () => {
    let release!: () => void;
    let started!: () => void;
    let calls = 0;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const server = await new Server({
      browser: {
        port: 0,
        maxActiveAuthRequests: 1,
        ...browserGateway(),
        authRoutes: [
          {
            method: "GET",
            path: "/auth/admission",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 1000,
            onRequest: () => {
              calls += 1;
              if (calls > 1) return new Response("ok");
              return new Promise<Response>((resolve) => {
                started();
                release = () => {
                  resolve(new Response("ok"));
                };
              });
            },
          },
        ],
      },
    }).start();
    try {
      const first = fetch(`${server.baseUrl}/auth/admission`, {
        headers: { origin: "http://127.0.0.1:5173" },
      });
      await ready;
      await expect(
        fetch(`${server.baseUrl}/auth/admission`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 503 });
      release();
      await first;
      await expect(
        fetch(`${server.baseUrl}/auth/admission`, { headers: { origin: "http://127.0.0.1:5173" } }),
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      await server.close();
    }
  });

  it("rejects noncanonical and unbounded auth route registrations before listening", () => {
    const route = {
      method: "POST" as const,
      path: "/auth/valid",
      origins: ["http://127.0.0.1:5173"],
      maxRequestBytes: 16,
      timeoutMs: 1000,
      onRequest: () => new Response(),
    };
    expect(() => BrowserServer.authRoutes([{ ...route, path: "/" }])).toThrow("canonical non-root");
    expect(() => BrowserServer.authRoutes([{ ...route, maxRequestBytes: 0 }])).toThrow(
      "positive safe transport bound",
    );
    expect(() => BrowserServer.authRoutes([{ ...route, maxRequestBytes: 4_194_305 }])).toThrow(
      "positive safe transport bound",
    );
    expect(() => BrowserServer.authRoutes([{ ...route, timeoutMs: 0 }])).toThrow(
      "safe positive millisecond",
    );
    expect(() => BrowserServer.authRoutes([{ ...route, timeoutMs: 2_147_483_648 }])).toThrow(
      "safe positive millisecond",
    );
    expect(() => BrowserServer.authRoutes([route, route])).toThrow("one method per canonical path");
    expect(() => BrowserServer.authRoutes([{ ...route, method: "GET" }])).not.toThrow();
    expect(() => BrowserServer.authRoutes([{ ...route, method: "PUT" as "POST" }])).toThrow(
      "GET or POST",
    );
    expect(() => BrowserServer.authRoutes([route, { ...route, method: "GET" }])).toThrow(
      "one method per canonical path",
    );
  });

  it.each(["GET", "POST"] as const)(
    "rejects a %s auth route collision with a reserved RPC path before listener startup",
    async (method) => {
      let calls = 0;
      const starting = new Server({
        browser: {
          port: 0,
          ...browserGateway(),
          authRoutes: [
            {
              method,
              path: "/spine.client.CommandService/Post",
              origins: ["http://127.0.0.1:5173"],
              maxRequestBytes: 16,
              timeoutMs: 1000,
              onRequest: () => ((calls += 1), new Response()),
            },
          ],
        },
      }).start();

      await expect(starting).rejects.toThrow("reserved Spine RPC paths");
      expect(calls).toBe(0);
    },
  );

  it("rejects a chunked auth body that exceeds its bound before handler work", async () => {
    let calls = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/chunked",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 2,
            timeoutMs: 1000,
            onRequest: () => ((calls += 1), new Response()),
          },
        ],
      },
    }).start();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          `${server.baseUrl}/auth/chunked`,
          {
            method: "POST",
            headers: { origin: "http://127.0.0.1:5173", "transfer-encoding": "chunked" },
          },
          (response) => {
            resolve(response.statusCode ?? 0);
          },
        );
        request.once("error", reject);
        request.end("abc");
      });
      expect(status).toBe(413);
      expect(calls).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("answers an allowed exact auth preflight without application work", async () => {
    let calls = 0;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        authRoutes: [
          {
            method: "POST",
            path: "/auth/preflight",
            origins: ["http://127.0.0.1:5173"],
            maxRequestBytes: 16,
            timeoutMs: 1000,
            onRequest: () => ((calls += 1), new Response()),
          },
        ],
      },
    }).start();
    try {
      const response = await fetch(`${server.baseUrl}/auth/preflight`, {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
      expect(response.headers.get("access-control-allow-methods")).toBe("POST,OPTIONS");
      expect(calls).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("starts on 127.0.0.1 by default and exposes its local base URL", async () => {
    const server = await Server.atPort(0).start();

    try {
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port.toString()}`);
    } finally {
      await server.close();
    }
  });

  it("runs a server under process-owned signal shutdown", async () => {
    const withMetadata = vi.fn(() => ({ warn: vi.fn(), error: vi.fn() }));
    ServerEnvironment.when(EnvironmentType.Local).use({
      logger: { child: () => ({ withMetadata }) } as never,
    });
    const server = await Server.atPort(0).run();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");
    const closed = once(session, "close");

    process.emit("SIGTERM");

    await expect(closed).resolves.toBeUndefined();
    await server.close();
    expect(withMetadata).not.toHaveBeenCalled();
  });

  it("keeps a standalone discovery gateway signal-managed without retiring its environment", async () => {
    const closed: string[] = [];
    let stops = 0;
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const gateway = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        discovery: {
          watch: () => async () => {
            stops += 1;
          },
        },
        bindings: inMemoryBindings(),
      },
    }).run();

    process.emit("SIGTERM");
    await waitFor(() => stops === 1);

    expect(closed).toEqual([]);
    await gateway.close();
  });

  it("retires the last local environment owner while a standalone gateway remains running", async () => {
    const closed: string[] = [];
    let stops = 0;
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const application = await Server.atPort(0).run();
    const gateway = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        discovery: {
          watch: () => async () => {
            stops += 1;
          },
        },
        bindings: inMemoryBindings(),
      },
    }).run();

    await application.close();

    expect(closed).toEqual(["transport", "storage"]);
    expect(stops).toBe(0);
    await gateway.close();
    expect(stops).toBe(1);
  });

  it("coalesces concurrent run calls before process lifecycle admission", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const server = Server.atPort(0);

    const [first, second] = await Promise.all([server.run(), server.run()]);

    try {
      expect(second).toBe(first);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners + 1);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
    } finally {
      await first.close();
    }

    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
  });

  it("does not return a closed managed handle from a later run call", async () => {
    const server = Server.atPort(0);
    const running = await server.run();

    await running.close();

    await expect(server.run()).rejects.toThrow("ServerEnvironment is closed.");
  });

  it("closes process-owned servers in reverse successful-start order", async () => {
    const closed: string[] = [];
    const first = await Server.atPort(0)
      .addResource({ close: () => closed.push("first") })
      .run();
    const second = await Server.atPort(0)
      .addResource({ close: () => closed.push("second") })
      .run();

    process.emit("SIGINT");

    await Promise.all([first.close(), second.close()]);
    expect(closed).toEqual(["second", "first"]);
  });

  it("shares close work when an explicit close races a process signal", async () => {
    let closes = 0;
    const server = await Server.atPort(0)
      .addResource({
        close: () => {
          closes += 1;
        },
      })
      .run();
    const closing = server.close();
    process.emit("SIGTERM");
    await closing;
    expect(closes).toBe(1);
  });

  it("keeps a failed signal close retryable", async () => {
    const original = process.exitCode;
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    const child = {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    };
    ServerEnvironment.when(EnvironmentType.Local).use({
      logger: { child: () => child } as unknown as ILogLayer,
    });
    let attempts = 0;
    const server = await Server.atPort(0)
      .addResource({
        close: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("close failed");
        },
      })
      .run();
    try {
      process.emit("SIGTERM");
      process.emit("SIGINT");
      await waitFor(() => process.exitCode === 1);
      expect(process.exitCode).toBe(1);
      expect(attempts).toBe(1);
      expect(errors).toEqual([
        {
          message: "Process-owned server shutdown failed.",
          facts: { operation: "server.process_shutdown", reasonCode: "close_failed" },
        },
      ]);
      process.emit("SIGTERM");
      await waitFor(() => attempts === 2);
      expect(attempts).toBe(2);
      expect(errors).toHaveLength(1);
    } finally {
      await server.close().catch(() => undefined);
      process.exitCode = original;
    }
  });

  it("retries a failed final environment close on a later process signal", async () => {
    const original = process.exitCode;
    const closed: string[] = [];
    const storageError = new Error("storage close failed once");
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new FlakyCloseStorageFactory(closed, storageError),
      transport: new CloseTrackingTransport(closed),
    });
    const server = await Server.atPort(0).run();

    try {
      process.emit("SIGTERM");
      await waitFor(() => closed.length === 2);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners + 1);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);

      process.emit("SIGTERM");
      await waitFor(() => closed.length === 3);
      expect(closed).toEqual(["transport", "storage", "storage"]);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      await server.close().catch(() => undefined);
      process.exitCode = original;
    }
  });

  it("releases failed run ownership without installing process signal listeners", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const occupied = http.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test listener did not expose a TCP port.");
    }

    try {
      await expect(Server.atPort(address.port).run()).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      await new Promise<void>((resolve, reject) =>
        occupied.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        }),
      );
    }

    const callerManaged = await Server.atPort(0).start();
    await callerManaged.close();
  });

  it("rejects run admission before opening a listener while caller ownership is active", async () => {
    const callerManaged = await Server.atPort(0).start();
    const rejectedPort = await unusedPort();

    try {
      const rejected = Server.atPort(rejectedPort).run();
      try {
        await expect(rejected).rejects.toThrow(
          "Server-owned environment registration requires exclusive ownership.",
        );
      } finally {
        await rejected.then(
          (server) => server.close(),
          () => undefined,
        );
      }
      const sibling = await Server.atPort(rejectedPort).start();
      expect(sibling.port).toBe(rejectedPort);
      await sibling.close();
    } finally {
      await callerManaged.close();
    }
  });

  it("rejects caller-managed admission before opening a listener while run ownership is active", async () => {
    const runManaged = await Server.atPort(0).run();
    const rejectedPort = await unusedPort();

    try {
      const rejected = Server.atPort(rejectedPort).start();
      try {
        await expect(rejected).rejects.toThrow(
          "Server-owned environment registration requires exclusive ownership.",
        );
      } finally {
        await rejected.then(
          (server) => server.close(),
          () => undefined,
        );
      }
      const sibling = await Server.atPort(rejectedPort).run();
      expect(sibling.port).toBe(rejectedPort);
      await sibling.close();
    } finally {
      await runManaged.close();
    }
  });

  it("keeps a run-managed sibling usable and closes singleton facilities after the last retires", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const first = await Server.atPort(0).run();
    const second = await Server.atPort(0).run();

    await first.close();
    const session = http2.connect(second.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");
    session.close();
    await once(session, "close");
    expect(closed).toEqual([]);

    await second.close();
    expect(closed).toEqual(["transport", "storage"]);
  });

  it("retries a failed final run-managed environment close without repeating server cleanup", async () => {
    const closed: string[] = [];
    const storageError = new Error("storage close failed once");
    let resourceCloses = 0;
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new FlakyCloseStorageFactory(closed, storageError),
      transport: new CloseTrackingTransport(closed),
    });
    const server = await Server.atPort(0)
      .addResource({
        close() {
          resourceCloses += 1;
        },
      })
      .run();

    await expect(server.close()).rejects.toMatchObject({ errors: [storageError] });
    expect(resourceCloses).toBe(1);
    await expect(server.close()).resolves.toBeUndefined();
    expect(resourceCloses).toBe(1);
    expect(closed).toEqual(["transport", "storage", "storage"]);
  });

  it("serves browser preflight only to configured origins", async () => {
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
      },
    }).start();

    try {
      const allowed = await fetch(`${server.baseUrl}/spine.client.CommandService/Post`, {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      const forbidden = await fetch(`${server.baseUrl}/spine.client.CommandService/Post`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173" },
      });

      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
      expect(allowed.headers.get("vary")).toBe("Origin");
      expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
      expect(allowed.headers.get("access-control-expose-headers")).toContain("grpc-status");
      expect(forbidden.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it.each(["http://example.test/path", "ftp://example.test", "not an origin"])(
    "rejects a noncanonical browser origin %s",
    async (origin) => {
      await expect(
        new Server({ browser: { ...browserGateway(), origins: [origin] } }).start(),
      ).rejects.toThrow("canonical HTTP(S) origins");
    },
  );

  it("rejects duplicate browser origins", async () => {
    await expect(
      new Server({
        browser: {
          ...browserGateway(),
          origins: ["http://127.0.0.1:5173", "http://127.0.0.1:5173"],
        },
      }).start(),
    ).rejects.toThrow("unique and non-empty");
  });

  it("rejects an empty browser origin list", async () => {
    await expect(
      new Server({ browser: { ...browserGateway(), origins: [] } }).start(),
    ).rejects.toThrow("unique and non-empty");
  });

  it("accepts a canonical HTTPS browser origin", async () => {
    const server = await new Server({
      browser: { ...browserGateway(), port: 0, origins: ["https://chat.example"] },
    }).start();
    try {
      const response = await fetch(`${server.baseUrl}/spine.client.CommandService/Post`, {
        method: "OPTIONS",
        headers: { origin: "https://chat.example" },
      });
      expect(response.status).toBe(204);
    } finally {
      await server.close();
    }
  });

  it("formats an IPv6 browser listener URL", async () => {
    const server = await new Server({
      host: "::1",
      browser: { ...browserGateway(), host: "::1", port: 0 },
    }).start();
    try {
      expect(server.host).toBe("::1");
      expect(server.baseUrl).toBe(`http://[::1]:${server.port.toString()}`);
    } finally {
      await server.close();
    }
  });

  it("rejects a browser request without an origin", async () => {
    const server = await new Server({ browser: { port: 0, ...browserGateway() } }).start();
    try {
      const response = await fetch(`${server.baseUrl}/spine.client.CommandService/Post`, {
        method: "POST",
      });
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("routes browser Connect RPCs through its authentication boundary", async () => {
    const server = await new Server({ browser: { port: 0, ...browserGateway() } }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );

    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: { origin: "http://127.0.0.1:5173" },
        }),
      ).rejects.toMatchObject({ code: 16 });
    } finally {
      await server.close();
    }
  });

  it("accepts an application type registry for browser request decoding", async () => {
    const server = await new Server({
      browser: { port: 0, ...browserGateway(), registry: new TypeRegistry([TenantIdSchema]) },
    }).start();
    try {
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("enforces the configured browser request-message limit", async () => {
    const server = await new Server({
      readMaxBytes: 32,
      browser: { port: 0, ...browserGateway() },
    }).start();
    const client = createClient(
      CommandService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    try {
      await expect(
        client.post(
          create(CommandSchema, {
            message: { typeUrl: "type.example.test/Large", value: new Uint8Array(128) },
          }),
          { headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" } },
        ),
      ).rejects.toMatchObject({ code: 8 });
    } finally {
      await server.close();
    }
  });

  it("enforces the configured browser response-message limit", async () => {
    const options = {
      ...browserGateway(),
      sessions: {
        resolve: () =>
          Promise.resolve({ principal: { id: "ada" }, expiresAt: create(TimestampSchema) }),
      },
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "x".repeat(128) }),
            timestamp: create(TimestampSchema),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "x".repeat(128) }),
            timestamp: create(TimestampSchema),
          }),
      },
    };
    const server = await new Server({
      writeMaxBytes: 32,
      browser: { port: 0, ...options },
    }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" },
        }),
      ).rejects.toMatchObject({ code: 8 });
    } finally {
      await server.close();
    }
  });

  it("enforces the configured browser request-message limit over gRPC-Web", async () => {
    const server = await new Server({
      readMaxBytes: 32,
      browser: { port: 0, ...browserGateway() },
    }).start();
    const client = createClient(
      CommandService,
      createGrpcWebTransport({ baseUrl: server.baseUrl }),
    );
    try {
      await expect(
        client.post(
          create(CommandSchema, {
            message: { typeUrl: "type.example.test/Large", value: new Uint8Array(128) },
          }),
          { headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" } },
        ),
      ).rejects.toMatchObject({ code: 8 });
    } finally {
      await server.close();
    }
  });

  it("enforces the configured browser response-message limit over gRPC-Web", async () => {
    const options = {
      ...browserGateway(),
      sessions: {
        resolve: () =>
          Promise.resolve({ principal: { id: "ada" }, expiresAt: create(TimestampSchema) }),
      },
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "x".repeat(128) }),
            timestamp: create(TimestampSchema),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "x".repeat(128) }),
            timestamp: create(TimestampSchema),
          }),
      },
    };
    const server = await new Server({
      writeMaxBytes: 32,
      browser: { port: 0, ...options },
    }).start();
    const client = createClient(
      AuthenticationService,
      createGrpcWebTransport({ baseUrl: server.baseUrl }),
    );
    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" },
        }),
      ).rejects.toMatchObject({ code: 8 });
    } finally {
      await server.close();
    }
  });

  it("routes browser gRPC-Web RPCs through its authentication boundary", async () => {
    const server = await new Server({ browser: { port: 0, ...browserGateway() } }).start();
    const client = createClient(
      AuthenticationService,
      createGrpcWebTransport({ baseUrl: server.baseUrl }),
    );

    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: { origin: "http://127.0.0.1:5173" },
        }),
      ).rejects.toMatchObject({ code: 16 });
    } finally {
      await server.close();
    }
  });

  it("extracts an opaque browser session cookie before gateway admission", async () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: new Uint8Array(32).fill(7),
      origins: ["http://127.0.0.1:5173"],
    });
    const sessionId = "a".repeat(43);
    let credential: string | undefined;
    const options = {
      ...browserGateway(),
      cookies,
      sessions: {
        resolve(value: RequestCredential) {
          credential = `${value.kind}:${value.value}`;
          return Promise.resolve(undefined);
        },
      },
    };
    const server = await new Server({ browser: { port: 0, ...options } }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );

    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: {
            origin: "http://127.0.0.1:5173",
            cookie: cookies
              .issue(sessionId)
              .map((value) => value.split(";", 1)[0])
              .join("; "),
            "x-spine-csrf": cookies.csrf(sessionId),
          },
        }),
      ).rejects.toMatchObject({ code: 16 });
      expect(credential).toBe(`cookie:${sessionId}`);
    } finally {
      await server.close();
      await cookies.close();
    }
  });

  it("does not admit malformed bearer or rejected cookie credentials", async () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: new Uint8Array(32).fill(8),
      origins: ["http://127.0.0.1:5173"],
    });
    const values: string[] = [];
    const options = {
      ...browserGateway(),
      cookies,
      sessions: {
        resolve(value: RequestCredential) {
          values.push(value.value);
          return Promise.resolve(undefined);
        },
      },
    };
    const server = await new Server({ browser: { port: 0, ...options } }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    try {
      for (const headers of [
        { origin: "http://127.0.0.1:5173", authorization: "Bearer one two" },
        {
          origin: "http://127.0.0.1:5173",
          authorization: "Bearer valid, Bearer other",
          cookie: "broken",
          "x-spine-csrf": "bad",
        },
      ])
        await expect(
          client.resolveContext(create(ResolveContextRequestSchema), { headers }),
        ).rejects.toMatchObject({ code: 16 });
      expect(values).toEqual(["", ""]);
    } finally {
      await server.close();
      await cookies.close();
    }
  });

  it("extracts an exact bearer credential before gateway admission", async () => {
    let credential: RequestCredential | undefined;
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        sessions: {
          resolve(value: RequestCredential) {
            credential = value;
            return Promise.resolve(undefined);
          },
        },
      },
    }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    try {
      await expect(
        client.resolveContext(create(ResolveContextRequestSchema), {
          headers: {
            origin: "http://127.0.0.1:5173",
            authorization: "Bearer exact-token",
          },
        }),
      ).rejects.toMatchObject({ code: 16 });
      expect(credential).toEqual({ kind: "bearer", value: "exact-token" });
    } finally {
      await server.close();
    }
  });

  it("forces a stalled permitted browser request closed before native cleanup", async () => {
    let admitted = false;
    const closed: string[] = [];
    const options = {
      ...browserGateway(),
      sessions: {
        resolve: () => {
          admitted = true;
          return new Promise<undefined>(() => undefined);
        },
      },
    };
    const server = await new Server({
      browser: { port: 0, ...options },
      resources: [{ close: () => closed.push("native") }],
    }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    const request = client.resolveContext(create(ResolveContextRequestSchema), {
      headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" },
    });
    const rejected = request.catch(() => undefined);
    try {
      await waitFor(() => admitted);
      await expect(
        Promise.race([
          server.close(),
          delay(1_000).then(() => {
            throw new Error("close timed out");
          }),
        ]),
      ).resolves.toBeUndefined();
      expect(closed).toEqual(["native"]);
    } finally {
      await rejected;
      await server.close().catch(() => undefined);
    }
  });

  it("shares a pending listener drain across a failed browser subscription close", async () => {
    let admitted = false;
    const closed: string[] = [];
    const drain = vi.spyOn(http.Server.prototype, "closeAllConnections");
    const subscriptionClose = vi
      .spyOn(SubscriptionGateway.prototype, "close")
      .mockRejectedValueOnce(new Error("subscription cleanup failed"));
    const server = await new Server({
      browser: {
        port: 0,
        ...browserGateway(),
        sessions: {
          resolve: () => {
            admitted = true;
            return new Promise<undefined>(() => undefined);
          },
        },
      },
      resources: [
        {
          close: () => {
            expect(drain).toHaveBeenCalledTimes(1);
            closed.push("native");
          },
        },
      ],
    }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    const request = client.resolveContext(create(ResolveContextRequestSchema), {
      headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" },
    });
    const rejected = request.catch(() => undefined);
    try {
      await waitFor(() => admitted);
      await expect(server.close()).rejects.toThrow("subscription cleanup failed");
      const retry = server.close();
      await delay(25);
      expect(closed).toEqual(["native"]);
      await expect(retry).resolves.toBeUndefined();
      expect(closed).toEqual(["native"]);
    } finally {
      subscriptionClose.mockRestore();
      drain.mockRestore();
      await rejected;
      await server.close().catch(() => undefined);
    }
  });

  it("retries a failed browser listener close", async () => {
    const close = vi.spyOn(http.Server.prototype, "close");
    const server = await new Server({ browser: { port: 0, ...browserGateway() } }).start();
    close.mockImplementationOnce(function (this: http.Server, callback?: (error?: Error) => void) {
      callback?.(new Error("browser listener close failed"));
      return this;
    });
    try {
      await expect(server.close()).rejects.toThrow("browser listener close failed");
      close.mockRestore();
      await expect(server.close()).resolves.toBeUndefined();
    } finally {
      close.mockRestore();
      await server.close().catch(() => undefined);
    }
  });

  it("replaces browser actor and tenant facts with trusted context", async () => {
    const options = {
      ...browserGateway(),
      sessions: {
        resolve: () =>
          Promise.resolve({
            principal: { id: "ada" },
            expiresAt: create(TimestampSchema, { seconds: 10n }),
          }),
      },
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "ada" }),
            timestamp: create(TimestampSchema),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "ada" }),
            tenant: create(TenantIdSchema, { kind: { case: "value", value: "acme" } }),
            timestamp: create(TimestampSchema),
          }),
      },
    };
    const server = await new Server({ browser: { port: 0, ...options } }).start();
    const client = createClient(
      AuthenticationService,
      createConnectTransport({ baseUrl: server.baseUrl, httpVersion: "1.1" }),
    );
    try {
      const response = await client.resolveContext(create(ResolveContextRequestSchema), {
        headers: { origin: "http://127.0.0.1:5173", authorization: "Bearer token" },
      });
      expect(response.actor?.value).toBe("ada");
      expect(response.tenant?.kind.value).toBe("acme");
    } finally {
      await server.close();
    }
  });

  it("rolls back the private native server when the public browser port is unavailable", async () => {
    const occupied = await Server.atPort(0).start();
    const closed: string[] = [];
    try {
      await expect(
        new Server({
          browser: { port: occupied.port, ...browserGateway() },
          resources: [{ close: () => closed.push("resource") }],
        }).start(),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(closed).toEqual(["resource"]);
    } finally {
      await occupied.close();
    }
  });

  it("retries only the unfinished native close phase behind the browser listener", async () => {
    let attempts = 0;
    const server = await new Server({
      browser: { port: 0, ...browserGateway() },
      resources: [
        {
          close: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("close failed");
          },
        },
      ],
    }).start();
    await expect(server.close()).rejects.toThrow("close failed");
    await expect(server.close()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("honors an explicit host and port", async () => {
    const server = await new Server({ host: "127.0.0.1", port: 0 }).start();

    try {
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("rejects blank hosts before opening a listener", () => {
    expect(() => new Server({ host: "" })).toThrow("Server host must not be blank.");
    expect(() => new Server({ host: " \t " })).toThrow("Server host must not be blank.");
  });

  it("rejects invalid network message bounds before opening a listener", () => {
    for (const value of [0, 1.5, 0x1_0000_0000, Number.NaN]) {
      expect(() => new Server({ readMaxBytes: value })).toThrow(
        "Server readMaxBytes must be an integer from 1 through 4294967295.",
      );
      expect(() => new Server({ writeMaxBytes: value })).toThrow(
        "Server writeMaxBytes must be an integer from 1 through 4294967295.",
      );
    }
  });

  it("closes active HTTP/2 sessions before owned resources", async () => {
    const order: string[] = [];
    const server = await Server.atPort(0)
      .addResource({
        close() {
          order.push("resource");
        },
      })
      .start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    session.on("close", () => order.push("session"));
    await once(session, "remoteSettings");

    await server.close();

    expect(order).toEqual(["session", "resource"]);
  });

  it("destroys non-draining HTTP/2 streams and still closes owned resources", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const closed: string[] = [];
    const server = await Server.atPort(0)
      .add(context)
      .addResource({
        close() {
          closed.push("resource");
        },
      })
      .start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    const request = session.request({
      [http2.constants.HTTP2_HEADER_METHOD]: "POST",
      [http2.constants.HTTP2_HEADER_PATH]: "/spine.client.SubscriptionService/Activate",
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/connect+proto",
    });
    request.on("error", () => undefined);
    request.on("close", () => closed.push("stream"));
    await once(session, "remoteSettings");
    request.write(Buffer.from([0]));
    await nextTurn();

    const close = server.close();
    const result = await Promise.race([
      close.then(() => "closed"),
      delay(500).then(() => "timed-out"),
    ]);
    if (result !== "closed") {
      request.close();
      session.destroy();
      await close.catch(() => undefined);
    }

    expect(result).toBe("closed");
    expect(closed).toContain("stream");
    expect(closed).toContain("resource");
    await expect(context.commandBus().post(create(CommandSchema))).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
  });

  it("ignores sessions already destroyed before server shutdown", async () => {
    const server = await Server.atPort(0).start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");

    session.destroy();
    await server.close();
  });

  it("attempts all owned resource closes and retries only failed closes", async () => {
    const firstError = new Error("first close failed");
    const closed: string[] = [];
    let firstAttempts = 0;
    const server = await Server.atPort(0)
      .addResource({
        close() {
          firstAttempts += 1;
          closed.push("first");
          if (firstAttempts === 1) {
            throw firstError;
          }
        },
      })
      .addResource({
        close() {
          closed.push("second");
        },
      })
      .start();

    await expect(server.close()).rejects.toMatchObject({
      errors: [firstError],
      message: "Server close failed while closing owned contexts/resources.",
    });
    await expect(server.close()).resolves.toBeUndefined();
    expect(closed).toEqual(["first", "second", "first"]);
  });

  it("ignores non-closeable resources and flattens aggregate close failures", async () => {
    const firstError = new Error("first nested close failed");
    const secondError = new Error("second nested close failed");
    const closed: string[] = [];
    const server = await new Server({
      resources: [
        null as unknown as { close(): unknown },
        {} as { close(): unknown },
        {
          close() {
            throw new AggregateError([firstError, secondError], "Nested close failed.");
          },
        },
        {
          close() {
            closed.push("after aggregate");
          },
        },
      ],
    }).start();

    await expect(server.close()).rejects.toMatchObject({
      errors: [firstError, secondError],
      message: "Server close failed while closing owned contexts/resources.",
    });
    expect(closed).toEqual(["after aggregate"]);
  });

  it("closes built bounded contexts and rejects later context work", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await Server.atPort(0).add(context).start();

    await server.close();
    await server.close();

    await expect(context.commandBus().post(create(CommandSchema))).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");
  });

  it("builds added context builders with the server environment storage factory", async () => {
    const storageFactory = new TrackingStorageFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory });
    const server = await new Server({
      contexts: [BoundedContext.singleTenant("Tasks")],
    }).start();

    try {
      expect(storageFactory.contextNames()).toContain("Tasks:subscriptions");
    } finally {
      await server.close();
    }

    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
  });

  it("keeps explicit builder storage factories over the server environment default", async () => {
    const environmentStorage = new TrackingStorageFactory();
    const builderStorage = new TrackingStorageFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: environmentStorage });
    const server = await Server.atPort(0)
      .add(BoundedContext.singleTenant("Tasks").withStorageFactory(builderStorage))
      .start();

    try {
      expect(builderStorage.contextNames()).toContain("Tasks:subscriptions");
      expect(environmentStorage.contextNames()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("closes contexts built earlier in the same start attempt when a later builder fails", async () => {
    const storageFactory = new TrackingStorageFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory });
    const brokenBuilder = BoundedContext.singleTenant("Broken").addEventDispatcher({
      messageSchemas() {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: () => Promise.resolve(),
    });

    await expect(
      Server.atPort(0).add(BoundedContext.singleTenant("Tasks")).add(brokenBuilder).start(),
    ).rejects.toThrow("Cannot read event schemas.");

    expect(storageFactory.contextNames()).toContain("Tasks:subscriptions");
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
  });

  it("removes local publish handlers when the last subscription closes", async () => {
    const environment = ServerEnvironment.instance();
    const topic = TransportTopics.create({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
    });
    const subscription = TransportSubscriptions.create({
      subscriberId: "test-subscriber",
      topic,
    });
    const received: unknown[] = [];
    const secondReceived: unknown[] = [];

    const handlePromise = environment.transport.subscribe(subscription, (operation) => {
      received.push(operation.envelope);
    });
    await environment.transport.publish({ topic, envelope: "before-await" });
    const handle = await handlePromise;
    const secondHandle = await environment.transport.subscribe(subscription, (operation) => {
      secondReceived.push(operation.envelope);
    });

    await environment.transport.publish({ topic, envelope: "before-close" });
    await handle.close();
    await handle.close();
    await environment.transport.publish({ topic, envelope: "after-first-close" });
    await secondHandle.close();
    await environment.transport.publish({ topic, envelope: "after-all-close" });
    await environment.close();

    expect(received).toEqual(["before-await", "before-close"]);
    expect(secondReceived).toEqual(["before-close", "after-first-close"]);
  });

  it("routes local request handlers and rejects duplicate responders", async () => {
    const environment = ServerEnvironment.instance();
    const topic = TransportTopics.create({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.LookupTask",
    });
    const subscription = TransportSubscriptions.create({
      subscriberId: "command-worker",
      topic,
      mode: "competing-consumer",
    });

    const handlePromise = environment.transport.respond<
      { readonly taskId: string },
      { readonly found: boolean; readonly taskId: string },
      "system"
    >(subscription, (operation) => ({
      found: true,
      taskId: operation.envelope.taskId,
    }));

    await expect(
      environment.transport.request({
        topic,
        envelope: { taskId: "task-0" },
      }),
    ).resolves.toEqual({ found: true, taskId: "task-0" });
    const handle = await handlePromise;
    await expect(
      environment.transport.respond(subscription, () => ({ found: false, taskId: "duplicate" })),
    ).rejects.toThrow('Local transport responder is already registered for "system:');
    await expect(
      environment.transport.request({
        topic,
        envelope: { taskId: "task-1" },
      }),
    ).resolves.toEqual({ found: true, taskId: "task-1" });

    await handle.close();

    await expect(
      environment.transport.request({
        topic,
        envelope: { taskId: "task-1" },
      }),
    ).rejects.toThrow('No local transport responder is registered for "system:');
    await environment.close();
  });

  it("rejects local transport work after environment close", async () => {
    const environment = ServerEnvironment.instance();
    const topic = TransportTopics.create({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.ClosedTransportTask",
    });
    const subscription = TransportSubscriptions.create({
      subscriberId: "closed-worker",
      topic,
    });

    await environment.close();

    await expect(environment.transport.publish({ topic, envelope: "closed" })).rejects.toThrow(
      "Local signal transport is closed.",
    );
    await expect(environment.transport.subscribe(subscription, () => undefined)).rejects.toThrow(
      "Local signal transport is closed.",
    );
    await expect(environment.transport.request({ topic, envelope: "closed" })).rejects.toThrow(
      "Local signal transport is closed.",
    );
    await expect(environment.transport.respond(subscription, () => "closed")).rejects.toThrow(
      "Local signal transport is closed.",
    );
  });

  it("leaves singleton facilities open when a server closes", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const environment = ServerEnvironment.instance();
    const server = await Server.atPort(0).start();

    await server.close();

    expect(closed).toEqual([]);

    await environment.close();

    expect(closed).toEqual(["transport", "storage"]);
  });

  it("retries failed environment facility closes without rerunning successful closes", async () => {
    const closed: string[] = [];
    const storageError = new Error("storage close failed once");
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new FlakyCloseStorageFactory(closed, storageError),
      transport: new CloseTrackingTransport(closed),
    });
    const environment = ServerEnvironment.instance();

    await expect(environment.close()).rejects.toMatchObject({
      errors: [storageError],
      message: "ServerEnvironment close failed.",
    });
    await expect(environment.close()).resolves.toBeUndefined();

    expect(closed).toEqual(["transport", "storage", "storage"]);
  });

  it("closes configured optional singleton facilities", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: new CloseTrackingCloseable(closed, "delivery") satisfies ServerEnvironmentCloseable,
      tracerFactory: new CloseTrackingCloseable(closed, "tracer"),
    });

    await ServerEnvironment.instance().close();
    expect(closed).toEqual(["delivery", "tracer"]);
  });

  it("closes singleton facilities only after server network sessions and resources", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const environment = ServerEnvironment.instance();
    const server = await Server.atPort(0)
      .addResource({
        close() {
          closed.push("resource");
        },
      })
      .start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    session.on("close", () => closed.push("session"));
    await once(session, "remoteSettings");

    await server.close();

    expect(closed).toEqual(["session", "resource"]);
    await environment.close();
    expect(closed).toEqual(["session", "resource", "transport", "storage"]);
  });

  it("cleans up owned resources but leaves the singleton open when listener open fails", async () => {
    const closed: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
    });
    const environment = ServerEnvironment.instance();
    const first = await Server.atPort(0).start();

    try {
      await expect(
        Server.atPort(first.port)
          .addResource({
            close() {
              closed.push("resource");
            },
          })
          .start(),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });

      expect(closed).toEqual(["resource"]);
      await first.close();
      await environment.close();
      expect(closed).toEqual(["resource", "transport", "storage"]);
    } finally {
      await first.close();
    }
  });
});

function once(target: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => {
    target.once(event, () => {
      resolve();
    });
  });
}

async function unusedPort(): Promise<number> {
  const listener = http.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test listener did not expose a TCP port.");
  }
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    }),
  );
  return address.port;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  throw new Error("Timed out waiting for signal shutdown.");
}

function browserGateway(): BrowserServerOptions {
  return {
    origins: ["http://127.0.0.1:5173"],
    sessions: { resolve: () => Promise.resolve(undefined) },
    authorize: () => Promise.resolve(false),
    contexts: {
      resolve: () =>
        Promise.resolve({
          actor: create(UserIdSchema, { value: "test" }),
          timestamp: create(TimestampSchema),
        }),
      resolveContext: () =>
        Promise.resolve({
          actor: create(UserIdSchema, { value: "test" }),
          timestamp: create(TimestampSchema),
        }),
    },
    clock: { now: () => create(TimestampSchema) },
  };
}

function inMemoryBindings(): InMemorySubscriptionBindings {
  return new InMemorySubscriptionBindings({
    nextId: () => globalThis.crypto.randomUUID(),
    dispose: () => Promise.resolve(),
  });
}

class CloseTrackingStorageFactory extends InMemoryStorageFactory {
  readonly #closed: string[];

  constructor(closed: string[]) {
    super();
    this.#closed = closed;
  }

  override close(): void {
    this.#closed.push("storage");
    super.close();
  }
}

class TrackingStorageFactory extends InMemoryStorageFactory {
  readonly contexts: StorageContext[] = [];
  readonly storages: RecordStorage<never, Message>[] = [];

  override createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.contexts.push(context);
    const storage = super.createRecordStorage(context, recordSpec);

    this.storages.push(storage as unknown as RecordStorage<never, Message>);
    return storage;
  }

  contextNames(): readonly string[] {
    return this.contexts.map((context) => context.name);
  }
}

class FlakyCloseStorageFactory extends InMemoryStorageFactory {
  readonly #closed: string[];
  readonly #error: Error;
  #attempts = 0;

  constructor(closed: string[], error: Error) {
    super();
    this.#closed = closed;
    this.#error = error;
  }

  override close(): void {
    this.#attempts += 1;
    this.#closed.push("storage");
    if (this.#attempts === 1) {
      throw this.#error;
    }
    super.close();
  }
}

class CloseTrackingCloseable {
  readonly #closed: string[];
  readonly #label: string;

  constructor(closed: string[], label: string) {
    this.#closed = closed;
    this.#label = label;
  }

  close(): void {
    this.#closed.push(this.#label);
  }
}

class CloseTrackingTransport implements SignalTransport {
  readonly #closed: string[];

  constructor(closed: string[]) {
    this.#closed = closed;
  }

  publish<Envelope, Kind extends TransportSignalKind>(
    _operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    void _operation;
    return Promise.resolve();
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    _handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    void _handler;
    return Promise.resolve(new CloseTrackingHandle(subscription));
  }

  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    _operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    void _operation;
    return Promise.reject(new Error("No test responder registered."));
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    _handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    void _handler;
    return Promise.resolve(new CloseTrackingHandle(subscription));
  }

  close(): Promise<void> {
    this.#closed.push("transport");
    return Promise.resolve();
  }
}

class CloseTrackingHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;

  constructor(subscription: TransportSubscription<Kind>) {
    this.subscription = subscription;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
