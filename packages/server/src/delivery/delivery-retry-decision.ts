import type {
  DeliveryAttemptSummary,
  DeliveryFailureReason,
  DeliveryFailureStage,
} from "./delivery-attempts.js";

const maxRetainedAttempts = 100;

/** Internal bounded retry classifier over one exact-message attempt summary. */
export class DeliveryRetryDecisions {
  readonly #limit: number;

  /** Configure a bounded retained-attempt retry budget. */
  constructor(options: DeliveryRetryDecisionOptions) {
    this.#limit = requireMaxAttempts(options.maxAttempts);
    Object.freeze(this);
  }

  /** Classify one retained-attempt summary without reading storage or attempt objects. */
  decide(summary: DeliveryAttemptSummary): DeliveryRetryDecision {
    const count = requireCount(summary.count);

    return Object.freeze({
      kind: count < this.#limit ? "RETRYABLE" : "EXHAUSTED",
      count,
      limit: this.#limit,
      latestStage: summary.latestStage,
      latestReason: summary.latestReason,
      latestAccepted: summary.latestAccepted,
    });
  }
}

/** Internal retry classifier configuration. */
export interface DeliveryRetryDecisionOptions {
  /** Positive bounded maximum number of retained failed attempts. */
  readonly maxAttempts: number | undefined;
}

/** Immutable sanitized retry decision facts. */
export interface DeliveryRetryDecision {
  /** Whether the retained attempt count still permits retry. */
  readonly kind: DeliveryRetryDecisionKind;
  /** Retained failed attempt count for the exact message. */
  readonly count: number;
  /** Configured bounded attempt limit. */
  readonly limit: number;
  /** Latest retained failure stage, when present. */
  readonly latestStage: DeliveryFailureStage | undefined;
  /** Latest retained failure reason, when present. */
  readonly latestReason: DeliveryFailureReason | undefined;
  /** Latest retained accepted flag, when present. */
  readonly latestAccepted: boolean | undefined;
}

/** Internal retry decision kind. */
export type DeliveryRetryDecisionKind = "RETRYABLE" | "EXHAUSTED";

function requireMaxAttempts(value: number | undefined): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maxRetainedAttempts
  ) {
    throw new Error(
      `Delivery retry max attempts must be a positive safe integer at most ${String(
        maxRetainedAttempts,
      )}.`,
    );
  }

  return value;
}

function requireCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Delivery retry summary count must be a non-negative safe integer.");
  }

  return value;
}
