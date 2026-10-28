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
} from "../internal/message-channel.js";
import { isCanonicalChannelType } from "../internal/message-channel.js";

/**
 * Provides an in-process typed transport factory for local and test environments.
 */
export class InMemoryTransportFactory implements TransportFactory {
  readonly #state = new MemoryTransportState();

  /**
   * Checks local factory readiness without creating a channel.
   *
   * @returns Completion when the factory remains open.
   */
  initialize(): Promise<void> {
    return this.#state.initialize();
  }

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

/**
 * Coordinates local publishers and subscribers for one factory lifetime.
 */
class MemoryTransportState {
  readonly #subscribers = new Map<string, Set<MemorySubscriber>>();

  readonly #publishers = new Set<MemoryPublisher>();

  #closed = false;

  #close: Promise<void> | undefined;

  /**
   * Checks the local factory state without opening a channel.
   * @returns Completion when the factory remains open.
   */
  initialize(): Promise<void> {
    try {
      this.#assertOpen();
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Transport initialization failed.", { cause: error }),
      );
    }
  }

  /**
   * Creates and retains a publisher for a channel.
   * @param id Identifies the channel.
   * @returns The new publisher.
   */
  createPublisher(id: ChannelId): Promise<Publisher> {
    return Promise.resolve().then(() => {
      this.#assertOpen();
      const publisher = new MemoryPublisher(copyChannel(id), this);
      this.#publishers.add(publisher);
      return publisher;
    });
  }

  /**
   * Creates and retains a subscriber for a channel.
   * @param id Identifies the channel.
   * @returns The new subscriber.
   */
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

  /**
   * Closes the factory after accepted publications and handles settle.
   * @returns Completion after all accepted publications and handles settle.
   */
  close(): Promise<void> {
    if (this.#close) return this.#close;
    this.#closed = true;
    this.#close = this.#closeAll();
    return this.#close;
  }

  /**
   * Closes every retained handle and records all failures.
   * @returns Completion after every retained handle closes.
   */
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

  /**
   * Delivers one copied frame to current subscribers.
   * @param targetType Selects the channel subscribers.
   * @param id Identifies the external message.
   * @param message Contains the external message.
   * @returns Completion after all subscriber callbacks settle.
   */
  async dispatch(targetType: string, id: Any, message: ExternalMessage): Promise<void> {
    validateFrame(id, message);
    const snapshot = clone(ExternalMessageSchema, message);
    for (const subscriber of [...(this.#subscribers.get(targetType) ?? [])])
      await subscriber.receive(snapshot);
  }

  /**
   * Removes a publisher after it completes close.
   * @param publisher Publisher that completed its close.
   */
  removePublisher(publisher: MemoryPublisher): void {
    this.#publishers.delete(publisher);
  }

  /**
   * Removes a subscriber after it completes close.
   * @param subscriber Subscriber that completed its close.
   */
  removeSubscriber(subscriber: MemorySubscriber): void {
    const group = this.#subscribers.get(subscriber.targetType);
    if (!group) return;
    group.delete(subscriber);
    if (group.size === 0) this.#subscribers.delete(subscriber.targetType);
  }

  /**
   * Rejects admission after factory close begins.
   */
  #assertOpen(): void {
    if (this.#closed) throw new Error("In-memory message transport is closed.");
  }
}

/**
 * Serializes publication for one local channel.
 */
class MemoryPublisher implements Publisher {
  #closing = false;

  #tail: Promise<void> = Promise.resolve();

  readonly #failures: unknown[] = [];

  #close: Promise<void> | undefined;

  readonly #targetType: string;

  readonly #factory: MemoryTransportState;

  /**
   * Returns the generated channel identity.
   * @returns The generated channel identity.
   */
  get id(): ChannelId {
    return create(ChannelIdSchema, { targetType: this.#targetType });
  }

  /**
   * Captures the channel and its retaining factory state.
   * @param id Identifies the channel.
   * @param factory Coordinates publications and close.
   */
  constructor(id: ChannelId, factory: MemoryTransportState) {
    this.#targetType = id.targetType;
    this.#factory = factory;
  }

  /**
   * Returns the canonical target type URL.
   * @returns The canonical target type URL.
   */
  get targetType(): string {
    return this.#targetType;
  }

  /**
   * Checks whether close fenced new publications.
   * @returns True after close fences new publications.
   */
  isStale(): boolean {
    return this.#closing;
  }

  /**
   * Publishes a copied external frame in channel order.
   * @param id Identifies the external message.
   * @param message Contains the external message.
   * @returns Completion after subscriber delivery.
   */
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

  /**
   * Closes this publisher after admitted publications settle.
   * @returns Completion after admitted publications settle.
   */
  close(): Promise<void> {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = this.#closeAfterDrain();
    return this.#close;
  }

  /**
   * Waits for the publication tail and reports retained errors.
   * @returns Completion after the publication tail and retained errors settle.
   */
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

/**
 * Delivers local channel messages to its registered consumers.
 */
class MemorySubscriber implements Subscriber {
  readonly #consumers = new Set<ExternalMessageConsumer>();

  #closed = false;

  readonly #targetType: string;

  readonly #factory: MemoryTransportState;

  /**
   * Returns the generated channel identity.
   * @returns The generated channel identity.
   */
  get id(): ChannelId {
    return create(ChannelIdSchema, { targetType: this.#targetType });
  }

  /**
   * Captures the channel and its retaining factory state.
   * @param id Identifies the channel.
   * @param factory Coordinates subscribers and close.
   */
  constructor(id: ChannelId, factory: MemoryTransportState) {
    this.#targetType = id.targetType;
    this.#factory = factory;
  }

  /**
   * Returns the canonical target type URL.
   * @returns The canonical target type URL.
   */
  get targetType(): string {
    return this.#targetType;
  }

  /**
   * Checks whether this subscriber is closed or lacks consumers.
   * @returns True when closed or without active consumers.
   */
  isStale(): boolean {
    return this.#closed || this.#consumers.size === 0;
  }

  /**
   * Registers one consumer until its returned handle closes.
   * @param consumer Receives matching external messages.
   * @returns A handle for removing the consumer.
   */
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

  /**
   * Sends a copied frame to each current consumer.
   * @param message Contains the external message.
   * @returns Completion after consumer callbacks settle.
   */
  async receive(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    for (const consumer of [...this.#consumers])
      await consumer(clone(ExternalMessageSchema, message));
  }

  /**
   * Closes this subscriber and removes its consumers.
   * @returns Completion after the subscriber stops receiving messages.
   */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#consumers.clear();
    this.#factory.removeSubscriber(this);
    return Promise.resolve();
  }
}

function copyChannel(id: ChannelId): ChannelId {
  if (!isCanonicalChannelType(id.targetType))
    throw new Error("Message channel targetType must be a canonical type URL.");
  return create(ChannelIdSchema, { targetType: id.targetType });
}

function validateFrame(id: Any, message: ExternalMessage): void {
  if (!id.typeUrl || id.value.length === 0)
    throw new Error("External message identity must contain a type URL and bytes.");
  const messageId = message.id;
  if (
    messageId === undefined ||
    !message.originalMessage?.typeUrl ||
    !message.boundedContextName?.value
  )
    throw new Error(
      "External message must contain identity, original message, and source context.",
    );
  if (messageId.typeUrl !== id.typeUrl || !bytesEqual(messageId.value, id.value))
    throw new Error("External message identity must match the supplied identity.");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
