import { randomUUID } from "node:crypto";

import type { Any } from "@bufbuild/protobuf/wkt";

import type { InboxStorage } from "./inbox-storage.js";
import type { ShardIndex } from "./shard-index.js";

/** Durable target inbox identity. */
export interface InboxId {
  /** Target entity ID routed to one inbox. */
  readonly targetId: string;
  /** Target entity state type URL. */
  readonly targetTypeUrl: string;
}

/** Durable inbox message identity. */
export interface InboxMessageId {
  /** Message UUID within one shard. */
  readonly value: string;
  /** Shard that owns the message. */
  readonly shard: ShardIndex;
}

/** Delivery destination label. */
export type DeliveryLabel =
  "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT" | "IMPORT_EVENT" | "CATCH_UP";

/** Durable delivery state. */
export type DeliveryStatus = "TO_DELIVER" | "SCHEDULED" | "DELIVERED" | "TO_CATCH_UP";

/** One durable inbox message. */
export interface InboxMessage {
  /** Durable record identity. */
  readonly id: InboxMessageId;
  /** Target inbox identity. */
  readonly inboxId: InboxId;
  /** Original signal identity used for delivery deduplication. */
  readonly signalId: string;
  /** Optional packed signal payload. */
  readonly signal?: Any;
  /** Delivery destination label. */
  readonly label: DeliveryLabel;
  /** Current delivery status. */
  readonly status: DeliveryStatus;
  /** Shard responsible for delivery. */
  readonly shard: ShardIndex;
  /** Durable receive time. */
  readonly whenReceived: Date;
  /** Ordering tie-breaker for equal receive times. */
  readonly version: bigint;
  /** Optional deduplication retention deadline. */
  readonly keepUntil?: Date;
}

/** Write request for one new inbox message. */
export interface InboxMessageInput {
  /** Target inbox identity. */
  readonly inboxId: InboxId;
  /** Original signal identity used for delivery deduplication. */
  readonly signalId: string;
  /** Optional packed signal payload. */
  readonly signal?: Any;
  /** Delivery destination label. */
  readonly label: DeliveryLabel;
  /** Current delivery status. */
  readonly status: DeliveryStatus;
  /** Shard responsible for delivery. */
  readonly shard: ShardIndex;
  /** Durable receive time. */
  readonly whenReceived: Date;
  /** Ordering tie-breaker for equal receive times. */
  readonly version: bigint;
  /** Optional deduplication retention deadline. */
  readonly keepUntil?: Date;
}

/** Read filter for one shard page. */
export interface InboxReadOptions {
  /** Optional delivery statuses to keep. */
  readonly statuses?: readonly DeliveryStatus[];
  /** Optional positive limit for one ordered page. */
  readonly limit?: number;
}

/** Durable inbox write outcome. */
export interface InboxWriteResult {
  /** Whether the message was written or matched an existing dedup key. */
  readonly outcome: "WRITTEN" | "DUPLICATE";
  /** Stored message selected for the outcome. */
  readonly message: InboxMessage;
}

/** Small JVM-style inbox facade over durable storage. */
export class Inbox {
  /** Open an inbox over one durable inbox storage. */
  constructor(readonly storage: InboxStorage) {
    Object.freeze(this);
  }

  /** Receive one message into durable inbox storage. */
  receive(input: InboxMessageInput): Promise<InboxWriteResult> {
    return this.storage.write({
      ...input,
      id: {
        value: randomUUID(),
        shard: input.shard,
      },
    });
  }

  /** Read ordered messages for one shard. */
  read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    return this.storage.read(shard, options);
  }
}
