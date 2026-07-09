import { mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

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
import type { ZeroMqAdapterConfig } from "./adapter-config.js";

/** Optional tuning for the adapter-scoped local IPC transport. */
export interface ZeroMqTransportOptions {
  /** Milliseconds used for bounded request/reply sends and receives. */
  readonly requestTimeoutMs?: number;
  /** Milliseconds used by background worker sockets while waiting for messages. */
  readonly receiveTimeoutMs?: number;
  /** @internal Adapter-private hook for background loop failures. */
  readonly onBackgroundFailure?: (error: Error) => void;
}

type ActiveHandle = TransportSubscriptionHandle;
interface PublishHandlerEntry {
  readonly subscription: TransportSubscription;
  readonly handler: PublishTransportHandler;
}
interface RequestHandlerEntry {
  readonly subscription: TransportSubscription;
  readonly handler: RequestTransportHandler;
}

const defaultRequestTimeoutMs = 2_000;
const defaultReceiveTimeoutMs = 250;
const closeDelayMs = 0;
const requestHandlerFailureMessage = "ZeroMQ request handler failed.";
const privateDirectoryMode = 0o700;
const unsafeModeMask = 0o077;

/** Create a same-host ZeroMQ-backed `SignalTransport` over deterministic local IPC endpoints. */
export function createZeroMqTransport(
  config: ZeroMqAdapterConfig,
  options: ZeroMqTransportOptions = {},
): SignalTransport {
  return new ZeroMqSignalTransport(config, options);
}

class ZeroMqSignalTransport implements SignalTransport {
  readonly #config: ZeroMqAdapterConfig;
  readonly #requestTimeoutMs: number;
  readonly #receiveTimeoutMs: number;
  readonly #onBackgroundFailure: ((error: Error) => void) | undefined;
  readonly #publishers = new Map<string, BoundPublisher>();
  readonly #publisherBinds = new Map<string, Promise<BoundPublisher>>();
  readonly #activeHandles = new Set<ActiveHandle>();
  #closed = false;
  #close: Promise<void> | undefined;

  constructor(config: ZeroMqAdapterConfig, options: ZeroMqTransportOptions) {
    this.#config = config;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
    this.#receiveTimeoutMs = options.receiveTimeoutMs ?? defaultReceiveTimeoutMs;
    this.#onBackgroundFailure = options.onBackgroundFailure;
  }

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    this.#requireOpen();
    const publisher = await this.#publisherFor(operation.topic);
    await publisher.socket.send([
      operation.topic.routing.routingKey,
      encodeEnvelope(operation.envelope),
    ]);
  }

  async subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    await ensurePrivateIpcDirectory(this.#config.ipcDirectory);

    const subscriber = new Subscriber({
      linger: closeDelayMs,
      receiveTimeout: this.#receiveTimeoutMs,
    });
    const endpoint = endpointFor(this.#config, subscription.topic, "publish");
    const entry: PublishHandlerEntry = {
      subscription,
      handler: handler as PublishTransportHandler,
    };

    subscriber.subscribe(subscription.topic.routing.routingKey);
    subscriber.connect(endpoint);

    const handle = new ZeroMqSubscriptionHandle(subscription, subscriber, () => {
      this.#activeHandles.delete(handle);
    });
    this.#activeHandles.add(handle);
    void this.#runSubscriber(subscriber, entry, handle);

    return handle;
  }

  async request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    this.#requireOpen();
    await ensurePrivateIpcDirectory(this.#config.ipcDirectory);

    const requester = new Request({
      linger: closeDelayMs,
      receiveTimeout: this.#requestTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });

    try {
      requester.connect(endpointFor(this.#config, operation.topic, "request"));
      await requester.send([
        operation.topic.routing.routingKey,
        encodeEnvelope(operation.envelope),
      ]);
      const [response] = await requester.receive();
      const decoded = decodeReply(response);

      if (decoded.status === "failed") {
        throw new Error(decoded.message);
      }

      return decoded.envelope as ResponseEnvelope;
    } finally {
      requester.close();
    }
  }

  async respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#requireOpen();
    await ensurePrivateIpcDirectory(this.#config.ipcDirectory);

    const replier = new Reply({
      linger: closeDelayMs,
      receiveTimeout: this.#receiveTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });
    const entry: RequestHandlerEntry = {
      subscription,
      handler: handler as RequestTransportHandler,
    };

    await replier.bind(endpointFor(this.#config, subscription.topic, "request"));

    const handle = new ZeroMqSubscriptionHandle(subscription, replier, () => {
      this.#activeHandles.delete(handle);
    });
    this.#activeHandles.add(handle);
    void this.#runReplier(replier, entry, handle);

    return handle;
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
    await ensurePrivateIpcDirectory(this.#config.ipcDirectory);

    const publisher = new Publisher({
      linger: closeDelayMs,
      sendTimeout: this.#requestTimeoutMs,
    });

    try {
      await publisher.bind(endpointFor(this.#config, topic, "publish"));

      if (this.#closed) {
        throw new Error("ZeroMQ signal transport is closed.");
      }

      const bound = Object.freeze({
        topic,
        socket: publisher,
      });
      this.#publishers.set(key, bound);

      return bound;
    } catch (error) {
      publisher.close();
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
        const received = await receiveFrames(subscriber);

        if (received.status === "stopped") {
          continue;
        }

        const [routingFrame, envelopeFrame] = received.frames;

        if (readFrame(routingFrame) !== entry.subscription.topic.routing.routingKey) {
          continue;
        }

        await entry.handler({
          topic: entry.subscription.topic,
          envelope: decodeEnvelope(envelopeFrame),
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
        const received = await receiveFrames(replier);

        if (received.status === "stopped") {
          continue;
        }

        const [routingFrame, envelopeFrame] = received.frames;

        if (readFrame(routingFrame) !== entry.subscription.topic.routing.routingKey) {
          await this.#trySendFailure(replier, "ZeroMQ transport received an unexpected route.");
          continue;
        }

        const response = await entry.handler({
          topic: entry.subscription.topic,
          envelope: decodeEnvelope(envelopeFrame),
        });
        await replier.send(encodeReplySuccess(response));
      } catch (error) {
        this.#recordBackgroundFailure(error);
        await this.#trySendFailure(replier, requestHandlerFailureMessage);
      }
    }
  }

  async #closeAll(): Promise<void> {
    this.#closed = true;

    await Promise.all([...this.#activeHandles].map((handle) => handle.close()));
    await Promise.allSettled(this.#publisherBinds.values());

    for (const publisher of this.#publishers.values()) {
      publisher.socket.close();
    }
    this.#publishers.clear();
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new Error("ZeroMQ signal transport is closed.");
    }
  }

  async #trySendFailure(replier: Reply, message: string): Promise<void> {
    try {
      await replier.send(encodeReplyFailure(message));
    } catch (error) {
      this.#recordBackgroundFailure(error);
    }
  }

  #recordBackgroundFailure(error: unknown): void {
    const failure = toError(error);

    try {
      this.#onBackgroundFailure?.(failure);
    } catch {
      // Background diagnostics must not terminate transport receive loops.
    }
  }
}

interface BoundPublisher {
  readonly topic: TransportTopic;
  readonly socket: Publisher;
}

class ZeroMqSubscriptionHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #socket: Socket;
  readonly #onClose: () => void;
  #closed = false;

  constructor(subscription: TransportSubscription<Kind>, socket: Socket, onClose: () => void) {
    this.subscription = subscription;
    this.#socket = socket;
    this.#onClose = onClose;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#socket.close();
      this.#onClose();
    }

    return Promise.resolve();
  }
}

type ReplyEnvelope =
  | { readonly status: "accepted"; readonly envelope: unknown }
  | { readonly status: "failed"; readonly message: string };

function endpointFor(
  config: ZeroMqAdapterConfig,
  topic: TransportTopic,
  channel: "publish" | "request",
): string {
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

  return `ipc://${path.join(config.ipcDirectory, fileName)}`;
}

function encodeEnvelope(envelope: unknown): Buffer {
  return serialize(envelope);
}

function decodeEnvelope(frame: Buffer | undefined): unknown {
  if (frame === undefined) {
    throw new Error("ZeroMQ transport received an incomplete envelope.");
  }

  return deserialize(frame);
}

async function ensurePrivateIpcDirectory(ipcDirectory: string): Promise<void> {
  await mkdir(ipcDirectory, { recursive: true, mode: privateDirectoryMode });
  const directory = await stat(ipcDirectory);

  if (!directory.isDirectory()) {
    throw new Error("ZeroMQ adapter ipcDirectory must be a directory.");
  }

  if ((directory.mode & unsafeModeMask) !== 0) {
    throw new Error("ZeroMQ adapter ipcDirectory must be private to the current user.");
  }
}

async function receiveFrames(
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
    if (isExpectedReceiveStop(error)) {
      return { status: "stopped" };
    }

    throw error;
  }
}

function encodeReplySuccess(envelope: unknown): MessageLike {
  return serialize({
    status: "accepted",
    envelope,
  } satisfies ReplyEnvelope);
}

function encodeReplyFailure(message: string): MessageLike {
  return serialize({
    status: "failed",
    message,
  } satisfies ReplyEnvelope);
}

function decodeReply(frame: Buffer | undefined): ReplyEnvelope {
  const decoded = decodeEnvelope(frame);

  if (isReplyEnvelope(decoded)) {
    return decoded;
  }

  throw new Error("ZeroMQ transport received a malformed reply.");
}

function isReplyEnvelope(value: unknown): value is ReplyEnvelope {
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
}

function readFrame(frame: Buffer | undefined): string {
  if (frame === undefined) {
    throw new Error("ZeroMQ transport received an incomplete route.");
  }

  return frame.toString("utf8");
}

function isExpectedReceiveStop(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /closed|timed out|EAGAIN|EBADF|ETERM/iu.test(error.message);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
