/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { clone, create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Any } from "@bufbuild/protobuf/wkt";
import { ChannelIdSchema, ExternalMessageSchema } from "@spine-event-engine/proto";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";
import type {
  ConsumerHandle,
  ExternalMessageConsumer,
  Publisher,
  Subscriber,
  TransportFactory,
} from "../message-channel.js";

/**
 * Provides an in-process typed transport factory for local and test environments.
 */
export class InMemoryTransportFactory implements TransportFactory {
  readonly #state = new MemoryTransportState();

  /**
   * Creates a publisher for a validated channel identity.
   *
   * @param id Identifies the typed channel.
   * @returns A publisher for the channel.
   */
  createPublisher(id: ChannelId): Promise<Publisher> {
    return this.#state.createPublisher(id);
  }

  /**
   * Creates a subscriber for a validated channel identity.
   *
   * @param id Identifies the typed channel.
   * @returns A subscriber for the channel.
   */
  createSubscriber(id: ChannelId): Promise<Subscriber> {
    return this.#state.createSubscriber(id);
  }

  /**
   * Closes this factory idempotently and drains accepted publication work.
   *
   * @returns The shared close completion for all racing callers.
   */
  close(): Promise<void> {
    return this.#state.close();
  }
}

class MemoryTransportState {
  readonly #subscribers = new Map<string, Set<MemorySubscriber>>();
  readonly #publishers = new Set<MemoryPublisher>();
  #closed = false;
  #close: Promise<void> | undefined;

  createPublisher(id: ChannelId): Promise<Publisher> {
    return Promise.resolve().then(() => {
      this.#assertOpen();
      const publisher = new MemoryPublisher(copyChannel(id), this);
      this.#publishers.add(publisher);
      return publisher;
    });
  }
  createSubscriber(id: ChannelId): Promise<Subscriber> {
    return Promise.resolve().then(() => {
      this.#assertOpen();
      const subscriber = new MemorySubscriber(copyChannel(id), this);
      const group = this.#subscribers.get(subscriber.targetType) ?? new Set<MemorySubscriber>();
      group.add(subscriber);
      this.#subscribers.set(subscriber.targetType, group);
      return subscriber;
    });
  }
  close(): Promise<void> {
    if (this.#close) return this.#close;
    this.#closed = true;
    this.#close = this.#closeAll();
    return this.#close;
  }
  async #closeAll(): Promise<void> {
    const publishers = [...this.#publishers];
    const subscribers = [...this.#subscribers.values()].flatMap((group) => [...group]);
    const publisherResults = await Promise.allSettled(
      publishers.map((publisher) => publisher.close()),
    );
    const subscriberResults = await Promise.allSettled(
      subscribers.map((subscriber) => subscriber.close()),
    );
    this.#publishers.clear();
    this.#subscribers.clear();
    const failures = [...publisherResults, ...subscriberResults]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason as unknown);
    if (failures.length > 0)
      throw new AggregateError(failures, "Failed to close in-memory message transport.");
  }
  async dispatch(targetType: string, id: Any, message: ExternalMessage): Promise<void> {
    validateFrame(id, message);
    const snapshot = clone(ExternalMessageSchema, message);
    for (const subscriber of [...(this.#subscribers.get(targetType) ?? [])])
      await subscriber.receive(snapshot);
  }
  removePublisher(publisher: MemoryPublisher): void {
    this.#publishers.delete(publisher);
  }
  removeSubscriber(subscriber: MemorySubscriber): void {
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
  #closing = false;
  #tail: Promise<void> = Promise.resolve();
  readonly #failures: unknown[] = [];
  #close: Promise<void> | undefined;
  readonly #targetType: string;
  readonly #factory: MemoryTransportState;
  get id(): ChannelId {
    return create(ChannelIdSchema, { targetType: this.#targetType });
  }
  constructor(id: ChannelId, factory: MemoryTransportState) {
    this.#targetType = id.targetType;
    this.#factory = factory;
  }
  get targetType(): string {
    return this.#targetType;
  }
  isStale(): boolean {
    return this.#closing;
  }
  async publish(id: Any, message: ExternalMessage): Promise<void> {
    if (this.#closing) throw new Error("Message publisher is closed.");
    const copiedId = create(AnySchema, { typeUrl: id.typeUrl, value: new Uint8Array(id.value) });
    const copiedMessage = clone(ExternalMessageSchema, message);
    const accepted = this.#tail.then(() =>
      this.#factory.dispatch(this.#targetType, copiedId, copiedMessage),
    );
    this.#tail = accepted.catch((error: unknown) => {
      this.#failures.push(error);
    });
    return accepted;
  }
  close(): Promise<void> {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = this.#closeAfterDrain();
    return this.#close;
  }
  async #closeAfterDrain(): Promise<void> {
    try {
      await this.#tail;
      if (this.#failures.length > 0)
        throw new AggregateError(this.#failures, "Accepted message publication failed.");
    } finally {
      this.#factory.removePublisher(this);
    }
  }
}

class MemorySubscriber implements Subscriber {
  readonly #consumers = new Set<ExternalMessageConsumer>();
  #closed = false;
  readonly #targetType: string;
  readonly #factory: MemoryTransportState;
  get id(): ChannelId {
    return create(ChannelIdSchema, { targetType: this.#targetType });
  }
  constructor(id: ChannelId, factory: MemoryTransportState) {
    this.#targetType = id.targetType;
    this.#factory = factory;
  }
  get targetType(): string {
    return this.#targetType;
  }
  isStale(): boolean {
    return this.#closed || this.#consumers.size === 0;
  }
  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle> {
    return Promise.resolve().then(() => {
      if (this.#closed) throw new Error("Message subscriber is closed.");
      this.#consumers.add(consumer);
      let removed = false;
      return {
        close: () => {
          if (removed) return Promise.resolve();
          removed = true;
          this.#consumers.delete(consumer);
          return Promise.resolve();
        },
      };
    });
  }
  async receive(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    for (const consumer of [...this.#consumers])
      await consumer(clone(ExternalMessageSchema, message));
  }
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#consumers.clear();
    this.#factory.removeSubscriber(this);
    return Promise.resolve();
  }
}

function copyChannel(id: ChannelId): ChannelId {
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
