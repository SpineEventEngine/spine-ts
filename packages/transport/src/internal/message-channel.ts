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

import type { Any } from "@bufbuild/protobuf/wkt";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";

/**
 * Checks whether a channel target uses the canonical type-URL syntax.
 *
 * Transport channels know only their generated type URL. They deliberately do
 * not resolve that URL through an application schema registry.
 *
 * @param targetType Supplies the channel target type URL.
 * @returns True when the target has a nonempty, whitespace-free prefix and a
 *   Protobuf full name.
 *
 * @internal
 */
export function isCanonicalChannelTargetType(targetType: string): boolean {
  const separator = targetType.lastIndexOf("/");
  if (separator <= 0) return false;
  const prefix = targetType.slice(0, separator);
  const fullName = targetType.slice(separator + 1);
  return (
    !/\s/u.test(prefix) &&
    !prefix.endsWith("/") &&
    /^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u.test(fullName)
  );
}

/**
 * Accepts one integration external-message frame.
 *
 * @param message Provides the received frame.
 * @returns Completes when consumption finishes.
 *
 */
export type ExternalMessageConsumer = (message: ExternalMessage) => void | Promise<void>;

/**
 * Removes one subscriber consumer.
 *
 */
export interface ConsumerHandle {
  // prettier-ignore

  // prettier-ignore

  /**
   *
   * Removes the consumer idempotently.
   *
   * @returns Completes when removal finishes.
   */
  close(): Promise<void>;
}

/**
 * Defines a typed integration message channel.
 *
 */
export interface MessageChannel {
  // prettier-ignore

  // prettier-ignore

  /**
   *
   * Identifies the channel.
   *
   */
  readonly id: ChannelId;

  // prettier-ignore

  /**
   *
   * Identifies the canonical target type URL.
   *
   */
  readonly targetType: string;

  // prettier-ignore

  /**
   *
   * Checks whether the channel has no active local work.
   *
   * @returns True when stale.
   */
  isStale(): boolean;

  // prettier-ignore

  /**
   *
   * Closes the channel idempotently; racing callers await the same completion.
   *
   * @returns Completes after close.
   */
  close(): Promise<void>;
}

/**
 * Publishes integration external-message frames.
 *
 */
export interface Publisher extends MessageChannel {
  // prettier-ignore

  // prettier-ignore

  /**
   *
   * Publishes a frame with its wrapper identity.
   *
   * @param id Provides the wrapper identity.
   * @param message Provides the external-message frame.
   * @returns Completes after local delivery accepts the frame.
   */
  publish(id: Any, message: ExternalMessage): Promise<void>;
}

/**
 * Receives integration external-message frames.
 *
 */
export interface Subscriber extends MessageChannel {
  // prettier-ignore

  // prettier-ignore

  /**
   *
   * Attaches a frame consumer.
   *
   * @param consumer Receives copied external-message frames.
   * @returns An idempotent consumer-removal handle.
   */
  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle>;
}

/**
 * Creates typed integration channels.
 *
 */
export interface TransportFactory {
  // prettier-ignore

  // prettier-ignore

  /**
   *
   * Creates a publisher.
   *
   * @param id Identifies the typed channel.
   * @returns A publisher for the channel.
   */
  createPublisher(id: ChannelId): Promise<Publisher>;

  // prettier-ignore

  /**
   *
   * Creates a subscriber.
   *
   * @param id Identifies the typed channel.
   * @returns A subscriber for the channel.
   */
  createSubscriber(id: ChannelId): Promise<Subscriber>;

  // prettier-ignore

  /**
   *
   * Closes factory resources idempotently; racing callers await the same completion.
   *
   * @returns Completes after close.
   */
  close(): Promise<void>;
}
