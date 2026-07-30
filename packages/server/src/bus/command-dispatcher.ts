import type { Command } from "@spine-event-engine/proto";
import type { MessageSchema } from "@spine-event-engine/core";

/**
 * Small unicast command-dispatch seam for bus and repository adapters.
 *
 * Dispatchers declare the command message schemas they accept and perform
 * handling behind the bus seam. Repository-backed adapters own entity loading
 * and method invocation; the bus only routes accepted command envelopes.
 */
export interface CommandDispatcher {
  /** Lists generated command message schemas accepted by this dispatcher.
   *
   * @returns the accepted message schemas.
   */
  messageSchemas(): readonly MessageSchema[];

  /** Dispatches one generated Spine command envelope.
   *
   * @param command the command envelope to dispatch.
   */
  dispatch(command: Command): Promise<void>;
}
