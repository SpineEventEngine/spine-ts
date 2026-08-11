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
  // prettier-ignore

  /**
   * Lists generated event message schemas accepted by this dispatcher.
   *
   * @returns the accepted message schemas.
   */
  messageSchemas(): readonly MessageSchema[];

  /**
   * Performs dispatcher-specific acceptance before the bus stores an event.
   *
   * The bus gives each dispatcher its own Event snapshot. After successful
   * storage, the same snapshot is passed to this dispatcher's `dispatch()`.
   *
   * @param event the event envelope to validate.
   * @returns A promise that resolves after validation completes.
   */
  accept?(event: Event): Promise<void>;

  /**
   * Dispatches one generated Spine event envelope.
   *
   * When `accept()` is present, this receives the dispatcher-local snapshot
   * that acceptance validated.
   *
   * @param event the event envelope to dispatch.
   * @returns A promise that resolves after the event is dispatched.
   */
  dispatch(event: Event): Promise<void>;
}
