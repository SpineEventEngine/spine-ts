import { ShardIndex } from "@spine-ts/server";

/**
 * Stable public worker identity represented by the frozen `WorkerId` wire type.
 * `nodeId` and `value` must be non-blank and together occupy at most 128 UTF-8 bytes.
 */
export interface DeliveryWorkerId {
  readonly nodeId: string;
  readonly value: string;
}

/** A remote exclusive shard session that can be released by this client. */
export interface RemoteShardSession {
  readonly kind: "EXCLUSIVE";
  readonly shard: ShardIndex;
  readonly worker: DeliveryWorkerId;
  readonly whenPicked: Date;
}

/** A detached observation of a session released for inactivity. */
export interface ReleasedShardSession extends RemoteShardSession {
  readonly whenReleased: Date;
}

/** A detached Admin observation of one remote delivery shard. */
export interface RemoteShardObservation {
  readonly shard: ShardIndex;
  readonly status: "PICKED" | "NOT_PICKED";
  readonly lastPicked?: Date;
  readonly messages: number;
}

/** Maximum serialized command or event envelope accepted from the delivery server. */
export const MAX_INBOX_PAYLOAD_BYTES: 1048576 = 1_048_576;
/** Hard maximum number of messages accepted by one delivery batch mutation. */
export const MAX_DELIVERY_BATCH_MESSAGES = 100;
/** Maximum serialized delivery RPC request or page response accepted by this client. */
export const MAX_DELIVERY_RPC_BYTES: 4194304 = 4_194_304;
/** Maximum shard observations accepted from the in-memory delivery server. */
export const MAX_DELIVERY_TRACKED_SHARDS = 1_000;
/** Maximum combined UTF-8 bytes of one worker and node identity. */
export const MAX_DELIVERY_WORKER_BYTES = 128;

/** Raised when a frozen delivery-server response cannot be represented safely. */
export class DeliveryProtocolError extends Error {
  constructor() {
    super("Delivery server returned an invalid inbox message.");
    this.name = "DeliveryProtocolError";
  }
}

/** Raised when the timestamp-only delivery wire page cannot continue without loss. */
export class DeliveryPagingError extends Error {
  constructor() {
    super("Delivery server page cannot be continued safely.");
    this.name = "DeliveryPagingError";
  }
}

/** Raised when durable removal-quarantine state cannot safely be used. */
export class DeliveryQuarantineError extends Error {
  constructor() {
    super("Delivery removal quarantine is unavailable.");
    this.name = "DeliveryQuarantineError";
  }
}

/** Caller-owned durable, capacity-bounded state for unknown remote removals. */
export interface RemovalQuarantine {
  get(id: string): Promise<RemovalQuarantineRecord | undefined>;
  put(record: RemovalQuarantineRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Compact recovery state persisted before callback admission and removal. */
export interface RemovalQuarantineRecord {
  readonly id: string;
  readonly phase: "ADMITTED" | "REMOVING";
  readonly fingerprint: string;
}

/** Raised when a slow observer exceeds the bounded shard-update buffer. */
export class ShardObservationOverflowError extends Error {
  constructor() {
    super("Delivery shard observation buffer overflowed.");
    this.name = "ShardObservationOverflowError";
  }
}

/** Raised when a shard observation stream ends without a usable recovery. */
export class DeliveryShardObservationError extends Error {
  constructor() {
    super("Delivery shard observation stream failed.");
    this.name = "DeliveryShardObservationError";
  }
}

/** Raised when a write may have reached the delivery server but its result was lost. */
export class DeliveryOutcomeUnknownError extends Error {
  readonly operation:
    | "WRITE_ONE"
    | "WRITE_MANY"
    | "REMOVE_ONE"
    | "REMOVE_MANY"
    | "PICK_UP_SHARD"
    | "RELEASE_SHARD"
    | "RELEASE_EXPIRED";
  readonly reconciliation: Readonly<
    | { readonly kind: "FIND_MESSAGE"; readonly messageIds: readonly string[] }
    | { readonly kind: "OBSERVE_SHARD"; readonly shards: readonly ShardIndex[] }
    | { readonly kind: "OBSERVE_SHARD"; readonly scope: "ALL_SHARDS" }
  >;

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

/** Options for constructing a delivery client. */
export interface DeliveryClientOptions {
  readonly pageSize?: number;
  readonly readRetries?: number;
  readonly retryBackoffMs?: number;
  readonly observationReconnects?: number;
  readonly observationReconnectBackoffMs?: number;
  readonly observationBufferSize?: number;
}
/** A cancellable, bounded stream of detached remote shard observations. */
export interface DeliveryShardObservationStream extends AsyncIterable<RemoteShardObservation> {
  cancel(): void;
}
/** Options for one side-effect-free read operation. */
export interface DeliveryFindOneOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
/** A bounded read page request; the wire contract can continue only by timestamp. */
export interface DeliveryReadPageOptions extends DeliveryFindOneOptions {
  readonly sinceWhen?: Date;
  readonly pageSize?: number;
}
/** Options for one non-idempotent delivery mutation. */
export interface DeliveryMutationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
