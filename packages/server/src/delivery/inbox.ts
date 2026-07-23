import { randomUUID } from "node:crypto";

import type { Any } from "@bufbuild/protobuf/wkt";

import type { InboxStorage } from "./inbox-storage.js";
import { inboxStorageAccess } from "./inbox-storage.js";
import type { DeliveryInboxWork, DeliveryWorkSession } from "./delivery-ports.js";
import type { ShardIndex } from "./shard-index.js";

/** Small JVM-style inbox facade over durable storage. */
export class Inbox {
  /** Local inbox work is admitted only under a renewable leased session. */
  readonly sessionKind = "LEASED" as const;
  /** Intentional low-level escape hatch for storage-focused tests and integrations. */
  readonly storage: InboxStorage;

  /** Open an inbox over one durable inbox storage. */
  constructor(storage: InboxStorage) {
    this.storage = storage;
    Object.freeze(this);
  }

  /** Receive one message into durable inbox storage. */
  async receive(input: InboxMessageInput): Promise<InboxWriteResult> {
    const messageInput = this.#inputObject(input, "Inbox message input");
    const shard = this.#readInput(messageInput, "shard", "Inbox message shard") as ShardIndex;
    const signal = this.#readInput(messageInput, "signal", "Inbox signal") as Any | undefined;
    const keepUntil = this.#readInput(messageInput, "keepUntil", "Inbox keep-until time") as
      Date | undefined;

    return this.storage.write({
      inboxId: this.#readInput(messageInput, "inboxId", "Inbox target identity") as InboxId,
      signalId: this.#readInput(messageInput, "signalId", "Inbox signal ID") as string,
      label: this.#readInput(messageInput, "label", "Inbox delivery label") as DeliveryLabel,
      status: this.#readInput(messageInput, "status", "Inbox delivery status") as DeliveryStatus,
      shard,
      whenReceived: this.#readInput(messageInput, "whenReceived", "Inbox receive time") as Date,
      version: this.#readInput(messageInput, "version", "Inbox version") as bigint,
      ...(signal === undefined ? {} : { signal }),
      ...(keepUntil === undefined ? {} : { keepUntil }),
      id: {
        value: randomUUID(),
        shard,
      },
    });
  }

  /** Read ordered messages for one shard. */
  read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    return this.storage.read(shard, options);
  }

  /** Read one exact durable inbox message by ID. */
  readMessage(id: InboxMessageId): Promise<InboxMessage | undefined> {
    return this.storage.readMessage(id);
  }

  /**
   * Mark one exact pending inbox message delivered.
   *
   * Returns `undefined` when the durable row is missing, is not pending, or no
   * longer matches the caller-provided message snapshot. Already-delivered
   * matching rows are returned idempotently so concurrent worker races can
   * converge without re-dispatching.
   */
  markDelivered(message: InboxMessage): Promise<InboxMessage | undefined> {
    return this.storage.markDelivered(message);
  }

  /** Begin exact-row work, retaining local claim fencing behind the port. */
  async begin(
    message: InboxMessage,
    session: DeliveryWorkSession,
  ): Promise<DeliveryInboxWork | undefined> {
    if (session.kind !== "LEASED") return undefined;
    const claimed = await inboxStorageAccess.claim(this.storage, message, session);
    return claimed === undefined ? undefined : new LocalInboxWork(this.storage, claimed);
  }

  #inputObject(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InboxMessageError(`${label} is invalid.`);
    }

    return value as Record<string, unknown>;
  }

  #readInput(value: Record<string, unknown>, property: string, label: string): unknown {
    try {
      return Reflect.get(value, property);
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  }
}

class LocalInboxWork implements DeliveryInboxWork {
  #claimed: import("./inbox-claim.js").ClaimedInboxMessage | undefined;

  constructor(
    private readonly storage: InboxStorage,
    claimed: import("./inbox-claim.js").ClaimedInboxMessage,
  ) {
    this.#claimed = claimed;
  }

  get message(): InboxMessage {
    const claimed = this.#requireClaimed();
    const { claim: ignoredClaim, ...message } = claimed;
    void ignoredClaim;
    return message;
  }

  async synchronize(session: DeliveryWorkSession): Promise<void> {
    if (session.kind !== "LEASED") throw new InboxMessageError("Inbox work session is not leased.");
    const claimed = this.#requireClaimed();
    if (
      claimed.claim.id === session.id &&
      claimed.claim.node === session.node &&
      claimed.claim.expiresAt.getTime() === session.expiresAt.getTime()
    ) {
      return;
    }
    const renewed = await inboxStorageAccess.renew(this.storage, claimed, session);
    if (renewed === undefined) throw new InboxMessageError("Inbox work claim was lost.");
    this.#claimed = renewed;
  }

  async complete(): Promise<boolean> {
    const claimed = this.#requireClaimed();
    const completed = await inboxStorageAccess.markDelivered(this.storage, claimed);
    if (completed !== undefined) {
      this.#claimed = undefined;
    }
    return completed !== undefined;
  }

  async abandon(): Promise<void> {
    const claimed = this.#claimed;
    if (claimed === undefined) return;
    const cleared = await inboxStorageAccess.clear(this.storage, claimed);
    if (cleared === undefined) {
      throw new InboxMessageError("Framework cleanup did not clear the pending row.");
    }
    this.#claimed = undefined;
  }

  #requireClaimed(): import("./inbox-claim.js").ClaimedInboxMessage {
    if (this.#claimed === undefined) throw new InboxMessageError("Inbox work is no longer active.");
    return this.#claimed;
  }
}

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
  /** Shard that owns the message; must match `InboxMessage.shard`. */
  readonly shard: ShardIndex;
}

/**
 * Raised by public delivery APIs when a caller provides an invalid inbox
 * message. Corrupt durable delivery rows raise
 * `DeliveryStorageCorruptionError`.
 */
export class InboxMessageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InboxMessageError";
  }
}

/** Delivery destination label. */
export type DeliveryLabel =
  "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT" | "CATCH_UP";

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
  /** Shard responsible for delivery; must match `id.shard`. */
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
  /** Optional page limit for one ordered page; must be positive and at most 1000. */
  readonly limit?: number;
  /** Optional stable inbox row key after which the ordered read should continue. */
  readonly after?: InboxReadContinuation;
  /** Optional non-negative page offset in inbox order; defaults to the first row. */
  readonly offset?: number;
}

/** Stable ordered inbox row key used to continue an ordered read. */
export interface InboxReadContinuation {
  /** Inbox message UUID from the last row of the previous page. */
  readonly messageId: string;
  /** Receive time from the last row of the previous page. */
  readonly whenReceived: Date;
  /** Version from the last row of the previous page. */
  readonly version: bigint;
}

/** Durable inbox write outcome. */
export interface InboxWriteResult {
  /** Whether the message was written or matched an existing dedup key. */
  readonly outcome: "WRITTEN" | "DUPLICATE";
  /** Stored message selected for the outcome. */
  readonly message: InboxMessage;
}
