import type { InboxMessage } from "./inbox.js";

/** Durable delivery claim held while a framework worker invokes an endpoint. */
export interface InboxClaim {
  /** Shard session identifier that owns the endpoint invocation. */
  readonly id: string;
  /** Worker node that owns the endpoint invocation. */
  readonly node: string;
  /** Deadline after which another worker may claim the row. */
  readonly expiresAt: Date;
}

/** Internal inbox row snapshot including durable claim metadata. */
export interface InboxRecordMessage extends InboxMessage {
  /** Durable delivery claim for a framework-owned endpoint invocation. */
  readonly claim?: InboxClaim;
}

/** Internal inbox row snapshot claimed by one framework worker. */
export interface ClaimedInboxMessage extends InboxMessage {
  /** Durable delivery claim for this worker's endpoint invocation. */
  readonly claim: InboxClaim;
}
