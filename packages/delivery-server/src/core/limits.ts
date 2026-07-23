/**
 * Delivery-server resource limits. They deliberately remain well below the
 * 4 MiB delivery RPC ceiling, so one bounded shard response can be encoded.
 */
export interface DeliveryStateLimits {
  readonly maxRetainedMessages: number;
  readonly maxRetainedBytes: number;
  readonly maxTrackedShards: number;
}

export const MAX_DELIVERY_RPC_BYTES = 4_194_304;
export const MAX_DELIVERY_BATCH_MESSAGES = 100;
export const MAX_INBOX_PAYLOAD_BYTES = 1_048_576;
/** Leaves room for the optional/page response wrapper below the RPC ceiling. */
export const MAX_INBOX_RECORD_BYTES: number = MAX_DELIVERY_RPC_BYTES - 64;
export const MAX_DELIVERY_RESPONSE_SHARDS = 1_000;
/** Keeps one bounded 1,000-session expiration response below the 4 MiB RPC ceiling. */
export const MAX_DELIVERY_WORKER_BYTES = 128;
export const MAX_DELIVERY_LIMIT = 2_147_483_647;

export const DEFAULT_DELIVERY_STATE_LIMITS: DeliveryStateLimits = Object.freeze({
  maxRetainedMessages: 10_000,
  maxRetainedBytes: 32 * 1_024 * 1_024,
  maxTrackedShards: MAX_DELIVERY_RESPONSE_SHARDS,
});

export function resolveStateLimits(
  options: Partial<DeliveryStateLimits> = {},
): DeliveryStateLimits {
  const limits = {
    maxRetainedMessages:
      options.maxRetainedMessages ?? DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedMessages,
    maxRetainedBytes: options.maxRetainedBytes ?? DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedBytes,
    maxTrackedShards: options.maxTrackedShards ?? DEFAULT_DELIVERY_STATE_LIMITS.maxTrackedShards,
  };
  stateLimit(limits.maxRetainedMessages, MAX_DELIVERY_LIMIT, "maxRetainedMessages");
  stateLimit(limits.maxRetainedBytes, MAX_DELIVERY_LIMIT, "maxRetainedBytes");
  stateLimit(limits.maxTrackedShards, MAX_DELIVERY_RESPONSE_SHARDS, "maxTrackedShards");
  return Object.freeze(limits);
}

function stateLimit(value: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`Delivery server ${name} is invalid.`);
}
