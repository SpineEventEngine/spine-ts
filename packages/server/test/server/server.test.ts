import * as http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { CommandSchema } from "@spine-ts/proto";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-ts/transport";
import { createTransportSubscription, createTransportTopic } from "@spine-ts/transport";
import { describe, expect, it } from "vitest";

import { BoundedContext, Server, ServerEnvironment } from "../../src/index.js";

describe("Server", () => {
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

  it("rejects production environments without required storage and transport", () => {
    const storageFactory = new InMemoryStorageFactory();
    const transport = new CloseTrackingTransport([]);

    expect(() =>
      ServerEnvironment.production({ transport } as unknown as {
        storageFactory: InMemoryStorageFactory;
        transport: SignalTransport;
      }),
    ).toThrow("Production ServerEnvironment requires storageFactory.");
    expect(() =>
      ServerEnvironment.production({ storageFactory } as unknown as {
        storageFactory: InMemoryStorageFactory;
        transport: SignalTransport;
      }),
    ).toThrow("Production ServerEnvironment requires transport.");
  });

  it("removes local publish handlers when the last subscription closes", async () => {
    const environment = ServerEnvironment.local();
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
    });
    const subscription = createTransportSubscription({
      subscriberId: "test-subscriber",
      topic,
    });
    const received: unknown[] = [];

    const handle = await environment.transport.subscribe(subscription, (operation) => {
      received.push(operation.envelope);
    });

    await environment.transport.publish({ topic, envelope: "before-close" });
    await handle.close();
    await environment.transport.publish({ topic, envelope: "after-close" });
    await environment.close();

    expect(received).toEqual(["before-close"]);
  });

  it("leaves caller-owned environments open by default", async () => {
    const closed: string[] = [];
    const environment = ServerEnvironment.local({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
      ownsStorageFactory: true,
      ownsTransport: true,
    });
    const server = await Server.atPort(0, { environment }).start();

    await server.close();

    expect(closed).toEqual([]);

    await environment.close();

    expect(closed).toEqual(["transport", "storage"]);
  });

  it("retries failed environment facility closes without rerunning successful closes", async () => {
    const closed: string[] = [];
    const storageError = new Error("storage close failed once");
    const environment = ServerEnvironment.local({
      storageFactory: new FlakyCloseStorageFactory(closed, storageError),
      transport: new CloseTrackingTransport(closed),
      ownsStorageFactory: true,
      ownsTransport: true,
    });

    await expect(environment.close()).rejects.toMatchObject({
      errors: [storageError],
      message: "ServerEnvironment close failed.",
    });
    await expect(environment.close()).resolves.toBeUndefined();

    expect(closed).toEqual(["transport", "storage", "storage"]);
  });

  it("closes server-owned environments after network sessions and resources", async () => {
    const closed: string[] = [];
    const environment = ServerEnvironment.local({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
      ownsStorageFactory: true,
      ownsTransport: true,
    });
    const server = await Server.atPort(0, { environment, ownsEnvironment: true })
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

    expect(closed).toEqual(["session", "resource", "transport", "storage"]);
  });

  it("cleans up owned resources and environment when listener open fails", async () => {
    const first = await Server.atPort(0).start();
    const closed: string[] = [];
    const environment = ServerEnvironment.local({
      storageFactory: new CloseTrackingStorageFactory(closed),
      transport: new CloseTrackingTransport(closed),
      ownsStorageFactory: true,
      ownsTransport: true,
    });

    try {
      await expect(
        Server.atPort(first.port, { environment, ownsEnvironment: true })
          .addResource({
            close() {
              closed.push("resource");
            },
          })
          .start(),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });

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

class CloseTrackingTransport implements SignalTransport {
  readonly #closed: string[];

  constructor(closed: string[]) {
    this.#closed = closed;
  }

  publish<Envelope, Kind extends TransportSignalKind>(
    _operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    return Promise.resolve();
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    _handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    return Promise.resolve(new CloseTrackingHandle(subscription));
  }

  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    _operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    return Promise.reject(new Error("No test responder registered."));
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    _handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
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
