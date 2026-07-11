import { describe, expect, it } from "vitest";

import type {
  DeliveryAttemptSummary,
  DeliveryFailureReason,
  DeliveryFailureStage,
} from "../../src/delivery/delivery-attempts.js";
import { DeliveryRetryDecisions } from "../../src/delivery/delivery-retry-decision.js";

describe("Delivery retry decisions", () => {
  it("keeps an empty retained-attempt summary retryable under a positive limit", () => {
    const decisions = new DeliveryRetryDecisions({ maxAttempts: 3 });

    expect(decisions.decide(summary({ count: 0 }))).toStrictEqual({
      kind: "RETRYABLE",
      count: 0,
      limit: 3,
      latestStage: undefined,
      latestReason: undefined,
      latestAccepted: undefined,
    });
  });

  it("exhausts the retry budget at the configured attempt limit", () => {
    const decisions = new DeliveryRetryDecisions({ maxAttempts: 3 });

    expect(
      decisions.decide(
        summary({
          count: 2,
          latestStage: "ENDPOINT",
          latestReason: "ENDPOINT_REJECTED",
          latestAccepted: true,
        }),
      ),
    ).toStrictEqual({
      kind: "RETRYABLE",
      count: 2,
      limit: 3,
      latestStage: "ENDPOINT",
      latestReason: "ENDPOINT_REJECTED",
      latestAccepted: true,
    });
    expect(
      decisions.decide(
        summary({
          count: 3,
          latestStage: "LEASE",
          latestReason: "LEASE_INACTIVE",
          latestAccepted: false,
        }),
      ),
    ).toStrictEqual({
      kind: "EXHAUSTED",
      count: 3,
      limit: 3,
      latestStage: "LEASE",
      latestReason: "LEASE_INACTIVE",
      latestAccepted: false,
    });
    expect(
      decisions.decide(
        summary({
          count: 4,
          latestStage: "STATUS_UPDATE",
          latestReason: "STATUS_UPDATE_FAILED",
          latestAccepted: true,
        }),
      ),
    ).toStrictEqual({
      kind: "EXHAUSTED",
      count: 4,
      limit: 3,
      latestStage: "STATUS_UPDATE",
      latestReason: "STATUS_UPDATE_FAILED",
      latestAccepted: true,
    });
  });

  it("returns immutable facts without reading retained attempt objects", () => {
    const decisions = new DeliveryRetryDecisions({ maxAttempts: 5 });
    const source = summary({
      count: 1,
      latestStage: "CLEANUP",
      latestReason: "CLEANUP_FAILED",
      latestAccepted: false,
    });
    const guarded = Object.create(Object.getPrototypeOf(source), {
      ...Object.getOwnPropertyDescriptors(source),
      attempts: {
        enumerable: true,
        get() {
          throw new Error("Retry decisions must not read retained attempt objects.");
        },
      },
    }) as DeliveryAttemptSummary;

    const decision = decisions.decide(guarded);

    expect(decision).toStrictEqual({
      kind: "RETRYABLE",
      count: 1,
      limit: 5,
      latestStage: "CLEANUP",
      latestReason: "CLEANUP_FAILED",
      latestAccepted: false,
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("rejects missing, unsafe, non-positive, non-finite, and unbounded limits", () => {
    const invalid = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      101,
    ];

    for (const maxAttempts of invalid) {
      expect(() => new DeliveryRetryDecisions({ maxAttempts })).toThrow(
        /Delivery retry max attempts/i,
      );
    }
  });
});

function summary(input: SummaryInput): DeliveryAttemptSummary {
  return Object.freeze({
    attempts: Object.freeze([]),
    count: input.count,
    latestAttempt: undefined,
    latestStage: input.latestStage,
    latestReason: input.latestReason,
    latestAccepted: input.latestAccepted,
  });
}

interface SummaryInput {
  readonly count: number;
  readonly latestStage?: DeliveryFailureStage;
  readonly latestReason?: DeliveryFailureReason;
  readonly latestAccepted?: boolean;
}
