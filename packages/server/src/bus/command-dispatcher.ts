import type { Command } from "@spine-ts/proto";
import type { MessageSchema } from "@spine-ts/core";

/**
 * Small unicast command-dispatch seam for bus and repository adapters.
 *
 * Dispatchers declare the command message schemas they accept and perform
 * handling behind the bus seam. Repository-backed adapters own entity loading
 * and method invocation; the bus only routes accepted command envelopes.
 */
export interface CommandDispatcher {
  /** Generated command message schemas accepted by this dispatcher. */
  messageSchemas(): readonly MessageSchema[];

  /** Dispatch one generated Spine command envelope. */
  dispatch(command: Command): Promise<void>;
}
