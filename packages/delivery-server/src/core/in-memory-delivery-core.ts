import type { ServiceImpl } from "@connectrpc/connect";
import { InboxService, ShardService } from "@spine-event-engine/proto/delivery-server";

import { createInboxService } from "./inbox-service.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { createShardService } from "./shard-service.js";

/** Options for the listener-free in-memory delivery-server core. */
export interface InMemoryDeliveryServerCoreOptions {
  /** Automatic pickup expiry; zero disables automatic stale takeover. */
  readonly processingTimeoutMs?: number;
  /** Deterministic wall-clock seam, expressed as Unix milliseconds. */
  readonly now?: () => number;
  /** Maximum retained records; integer from 1 through 2,147,483,647. */
  readonly maxRetainedMessages?: number;
  /** Maximum retained serialized record bytes; integer from 1 through 2,147,483,647. */
  readonly maxRetainedBytes?: number;
  /** Maximum tracked shards; integer from 1 through 1,000. */
  readonly maxTrackedShards?: number;
}

/** Handler implementations for caller-owned Connect router registration. */
export interface InMemoryDeliveryServerCore {
  readonly inbox: ServiceImpl<typeof InboxService>;
  readonly shards: ServiceImpl<typeof ShardService>;
}

/**
 * Creates an empty in-memory Inbox and Shard core. It owns neither a listener
 * nor a process lifecycle; constructing a replacement core loses all state.
 * Invalid options throw synchronously before any handler is returned.
 */
export function createInMemoryDeliveryServerCore(
  options: InMemoryDeliveryServerCoreOptions = {},
): InMemoryDeliveryServerCore {
  const timeout = options.processingTimeoutMs ?? 0;
  if (!Number.isFinite(timeout) || timeout < 0)
    throw new RangeError("Processing timeout is invalid.");
  const state = new InMemoryDeliveryState(options);
  const admission = new MutationAdmission();
  const now = options.now ?? Date.now;
  return Object.freeze({
    inbox: createInboxService(state, admission),
    shards: createShardService(state, admission, now, timeout),
  });
}
