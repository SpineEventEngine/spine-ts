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

import { ShardIndex } from "@spine-event-engine/server";

/**
 * Stable public worker identity represented by the frozen `WorkerId` wire type.
 * `nodeId` and `value` must be non-blank and together occupy at most 128 UTF-8 bytes.
 */
export interface DeliveryWorkerId {
  // prettier-ignore

  /**
   * Identifies the application node that owns this worker.
   */
  readonly nodeId: string;

  /**
   * Identifies this worker within its application node.
   */
  readonly value: string;
}

/**
 * A remote exclusive shard session that can be released by this client.
 */
export interface RemoteShardSession {
  // prettier-ignore

  /**
   * Identifies the exclusive session kind accepted by the remote service.
   */
  readonly kind: "EXCLUSIVE";

  /**
   * Identifies the shard held by this session.
   */
  readonly shard: ShardIndex;

  /**
   * Identifies the worker that acquired this session.
   */
  readonly worker: DeliveryWorkerId;

  /**
   * Records when the remote service granted the session.
   */
  readonly whenPicked: Date;
}

/**
 * A detached observation of a session released for inactivity.
 */
export interface ReleasedShardSession extends RemoteShardSession {
  // prettier-ignore

  /**
   * Records when the remote service released the inactive session.
   */
  readonly whenReleased: Date;
}

/**
 * A detached Admin observation of one remote delivery shard.
 */
export interface RemoteShardObservation {
  // prettier-ignore

  /**
   * Identifies the observed shard.
   */
  readonly shard: ShardIndex;

  /**
   * Describes whether the shard is currently held.
   */
  readonly status: "PICKED" | "NOT_PICKED";

  /**
   * Records the most recent pickup when the server provides it.
   */
  readonly lastPicked?: Date;

  /**
   * Counts messages currently reported for the shard.
   */
  readonly messages: number;
}

/**
 * Maximum serialized command or event envelope accepted from the delivery server.
 */
export const MAX_INBOX_PAYLOAD_BYTES: 1048576 = 1_048_576;

/**
 * Hard maximum number of messages accepted by one delivery batch mutation.
 */
export const MAX_DELIVERY_BATCH_MESSAGES = 100;

/**
 * Maximum serialized delivery RPC request or page response accepted by this client.
 */
export const MAX_DELIVERY_RPC_BYTES: 4194304 = 4_194_304;

/**
 * Maximum shard observations accepted from the in-memory delivery server.
 */
export const MAX_DELIVERY_TRACKED_SHARDS = 1_000;

/**
 * Maximum combined UTF-8 bytes of one worker and node identity.
 */
export const MAX_DELIVERY_WORKER_BYTES = 128;

/**
 * Raised when a frozen delivery-server response cannot be represented safely.
 */
export class DeliveryProtocolError extends Error {
  // prettier-ignore

  /**
   * Creates an error for an invalid delivery-server response.
   */
  constructor() {
    super("Delivery server returned an invalid inbox message.");
    this.name = "DeliveryProtocolError";
  }
}

/**
 * Raised when the timestamp-only delivery wire page cannot continue without loss.
 */
export class DeliveryPagingError extends Error {
  // prettier-ignore

  /**
   * Creates an error for a page that cannot continue safely.
   */
  constructor() {
    super("Delivery server page cannot be continued safely.");
    this.name = "DeliveryPagingError";
  }
}

/**
 * Raised when a slow observer exceeds the bounded shard-update buffer.
 */
export class ShardObservationOverflowError extends Error {
  // prettier-ignore

  /**
   * Creates an error for a full shard-observation buffer.
   */
  constructor() {
    super("Delivery shard observation buffer overflowed.");
    this.name = "ShardObservationOverflowError";
  }
}

/**
 * Raised when a shard observation stream ends without a usable recovery.
 */
export class DeliveryShardObservationError extends Error {
  // prettier-ignore

  /**
   * Creates an error for a failed shard-observation stream.
   */
  constructor() {
    super("Delivery shard observation stream failed.");
    this.name = "DeliveryShardObservationError";
  }
}

/**
 * Raised when a write may have reached the delivery server but its result was lost.
 */
export class DeliveryOutcomeUnknownError extends Error {
  // prettier-ignore

  /**
   * Identifies the mutation whose remote outcome could not be established.
   */
  readonly operation:
    | "WRITE_ONE"
    | "WRITE_MANY"
    | "REMOVE_ONE"
    | "REMOVE_MANY"
    | "PICK_UP_SHARD"
    | "RELEASE_SHARD"
    | "RELEASE_EXPIRED";

  /**
   * Identifies the observation required to reconcile the mutation outcome.
   */
  readonly reconciliation: Readonly<
    | { readonly kind: "FIND_MESSAGE"; readonly messageIds: readonly string[] }
    | { readonly kind: "OBSERVE_SHARD"; readonly shards: readonly ShardIndex[] }
    | { readonly kind: "OBSERVE_SHARD"; readonly scope: "ALL_SHARDS" }
  >;

  /**
   * Creates an error with the safe observation required before further action.
   *
   * @param operation Identifies the mutation with an unknown outcome.
   * @param reconciliation Identifies messages or shards that must be observed.
   */
  constructor(
    operation: DeliveryOutcomeUnknownError["operation"],
    reconciliation: readonly string[] | readonly ShardIndex[] | "ALL_SHARDS",
  ) {
    super(
      operation === "WRITE_ONE" || operation === "WRITE_MANY"
        ? "Delivery write outcome is unknown."
        : operation === "REMOVE_ONE" || operation === "REMOVE_MANY"
          ? "Delivery removal outcome is unknown."
          : "Delivery shard operation outcome is unknown.",
    );
    this.name = "DeliveryOutcomeUnknownError";
    this.operation = operation;
    if (typeof reconciliation === "string")
      this.reconciliation = Object.freeze({ kind: "OBSERVE_SHARD", scope: reconciliation });
    else if (operation === "PICK_UP_SHARD" || operation === "RELEASE_SHARD")
      this.reconciliation = Object.freeze({
        kind: "OBSERVE_SHARD",
        shards: Object.freeze(
          (reconciliation as readonly ShardIndex[]).map(
            (value) => new ShardIndex(value.index, value.ofTotal),
          ),
        ),
      });
    else
      this.reconciliation = Object.freeze({
        kind: "FIND_MESSAGE",
        messageIds: Object.freeze([...(reconciliation as readonly string[])]),
      });
  }
}

/**
 * Options for constructing a delivery client.
 */
export interface DeliveryClientOptions {
  // prettier-ignore

  /**
   * Limits messages requested in one read page.
   */
  readonly pageSize?: number;

  /**
   * Limits retries for safe read operations.
   */
  readonly readRetries?: number;

  /**
   * Delays each safe-read retry in milliseconds.
   */
  readonly retryBackoffMs?: number;

  /**
   * Limits reconnects for a shard-observation stream.
   */
  readonly observationReconnects?: number;

  /**
   * Delays each observation reconnect in milliseconds.
   */
  readonly observationReconnectBackoffMs?: number;

  /**
   * Limits queued observations and pending consumers.
   */
  readonly observationBufferSize?: number;
}

/**
 * A cancellable, bounded stream of detached remote shard observations.
 */
export interface DeliveryShardObservationStream extends AsyncIterable<RemoteShardObservation> {
  // prettier-ignore

  /**
   * Cancels the observation stream and releases its local listeners.
   */
  cancel(): void;
}

/**
 * Options for one side-effect-free read operation.
 */
export interface DeliveryFindOneOptions {
  // prettier-ignore

  /**
   * Cancels the operation when the caller no longer needs its result.
   */
  readonly signal?: AbortSignal;

  /**
   * Limits finite reads and stream setup in milliseconds; it never limits an acknowledged active stream.
   */
  readonly timeoutMs?: number;
}

/**
 * A bounded read page request; the wire contract can continue only by timestamp.
 */
export interface DeliveryReadPageOptions extends DeliveryFindOneOptions {
  // prettier-ignore

  /**
   * Continues a timestamp-ordered page after this received time.
   */
  readonly sinceWhen?: Date;

  /**
   * Limits messages requested for this page.
   */
  readonly pageSize?: number;
}

/**
 * Options for one non-idempotent delivery mutation.
 */
export interface DeliveryMutationOptions {
  // prettier-ignore

  /**
   * Cancels the mutation before its transport call completes.
   */
  readonly signal?: AbortSignal;

  /**
   * Limits the mutation duration in milliseconds.
   */
  readonly timeoutMs?: number;
}
