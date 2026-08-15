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

/**
 * A deliberately small transport double. It implements the frozen public
 * transport shape, records creation/publication/teardown, and delegates every
 * frame to the currently attached consumers.  It is an observation seam, not
 * a broker control surface.
 */
export class RecordingTransportFactory {
  readonly operations: string[] = [];
  readonly published: {
    readonly channel: unknown;
    readonly id: unknown;
    readonly message: unknown;
    readonly operationIndex: number;
  }[] = [];
  readonly created: { readonly kind: "publisher" | "subscriber"; readonly channel: unknown }[] = [];
  #consumers = new Map<string, Set<(message: unknown) => void | Promise<void>>>();
  #remainingCloseFailures: number;
  #publishFailure: ((channel: unknown) => boolean) | undefined;
  #publisherCreationFailure: ((channel: unknown) => boolean) | undefined;
  #publisherCreationFailureAfter:
    { remainingSuccesses: number; predicate: (channel: unknown) => boolean } | undefined;
  #openPublishers = new Set<string>();

  constructor(options: { readonly failCloseAttempts?: number } = {}) {
    this.#remainingCloseFailures = options.failCloseAttempts ?? 0;
  }

  #close(operation: string): void {
    this.operations.push(operation);
    if (this.#remainingCloseFailures-- > 0) throw new Error(`${operation} failed`);
  }

  /** Makes the next matching adapter publication fail before it is accepted. */
  failNextPublish(predicate: (channel: unknown) => boolean = () => true): void {
    this.#publishFailure = predicate;
  }

  /** Makes the next matching publisher acquisition fail without retaining a resource. */
  failNextPublisherCreation(predicate: (channel: unknown) => boolean): void {
    this.#publisherCreationFailure = predicate;
  }

  /** Fails after a fixed number of matching publisher acquisitions have succeeded. */
  failPublisherCreationAfter(
    successfulCreations: number,
    predicate: (channel: unknown) => boolean,
  ): void {
    this.#publisherCreationFailureAfter = {
      remainingSuccesses: successfulCreations,
      predicate,
    };
  }

  /** Lists currently open publisher channel keys. */
  openPublisherTargets(): readonly string[] {
    return [...this.#openPublishers].sort();
  }

  async createPublisher(channel: unknown) {
    if (this.#publisherCreationFailure?.(channel) === true) {
      this.#publisherCreationFailure = undefined;
      this.operations.push("publisher:create:failed");
      throw new Error("injected publisher creation failure");
    }
    if (this.#publisherCreationFailureAfter?.predicate(channel) === true) {
      if (this.#publisherCreationFailureAfter.remainingSuccesses === 0) {
        this.#publisherCreationFailureAfter = undefined;
        this.operations.push("publisher:create:failed");
        throw new Error("injected publisher creation failure");
      }
      this.#publisherCreationFailureAfter.remainingSuccesses -= 1;
    }
    this.created.push({ kind: "publisher", channel });
    this.operations.push("publisher:create");
    const key = channelKey(channel);
    this.#openPublishers.add(key);
    let closed = false;
    return {
      id: channel,
      targetType: (channel as { targetType?: string }).targetType,
      isStale: () => false,
      publish: async (id: unknown, message: unknown) => {
        this.operations.push("publisher:publish");
        if (this.#publishFailure?.(channel) === true) {
          this.#publishFailure = undefined;
          throw new Error("injected transport publication failure");
        }
        this.published.push({ channel, id, message, operationIndex: this.operations.length - 1 });
        for (const consumer of this.#consumers.get(channelKey(channel)) ?? [])
          await consumer(message);
      },
      close: async () => {
        if (closed) return;
        this.#close("publisher:close");
        closed = true;
        this.#openPublishers.delete(key);
      },
    };
  }

  async createSubscriber(channel: unknown) {
    this.created.push({ kind: "subscriber", channel });
    this.operations.push("subscriber:create");
    const key = channelKey(channel);
    const consumers = this.#consumers.get(key) ?? new Set();
    this.#consumers.set(key, consumers);
    return {
      id: channel,
      targetType: (channel as { targetType?: string }).targetType,
      isStale: () => consumers.size === 0,
      addConsumer: async (consumer: (message: unknown) => void | Promise<void>) => {
        consumers.add(consumer);
        this.operations.push("consumer:add");
        let closed = false;
        return {
          close: async () => {
            if (closed) return;
            closed = true;
            consumers.delete(consumer);
            this.operations.push("consumer:remove");
          },
        };
      },
      close: async () => {
        consumers.clear();
        this.#close("subscriber:close");
      },
    };
  }

  async close(): Promise<void> {
    this.#close("factory:close");
  }
}

function channelKey(channel: unknown): string {
  const targetType = (channel as { targetType?: unknown })?.targetType;
  if (typeof targetType !== "string" || targetType.length === 0)
    throw new TypeError("Transport channels require ChannelId.targetType.");
  return targetType;
}

/** Loads a planned Wave 13 contract without making the test suite itself depend on an absent module. */
export async function loadWave13Contract(modulePath: string): Promise<Record<string, unknown>> {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    expect.fail(`Wave 13 contract is unavailable at ${modulePath}: ${detail}`);
  }
}

/** Requires the specified contract member so a missing implementation is an assertion failure. */
export function requireContractMember(
  contract: Record<string, unknown>,
  member: string,
  behavior: string,
): unknown {
  const implementation = contract[member];
  expect(implementation, `${behavior} requires ${member}.`).toBeDefined();
  return implementation;
}
