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

/** Consumes one integration external-message frame. */
export type ExternalMessageConsumer = (message: ExternalMessage) => void | Promise<void>;

/** Removes one subscriber consumer. */
export interface ConsumerHandle {
  /** Removes the consumer. This operation is idempotent. */
  close(): Promise<void>;
}

/** A typed integration message channel. */
export interface MessageChannel {
  /** Identifies the channel. */
  readonly id: ChannelId;
  /** The canonical target type URL. */
  readonly targetType: string;
  /** Reports whether the channel no longer has active local work. */
  isStale(): boolean;
  /** Closes the channel. */
  close(): Promise<void>;
}

/** Publishes integration external-message frames. */
export interface Publisher extends MessageChannel {
  /** Publishes an external-message frame with its identity. */
  publish(id: Any, message: ExternalMessage): Promise<void>;
}

/** Receives integration external-message frames. */
export interface Subscriber extends MessageChannel {
  /** Attaches a consumer and returns its removal handle. */
  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle>;
}

/** Creates typed integration channels. */
export interface TransportFactory {
  /** Creates a publisher for the supplied channel. */
  createPublisher(id: ChannelId): Promise<Publisher>;
  /** Creates a subscriber for the supplied channel. */
  createSubscriber(id: ChannelId): Promise<Subscriber>;
  /** Closes all adapter resources. */
  close(): Promise<void>;
}
