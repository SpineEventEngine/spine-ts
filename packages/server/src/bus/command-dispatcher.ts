import type { Command } from "@spine-ts/proto";
import type { MessageSchema } from "@spine-ts/core";

/**
 * Small unicast command-dispatch seam for later repository/runtime owners.
 *
 * Dispatchers declare the command message schemas they accept and perform the
 * actual handling behind the bus seam. The bus does not instantiate entities
 * or invoke entity methods directly.
 */
export interface CommandDispatcher {
  /** Generated command message schemas accepted by this dispatcher. */
  messageSchemas(): readonly MessageSchema[];

  /** Dispatch one generated Spine command envelope. */
  dispatch(command: Command): Promise<void>;
}
