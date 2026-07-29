import type { ServiceImpl } from "@connectrpc/connect";
import { InboxService, ShardService } from "@spine-event-engine/proto/delivery-server";

import { InboxHandlers } from "./inbox-service.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { ShardHandlers } from "./shard-service.js";

/** Configures the listener-free in-memory delivery core. */
export interface DeliveryCoreOptions {
  /** Automatic pickup expiry; zero disables automatic stale takeover. */
  readonly processingTimeoutMs?: number;
  /** Returns a deterministic wall-clock value in Unix milliseconds.
   *
   * @returns Provides the current Unix time in milliseconds.
   */
  readonly now?: () => number;
  /** Maximum retained records; integer from 1 through 2,147,483,647. */
  readonly maxRetainedMessages?: number;
  /** Maximum retained serialized record bytes; integer from 1 through 2,147,483,647. */
  readonly maxRetainedBytes?: number;
  /** Maximum tracked shards; integer from 1 through 1,000. */
  readonly maxTrackedShards?: number;
}

/** Provides handler implementations for caller-owned Connect router registration. */
export interface DeliveryCore {
  /** Serves Inbox RPCs. */
  readonly inbox: ServiceImpl<typeof InboxService>;
  /** Serves Shard RPCs. */
  readonly shards: ServiceImpl<typeof ShardService>;
}

/** Creates listener-free in-memory delivery cores. */
export const InMemoryDelivery: Readonly<{
  /**
   * Creates an empty Inbox and Shard core.
   *
   * @param options Configures state limits and stale pickup expiry.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a finite non-negative number.
   */
  create(options?: DeliveryCoreOptions): DeliveryCore;
}> = Object.freeze({
  /**
   * Creates an empty Inbox and Shard core.
   *
   * @param options Configures state limits and stale pickup expiry.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a finite non-negative number.
   */
  create(options: DeliveryCoreOptions = {}): DeliveryCore {
    const timeout = options.processingTimeoutMs ?? 0;
    if (!Number.isFinite(timeout) || timeout < 0)
      throw new RangeError("Processing timeout is invalid.");
    const state = new InMemoryDeliveryState(options);
    const admission = new MutationAdmission();
    const now = options.now ?? Date.now;
    return Object.freeze({
      inbox: InboxHandlers.create(state, admission),
      shards: ShardHandlers.create(state, admission, now, timeout),
    });
  },
});
