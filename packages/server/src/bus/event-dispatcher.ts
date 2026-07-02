import type { Event } from "@spine-ts/proto";
import type { MessageSchema } from "@spine-ts/core";

/**
 * Small multicast event-dispatch seam for later repository/runtime owners.
 *
 * Dispatchers declare the event message schemas they accept and perform the
 * actual handling behind the bus seam. The bus does not instantiate entities
 * or invoke entity methods directly.
 */
export interface EventDispatcher {
  /** Generated event message schemas accepted by this dispatcher. */
  messageSchemas(): readonly MessageSchema[];

  /** Validate one generated Spine event before the bus stores it. */
  accept?(event: Event): Promise<void>;

  /** Dispatch one generated Spine event envelope. */
  dispatch(event: Event): Promise<void>;
}
