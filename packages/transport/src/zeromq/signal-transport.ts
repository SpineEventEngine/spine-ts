import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
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
import { endpointFileAccess } from "./endpoint-files.js";

/** Optional tuning for the adapter-scoped local IPC transport. */
export interface ZeroMqTransportOptions {
  /**
   * Milliseconds used for bounded request/reply sends and receives.
   *
   * Defaults to 2,000. Explicit values must be integers from 1 through
   * 2,147,483,647.
   */
  readonly requestTimeoutMs?: number;
  /** Milliseconds used by background worker sockets while waiting for messages. */
  readonly receiveTimeoutMs?: number;
}

interface InternalTransportOptions extends ZeroMqTransportOptions {
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
const privateDirectoryModeBigInt = 0o700n;
const posixModeMask = 0o7777n;
const posixWriteMask = 0o022n;
const isPosix = process.platform !== "win32";

interface PreparedIpcDirectory {
  readonly path: string;
  readonly identity: {
    readonly device: bigint;
    readonly inode: bigint;
  };
}

interface IpcPathPlan {
  readonly anchorPath: string;
  readonly missingComponents: readonly string[];
}

interface IpcPathWalk {
  readonly existingPath: string;
  readonly missingComponents: readonly string[];
}

/** Create a same-host ZeroMQ-backed `SignalTransport` over deterministic local IPC endpoints. */
export function createZeroMqTransport(
  config: ZeroMqAdapterConfig,
  options: ZeroMqTransportOptions = {},
): SignalTransport {
  return new ZeroMqSignalTransport(config, options);
}

/** @internal Package-private native socket/filesystem seam used by deterministic tests. */
export const zeroMqSocketAccess = {
  async bindPublisher(socket: Publisher, address: string): Promise<void> {
    await socket.bind(address);
  },
  async bindReply(socket: Reply, address: string): Promise<void> {
    await socket.bind(address);
  },
  close(socket: Socket): void {
    socket.close();
  },
  connect(socket: Subscriber | Request, address: string): void {
    socket.connect(address);
  },
  async createIpcDirectoryComponent(directory: string): Promise<void> {
    await mkdir(directory, { mode: privateDirectoryMode });
  },
  async prepareIpcDirectory(ipcDirectory: string): Promise<PreparedIpcDirectory> {
    return await prepareIpcDirectory(ipcDirectory);
  },
  async recheckIpcDirectory(prepared: PreparedIpcDirectory): Promise<void> {
    await recheckIpcDirectory(prepared);
  },
  async sendRequest(socket: Request, frames: MessageLike[]): Promise<void> {
    await socket.send(frames);
  },
};

class ZeroMqSignalTransport implements SignalTransport {
  readonly #config: ZeroMqAdapterConfig;
  readonly #requestTimeoutMs: number;
  readonly #receiveTimeoutMs: number;
  readonly #onBackgroundFailure: ((error: Error) => void) | undefined;
  readonly #publishers = new Map<string, BoundPublisher>();
  readonly #publisherBinds = new Map<string, Promise<BoundPublisher>>();
  readonly #responderBinds = new Set<Promise<TransportSubscriptionHandle>>();
  readonly #subscriberOpens = new Set<Promise<TransportSubscriptionHandle>>();
  readonly #requests = new Set<Promise<unknown>>();
  readonly #activeHandles = new Set<ActiveHandle>();
  #closed = false;
  #close: Promise<void> | undefined;

  constructor(config: ZeroMqAdapterConfig, options: InternalTransportOptions) {
    this.#config = config;
    this.#requestTimeoutMs = requestTimeoutMs(options.requestTimeoutMs);
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

    const subscriber = new Subscriber({
      linger: closeDelayMs,
      receiveTimeout: this.#receiveTimeoutMs,
    });
    const entry: PublishHandlerEntry = {
      subscription,
      handler: handler as PublishTransportHandler,
    };

    let handle: ZeroMqSubscriptionHandle<Kind> | undefined;

    try {
      subscriber.subscribe(subscription.topic.routing.routingKey);
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      const endpoint = endpointFor(this.#config, prepared.path, subscription.topic, "publish");
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
      receiveTimeout: this.#requestTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      this.#requireOpen();
      const endpoint = endpointFor(this.#config, prepared.path, operation.topic, "request");
      zeroMqSocketAccess.connect(requester, endpoint.address);
      await zeroMqSocketAccess.sendRequest(requester, [
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

    const replier = new Reply({
      linger: closeDelayMs,
      receiveTimeout: this.#receiveTimeoutMs,
      sendTimeout: this.#requestTimeoutMs,
    });
    const entry: RequestHandlerEntry = {
      subscription,
      handler: handler as RequestTransportHandler,
    };
    let handle: ZeroMqSubscriptionHandle<Kind> | undefined;

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      const endpoint = endpointFor(this.#config, prepared.path, subscription.topic, "request");
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

    const publisher = new Publisher({
      linger: closeDelayMs,
    });

    let bound: BoundPublisher | undefined;

    try {
      await zeroMqSocketAccess.recheckIpcDirectory(prepared);
      const endpoint = endpointFor(this.#config, prepared.path, topic, "publish");
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
        publisher.close();
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
    const failures: unknown[] = [];

    await Promise.allSettled([
      ...this.#publisherBinds.values(),
      ...this.#responderBinds,
      ...this.#subscriberOpens,
      ...this.#requests,
    ]);

    for (const handle of [...this.#activeHandles]) {
      await captureCleanupFailure(() => handle.close(), failures);
    }
    for (const publisher of this.#publishers.values()) {
      await captureCleanupFailure(() => publisher.cleanup.close(), failures);
    }

    if (failures.length > 0) {
      throw cleanupFailure(failures, "ZeroMQ signal transport close failed.");
    }
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

function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return defaultRequestTimeoutMs;
  }
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError(
      "ZeroMQ transport requestTimeoutMs must be an integer from 1 through 2147483647.",
    );
  }
  return value;
}

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
        await endpointFileAccess.remove(endpointFile);
        this.#endpointFile = undefined;
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw cleanupFailure(failures, "ZeroMQ socket cleanup failed.");
    }

    this.#onClose();
  }
}

type ReplyEnvelope =
  | { readonly status: "accepted"; readonly envelope: unknown }
  | { readonly status: "failed"; readonly message: string };

function endpointFor(
  config: ZeroMqAdapterConfig,
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
  return Object.freeze({
    address: `ipc://${filePath}`,
    filePath,
  });
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

async function prepareIpcDirectory(ipcDirectory: string): Promise<PreparedIpcDirectory> {
  const plan = await inspectIpcPath(ipcDirectory);
  const completedPath = await createIpcSuffix(plan.anchorPath, plan.missingComponents);
  return await finalizeIpcDirectory(completedPath);
}

async function inspectIpcPath(ipcDirectory: string): Promise<IpcPathPlan> {
  const parsed = path.parse(ipcDirectory);
  const components = ipcDirectory
    .slice(parsed.root.length)
    .split(path.sep)
    .filter((component) => component.length > 0);
  const walk = await walkLexicalPath(parsed.root, components);
  const followedAnchor = await stat(walk.existingPath, { bigint: true });
  const anchorPath = await realpath(walk.existingPath);
  const anchorEntry = await lstat(anchorPath, { bigint: true });
  requireMatchingIdentity(anchorEntry, followedAnchor, "canonical anchor");

  return {
    anchorPath,
    missingComponents: walk.missingComponents,
  };
}

async function walkLexicalPath(root: string, components: readonly string[]): Promise<IpcPathWalk> {
  let existingPath = root;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) {
      continue;
    }
    const candidate = path.join(existingPath, component);
    let lexicalEntry;

    try {
      lexicalEntry = await lstat(candidate, { bigint: true });
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
      return { existingPath, missingComponents: components.slice(index) };
    }

    await validatePathEntry(candidate, index === components.length - 1, lexicalEntry);
    existingPath = candidate;
  }

  return { existingPath, missingComponents: [] };
}

async function validatePathEntry(
  candidate: string,
  isFinal: boolean,
  lexicalEntry: BigIntStats,
): Promise<void> {
  if (lexicalEntry.isSymbolicLink()) {
    if (isFinal) {
      throw new Error("ZeroMQ adapter ipcDirectory final component must not be a symlink.");
    }
    if (isPosix) {
      await validatePosixAlias(candidate, lexicalEntry.uid);
    }
  }

  const followed = await stat(candidate, { bigint: true });
  if (!followed.isDirectory()) {
    throw new Error("ZeroMQ adapter ipcDirectory path components must be directories.");
  }
}

async function createIpcSuffix(
  anchorPath: string,
  missingComponents: readonly string[],
): Promise<string> {
  let completedPath = anchorPath;
  for (const component of missingComponents) {
    const next = path.join(completedPath, component);
    try {
      await zeroMqSocketAccess.createIpcDirectoryComponent(next);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
    const existing = await lstat(next, { bigint: true });
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("ZeroMQ adapter ipcDirectory creation encountered an unsafe path.");
    }
    completedPath = next;
  }
  return completedPath;
}

async function finalizeIpcDirectory(completedPath: string): Promise<PreparedIpcDirectory> {
  const canonicalCompletedPath = await realpath(completedPath);
  if (canonicalCompletedPath !== completedPath) {
    throw new Error("ZeroMQ adapter ipcDirectory must resolve to its canonical path.");
  }
  const finalEntry = await lstat(completedPath, { bigint: true });
  requirePrivateFinalDirectory(finalEntry);

  return Object.freeze({
    path: completedPath,
    identity: Object.freeze({
      device: finalEntry.dev,
      inode: finalEntry.ino,
    }),
  });
}

async function recheckIpcDirectory(prepared: PreparedIpcDirectory): Promise<void> {
  const canonicalPath = await realpath(prepared.path);
  if (canonicalPath !== prepared.path) {
    throw new Error("ZeroMQ adapter ipcDirectory changed after preparation.");
  }
  const finalEntry = await lstat(prepared.path, { bigint: true });
  requirePrivateFinalDirectory(finalEntry);

  const identityIsStable =
    isPosix ||
    (prepared.identity.device !== 0n &&
      prepared.identity.inode !== 0n &&
      finalEntry.dev !== 0n &&
      finalEntry.ino !== 0n);
  if (
    identityIsStable &&
    (finalEntry.dev !== prepared.identity.device || finalEntry.ino !== prepared.identity.inode)
  ) {
    throw new Error("ZeroMQ adapter ipcDirectory identity changed after preparation.");
  }
}

async function validatePosixAlias(aliasPath: string, aliasUid: bigint): Promise<void> {
  const parent = await stat(path.dirname(aliasPath), { bigint: true });
  if (aliasUid !== 0n || parent.uid !== 0n || (parent.mode & posixWriteMask) !== 0n) {
    throw new Error(
      "ZeroMQ adapter ipcDirectory ancestor symlink must be an immutable root-owned alias.",
    );
  }
}

function requirePrivateFinalDirectory(entry: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly uid: bigint;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): void {
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("ZeroMQ adapter ipcDirectory must be a non-symlink directory.");
  }
  if (!isPosix) {
    return;
  }

  const effectiveUserId = process.geteuid?.();
  if (effectiveUserId === undefined || entry.uid !== BigInt(effectiveUserId)) {
    throw new Error("ZeroMQ adapter ipcDirectory must be owned by the effective user.");
  }
  if ((entry.mode & posixModeMask) !== privateDirectoryModeBigInt) {
    throw new Error("ZeroMQ adapter ipcDirectory must have exact POSIX mode 0700.");
  }
}

function requireMatchingIdentity(
  actual: { readonly dev: bigint; readonly ino: bigint },
  expected: { readonly dev: bigint; readonly ino: bigint },
  label: string,
): void {
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`ZeroMQ adapter ipcDirectory ${label} identity changed.`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code?: unknown }).code === code
  );
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

async function captureCleanupFailure(
  cleanup: () => void | Promise<void>,
  failures: unknown[],
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
}

function cleanupFailure(failures: readonly unknown[], message: string): Error {
  const [failure] = failures;
  if (failures.length === 1 && failure !== undefined) {
    return toError(failure);
  }
  return new AggregateError(failures, message);
}
