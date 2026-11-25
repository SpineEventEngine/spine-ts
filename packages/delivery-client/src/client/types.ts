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
import type { Duration, Timestamp } from "@bufbuild/protobuf/wkt";

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
   * Reports full-precision pickup or renewal wall time. A pickup reply may
   * sample after the server stores the session, so Admin can report an earlier
   * time. This timestamp is advisory; `sessionId` identifies authority.
   */
  readonly whenPicked: Timestamp;

  /**
   * Identifies this pickup across renewals and excludes later pickups.
   * A previously issued handle remains valid after a completed renewal of
   * this same session.
   */
  readonly sessionId: string;

  /**
   * Gives the positive server lifetime between successful renewals.
   */
  readonly lifetime: Duration;
}

/**
 * Reports one definitive work-aware pickup result.
 */
export type DeliveryManagedPickupOutcome =
  | Readonly<{
      /**
       * Reports that a session was granted or recovered.
       */
      readonly kind: "PICKED";

      /**
       * Carries the complete granted session.
       */
      readonly session: RemoteShardSession;
    }>
  | Readonly<{
      /**
       * Reports that another session currently holds the shard.
       */
      readonly kind: "BUSY";

      /**
       * Identifies the current worker.
       */
      readonly worker: DeliveryWorkerId;

      /**
       * Reports the retained pickup or renewal time without granting authority.
       */
      readonly whenPicked: Timestamp;
    }>
  | Readonly<{
      /**
       * Reports that the free shard has no pending work.
       */
      readonly kind: "NO_WORK";
    }>;

/**
 * A detached observation of a session released for inactivity.
 */
export interface ReleasedShardSession {
  // prettier-ignore

  /**
   * Identifies the released session kind.
   */
  readonly kind: "EXCLUSIVE";

  /**
   * Identifies the released shard.
   */
  readonly shard: ShardIndex;

  /**
   * Identifies the former worker.
   */
  readonly worker: DeliveryWorkerId;

  /**
   * Reports the former pickup with full precision.
   */
  readonly whenPicked: Timestamp;

  /**
   * Reports when the remote service released the inactive session.
   */
  readonly whenReleased: Timestamp;
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
   * Reports the retained full-precision pickup or renewal wall time when known.
   * This is an observation and does not grant or prove a live session.
   */
  readonly lastPicked?: Timestamp;

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
   * @param cause Preserves the invalid response's internal decoding error.
   */
  constructor(cause?: unknown) {
    super("Delivery server returned an invalid inbox message.", { cause });
    this.name = "DeliveryProtocolError";
  }
}

/**
 * Raised when a local read position cannot be continued through JVM timestamp paging.
 */
export class DeliveryPagingError extends Error {
  // prettier-ignore

  /**
   * Creates an error for an unsupported local remote-read offset.
   */
  constructor() {
    super("Remote Inbox cannot continue safely from the supplied page position.");
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
    | "PICK_UP_FOR_DELIVERY"
    | "RENEW_SHARD"
    | "RELEASE_SHARD"
    | "RELEASE_EXPIRED"
    | "ACKNOWLEDGE"
    | "REMOVE_DUPLICATE_GUARDED"
    | "REMOVE_DELIVERED_GUARDED";

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
    super(DeliveryOutcomeValues.message(operation));
    this.name = "DeliveryOutcomeUnknownError";
    this.operation = operation;
    this.reconciliation = DeliveryOutcomeValues.reconciliation(operation, reconciliation);
  }
}

/**
 * Builds safe labels and reconciliation scopes for unknown mutation outcomes.
 */
const DeliveryOutcomeValues = Object.freeze({
  /**
   * Returns a safe error message for the operation.
   *
   * @param operation Names the uncertain mutation.
   * @returns A message without server-provided data.
   */
  message(operation: DeliveryOutcomeUnknownError["operation"]): string {
    if (operation === "WRITE_ONE" || operation === "WRITE_MANY")
      return "Delivery write outcome is unknown.";
    if (
      operation === "REMOVE_ONE" ||
      operation === "REMOVE_MANY" ||
      operation === "REMOVE_DUPLICATE_GUARDED" ||
      operation === "REMOVE_DELIVERED_GUARDED"
    )
      return "Delivery removal outcome is unknown.";
    return "Delivery shard operation outcome is unknown.";
  },

  /**
   * Builds the observation required after an uncertain mutation.
   *
   * @param operation Names the uncertain mutation.
   * @param input Supplies affected messages or shards.
   * @returns A detached safe reconciliation scope.
   */
  reconciliation(
    operation: DeliveryOutcomeUnknownError["operation"],
    input: readonly string[] | readonly ShardIndex[] | "ALL_SHARDS",
  ): DeliveryOutcomeUnknownError["reconciliation"] {
    if (typeof input === "string") return Object.freeze({ kind: "OBSERVE_SHARD", scope: input });
    if (DeliveryOutcomeValues.shardOperation(operation))
      return Object.freeze({
        kind: "OBSERVE_SHARD",
        shards: Object.freeze(
          (input as readonly ShardIndex[]).map(
            (value) => new ShardIndex(value.index, value.ofTotal),
          ),
        ),
      });
    return Object.freeze({
      kind: "FIND_MESSAGE",
      messageIds: Object.freeze([...(input as readonly string[])]),
    });
  },

  /**
   * Checks whether one operation needs shard observation.
   *
   * @param operation Names the uncertain mutation.
   * @returns Whether shard observation is required.
   */
  shardOperation(operation: DeliveryOutcomeUnknownError["operation"]): boolean {
    return (
      operation === "PICK_UP_SHARD" ||
      operation === "PICK_UP_FOR_DELIVERY" ||
      operation === "RENEW_SHARD" ||
      operation === "RELEASE_SHARD"
    );
  },
});

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
 * A bounded read page request through the JVM timestamp protocol.
 */
export interface DeliveryReadPageOptions extends DeliveryFindOneOptions {
  // prettier-ignore

  /**
   * Continues a timestamp-ordered page after this precise received time.
   */
  readonly sinceWhen?: Timestamp;

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
