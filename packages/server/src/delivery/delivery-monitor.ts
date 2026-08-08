import type { InboxMessage } from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";

/** A monitor-selected asynchronous reception outcome. */
export interface ReceptionAction {
  execute(): Promise<void>;
}

/** A monitor-selected asynchronous pickup outcome. */
export interface PickUpAction {
  execute(): Promise<void>;
}

/** Facts supplied when dispatching one inbox message failed. */
export class FailedReception {
  constructor(
    readonly message: InboxMessage,
    readonly error: unknown,
    private readonly mark: () => Promise<void>,
    private readonly repeat: () => Promise<void>,
  ) {}

  /** Selects durable acknowledgement of the failed row. */
  markDelivered(): ReceptionAction {
    return Object.freeze({ execute: this.mark });
  }

  /** Selects one immediate repeat of the failed dispatch. */
  repeatDispatching(): ReceptionAction {
    return Object.freeze({ execute: this.repeat });
  }
}

/** Facts supplied when acquiring a shard failed. */
export class FailedPickUp {
  constructor(
    readonly shard: ShardIndex,
    readonly error: unknown,
  ) {}

  /** Selects a failed delivery result without acquiring ownership. */
  fail(): PickUpAction {
    return Object.freeze({ execute: () => Promise.resolve() });
  }
}

/** Facts supplied when a shard is already owned by another worker. */
export class AlreadyPickedUp {
  constructor(readonly shard: ShardIndex) {}

  /** Selects a skipped delivery result without acquiring ownership. */
  skip(): PickUpAction {
    return Object.freeze({ execute: () => Promise.resolve() });
  }
}

/** Stages at which a monitor may stop a finite delivery. */
export type DeliveryStage = "DELIVERY" | "PAGE";

/** Immutable finite-delivery statistics. */
export interface DeliveryStatistics {
  readonly processed: number;
  readonly delivered: number;
  readonly failed: number;
}

/**
 * Controls finite delivery failure actions without scheduling retries.
 * Subclasses may return direct values or promises from every callback.
 */
export class DeliveryMonitor {
  shouldContinueAfter(_stage: DeliveryStage): boolean | Promise<boolean> {
    return true;
  }

  onDeliveryStarted(_shard: ShardIndex): void | Promise<void> {}

  onDeliveryCompleted(_statistics: DeliveryStatistics): void | Promise<void> {}

  onReceptionFailure(reception: FailedReception): ReceptionAction | Promise<ReceptionAction> {
    return reception.markDelivered();
  }

  onShardPickUpFailure(failure: FailedPickUp): PickUpAction | Promise<PickUpAction> {
    return failure.fail();
  }

  onShardAlreadyPicked(failure: AlreadyPickedUp): PickUpAction | Promise<PickUpAction> {
    return failure.skip();
  }
}
