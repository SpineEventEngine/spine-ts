import type { Event } from "@spine-ts/proto";

import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";

/**
 * Small multicast event-dispatch seam for later repository/runtime owners.
 *
 * Dispatchers declare the event message schemas they accept and perform the
 * actual handling behind the bus seam. The bus does not instantiate entities
 * or invoke entity methods directly.
 */
export interface EventDispatcher {
  /** Generated event message schemas accepted by this dispatcher. */
  messageSchemas(): readonly DescriptorMessageSchema[];

  /** Dispatch one generated Spine event envelope. */
  dispatch(event: Event): Promise<void>;
}
