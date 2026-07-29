import * as http2 from "node:http2";

import { create, type Message } from "@bufbuild/protobuf";
import { CommandSchema } from "@spine-event-engine/proto";
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
import { TransportSubscriptions, TransportTopics } from "@spine-event-engine/transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BoundedContext,
  EnvironmentType,
  Server,
  ServerEnvironment,
  type ServerEnvironmentCloseable,
} from "../../src/index.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

describe("Server", () => {
  beforeEach(async () => {
    await resetServerEnvironmentForTest();
  });

  afterEach(async () => {
    await resetServerEnvironmentForTest();
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
      expect(storageFactory.contextNames()).toContain("Tasks");
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
      expect(builderStorage.contextNames()).toContain("Tasks");
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

    expect(storageFactory.contextNames()).toContain("Tasks");
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
  readonly storages: RecordStorage<unknown, Message>[] = [];

  override createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.contexts.push(context);
    const storage = super.createRecordStorage(context, recordSpec);

    this.storages.push(storage);
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
