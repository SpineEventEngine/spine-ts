/** Smallest supported worker and shard lease duration in milliseconds. */
export const minDeliveryLeaseMs = 1_000;

/** Largest supported worker and shard lease duration in milliseconds. */
export const maxDeliveryLeaseMs = 2_147_483_647;

/** Validate one delivery or shard lease duration. */
export function requireDeliveryLeaseMs(
  owner: "Delivery" | "ShardedWorkRegistry",
  value: unknown,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minDeliveryLeaseMs) {
    throw new Error(
      `${owner} leaseMs must be a positive safe integer at least ${String(minDeliveryLeaseMs)}.`,
    );
  }
  if ((value as number) > maxDeliveryLeaseMs) {
    throw new Error(
      `${owner} leaseMs must be a positive safe integer at most ${String(maxDeliveryLeaseMs)}.`,
    );
  }

  return value as number;
}
