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
import { lstat, mkdir, open, opendir, rename, rm, stat } from "node:fs/promises";
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
import type { ZeroMqConfig } from "./adapter-config.js";
import { ChannelEndpoints } from "./channel-endpoints.js";

const manifestVersion = 1;
const maxManifestBytes = 4096;
const maxManifestEntries = 1024;
const staleAfterMs = 5000;
const heartbeatIntervalMs = 1000;
const unixSocketPathLimit = 104;
const maxRetainedFailures = 16;
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
  #closePromise: Promise<void> | undefined;

  constructor(config: ZeroMqConfig) {
    this.#config = config;
  }

  createPublisher(id: ChannelId): Promise<Publisher> {
    const creating = Promise.resolve().then(() => {
      if (this.#closePromise !== undefined) throw new Error("ZeroMQ message transport is closed.");
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
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  removePublisher(publisher: NativePublisher): void {
    this.#publishers.delete(publisher);
  }

  removeSubscriber(subscriber: NativeSubscriber): void {
    this.#subscribers.delete(subscriber);
  }

  #isClosing(): boolean {
    return this.#closePromise !== undefined;
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
      const socket = new Push({ linger: 100, immediate: true, sendTimeout: 250 });
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
  #closePromise: Promise<void> | undefined;

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
    const socket = new Pull({ linger: 0 });
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
    return this.#closePromise !== undefined || this.#consumers.size === 0;
  }

  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle> {
    return Promise.resolve().then(() => {
      if (this.#closePromise !== undefined) throw new Error("ZeroMQ message subscriber is closed.");
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
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  #isClosing(): boolean {
    return this.#closePromise !== undefined;
  }

  async #close(): Promise<void> {
    clearInterval(this.#heartbeat);
    const heartbeats = await Promise.allSettled([this.#heartbeatTail]);
    const results = await Promise.allSettled([
      zeroMqMessageAccess.remove(this.#manifestPath),
      this.#receiveWork,
    ]);
    this.#socket.close();
    results.push(
      await Promise.allSettled([zeroMqMessageAccess.remove(this.#socketPath)]).then(
        ([item]) => item,
      ),
    );
    this.#consumers.clear();
    this.#factory.removeSubscriber(this);
    const failures: unknown[] = [...this.#backgroundFailures];
    for (const result of [...heartbeats, ...results]) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "ZeroMQ message subscriber background processing failed.");
  }

  async #refreshHeartbeat(): Promise<void> {
    if (this.#closePromise !== undefined) return;
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
        const message = fromBinary(ExternalMessageSchema, bytes);
        const work = this.#deliver(message);
        this.#receiveWork = work.catch((error: unknown) => {
          retainFailure(this.#backgroundFailures, error);
        });
        await work;
      }
    } catch (error) {
      if (this.#closePromise === undefined) retainFailure(this.#backgroundFailures, error);
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
    const manifest = await readManifest(manifestPath, layout, entry, config.adapterIdentity);
    if (manifest === undefined) continue;
    if (manifest.adapterIdentity !== config.adapterIdentity) continue;
    if (!(await isLive(manifest))) {
      await rm(manifestPath, { force: true });
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
): Promise<SubscriberManifest | undefined> {
  try {
    const file = await lstat(manifestPath);
    if (file.isSymbolicLink() || !file.isFile() || file.size > maxManifestBytes) {
      await rm(manifestPath, { force: true });
      return undefined;
    }
    const handle = await open(manifestPath, "r");
    let text: string;
    try {
      text = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    const parsed: unknown = JSON.parse(text);
    if (hasForeignIdentity(parsed, adapterIdentity)) return undefined;
    if (!isManifest(parsed, layout, entry)) {
      await rm(manifestPath, { force: true });
      return undefined;
    }
    return parsed;
  } catch {
    await rm(manifestPath, { force: true });
    return undefined;
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

async function isLive(manifest: SubscriberManifest): Promise<boolean> {
  if (Date.now() - manifest.heartbeatAtMs > staleAfterMs) return false;
  try {
    const socket = await stat(socketPathFromEndpoint(manifest.endpoint));
    if (!socket.isSocket()) return false;
  } catch {
    return false;
  }
  try {
    process.kill(manifest.ownerPid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, "EPERM");
  }
}

function socketPathFromEndpoint(endpoint: string): string {
  return endpoint.slice("ipc://".length);
}

function canonicalChannelId(id: ChannelId): ChannelId {
  create(ChannelIdSchema, id);
  if (!/^type\.spine\.io\/[A-Za-z_][A-Za-z0-9_.]*$/u.test(id.targetType))
    throw new Error("Message channel targetType must be a canonical type.spine.io URL.");
  return create(ChannelIdSchema, { targetType: id.targetType });
}

function validateFrame(id: Any, message: ExternalMessage): void {
  if (!id.typeUrl || id.value.length === 0)
    throw new Error("External message identity must contain a type URL and bytes.");
  if (
    !message.id ||
    !message.originalMessage?.typeUrl ||
    message.originalMessage.value.length === 0 ||
    !message.boundedContextName?.value
  )
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
