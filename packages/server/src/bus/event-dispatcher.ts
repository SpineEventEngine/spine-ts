import type { Event } from "@spine-event-engine/proto";
import type { MessageSchema } from "@spine-event-engine/core";

/**
 * Small multicast event-dispatch seam for bus and repository adapters.
 *
 * Dispatchers declare the event message schemas they accept and perform
 * handling behind the bus seam. Repository-backed adapters own projection or
 * subscriber invocation; the bus validates, stores, and routes event envelopes.
 */
export interface EventDispatcher {
  /** Generated event message schemas accepted by this dispatcher. */
  messageSchemas(): readonly MessageSchema[];

  /** Validate one generated Spine event before the bus stores it. */
  accept?(event: Event): Promise<void>;

  /** Dispatch one generated Spine event envelope. */
  dispatch(event: Event): Promise<void>;
}
