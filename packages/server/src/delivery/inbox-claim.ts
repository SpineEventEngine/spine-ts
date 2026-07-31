import type { InboxMessage } from "./inbox.js";

/**
 * Durable delivery claim held while a framework worker invokes an endpoint.
 */
export interface InboxClaim {
  // prettier-ignore

  /**
   * Shard session identifier that owns the endpoint invocation.
   */
  readonly id: string;

  /**
   * Worker node that owns the endpoint invocation.
   */
  readonly node: string;

  /**
   * Framework-owned expiry metadata renewed from the owning shard session.
   *
   * Claim compare-and-set treats live claims as unavailable and may replace
   * expired claims with the active worker's claim.
   */
  readonly expiresAt: Date;
}

/**
 * Internal inbox row snapshot including durable claim metadata.
 */
export interface InboxRecordMessage extends InboxMessage {
  // prettier-ignore

  /**
   * Durable delivery claim for a framework-owned endpoint invocation.
   */
  readonly claim?: InboxClaim;
}

/**
 * Internal inbox row snapshot claimed by one framework worker.
 */
export interface ClaimedInboxMessage extends InboxMessage {
  // prettier-ignore

  /**
   * Durable delivery claim for this worker's endpoint invocation.
   */
  readonly claim: InboxClaim;
}
