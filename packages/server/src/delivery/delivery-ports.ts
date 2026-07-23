import type {
  InboxMessage,
  InboxMessageId,
  InboxMessageInput,
  InboxReadOptions,
  InboxWriteResult,
} from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";
import type { ShardSession } from "./sharded-work-registry.js";

/** Cancellation and per-call deadline propagated through delivery port work. */
export interface DeliveryOperationOptions {
  /** Cooperative cancellation propagated through reads, mutations, lease work, and completion. */
  readonly signal?: AbortSignal;
  /** Positive safe-integer operation deadline in milliseconds, measured from admission. */
  readonly timeoutMs?: number;
}

/** Server-owned durable inbox boundary used by delivery drains. */
export interface DeliveryInbox {
  /** Session fence kind this inbox accepts; ports supplied together must agree. */
  readonly sessionKind: DeliveryWorkSession["kind"];
  /** Persist one incoming message before any worker observes it. */
  receive(input: InboxMessageInput, options?: DeliveryOperationOptions): Promise<InboxWriteResult>;
  /** Read one bounded, exact continuation page for a shard. */
  read(
    shard: ShardIndex,
    options?: InboxReadOptions & DeliveryOperationOptions,
  ): Promise<readonly InboxMessage[]>;
  /** Find one exact message without claiming delivery work. */
  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined>;
  /** Admit an exact pending message under the supplied work-session fence. */
  begin(
    message: InboxMessage,
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryInboxWork | undefined>;
}

/** One admitted exact-message delivery operation. */
export interface DeliveryInboxWork {
  /** A defensive message snapshot admitted under this work fence; callers may mutate their copy. */
  readonly message: InboxMessage;
  /** Reject when the caller no longer holds the matching work fence. */
  synchronize(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<void>;
  /** Remove the admitted message once delivery completed. */
  complete(options?: DeliveryOperationOptions): Promise<boolean>;
  /** Leave the message pending without remote removal. */
  abandon(options?: DeliveryOperationOptions): Promise<void>;
}

/** Server-owned exclusive shard-work boundary. */
export interface DeliveryWorkRegistry {
  /** Session fence kind this registry issues; ports supplied together must agree. */
  readonly sessionKind: DeliveryWorkSession["kind"];
  /** Acquire one shard's work fence, if it is currently available. */
  pickUp(
    shard: ShardIndex,
    node: string,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryWorkSession | undefined>;
  /** Renew only a local leased session; remote exclusive sessions are not renewable. */
  renew?(
    session: LeasedDeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<LeasedDeliveryWorkSession | undefined>;
  /** Release a held work fence. Remote release is not worker-conditional on the frozen wire. */
  release(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<boolean>;
}

/** Local registry session that has renewable expiry fencing. */
export type LeasedDeliveryWorkSession = ShardSession;

/** Remote exclusive session without a fictional lease or renewal timer. */
export interface ExclusiveDeliveryWorkSession {
  readonly kind: "EXCLUSIVE";
  readonly shard: ShardIndex;
}

/** Honest session union accepted by delivery work. */
export type DeliveryWorkSession = LeasedDeliveryWorkSession | ExclusiveDeliveryWorkSession;
