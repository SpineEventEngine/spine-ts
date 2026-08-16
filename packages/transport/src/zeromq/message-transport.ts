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
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
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
} from "../message-channel.js";
import type { ZeroMqConfig } from "./adapter-config.js";
import { zeroMqSocketAccess } from "./signal-transport.js";

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
  #closed = false;
  readonly #config: ZeroMqConfig;
  constructor(config: ZeroMqConfig) {
    this.#config = config;
  }
  async createPublisher(id: ChannelId): Promise<Publisher> {
    if (this.#closed) throw new Error("ZeroMQ message transport is closed.");
    const publisher = new NativePublisher(id, this.#config);
    this.#publishers.add(publisher);
    return publisher;
  }
  async createSubscriber(id: ChannelId): Promise<Subscriber> {
    if (this.#closed) throw new Error("ZeroMQ message transport is closed.");
    const subscriber = await NativeSubscriber.open(id, this.#config);
    this.#subscribers.add(subscriber);
    return subscriber;
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#publishers].map((item) => item.close()));
    await Promise.all([...this.#subscribers].map((item) => item.close()));
  }
}

class NativePublisher implements Publisher {
  readonly id: ChannelId;
  readonly #config: ZeroMqConfig;
  #closed = false;
  constructor(id: ChannelId, config: ZeroMqConfig) {
    this.id = { ...id };
    this.#config = config;
  }
  get targetType(): string {
    return this.id.targetType;
  }
  isStale(): boolean {
    return this.#closed;
  }
  async publish(_id: Any, message: ExternalMessage): Promise<void> {
    if (this.#closed) throw new Error("ZeroMQ message publisher is closed.");
    const directory = channelDirectory(this.#config, this.targetType);
    const subscribers = path.join(directory, "subscribers");
    let entries: string[] = [];
    try {
      entries = await readdir(subscribers);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const manifest = JSON.parse(await readFile(path.join(subscribers, entry), "utf8")) as {
            endpoint?: string;
          };
          if (!manifest.endpoint) return;
          const socket = new Push({ linger: 0 });
          try {
            socket.connect(manifest.endpoint);
            await socket.send(toBinary(ExternalMessageSchema, message));
          } finally {
            socket.close();
          }
        }),
    );
  }
  async close(): Promise<void> {
    this.#closed = true;
  }
}

class NativeSubscriber implements Subscriber {
  readonly id: ChannelId;
  readonly #socket: Pull;
  readonly #manifest: string;
  readonly #consumers = new Set<ExternalMessageConsumer>();
  #closed = false;
  private constructor(id: ChannelId, socket: Pull, manifest: string) {
    this.id = { ...id };
    this.#socket = socket;
    this.#manifest = manifest;
    this.#run();
  }
  static async open(id: ChannelId, config: ZeroMqConfig): Promise<NativeSubscriber> {
    await zeroMqSocketAccess.prepareIpcDirectory(config.ipcDirectory);
    const generation = randomUUID();
    const directory = channelDirectory(config, id.targetType);
    const subscribers = path.join(directory, "subscribers");
    const sockets = path.join(config.ipcDirectory, "spine-message-channels", "sockets");
    await mkdir(subscribers, { recursive: true, mode: 0o700 });
    await mkdir(sockets, { recursive: true, mode: 0o700 });
    const endpoint = "ipc://" + path.join(sockets, generation + ".sock");
    const socket = new Pull({ linger: 0 });
    await socket.bind(endpoint);
    const manifest = path.join(subscribers, generation + ".json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        generation,
        adapterIdentity: config.adapterIdentity,
        ownerPid: process.pid,
        endpoint,
        heartbeatAtMs: Date.now(),
      }),
      { mode: 0o600 },
    );
    return new NativeSubscriber(id, socket, manifest);
  }
  get targetType(): string {
    return this.id.targetType;
  }
  isStale(): boolean {
    return this.#closed || this.#consumers.size === 0;
  }
  async addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle> {
    this.#consumers.add(consumer);
    let removed = false;
    return {
      close: async () => {
        if (removed) return;
        removed = true;
        this.#consumers.delete(consumer);
      },
    };
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await rm(this.#manifest, { force: true });
    this.#socket.close();
    this.#consumers.clear();
  }
  async #run(): Promise<void> {
    try {
      for await (const [bytes] of this.#socket) {
        if (bytes === undefined) continue;
        const message = fromBinary(ExternalMessageSchema, bytes);
        for (const consumer of this.#consumers) await consumer(message);
      }
    } catch {
      /* close ends iteration */
    }
  }
}
function channelDirectory(config: ZeroMqConfig, targetType: string): string {
  return path.join(
    config.ipcDirectory,
    "spine-message-channels",
    "channels",
    createHash("sha256").update(targetType).digest("hex"),
  );
}
