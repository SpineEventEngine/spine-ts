import type {
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
} from "./delivery-ports.js";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import type { ShardIndex } from "./shard-index.js";

type OnConditionalPickUp = (
  shard: ShardIndex,
  worker: WorkerId,
  options?: DeliveryOperationOptions,
) => Promise<DeliveryWorkSession | undefined>;
const pickups = new WeakMap<DeliveryWorkRegistry, OnConditionalPickUp>();

/**
 * Provides framework-private conditional pickup for registries that support it.
 */
export const conditionalPickUp: Readonly<{
  // prettier-ignore

  /**
   * Records a registry's conditional pickup implementation.
   *
   * @param registry Identifies the supporting work registry.
   * @param pickUp Acquires only when remote pending work exists.
   */
  register: (registry: DeliveryWorkRegistry, pickUp: OnConditionalPickUp) => void;

  /**
   * Finds a registry's conditional pickup implementation.
   *
   * @param registry Identifies the work registry.
   * @returns The conditional pickup when the registry supports it.
   */
  for: (registry: DeliveryWorkRegistry) => OnConditionalPickUp | undefined;
}> = Object.freeze({
  register(registry: DeliveryWorkRegistry, pickUp: OnConditionalPickUp): void {
    pickups.set(registry, pickUp);
  },
  for(registry: DeliveryWorkRegistry): OnConditionalPickUp | undefined {
    return pickups.get(registry);
  },
});
