import type {
  DeliveryAttemptSummary,
  DeliveryFailureReason,
  DeliveryFailureStage,
} from "./delivery-attempts.js";
import { deliveryAttemptCapacity } from "./delivery-attempts.js";

/**
 * Internal bounded retry classifier over one exact-message attempt summary.
 */
export class DeliveryRetryDecisions {
  readonly #limit: number;

  /**
   * Creates a bounded retained-attempt retry budget.
   *
   * @param options The retry-budget configuration.
   */
  constructor(options: DeliveryRetryDecisionOptions) {
    this.#limit = this.#requireMaxAttempts(options.maxAttempts);
    Object.freeze(this);
  }

  /**
   * Determines one retained-attempt summary without reading storage or attempt objects.
   *
   * @param summary The retained facts for one inbox message.
   * @returns Frozen retry facts for the message.
   */
  decide(summary: DeliveryAttemptSummary): DeliveryRetryDecision {
    const count = this.#requireCount(summary.count);

    return Object.freeze({
      kind: count < this.#limit ? "RETRYABLE" : "EXHAUSTED",
      count,
      limit: this.#limit,
      latestStage: summary.latestStage,
      latestReason: summary.latestReason,
      latestAccepted: summary.latestAccepted,
    });
  }

  #requireMaxAttempts(value: number | undefined): number {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > deliveryAttemptCapacity
    ) {
      throw new Error(
        `Delivery retry max attempts must be a positive safe integer at most ${String(
          deliveryAttemptCapacity,
        )}.`,
      );
    }
    return value;
  }

  #requireCount(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Delivery retry summary count must be a non-negative safe integer.");
    }
    return value;
  }
}

/**
 * Configures the internal retry classifier.
 */
export interface DeliveryRetryDecisionOptions {
  // prettier-ignore

  /**
   * Positive bounded maximum number of retained failed attempts.
   */
  readonly maxAttempts: number | undefined;
}

/**
 * Describes immutable sanitized retry decision facts.
 */
export interface DeliveryRetryDecision {
  // prettier-ignore

  /**
   * Whether the retained attempt count still permits retry.
   */
  readonly kind: DeliveryRetryDecisionKind;

  /**
   * Retained failed attempt count for the exact message.
   */
  readonly count: number;

  /**
   * Configured bounded attempt limit.
   */
  readonly limit: number;

  /**
   * Latest retained failure stage, when present.
   */
  readonly latestStage: DeliveryFailureStage | undefined;

  /**
   * Latest retained failure reason, when present.
   */
  readonly latestReason: DeliveryFailureReason | undefined;

  /**
   * Latest retained accepted flag, when present.
   */
  readonly latestAccepted: boolean | undefined;
}

/**
 * Names the possible internal retry decisions.
 */
export type DeliveryRetryDecisionKind = "RETRYABLE" | "EXHAUSTED";
