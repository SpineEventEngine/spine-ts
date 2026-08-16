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

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

import { fromBinary, isMessage, toBinary } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-event-engine/proto";
import { Publisher, Reply, Request, Subscriber, type Socket, type MessageLike } from "zeromq";

import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
  TransportTopic,
} from "../index.js";
import type { ZeroMqConfig } from "./adapter-config.js";
import { ChannelEndpoints, type PreparedIpcDirectory } from "./channel-endpoints.js";
import { EndpointFiles } from "./endpoint-files.js";

/**
 * Optional tuning for the adapter-scoped local IPC transport.
 */
export interface ZeroMqTransportOptions {
  // prettier-ignore

  /**
   * Milliseconds used for bounded request/reply sends and receives.
   *
   * Defaults to 2,000. Explicit values must be integers from 1 through
   * 2,147,483,647.
   */
  readonly requestTimeoutMs?: number;

  /**
   * Milliseconds used by background worker sockets while waiting for messages.
   */
  readonly receiveTimeoutMs?: number;
}

interface InternalTransportOptions extends ZeroMqTransportOptions {
  // prettier-ignore

  /**
   * @internal Adapter-private hook for background loop failures.
   */
  readonly onBackgroundFailure?: (error: Error) => void;
}

type ActiveHandle = TransportSubscriptionHandle;
interface InternalTransportOperation {
  readonly topic: TransportTopic;
  readonly envelope: unknown;
}
interface PublishHandlerEntry {
  readonly subscription: TransportSubscription;
  readonly handler: (operation: InternalTransportOperation) => void | Promise<void>;
}
interface RequestHandlerEntry {
  readonly subscription: TransportSubscription;
  readonly handler: (operation: InternalTransportOperation) => unknown;
}

const defaultRequestTimeoutMs = 2_000;
const defaultReceiveTimeoutMs = 250;
const closeDelayMs = 0;
const nativeMessageMaxBytes = 8_388_608;
const requestHandlerFailureMessage = "ZeroMQ request handler failed.";
const privateDirectoryMode = 0o700;
/**
 * Exposes package-private native socket and filesystem operations for tests.
 */
export const zeroMqSocketAccess = {
  // prettier-ignore

  /**
   * Binds a publisher to an IPC address.
   *
   * @param socket Specifies the publisher.
   * @param address Specifies the IPC address.
   * @returns Completes after the publisher binds.
   */
  async bindPublisher(socket: Publisher, address: string): Promise<void> {
    await socket.bind(address);
  },

  /**
   * Binds a replier to an IPC address.
   *
   * @param socket Specifies the replier.
   * @param address Specifies the IPC address.
   * @returns Completes after the replier binds.
   */
  async bindReply(socket: Reply, address: string): Promise<void> {
    await socket.bind(address);
  },

  /**
   * Closes a native socket.
   *
   * @param socket Specifies the socket to close.
   */
  close(socket: Socket): void {
    socket.close();
  },

  /**
   * Connects a receiver to an IPC address.
   *
   * @param socket Specifies the receiver.
   * @param address Specifies the IPC address.
   */
  connect(socket: Subscriber | Request, address: string): void {
    socket.connect(address);
  },

  /**
   * Creates one private IPC directory component.
   *
   * @param directory Specifies the directory.
   * @returns Completes after the directory is created.
   */
  async createIpcDirectoryComponent(directory: string): Promise<void> {
    await mkdir(directory, { mode: privateDirectoryMode });
  },

  /**
   * Prepares and identifies a private IPC directory.
   *
   * @param ipcDirectory Specifies the directory.
   * @returns Returns its prepared identity.
   */
  async prepareIpcDirectory(ipcDirectory: string): Promise<PreparedIpcDirectory> {
    return await ChannelEndpoints.prepare(ipcDirectory, async (directory) => {
      await zeroMqSocketAccess.createIpcDirectoryComponent(directory);
    });
  },

  /**
   * Verifies a prepared IPC directory.
   *
   * @param prepared Specifies the directory identity.
   * @returns Completes after the directory is verified.
   */
  async recheckIpcDirectory(prepared: PreparedIpcDirectory): Promise<void> {
    await ChannelEndpoints.recheck(prepared);
  },

  /**
   * Sends frames through a publisher.
   *
   * @param socket Specifies the publisher.
   * @param frames Specifies the frames.
   * @returns Completes after the frames are sent.
   */
  async sendPublisher(socket: Publisher, frames: MessageLike[]): Promise<void> {
    await socket.send(frames);
  },

  /**
   * Sends frames through a requester.
   *
   * @param socket Specifies the requester.
   * @param frames Specifies the frames.
   * @returns Completes after the frames are sent.
   */
  async sendRequest(socket: Request, frames: MessageLike[]): Promise<void> {
    await socket.send(frames);
  },
};

/**
 * Creates signal transports scoped to one validated ZeroMQ adapter configuration.
 */
const ZeroMqTransport = {
  // prettier-ignore

  /**
   * Creates a transport from validated local IPC configuration.
   */
  create(config: ZeroMqConfig, options: ZeroMqTransportOptions = {}): SignalTransport {
    return new ZeroMqSignalTransport(config, options);
  },
};

/**
 * Creates a same-host ZeroMQ-backed transport over deterministic local IPC endpoints.
 *
 * @param config Specifies validated local IPC configuration.
 * @param options Specifies optional socket timeouts.
 * @returns Returns the transport contract.
 */
export const createZeroMqTransport: (
  config: ZeroMqConfig,
  options?: ZeroMqTransportOptions,
) => SignalTransport = (config, options) => ZeroMqTransport.create(config, options);

class ZeroMqSignalTransport implements SignalTransport {
  readonly #config: ZeroMqConfig;
  readonly #requestTimeoutMs: number;
  readonly #receiveTimeoutMs: number;
  readonly #onBackgroundFailure: ((error: Error) => void) | undefined;
  readonly #publishers = new Map<string, BoundPublisher>();
  readonly #publisherBinds = new Map<string, Promise<BoundPublisher>>();
  readonly #publishes = new Set<Promise<void>>();
  readonly #responderBinds = new Set<Promise<TransportSubscriptionHandle>>();
  readonly #subscriberOpens = new Set<Promise<TransportSubscriptionHandle>>();
  readonly #requests = new Set<Promise<unknown>>();
  readonly #activeHandles = new Set<ActiveHandle>();
  #closed = false;
  #close: Promise<void> | undefined;

  constructor(config: ZeroMqConfig, options: InternalTransportOptions) {
    this.#config = config;
    this.#requestTimeoutMs = ZeroMqTimeouts.request(options.requestTimeoutMs);
    this.#receiveTimeoutMs = options.receiveTimeoutMs ?? defaultReceiveTimeoutMs;
    this.#onBackgroundFailure = options.onBackgroundFailure;
  }

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    this.#requireOpen();
    const publish = this.#performPublish(operation);
    this.#publishes.add(publish);

    try {
      await publish;
    } finally {
      this.#publishes.delete(publish);
    }
  }

  async #performPublish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    const publisher = await this.#publisherFor(operation.topic);
    this.#requireOpen();
    await zeroMqSocketAccess.sendPublisher(publisher.socket, [
      operation.topic.routing.routingKey,
      ZeroMqFrames.encodeEnvelope(operation.topic, operation.envelope),
    ]);
  }

  async subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    const open = this.#openSubscriber(subscription, handler);
    this.#subscriberOpens.add(open);

    try {
      return await open;
    } finally {
      this.#subscriberOpens.delete(open);
    }
  }

  async #openSubscriber<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    const prepared = await zeroMqSocketAccess.prepareIpcDirectory(this.#config.ipcDirectory);
    this.#requireOpen();

    const subscriber = new Subscriber({
      linger: closeDelayMs,
      maxMessageSize: nativeMessageMaxBytes,
      receiveTimeout: this.#receiveTimeoutMs,
    });
    const entry: PublishHandlerEntry = {
      subscription,
      handler: handler as PublishHandlerEntry["handler"],
    };

    let handle: ZeroMqSubscriptionHandle<Kind> | undefined;

    try {
      subscriber.subscribe(subscription.topic.routing.routingKey);
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      this.#requireOpen();
      const endpoint = ZeroMqEndpoints.for(
        this.#config,
        prepared.path,
        subscription.topic,
        "publish",
      );
      zeroMqSocketAccess.connect(subscriber, endpoint.address);

      const openedHandle = new ZeroMqSubscriptionHandle(subscription, subscriber, undefined, () => {
        this.#activeHandles.delete(openedHandle);
      });
      handle = openedHandle;

      if (this.#closed) {
        throw new Error("ZeroMQ signal transport is closed.");
      }

      this.#activeHandles.add(openedHandle);
      void this.#runSubscriber(subscriber, entry, openedHandle);

      return openedHandle;
    } catch (error) {
      try {
        if (handle === undefined) {
          zeroMqSocketAccess.close(subscriber);
        } else {
          await handle.close();
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "ZeroMQ subscriber setup and cleanup failed.",
        );
      }
      throw error;
    }
  }

  async request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    this.#requireOpen();
    const request = this.#performRequest<RequestEnvelope, ResponseEnvelope, Kind>(operation);
    this.#requests.add(request);

    try {
      return await request;
    } finally {
      this.#requests.delete(request);
    }
  }

  async #performRequest<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    const prepared = await zeroMqSocketAccess.prepareIpcDirectory(this.#config.ipcDirectory);
    this.#requireOpen();

    const requester = new Request({
      linger: closeDelayMs,
      maxMessageSize: nativeMessageMaxBytes,
      receiveTimeout: this.#requestTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });
    let responseEnvelope!: ResponseEnvelope;

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      this.#requireOpen();
      const endpoint = ZeroMqEndpoints.for(this.#config, prepared.path, operation.topic, "request");
      zeroMqSocketAccess.connect(requester, endpoint.address);
      await zeroMqSocketAccess.sendRequest(requester, [
        operation.topic.routing.routingKey,
        ZeroMqFrames.encodeEnvelope(operation.topic, operation.envelope),
      ]);
      const [response] = await requester.receive();
      const decoded = ZeroMqReplyFrames.decodeReply(response);

      if (decoded.status === "failed") {
        throw new Error(decoded.message);
      }

      responseEnvelope = decoded.envelope as ResponseEnvelope;
    } catch (error) {
      try {
        zeroMqSocketAccess.close(requester);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "ZeroMQ request and cleanup failed.");
      }
      throw error;
    }

    zeroMqSocketAccess.close(requester);
    return responseEnvelope;
  }

  async respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    const bind = this.#bindResponder(subscription, handler);
    this.#responderBinds.add(bind);

    try {
      return await bind;
    } finally {
      this.#responderBinds.delete(bind);
    }
  }

  async #bindResponder<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    const prepared = await zeroMqSocketAccess.prepareIpcDirectory(this.#config.ipcDirectory);
    this.#requireOpen();

    const replier = new Reply({
      linger: closeDelayMs,
      maxMessageSize: nativeMessageMaxBytes,
      receiveTimeout: this.#receiveTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });
    const entry: RequestHandlerEntry = {
      subscription,
      handler: handler as RequestHandlerEntry["handler"],
    };
    let handle: ZeroMqSubscriptionHandle<Kind> | undefined;

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      this.#requireOpen();
      const endpoint = ZeroMqEndpoints.for(
        this.#config,
        prepared.path,
        subscription.topic,
        "request",
      );
      await zeroMqSocketAccess.bindReply(replier, endpoint.address);

      const openedHandle = new ZeroMqSubscriptionHandle(
        subscription,
        replier,
        endpoint.filePath,
        () => {
          this.#activeHandles.delete(openedHandle);
        },
      );
      handle = openedHandle;
      this.#activeHandles.add(openedHandle);

      if (this.#closed) {
        throw new Error("ZeroMQ signal transport is closed.");
      }

      void this.#runReplier(replier, entry, openedHandle);

      return openedHandle;
    } catch (error) {
      try {
        if (handle === undefined) {
          zeroMqSocketAccess.close(replier);
        } else {
          await handle.close();
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "ZeroMQ responder bind and cleanup failed.",
        );
      }
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.#close === undefined) {
      this.#close = this.#closeAll().catch((error: unknown) => {
        this.#close = undefined;
        throw error;
      });
    }

    return this.#close;
  }

  async #publisherFor(topic: TransportTopic): Promise<BoundPublisher> {
    const key = topic.routing.routingKey;
    const existing = this.#publishers.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const inFlight = this.#publisherBinds.get(key);

    if (inFlight !== undefined) {
      return inFlight;
    }

    const bind = this.#bindPublisher(topic, key);
    this.#publisherBinds.set(key, bind);

    try {
      return await bind;
    } finally {
      this.#publisherBinds.delete(key);
    }
  }

  async #bindPublisher(topic: TransportTopic, key: string): Promise<BoundPublisher> {
    const prepared = await zeroMqSocketAccess.prepareIpcDirectory(this.#config.ipcDirectory);
    this.#requireOpen();

    const publisher = new Publisher({
      linger: closeDelayMs,
    });

    let bound: BoundPublisher | undefined;

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      this.#requireOpen();
      const endpoint = ZeroMqEndpoints.for(this.#config, prepared.path, topic, "publish");
      await zeroMqSocketAccess.bindPublisher(publisher, endpoint.address);

      const cleanup = new ZeroMqSocketCleanup(publisher, endpoint.filePath, () => {
        this.#publishers.delete(key);
      });
      bound = Object.freeze({
        cleanup,
        topic,
        socket: publisher,
      });
      this.#publishers.set(key, bound);

      if (this.#closed) {
        throw new Error("ZeroMQ signal transport is closed.");
      }

      return bound;
    } catch (error) {
      if (bound === undefined) {
        try {
          zeroMqSocketAccess.close(publisher);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "ZeroMQ publisher bind and cleanup failed.",
          );
        }
        throw error;
      }

      try {
        await bound.cleanup.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "ZeroMQ publisher setup and cleanup failed.",
        );
      }
      throw error;
    }
  }

  async #runSubscriber(
    subscriber: Subscriber,
    entry: PublishHandlerEntry,
    handle: ZeroMqSubscriptionHandle<TransportSignalKind>,
  ): Promise<void> {
    for (;;) {
      if (handle.closed) {
        break;
      }
      try {
        const received = await ZeroMqReceives.receiveFrames(subscriber);

        if (received.status === "stopped") {
          continue;
        }

        const [routingFrame, envelopeFrame] = received.frames;

        if (
          ZeroMqReplyFrames.readRoute(routingFrame) !== entry.subscription.topic.routing.routingKey
        ) {
          continue;
        }

        await entry.handler({
          topic: entry.subscription.topic,
          envelope: ZeroMqFrames.decodeEnvelope(entry.subscription.topic, envelopeFrame),
        });
      } catch (error) {
        this.#recordBackgroundFailure(error);
      }
    }
  }

  async #runReplier(
    replier: Reply,
    entry: RequestHandlerEntry,
    handle: ZeroMqSubscriptionHandle<TransportSignalKind>,
  ): Promise<void> {
    for (;;) {
      if (handle.closed) {
        break;
      }
      try {
        const received = await ZeroMqReceives.receiveFrames(replier);

        if (received.status === "stopped") {
          continue;
        }

        const [routingFrame, envelopeFrame] = received.frames;

        if (
          ZeroMqReplyFrames.readRoute(routingFrame) !== entry.subscription.topic.routing.routingKey
        ) {
          await this.#trySendFailure(replier, "ZeroMQ transport received an unexpected route.");
          continue;
        }

        const response = await entry.handler({
          topic: entry.subscription.topic,
          envelope: ZeroMqFrames.decodeEnvelope(entry.subscription.topic, envelopeFrame),
        });
        ZeroMqFrames.rejectGeneratedProtoReply(response);
        await replier.send(ZeroMqReplyFrames.encodeReplySuccess(response));
      } catch (error) {
        this.#recordBackgroundFailure(error);
        await this.#trySendFailure(replier, requestHandlerFailureMessage);
      }
    }
  }

  async #closeAll(): Promise<void> {
    this.#closed = true;
    const failures: unknown[] = [];

    await Promise.allSettled([
      ...this.#publisherBinds.values(),
      ...this.#responderBinds,
      ...this.#subscriberOpens,
      ...this.#requests,
    ]);

    for (const handle of [...this.#activeHandles]) {
      await ZeroMqCleanup.capture(() => handle.close(), failures);
    }
    for (const publisher of this.#publishers.values()) {
      await ZeroMqCleanup.capture(() => publisher.cleanup.close(), failures);
    }
    await Promise.allSettled(this.#publishes);

    if (failures.length > 0) {
      throw ZeroMqCleanup.failure(failures, "ZeroMQ signal transport close failed.");
    }
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new Error("ZeroMQ signal transport is closed.");
    }
  }

  async #trySendFailure(replier: Reply, message: string): Promise<void> {
    try {
      await replier.send(ZeroMqReplyFrames.encodeReplyFailure(message));
    } catch (error) {
      this.#recordBackgroundFailure(error);
    }
  }

  #recordBackgroundFailure(error: unknown): void {
    const failure = ZeroMqCleanup.error(error);

    try {
      this.#onBackgroundFailure?.(failure);
    } catch {
      // Background diagnostics must not terminate transport receive loops.
    }
  }
}

/**
 * Normalizes timeout values accepted by the ZeroMQ adapter.
 */
const ZeroMqTimeouts = {
  // prettier-ignore

  /**
   * Returns a supported request timeout.
   */
  request(value: number | undefined): number {
    if (value === undefined) {
      return defaultRequestTimeoutMs;
    }
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new TypeError(
        "ZeroMQ transport requestTimeoutMs must be an integer from 1 through 2147483647.",
      );
    }
    return value;
  },
};

interface BoundPublisher {
  readonly cleanup: ZeroMqSocketCleanup<Publisher>;
  readonly topic: TransportTopic;
  readonly socket: Publisher;
}

interface IpcEndpoint {
  readonly address: string;
  readonly filePath: string;
}

class ZeroMqSubscriptionHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #cleanup: ZeroMqSocketCleanup<Socket>;

  constructor(
    subscription: TransportSubscription<Kind>,
    socket: Socket,
    endpointFile: string | undefined,
    onClose: () => void,
  ) {
    this.subscription = subscription;
    this.#cleanup = new ZeroMqSocketCleanup(socket, endpointFile, onClose);
  }

  get closed(): boolean {
    return this.#cleanup.socketClosed;
  }

  close(): Promise<void> {
    return this.#cleanup.close();
  }
}

class ZeroMqSocketCleanup<NativeSocket extends Socket> {
  readonly socket: NativeSocket;
  readonly #onClose: () => void;
  #close: Promise<void> | undefined;
  #endpointFile: string | undefined;
  #socketClosed = false;

  constructor(socket: NativeSocket, endpointFile: string | undefined, onClose: () => void) {
    this.socket = socket;
    this.#endpointFile = endpointFile;
    this.#onClose = onClose;
  }

  get socketClosed(): boolean {
    return this.#socketClosed;
  }

  close(): Promise<void> {
    if (this.#close === undefined) {
      const close = this.#closeOnce();
      this.#close = close;
      void close.catch(() => {
        if (this.#close === close) {
          this.#close = undefined;
        }
      });
    }

    return this.#close;
  }

  async #closeOnce(): Promise<void> {
    const failures: unknown[] = [];

    if (!this.#socketClosed) {
      this.#socketClosed = true;
      try {
        this.socket.close();
      } catch (error) {
        failures.push(error);
      }
    }

    const endpointFile = this.#endpointFile;
    if (endpointFile !== undefined) {
      try {
        await EndpointFiles.remove(endpointFile);
        this.#endpointFile = undefined;
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw ZeroMqCleanup.failure(failures, "ZeroMQ socket cleanup failed.");
    }

    this.#onClose();
  }
}

type ReplyEnvelope =
  | { readonly status: "accepted"; readonly envelope: unknown }
  | { readonly status: "failed"; readonly message: string };

/**
 * Derives deterministic IPC endpoints for transport routing topics.
 */
const ZeroMqEndpoints = {
  // prettier-ignore

  /**
   * Derives an endpoint for one routing topic and channel.
   */
  for(
    config: ZeroMqConfig,
    canonicalDirectory: string,
    topic: TransportTopic,
    channel: "publish" | "request",
  ): IpcEndpoint {
    const digest = createHash("sha256")
      .update(config.adapterIdentity)
      .update("\0")
      .update(channel)
      .update("\0")
      .update(topic.routing.routingKey)
      .digest("hex")
      .slice(0, 24);
    const signalKindPrefix = topic.signalKind[0] ?? "s";
    const channelPrefix = channel[0] ?? "c";
    const fileName = `s${signalKindPrefix}-${channelPrefix}-${digest}.sock`;
    const filePath = path.join(canonicalDirectory, fileName);
    return Object.freeze({ address: `ipc://${filePath}`, filePath });
  },
};

/**
 * Encodes multipart transport frames and replies for ZeroMQ exchange.
 */
const ZeroMqFrames = {
  // prettier-ignore

  /**
   * Encodes one transport envelope into its wire frame.
   */
  encodeEnvelope(topic: TransportTopic, envelope: unknown): Buffer {
    switch (topic.signalKind) {
      case "command":
        return Buffer.from(
          toBinary(CommandSchema, envelope as Command, { writeUnknownFields: false }),
        );
      case "event":
        return Buffer.from(toBinary(EventSchema, envelope as Event, { writeUnknownFields: false }));
      case "query":
      case "subscription":
      case "system":
        return serialize(envelope);
    }
  },

  /**
   * Decodes one transport envelope wire frame.
   */
  decodeEnvelope(topic: TransportTopic, frame: Buffer | undefined): unknown {
    if (frame === undefined) {
      throw new Error("ZeroMQ transport received an incomplete envelope.");
    }

    switch (topic.signalKind) {
      case "command":
        return fromBinary(CommandSchema, frame, { readUnknownFields: false });
      case "event":
        return fromBinary(EventSchema, frame, { readUnknownFields: false });
      case "query":
      case "subscription":
      case "system":
        return deserialize(frame);
    }
  },

  /**
   * Rejects reply values that cannot use the adapter reply encoding.
   */
  rejectGeneratedProtoReply(envelope: unknown): void {
    if (isMessage(envelope)) {
      throw new Error("ZeroMQ transport cannot encode generated Protobuf replies.");
    }
  },
};

/**
 * Handles recoverable native receive and cleanup errors.
 */
const ZeroMqReceives = {
  // prettier-ignore

  /**
   * Receives frames while treating expected socket stops as idle.
   */
  async receiveFrames(
    socket: Subscriber | Reply,
  ): Promise<
    { readonly status: "received"; readonly frames: Buffer[] } | { readonly status: "stopped" }
  > {
    try {
      return {
        status: "received",
        frames: await socket.receive(),
      };
    } catch (error) {
      if (ZeroMqCleanup.isExpectedReceiveStop(error)) {
        return { status: "stopped" };
      }

      throw error;
    }
  },
};

/**
 * Encodes ZeroMQ reply and route frames.
 */
const ZeroMqReplyFrames = {
  // prettier-ignore

  /**
   * Encodes a successful reply.
   */
  encodeReplySuccess(envelope: unknown): MessageLike {
    return serialize({
      status: "accepted",
      envelope,
    } satisfies ReplyEnvelope);
  },

  /**
   * Encodes a failed reply.
   */
  encodeReplyFailure(message: string): MessageLike {
    return serialize({
      status: "failed",
      message,
    } satisfies ReplyEnvelope);
  },

  /**
   * Decodes a reply frame.
   */
  decodeReply(frame: Buffer | undefined): ReplyEnvelope {
    if (frame === undefined) {
      throw new Error("ZeroMQ transport received an incomplete envelope.");
    }

    const decoded: unknown = deserialize(frame);

    if (ZeroMqReplyFrames.isReplyEnvelope(decoded)) {
      return decoded;
    }

    throw new Error("ZeroMQ transport received a malformed reply.");
  },

  /**
   * Recognizes a serialized reply shape.
   */
  isReplyEnvelope(value: unknown): value is ReplyEnvelope {
    if (value === null || typeof value !== "object" || !("status" in value)) {
      return false;
    }

    const status = (value as { readonly status: unknown }).status;

    if (status === "accepted") {
      return "envelope" in value;
    }

    return (
      status === "failed" && typeof (value as { readonly message?: unknown }).message === "string"
    );
  },

  /**
   * Reads a required route frame.
   */
  readRoute(frame: Buffer | undefined): string {
    if (frame === undefined) {
      throw new Error("ZeroMQ transport received an incomplete route.");
    }

    return frame.toString("utf8");
  },
};

/**
 * Creates recoverable native socket and cleanup errors.
 */
const ZeroMqCleanup = {
  // prettier-ignore

  /**
   * Recognizes normal native socket stop errors.
   */
  isExpectedReceiveStop(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /closed|timed out|EAGAIN|EBADF|ETERM/iu.test(error.message);
  },

  /**
   * Converts an unknown failure to an Error.
   */
  error(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  },

  /**
   * Captures one cleanup failure without stopping later cleanup.
   */
  async capture(cleanup: () => void | Promise<void>, failures: unknown[]): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  },

  /**
   * Returns the one failure or aggregates multiple failures.
   */
  failure(failures: readonly unknown[], message: string): Error {
    const [failure] = failures;
    if (failures.length === 1 && failure !== undefined) {
      return ZeroMqCleanup.error(failure);
    }
    return new AggregateError(failures, message);
  },
};
