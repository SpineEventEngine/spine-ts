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
  /** Lists generated event message schemas accepted by this dispatcher.
   *
   * @returns the accepted message schemas.
   */
  messageSchemas(): readonly MessageSchema[];

  /** Validates one generated Spine event before the bus stores it.
   *
   * @param event the event envelope to validate.
   */
  accept?(event: Event): Promise<void>;

  /** Dispatches one generated Spine event envelope.
   *
   * @param event the event envelope to dispatch.
   */
  dispatch(event: Event): Promise<void>;
}
