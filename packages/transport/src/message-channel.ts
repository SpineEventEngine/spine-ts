/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 */

import type { Any } from "@bufbuild/protobuf/wkt";
import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";

/**
 * Receives one integration external-message frame.
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
  /**
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
  /**
   * Identifies the channel.
   *
   */
  readonly id: ChannelId;

  /**
   * Identifies the canonical target type URL.
   *
   */
  readonly targetType: string;

  /**
   * Checks whether the channel has no active local work.
   *
   * @returns True when stale.
   */
  isStale(): boolean;

  /**
   * Closes the channel.
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
  /**
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
  /**
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
  /**
   * Creates a publisher.
   *
   * @param id Identifies the typed channel.
   * @returns A publisher for the channel.
   */
  createPublisher(id: ChannelId): Promise<Publisher>;

  /**
   * Creates a subscriber.
   *
   * @param id Identifies the typed channel.
   * @returns A subscriber for the channel.
   */
  createSubscriber(id: ChannelId): Promise<Subscriber>;

  /**
   * Closes factory resources.
   *
   * @returns Completes after close.
   */
  close(): Promise<void>;
}
