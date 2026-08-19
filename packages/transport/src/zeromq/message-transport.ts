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

import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { ChannelIdSchema, ExternalMessageSchema } from "@spine-event-engine/proto";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";
import { Pull, Push } from "zeromq";
import type {
  ConsumerHandle,
  ExternalMessageConsumer,
  Publisher,
  Subscriber,
  TransportFactory,
} from "../internal/message-channel.js";
import { isCanonicalChannelTargetType } from "../internal/message-channel.js";
import type { ZeroMqConfig } from "./adapter-config.js";
import { ChannelEndpoints } from "./channel-endpoints.js";

const manifestVersion = 1;
const maxManifestBytes = 4096;
const maxManifestEntries = 1024;
const staleAfterMs = 5000;
const heartbeatIntervalMs = 1000;
const unixSocketPathLimit = 104;
const maxRetainedFailures = 16;

/**
 * Bounds one complete encoded ExternalMessage, including nested Any/Event payload bytes.
 */
const maxNativeFrameBytes = 1024 * 1024;
const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface SubscriberManifest {
  readonly version: 1;
  readonly generation: string;
  readonly adapterIdentity: string;
  readonly ownerPid: number;
  readonly endpoint: string;
  readonly heartbeatAtMs: number;
}

/**
 * Exposes package-private filesystem operations for deterministic native lifecycle tests.
 *
 * @internal
 */
export const zeroMqMessageAccess = {
  // prettier-ignore

  /**
   * Removes a filesystem entry when it exists.
   *
   * @param filePath Identifies the entry to remove.
   * @returns Completes after removal or after confirming the entry is absent.
   */
  async remove(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  },

  /**
   * Writes one subscriber manifest through the production manifest encoder.
   *
   * @param manifestPath Identifies the manifest destination.
   * @param manifest Supplies the complete subscriber state to persist.
   * @returns Completes after the manifest becomes available to discovery.
   */
  async writeManifest(manifestPath: string, manifest: SubscriberManifest): Promise<void> {
    await writeManifest(manifestPath, manifest);
  },

  /**
   * Opens one manifest without following a symbolic link.
   *
   * @param manifestPath Identifies the manifest to open.
   * @returns The opened manifest handle for identity verification.
   * @internal
   */
  async openManifest(manifestPath: string): Promise<FileHandle> {
    return await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  },

  /**
   * Updates one manifest pathname atomically within its private directory.
   *
   * @param fromPath Identifies the current manifest pathname.
   * @param toPath Identifies the private destination pathname.
   * @returns Completes after the manifest move is visible.
   * @internal
   */
  async moveManifest(fromPath: string, toPath: string): Promise<void> {
    await rename(fromPath, toPath);
  },
};

/**
 * Creates the distinct typed-message ZeroMQ adapter.
 *
 * @param config Supplies validated local IPC configuration.
 * @returns A typed message transport factory.
 */
export function createZeroMqTransportFactory(config: ZeroMqConfig): TransportFactory {
  return new ZeroMqMessageTransport(config);
}

class ZeroMqMessageTransport implements TransportFactory {
  readonly #publishers = new Set<NativePublisher>();
  readonly #subscribers = new Set<NativeSubscriber>();
  readonly #pendingPublishers = new Set<Promise<Publisher>>();
  readonly #pendingSubscribers = new Set<Promise<Subscriber>>();
  readonly #config: ZeroMqConfig;
  #closeAttempt: Promise<void> | undefined;
  #closedForCreation = false;

  constructor(config: ZeroMqConfig) {
    this.#config = config;
  }

  createPublisher(id: ChannelId): Promise<Publisher> {
    const creating = Promise.resolve().then(() => {
      if (this.#closedForCreation) throw new Error("ZeroMQ message transport is closed.");
      const publisher = new NativePublisher(id, this.#config, this);
      return discoverSubscribers(this.#config, publisher.targetType).then(() => {
        if (this.#isClosing())
          throw new Error("ZeroMQ message transport closed while publisher opened.");
        this.#publishers.add(publisher);
        return publisher;
      });
    });
    this.#pendingPublishers.add(creating);
    void creating.then(
      () => this.#pendingPublishers.delete(creating),
      () => this.#pendingPublishers.delete(creating),
    );
    return creating;
  }

  createSubscriber(id: ChannelId): Promise<Subscriber> {
    const creating = Promise.resolve().then(async () => {
      if (this.#isClosing()) throw new Error("ZeroMQ message transport is closed.");
      const subscriber = await NativeSubscriber.open(id, this.#config, this);
      if (this.#isClosing()) {
        await subscriber.close();
        throw new Error("ZeroMQ message transport closed while subscriber opened.");
      }
      this.#subscribers.add(subscriber);
      return subscriber;
    });
    this.#pendingSubscribers.add(creating);
    void creating.then(
      () => this.#pendingSubscribers.delete(creating),
      () => this.#pendingSubscribers.delete(creating),
    );
    return creating;
  }

  close(): Promise<void> {
    this.#closedForCreation = true;
    this.#closeAttempt ??= this.#close().finally(() => {
      this.#closeAttempt = undefined;
    });
    return this.#closeAttempt;
  }

  removePublisher(publisher: NativePublisher): void {
    this.#publishers.delete(publisher);
  }

  removeSubscriber(subscriber: NativeSubscriber): void {
    this.#subscribers.delete(subscriber);
  }

  #isClosing(): boolean {
    return this.#closedForCreation;
  }

  async #close(): Promise<void> {
    const pending = await Promise.allSettled([
      ...this.#pendingPublishers,
      ...this.#pendingSubscribers,
    ]);
    const results = await Promise.allSettled([
      ...[...this.#publishers].map((item) => item.close()),
      ...[...this.#subscribers].map((item) => item.close()),
    ]);
    const failures: unknown[] = [];
    for (const result of [...pending, ...results]) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "ZeroMQ message transport close failed.");
  }
}

class NativePublisher implements Publisher {
  readonly #id: ChannelId;
  readonly #config: ZeroMqConfig;
  readonly #factory: ZeroMqMessageTransport;
  readonly #sockets = new Map<string, { readonly endpoint: string; readonly socket: Push }>();
  #closing = false;
  #tail: Promise<void> = Promise.resolve();
  readonly #failures: unknown[] = [];
  #closePromise: Promise<void> | undefined;

  constructor(id: ChannelId, config: ZeroMqConfig, factory: ZeroMqMessageTransport) {
    this.#id = canonicalChannelId(id);
    this.#config = config;
    this.#factory = factory;
  }

  get id(): ChannelId {
    return { ...this.#id };
  }

  get targetType(): string {
    return this.#id.targetType;
  }

  isStale(): boolean {
    return this.#closing;
  }

  async publish(id: Any, message: ExternalMessage): Promise<void> {
    if (this.#closing) throw new Error("ZeroMQ message publisher is closed.");
    validateFrame(id, message);
    const copiedMessage = clone(ExternalMessageSchema, message);
    const accepted = this.#tail.then(() => this.#publish(copiedMessage));
    this.#tail = accepted.catch((error: unknown) => {
      retainFailure(this.#failures, error);
    });
    return accepted;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#closeAfterDrain();
    return this.#closePromise;
  }

  async #closeAfterDrain(): Promise<void> {
    this.#closing = true;
    try {
      await this.#tail;
      if (this.#failures.length > 0)
        throw new AggregateError(this.#failures, "Accepted ZeroMQ message publication failed.");
    } finally {
      this.#factory.removePublisher(this);
      this.#closeSockets();
    }
  }

  #closeSockets(): void {
    for (const { socket } of this.#sockets.values()) socket.close();
    this.#sockets.clear();
  }

  async #publish(message: ExternalMessage): Promise<void> {
    const manifests = await discoverSubscribers(this.#config, this.targetType);
    this.#reconcile(manifests);
    const frame = toBinary(ExternalMessageSchema, message);
    if (frame.byteLength > maxNativeFrameBytes)
      throw new Error("ZeroMQ message frame exceeds the native frame-size limit.");
    const attempts = await Promise.allSettled(
      manifests.map((manifest) => this.#send(manifest, frame)),
    );
    const failures = attempts.flatMap((item, index) =>
      item.status === "rejected"
        ? [{ subscriber: manifests[index]?.generation, reason: "delivery failed" }]
        : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `ZeroMQ message publication failed for ${this.targetType}.`,
      );
  }

  async #send(manifest: SubscriberManifest, frame: Uint8Array): Promise<void> {
    let cached = this.#sockets.get(manifest.generation);
    if (cached?.endpoint !== manifest.endpoint) {
      cached?.socket.close();
      const socket = new Push({
        linger: 100,
        immediate: true,
        sendTimeout: 250,
        maxMessageSize: maxNativeFrameBytes,
      });
      socket.connect(manifest.endpoint);
      cached = { endpoint: manifest.endpoint, socket };
      this.#sockets.set(manifest.generation, cached);
    }
    await cached.socket.send(frame);
  }

  #reconcile(manifests: readonly SubscriberManifest[]): void {
    const active = new Set(manifests.map((manifest) => manifest.generation));
    for (const [generation, cached] of this.#sockets) {
      if (active.has(generation)) continue;
      cached.socket.close();
      this.#sockets.delete(generation);
    }
  }
}

class NativeSubscriber implements Subscriber {
  readonly #id: ChannelId;
  readonly #socket: Pull;
  readonly #manifestPath: string;
  readonly #socketPath: string;
  readonly #manifest: SubscriberManifest;
  readonly #factory: ZeroMqMessageTransport;
  readonly #consumers = new Set<ExternalMessageConsumer>();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #backgroundFailures: unknown[] = [];
  #receiveWork: Promise<void> = Promise.resolve();
  #heartbeatTail: Promise<void> = Promise.resolve();
  #heartbeatRunning = false;
  #heartbeatQueued = false;
  #closeAttempt: Promise<void> | undefined;
  #closing = false;

  private constructor(
    id: ChannelId,
    socket: Pull,
    manifestPath: string,
    socketPath: string,
    manifest: SubscriberManifest,
    factory: ZeroMqMessageTransport,
  ) {
    this.#id = canonicalChannelId(id);
    this.#socket = socket;
    this.#manifestPath = manifestPath;
    this.#socketPath = socketPath;
    this.#manifest = manifest;
    this.#factory = factory;
    this.#heartbeat = setInterval(() => {
      this.#scheduleHeartbeat();
    }, heartbeatIntervalMs);
    this.#heartbeat.unref();
    void this.#run();
  }

  static async open(
    id: ChannelId,
    config: ZeroMqConfig,
    factory: ZeroMqMessageTransport,
  ): Promise<NativeSubscriber> {
    const channel = canonicalChannelId(id);
    const layout = await prepareLayout(config, channel.targetType);
    await discoverSubscribers(config, channel.targetType);
    const generation = randomUUID();
    const socketPath = path.join(layout.sockets, `${generation}.sock`);
    const endpoint = `ipc://${socketPath}`;
    if (Buffer.byteLength(socketPath) >= unixSocketPathLimit)
      throw new Error("ZeroMQ message channel IPC socket path exceeds the native path limit.");
    const manifestPath = path.join(layout.subscribers, `${generation}.json`);
    const manifest: SubscriberManifest = {
      version: manifestVersion,
      generation,
      adapterIdentity: config.adapterIdentity,
      ownerPid: process.pid,
      endpoint,
      heartbeatAtMs: Date.now(),
    };
    const socket = new Pull({ linger: 0, maxMessageSize: maxNativeFrameBytes });
    try {
      await socket.bind(endpoint);
      await zeroMqMessageAccess.writeManifest(manifestPath, manifest);
      return new NativeSubscriber(channel, socket, manifestPath, socketPath, manifest, factory);
    } catch (error) {
      socket.close();
      await zeroMqMessageAccess.remove(socketPath);
      throw error;
    }
  }

  get id(): ChannelId {
    return { ...this.#id };
  }

  get targetType(): string {
    return this.#id.targetType;
  }

  isStale(): boolean {
    return this.#closing || this.#consumers.size === 0;
  }

  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle> {
    return Promise.resolve().then(() => {
      if (this.#closing) throw new Error("ZeroMQ message subscriber is closed.");
      this.#consumers.add(consumer);
      let removed = false;
      const handle: ConsumerHandle = {
        close: () => {
          if (removed) return Promise.resolve();
          removed = true;
          this.#consumers.delete(consumer);
          return this.#consumers.size === 0 ? this.close() : Promise.resolve();
        },
      };
      return handle;
    });
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#closeAttempt ??= this.#close().finally(() => {
      this.#closeAttempt = undefined;
    });
    return this.#closeAttempt;
  }

  #isClosing(): boolean {
    return this.#closing;
  }

  async #close(): Promise<void> {
    clearInterval(this.#heartbeat);
    const heartbeats = await Promise.allSettled([this.#heartbeatTail]);
    const [manifestRemoval, receiveWork] = await Promise.allSettled([
      zeroMqMessageAccess.remove(this.#manifestPath),
      this.#receiveWork,
    ]);
    this.#socket.close();
    const socketRemoval = await zeroMqMessageAccess.remove(this.#socketPath).then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    this.#consumers.clear();
    const failures: unknown[] = [...this.#backgroundFailures];
    for (const result of [...heartbeats, manifestRemoval, receiveWork, socketRemoval]) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    const cleanupFailed =
      manifestRemoval.status === "rejected" || socketRemoval.status === "rejected";
    if (!cleanupFailed) this.#factory.removeSubscriber(this);
    if (failures.length > 0)
      throw new AggregateError(failures, "ZeroMQ message subscriber background processing failed.");
  }

  async #refreshHeartbeat(): Promise<void> {
    if (this.#closing) return;
    try {
      await zeroMqMessageAccess.writeManifest(this.#manifestPath, {
        ...this.#manifest,
        heartbeatAtMs: Date.now(),
      });
      if (this.#isClosing()) await zeroMqMessageAccess.remove(this.#manifestPath);
    } catch (error) {
      retainFailure(this.#backgroundFailures, error);
    }
  }

  #scheduleHeartbeat(): void {
    if (this.#isClosing()) return;
    if (this.#heartbeatRunning) {
      this.#heartbeatQueued = true;
      return;
    }
    this.#heartbeatRunning = true;
    this.#heartbeatTail = this.#refreshHeartbeat().finally(() => {
      this.#heartbeatRunning = false;
      if (this.#heartbeatQueued && !this.#isClosing()) {
        this.#heartbeatQueued = false;
        this.#scheduleHeartbeat();
      }
    });
  }

  async #run(): Promise<void> {
    try {
      for await (const [bytes] of this.#socket) {
        if (bytes === undefined) continue;
        if (bytes.byteLength > maxNativeFrameBytes) continue;
        let message: ExternalMessage;
        try {
          message = fromBinary(ExternalMessageSchema, bytes);
        } catch {
          continue;
        }
        const work = this.#deliver(message);
        this.#receiveWork = work.catch((error: unknown) => {
          retainFailure(this.#backgroundFailures, error);
        });
        try {
          await work;
        } catch {
          // One application consumer cannot terminate a native receive loop.
        }
      }
    } catch (error) {
      if (!this.#closing) retainFailure(this.#backgroundFailures, error);
    }
  }

  async #deliver(message: ExternalMessage): Promise<void> {
    for (const consumer of this.#consumers) await consumer(message);
  }
}

async function discoverSubscribers(
  config: ZeroMqConfig,
  targetType: string,
): Promise<SubscriberManifest[]> {
  const layout = await prepareLayout(config, targetType);
  const entries: string[] = [];
  const directory = await opendir(layout.subscribers);
  for await (const entry of directory) {
    entries.push(entry.name);
    if (entries.length > maxManifestEntries)
      throw new Error(
        `ZeroMQ message channel exceeds ${String(maxManifestEntries)} subscriber manifests.`,
      );
  }
  entries.sort();
  const manifests = entries.filter((entry) => entry.endsWith(".json"));
  const discovered: SubscriberManifest[] = [];
  for (const entry of manifests) {
    const manifestPath = path.join(layout.subscribers, entry);
    const inspected = await readManifest(manifestPath, layout, entry, config.adapterIdentity);
    if (inspected === undefined) continue;
    const { manifest, file } = inspected;
    const liveness = await inspectLiveness(manifest);
    if (!liveness.live) {
      if ((await quarantineIfUnchanged(manifestPath, file)) && liveness.removeSocket)
        await rm(socketPathFromEndpoint(manifest.endpoint), { force: true });
      continue;
    }
    discovered.push(manifest);
  }
  return discovered;
}

async function prepareLayout(
  config: ZeroMqConfig,
  targetType: string,
): Promise<{
  readonly subscribers: string;
  readonly sockets: string;
}> {
  await ChannelEndpoints.prepare(config.ipcDirectory);
  const root = path.join(config.ipcDirectory, "spine-message-channels");
  await ensurePrivateDirectory(root);
  const channel = path.join(
    root,
    "channels",
    createHash("sha256").update(targetType).digest("hex"),
  );
  const subscribers = path.join(channel, "subscribers");
  const sockets = path.join(root, "sockets");
  await ensurePrivateDirectory(path.join(root, "channels"));
  await ensurePrivateDirectory(channel);
  await ensurePrivateDirectory(subscribers);
  await ensurePrivateDirectory(sockets);
  return { subscribers, sockets };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory())
    throw new Error("ZeroMQ message channel directory must be a non-symlink directory.");
  if (process.platform !== "win32") {
    if (entry.uid !== process.geteuid?.())
      throw new Error("ZeroMQ message channel directory must be owned by the effective user.");
    if ((entry.mode & 0o777) !== 0o700)
      throw new Error("ZeroMQ message channel directory must have exact POSIX mode 0700.");
  }
}

async function writeManifest(manifestPath: string, manifest: SubscriberManifest): Promise<void> {
  const contents = JSON.stringify(manifest);
  if (Buffer.byteLength(contents) > maxManifestBytes)
    throw new Error("ZeroMQ message manifest is too large.");
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, manifestPath);
    renamed = true;
  } finally {
    if (!renamed) await rm(temporary, { force: true });
  }
}

async function readManifest(
  manifestPath: string,
  layout: { readonly subscribers: string; readonly sockets: string },
  entry: string,
  adapterIdentity: string,
): Promise<{ readonly manifest: SubscriberManifest; readonly file: Stats } | undefined> {
  let inspected: Stats | undefined;
  try {
    const file = await lstat(manifestPath);
    inspected = file;
    if (file.isSymbolicLink() || !file.isFile() || file.size > maxManifestBytes) {
      await quarantineIfUnchanged(manifestPath, file);
      return undefined;
    }
    const handle = await zeroMqMessageAccess.openManifest(manifestPath);
    let text: string;
    let openedUid = -1;
    let openedMode = 0;
    try {
      const opened = await handle.stat();
      openedUid = opened.uid;
      openedMode = opened.mode;
      if (
        !opened.isFile() ||
        opened.dev !== file.dev ||
        opened.ino !== file.ino ||
        opened.size !== file.size ||
        opened.size > maxManifestBytes
      ) {
        return undefined;
      }
      text = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    const parsed: unknown = JSON.parse(text);
    if (hasForeignIdentity(parsed, adapterIdentity)) return undefined;
    if (
      process.platform !== "win32" &&
      (file.uid !== process.geteuid?.() ||
        openedUid !== process.geteuid() ||
        (file.mode & 0o777) !== 0o600 ||
        (openedMode & 0o777) !== 0o600)
    ) {
      await quarantineIfUnchanged(manifestPath, file);
      return undefined;
    }
    if (!isManifest(parsed, layout, entry)) {
      await quarantineIfUnchanged(manifestPath, file);
      return undefined;
    }
    return { manifest: parsed, file };
  } catch {
    if (inspected !== undefined) await quarantineIfUnchanged(manifestPath, inspected);
    return undefined;
  }
}

async function quarantineIfUnchanged(manifestPath: string, inspected: Stats): Promise<boolean> {
  const quarantinePath = `${manifestPath}.${randomUUID()}.quarantine`;
  try {
    await zeroMqMessageAccess.moveManifest(manifestPath, quarantinePath);
    const moved = await lstat(quarantinePath);
    if (moved.dev === inspected.dev && moved.ino === inspected.ino) {
      await rm(quarantinePath, { force: true });
      return true;
    }
    await restoreQuarantine(quarantinePath, manifestPath);
    return false;
  } catch {
    await rm(quarantinePath, { force: true }).catch(() => undefined);
    return false;
  }
}

async function restoreQuarantine(quarantinePath: string, manifestPath: string): Promise<void> {
  try {
    await link(quarantinePath, manifestPath);
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) throw error;
  } finally {
    await rm(quarantinePath, { force: true });
  }
}

function hasForeignIdentity(candidate: unknown, adapterIdentity: string): boolean {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    (candidate as { adapterIdentity?: unknown }).adapterIdentity !== adapterIdentity
  );
}

function isManifest(
  candidate: unknown,
  layout: { readonly subscribers: string; readonly sockets: string },
  entry: string,
): candidate is SubscriberManifest {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const value = candidate as Record<string, unknown>;
  const expectedKeys = [
    "adapterIdentity",
    "endpoint",
    "generation",
    "heartbeatAtMs",
    "ownerPid",
    "version",
  ];
  if (Object.keys(value).sort().join("\0") !== expectedKeys.join("\0")) return false;
  if (value.version !== manifestVersion || typeof value.generation !== "string") return false;
  if (!generationPattern.test(value.generation) || entry !== `${value.generation}.json`)
    return false;
  if (typeof value.adapterIdentity !== "string" || value.adapterIdentity.length === 0) return false;
  if (
    typeof value.ownerPid !== "number" ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid <= 0
  )
    return false;
  if (
    typeof value.heartbeatAtMs !== "number" ||
    !Number.isSafeInteger(value.heartbeatAtMs) ||
    value.heartbeatAtMs <= 0
  )
    return false;
  if (typeof value.endpoint !== "string") return false;
  const expectedSocket = path.join(layout.sockets, `${value.generation}.sock`);
  return value.endpoint === `ipc://${expectedSocket}`;
}

async function inspectLiveness(
  manifest: SubscriberManifest,
): Promise<{ readonly live: boolean; readonly removeSocket: boolean }> {
  try {
    const socket = await stat(socketPathFromEndpoint(manifest.endpoint));
    if (!socket.isSocket()) return { live: false, removeSocket: false };
  } catch {
    return { live: false, removeSocket: false };
  }
  try {
    process.kill(manifest.ownerPid, 0);
    if (Date.now() - manifest.heartbeatAtMs > staleAfterMs)
      return { live: false, removeSocket: false };
    return { live: true, removeSocket: false };
  } catch (error) {
    if (isErrorCode(error, "ESRCH")) return { live: false, removeSocket: true };
    if (isErrorCode(error, "EPERM") && Date.now() - manifest.heartbeatAtMs <= staleAfterMs)
      return { live: true, removeSocket: false };
    return { live: false, removeSocket: false };
  }
}

function socketPathFromEndpoint(endpoint: string): string {
  return endpoint.slice("ipc://".length);
}

function canonicalChannelId(id: ChannelId): ChannelId {
  create(ChannelIdSchema, id);
  if (!isCanonicalChannelTargetType(id.targetType))
    throw new Error("Message channel targetType must be a canonical type URL.");
  return create(ChannelIdSchema, { targetType: id.targetType });
}

function validateFrame(id: Any, message: ExternalMessage): void {
  if (!id.typeUrl || id.value.length === 0)
    throw new Error("External message identity must contain a type URL and bytes.");
  if (!message.id || !message.originalMessage?.typeUrl || !message.boundedContextName?.value)
    throw new Error(
      "External message must contain identity, original message, and source context.",
    );
  if (message.id.typeUrl !== id.typeUrl || !bytesEqual(message.id.value, id.value))
    throw new Error("External message identity must match the supplied identity.");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

function retainFailure(failures: unknown[], error: unknown): void {
  if (failures.length < maxRetainedFailures) {
    failures.push(error);
    return;
  }
  if (failures.length === maxRetainedFailures)
    failures.push({ overflow: true, retained: maxRetainedFailures });
}
