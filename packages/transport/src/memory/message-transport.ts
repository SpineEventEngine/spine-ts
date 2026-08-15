/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Any } from "@bufbuild/protobuf/wkt";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";
import type {
  ConsumerHandle,
  ExternalMessageConsumer,
  Publisher,
  Subscriber,
  TransportFactory,
} from "../message-channel.js";

/** In-process typed transport factory for local and test environments. */
export class InMemoryTransportFactory implements TransportFactory {
  readonly #subscribers = new Map<string, Set<MemorySubscriber>>();
  #closed = false;

  async createPublisher(id: ChannelId): Promise<Publisher> {
    this.#assertOpen();
    return new MemoryPublisher(id, this);
  }

  async createSubscriber(id: ChannelId): Promise<Subscriber> {
    this.#assertOpen();
    const subscriber = new MemorySubscriber(id, this);
    const group = this.#subscribers.get(id.targetType) ?? new Set<MemorySubscriber>();
    group.add(subscriber);
    this.#subscribers.set(id.targetType, group);
    return subscriber;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all(
      [...this.#subscribers.values()].flatMap((group) => [...group].map((s) => s.close())),
    );
    this.#subscribers.clear();
  }

  async publish(id: ChannelId, message: ExternalMessage): Promise<void> {
    this.#assertOpen();
    for (const subscriber of [...(this.#subscribers.get(id.targetType) ?? [])])
      await subscriber.receive(message);
  }

  remove(subscriber: MemorySubscriber): void {
    const group = this.#subscribers.get(subscriber.targetType);
    if (!group) return;
    group.delete(subscriber);
    if (group.size === 0) this.#subscribers.delete(subscriber.targetType);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("In-memory message transport is closed.");
  }
}

class MemoryPublisher implements Publisher {
  #closed = false;
  readonly id: ChannelId;
  readonly #factory: InMemoryTransportFactory;
  constructor(id: ChannelId, factory: InMemoryTransportFactory) {
    this.id = id;
    this.#factory = factory;
  }
  get targetType(): string {
    return this.id.targetType;
  }
  isStale(): boolean {
    return this.#closed;
  }
  async publish(_id: Any, message: ExternalMessage): Promise<void> {
    if (this.#closed) throw new Error("Message publisher is closed.");
    await this.#factory.publish(this.id, message);
  }
  async close(): Promise<void> {
    this.#closed = true;
  }
}

class MemorySubscriber implements Subscriber {
  readonly #consumers = new Set<ExternalMessageConsumer>();
  #closed = false;
  readonly id: ChannelId;
  readonly #factory: InMemoryTransportFactory;
  constructor(id: ChannelId, factory: InMemoryTransportFactory) {
    this.id = id;
    this.#factory = factory;
  }
  get targetType(): string {
    return this.id.targetType;
  }
  isStale(): boolean {
    return this.#closed || this.#consumers.size === 0;
  }
  async addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle> {
    if (this.#closed) throw new Error("Message subscriber is closed.");
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
  async receive(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    for (const consumer of [...this.#consumers]) await consumer(message);
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#consumers.clear();
    this.#factory.remove(this);
  }
}
