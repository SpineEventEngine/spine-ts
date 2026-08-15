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

import { randomUUID } from "node:crypto";

import { clone, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { fromBinary } from "@bufbuild/protobuf";

import type { InboxStorage } from "./inbox-storage.js";
import type { DeliveryOperationOptions, DeliveryWorkSession } from "./delivery-ports.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Small JVM-style inbox facade over durable storage.
 */
export class Inbox {
  // prettier-ignore

  /**
   * Local inbox work is admitted only under a renewable leased session.
   */
  readonly sessionKind = "LEASED" as const;

  /**
   * Intentional low-level escape hatch for storage-focused tests and integrations.
   */
  readonly storage: InboxStorage;

  /**
   * Opens an inbox over durable inbox storage.
   *
   * @param storage Stores pending and delivered inbox rows directly.
   */
  constructor(storage: InboxStorage) {
    this.storage = storage;
    Object.freeze(this);
  }

  /**
   * Stores one message in durable inbox storage.
   *
   * @param input Describes the message to make durable.
   * @returns The write or deduplication outcome.
   */
  async receive(input: InboxMessageInput): Promise<InboxWriteResult> {
    const messageInput = this.#inputObject(input, "Inbox message input");
    const shard = this.#readInput(messageInput, "shard", "Inbox message shard") as ShardIndex;
    const signal = this.#readInput(messageInput, "signal", "Inbox signal") as Any | undefined;
    const keepUntil = this.#readInput(messageInput, "keepUntil", "Inbox keep-until time") as
      Date | undefined;

    return this.storage.write({
      inboxId: this.#readInput(messageInput, "inboxId", "Inbox target identity") as InboxId,
      signalId: this.#readInput(messageInput, "signalId", "Inbox signal ID") as string,
      label: this.#readInput(messageInput, "label", "Inbox delivery label") as DeliveryLabel,
      status: this.#readInput(messageInput, "status", "Inbox delivery status") as DeliveryStatus,
      shard,
      whenReceived: this.#readInput(messageInput, "whenReceived", "Inbox receive time") as Date,
      version: this.#readInput(messageInput, "version", "Inbox version") as bigint,
      ...(signal === undefined ? {} : { signal }),
      ...(keepUntil === undefined ? {} : { keepUntil }),
      id: {
        value: randomUUID(),
        shard,
      },
    });
  }

  /**
   * Reads ordered messages for one shard.
   *
   * @param shard Selects the shard to inspect.
   * @param options Filters and bounds the ordered page.
   * @returns The matching durable messages.
   */
  read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    return this.storage.read(shard, options);
  }

  /**
   * Reads one exact durable inbox message by ID.
   *
   * @param id Identifies the durable message.
   * @returns The message when it remains durable.
   */
  readMessage(id: InboxMessageId): Promise<InboxMessage | undefined> {
    return this.storage.readMessage(id);
  }

  /**
   * Updates one pending message to delivered when its snapshot still matches.
   *
   * @param message Supplies the pending message snapshot.
   * @returns The delivered message, or `undefined` when the durable row is missing,
   * not pending, or no longer matches the snapshot. Matching delivered rows return
   * idempotently so concurrent workers converge without re-dispatching.
   */
  markDelivered(message: InboxMessage): Promise<InboxMessage | undefined> {
    return this.storage.markDelivered(message);
  }

  /**
   * Removes one delivered message only when direct provider cleanup can prove
   * current ownership and the exact durable snapshot in one atomic operation.
   *
   * @param message Supplies the exact delivered snapshot to remove.
   * @param session Supplies the leased session that owns the message shard.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns Whether the provider atomically removed the exact durable row.
   */
  removeDelivered(
    message: InboxMessage,
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    return this.storage.removeDelivered(message, session, options);
  }

  #inputObject(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InboxMessageError(`${label} is invalid.`);
    }

    return value as Record<string, unknown>;
  }

  #readInput(value: Record<string, unknown>, property: string, label: string): unknown {
    try {
      return Reflect.get(value, property);
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  }
}

/**
 * Durable target inbox identity.
 */
export interface InboxId {
  // prettier-ignore

  /**
   * Target Entity ID packed as canonical `Any` type URL and bytes.
   *
   * Durable boundaries snapshot this value. Callers and custom delivery
   * strategies must treat it as typed identity, not as a display string.
   */
  readonly targetId: Any;

  /**
   * Target entity state type URL.
   */
  readonly targetTypeUrl: string;
}

/**
 * Provides canonical typed Inbox target identity operations.
 */
export const InboxTargets: Readonly<{
  clone(value: Any): Any;
  key(value: Any): string;
  shardKey(value: Any): string;
  equal(left: Any, right: Any): boolean;
}> = Object.freeze({
  clone(value: Any): Any {
    if (value.typeUrl.trim().length === 0) throw new TypeError("Inbox target ID is invalid.");
    return clone(AnySchema, value);
  },
  key(value: Any): string {
    return Buffer.from(toBinary(AnySchema, value)).toString("base64");
  },
  shardKey(value: Any): string {
    if (value.typeUrl === "type.googleapis.com/google.protobuf.StringValue") {
      try {
        const text = fromBinary(StringValueSchema, value.value).value;
        if (text.trim().length === 0) throw new TypeError("String target ID is blank.");
        return text;
      } catch {
        throw new TypeError("Inbox target ID must be a valid StringValue.");
      }
    }
    return this.key(value);
  },
  equal(left: Any, right: Any): boolean {
    return this.key(left) === this.key(right);
  },
});

/**
 * Durable inbox message identity.
 */
export interface InboxMessageId {
  // prettier-ignore

  /**
   * Message UUID within one shard.
   */
  readonly value: string;

  /**
   * Shard that owns the message; must match `InboxMessage.shard`.
   */
  readonly shard: ShardIndex;
}

/**
 * Raised by public delivery APIs when a caller provides an invalid inbox
 * message. Corrupt durable delivery rows raise
 * `DeliveryStorageCorruptionError`.
 */
export class InboxMessageError extends Error {
  // prettier-ignore

  /**
   * Creates an error for invalid public inbox input.
   *
   * @param message Describes the invalid input.
   * @param options Optionally preserves the originating failure.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InboxMessageError";
  }
}

/**
 * Delivery destination label.
 */
export type DeliveryLabel =
  "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT" | "CATCH_UP";

/**
 * Durable delivery state.
 */
export type DeliveryStatus = "TO_DELIVER" | "SCHEDULED" | "DELIVERED" | "TO_CATCH_UP";

/**
 * One durable inbox message.
 */
export interface InboxMessage {
  // prettier-ignore

  /**
   * Durable record identity.
   */
  readonly id: InboxMessageId;

  /**
   * Target inbox identity.
   */
  readonly inboxId: InboxId;

  /**
   * Original signal identity used for delivery deduplication.
   */
  readonly signalId: string;

  /**
   * Optional packed signal payload.
   */
  readonly signal?: Any;

  /**
   * Delivery destination label.
   */
  readonly label: DeliveryLabel;

  /**
   * Current delivery status.
   */
  readonly status: DeliveryStatus;

  /**
   * Shard responsible for delivery; must match `id.shard`.
   */
  readonly shard: ShardIndex;

  /**
   * Durable receive time.
   */
  readonly whenReceived: Date;

  /**
   * Ordering tie-breaker for equal receive times.
   */
  readonly version: bigint;

  /**
   * Optional deduplication retention deadline.
   */
  readonly keepUntil?: Date;
}

/**
 * Write request for one new inbox message.
 */
export interface InboxMessageInput {
  // prettier-ignore

  /**
   * Target inbox identity.
   */
  readonly inboxId: InboxId;

  /**
   * Original signal identity used for delivery deduplication.
   */
  readonly signalId: string;

  /**
   * Optional packed signal payload.
   */
  readonly signal?: Any;

  /**
   * Delivery destination label.
   */
  readonly label: DeliveryLabel;

  /**
   * Current delivery status.
   */
  readonly status: DeliveryStatus;

  /**
   * Shard responsible for delivery.
   */
  readonly shard: ShardIndex;

  /**
   * Durable receive time.
   */
  readonly whenReceived: Date;

  /**
   * Ordering tie-breaker for equal receive times.
   */
  readonly version: bigint;

  /**
   * Optional deduplication retention deadline.
   */
  readonly keepUntil?: Date;
}

/**
 * Read filter for one shard page.
 */
export interface InboxReadOptions {
  // prettier-ignore

  /**
   * Optional delivery statuses to keep.
   */
  readonly statuses?: readonly DeliveryStatus[];

  /**
   * Optional page limit for one ordered page; must be positive and at most 1000.
   */
  readonly limit?: number;

  /**
   * Optional stable inbox row key after which the ordered read should continue.
   */
  readonly after?: InboxReadContinuation;

  /**
   * Optional non-negative page offset in inbox order; defaults to the first row.
   */
  readonly offset?: number;
}

/**
 * Stable ordered inbox row key used to continue an ordered read.
 */
export interface InboxReadContinuation {
  // prettier-ignore

  /**
   * Inbox message UUID from the last row of the previous page.
   */
  readonly messageId: string;

  /**
   * Receive time from the last row of the previous page.
   */
  readonly whenReceived: Date;

  /**
   * Version from the last row of the previous page.
   */
  readonly version: bigint;
}

/**
 * Durable inbox write outcome.
 */
export interface InboxWriteResult {
  // prettier-ignore

  /**
   * Whether the message was written or matched an existing dedup key.
   */
  readonly outcome: "WRITTEN" | "DUPLICATE";

  /**
   * Stored message selected for the outcome.
   */
  readonly message: InboxMessage;
}
