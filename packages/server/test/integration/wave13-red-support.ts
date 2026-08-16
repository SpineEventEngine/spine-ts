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

import { expect } from "vitest";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";
import type {
  ConsumerHandle,
  ExternalMessageConsumer,
  Publisher,
  Subscriber,
  TransportFactory,
} from "@spine-event-engine/transport";

/**
 * A deliberately small transport double. It implements the frozen public
 * transport shape, records creation/publication/teardown, and delegates every
 * frame to the currently attached consumers.  It is an observation seam, not
 * a broker control surface.
 */
export class RecordingTransportFactory implements TransportFactory {
  readonly operations: string[] = [];
  readonly published: {
    readonly channel: unknown;
    readonly id: unknown;
    readonly message: unknown;
    readonly operationIndex: number;
  }[] = [];
  readonly created: { readonly kind: "publisher" | "subscriber"; readonly channel: unknown }[] = [];
  #consumers = new Map<string, Set<ExternalMessageConsumer>>();
  #remainingCloseFailures: number;
  #closeSuccessesBeforeFailure: number | undefined;
  #publishFailure: ((channel: unknown) => boolean) | undefined;
  #publisherCreationFailure: ((channel: unknown) => boolean) | undefined;
  #consumerAdditionFailure: ((channel: unknown) => boolean) | undefined;
  #publishGate:
    { readonly predicate: (channel: unknown) => boolean; readonly wait: Promise<void> } | undefined;
  #publisherCreationFailureAfter:
    { remainingSuccesses: number; predicate: (channel: unknown) => boolean } | undefined;
  #openPublishers = new Set<string>();

  constructor(options: { readonly failCloseAttempts?: number } = {}) {
    this.#remainingCloseFailures = options.failCloseAttempts ?? 0;
  }

  /**
   * Makes the next adapter close operation fail.
   */
  failNextClose(): void {
    this.#remainingCloseFailures = 1;
  }

  /**
   * Makes the requested number of adapter close operations fail.
   */
  failCloseAttempts(attempts: number): void {
    this.#remainingCloseFailures = attempts;
  }

  /**
   * Makes one adapter close fail after the requested number of successful closes.
   */
  failCloseAfter(successfulCloses: number): void {
    this.#closeSuccessesBeforeFailure = successfulCloses;
  }

  /**
   * Makes the next matching subscriber consumer attachment fail.
   */
  failNextConsumerAddition(predicate: (channel: unknown) => boolean): void {
    this.#consumerAdditionFailure = predicate;
  }

  /**
   * Gates matching publication after it has been accepted by the recording transport.
   */
  gateNextPublish(predicate: (channel: unknown) => boolean): () => void {
    let release!: () => void;
    this.#publishGate = {
      predicate,
      wait: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    return release;
  }

  #close(operation: string): void {
    this.operations.push(operation);
    if (this.#closeSuccessesBeforeFailure !== undefined) {
      if (this.#closeSuccessesBeforeFailure === 0) {
        this.#closeSuccessesBeforeFailure = undefined;
        throw new Error(`${operation} failed`);
      }
      this.#closeSuccessesBeforeFailure -= 1;
    }
    if (this.#remainingCloseFailures-- > 0) throw new Error(`${operation} failed`);
  }

  /**
   * Makes the next matching adapter publication fail before it is accepted.
   */
  failNextPublish(predicate: (channel: unknown) => boolean = () => true): void {
    this.#publishFailure = predicate;
  }

  /**
   * Makes the next matching publisher acquisition fail without retaining a resource.
   */
  failNextPublisherCreation(predicate: (channel: unknown) => boolean): void {
    this.#publisherCreationFailure = predicate;
  }

  /**
   * Fails after a fixed number of matching publisher acquisitions have succeeded.
   */
  failPublisherCreationAfter(
    successfulCreations: number,
    predicate: (channel: unknown) => boolean,
  ): void {
    this.#publisherCreationFailureAfter = {
      remainingSuccesses: successfulCreations,
      predicate,
    };
  }

  /**
   * Lists currently open publisher channel keys.
   */
  openPublisherTargets(): readonly string[] {
    return [...this.#openPublishers].sort();
  }

  createPublisher(channel: ChannelId): Promise<Publisher> {
    if (this.#publisherCreationFailure?.(channel) === true) {
      this.#publisherCreationFailure = undefined;
      this.operations.push("publisher:create:failed");
      return Promise.reject(new Error("injected publisher creation failure"));
    }
    if (this.#publisherCreationFailureAfter?.predicate(channel) === true) {
      if (this.#publisherCreationFailureAfter.remainingSuccesses === 0) {
        this.#publisherCreationFailureAfter = undefined;
        this.operations.push("publisher:create:failed");
        return Promise.reject(new Error("injected publisher creation failure"));
      }
      this.#publisherCreationFailureAfter.remainingSuccesses -= 1;
    }
    this.created.push({ kind: "publisher", channel });
    this.operations.push("publisher:create");
    const key = channelKey(channel);
    this.#openPublishers.add(key);
    let closed = false;
    const publisher: Publisher = {
      id: channel,
      targetType: required(channel.targetType, "publisher channel target type"),
      isStale: () => false,
      publish: async (id: Any, message: ExternalMessage) => {
        this.operations.push("publisher:publish");
        if (this.#publishFailure?.(channel) === true) {
          this.#publishFailure = undefined;
          throw new Error("injected transport publication failure");
        }
        this.published.push({ channel, id, message, operationIndex: this.operations.length - 1 });
        for (const consumer of this.#consumers.get(channelKey(channel)) ?? [])
          await consumer(message);
        if (this.#publishGate?.predicate(channel) === true) {
          const gate = this.#publishGate;
          this.#publishGate = undefined;
          await gate.wait;
        }
      },
      close: () =>
        Promise.resolve().then(() => {
          if (closed) return;
          this.#close("publisher:close");
          closed = true;
          this.#openPublishers.delete(key);
        }),
    };
    return Promise.resolve(publisher);
  }

  createSubscriber(channel: ChannelId): Promise<Subscriber> {
    this.created.push({ kind: "subscriber", channel });
    this.operations.push("subscriber:create");
    const key = channelKey(channel);
    const consumers = this.#consumers.get(key) ?? new Set();
    this.#consumers.set(key, consumers);
    const subscriberConsumers = new Set<ExternalMessageConsumer>();
    let closed = false;
    let closing: Promise<void> | undefined;
    const subscriber: Subscriber = {
      id: channel,
      targetType: required(channel.targetType, "subscriber channel target type"),
      isStale: () => subscriberConsumers.size === 0,
      addConsumer: (consumer: ExternalMessageConsumer): Promise<ConsumerHandle> => {
        if (closed || closing !== undefined)
          return Promise.reject(new Error("subscriber is closed"));
        if (this.#consumerAdditionFailure?.(channel) === true) {
          this.#consumerAdditionFailure = undefined;
          this.operations.push("consumer:add:failed");
          return Promise.reject(new Error("injected consumer attachment failure"));
        }
        consumers.add(consumer);
        subscriberConsumers.add(consumer);
        this.operations.push("consumer:add");
        let handleClosed = false;
        const handle: ConsumerHandle = {
          close: () => {
            if (handleClosed) return Promise.resolve();
            handleClosed = true;
            consumers.delete(consumer);
            subscriberConsumers.delete(consumer);
            this.operations.push("consumer:remove");
            return Promise.resolve();
          },
        };
        return Promise.resolve(handle);
      },
      close: () =>
        (closing ??= Promise.resolve()
          .then(() => {
            closed = true;
            for (const consumer of subscriberConsumers) consumers.delete(consumer);
            subscriberConsumers.clear();
            this.#close("subscriber:close");
          })
          .catch((error: unknown) => {
            closing = undefined;
            throw error;
          })),
    };
    return Promise.resolve(subscriber);
  }

  close(): Promise<void> {
    return Promise.resolve().then(() => {
      this.#close("factory:close");
    });
  }
}

function channelKey(channel: unknown): string {
  const targetType = (channel as { targetType?: unknown }).targetType;
  if (typeof targetType !== "string" || targetType.length === 0)
    throw new TypeError("Transport channels require ChannelId.targetType.");
  return targetType;
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Expected ${label}.`);
  return value;
}

/**
 * Loads a planned Wave 13 contract without making the test suite itself depend on an absent module.
 */
export async function loadWave13Contract(modulePath: string): Promise<Record<string, unknown>> {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    expect.fail(`Wave 13 contract is unavailable at ${modulePath}: ${detail}`);
  }
}

/**
 * Requires the specified contract member so a missing implementation is an assertion failure.
 */
export function requireContractMember(
  contract: Record<string, unknown>,
  member: string,
  behavior: string,
): unknown {
  const implementation = contract[member];
  expect(implementation, `${behavior} requires ${member}.`).toBeDefined();
  return implementation;
}
