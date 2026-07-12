import { describe, expect, it } from "vitest";

import {
  ParkedDeliveryObligations,
  type ParkedOwner,
} from "../../src/delivery/parked-delivery-obligations.js";

describe("ParkedDeliveryObligations", () => {
  it("coalesces repeated rejected work into one canonical record with a saturating count", () => {
    const obligations = table();
    const first = new Error("first");

    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], first);
    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], new Error("later"));
    obligations.park(
      registration("one"),
      "one-all",
      ["shard-0", "shard-1"],
      new Error("maximum"),
      Number.MAX_SAFE_INTEGER,
    );

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        owner: registration("one"),
        obligation: "one-all",
        units: ["shard-0", "shard-1"],
        cause: first,
        occurrences: Number.MAX_SAFE_INTEGER,
        reportedSinceResolution: false,
      }),
    ]);
  });

  it("reports selected representatives once without resolving their operational work", () => {
    const obligations = table();
    const first = new Error("first");
    const second = new Error("second");
    obligations.park(registration("one"), "one-all", ["shard-0"], first);
    obligations.park(registration("two"), "two-all", ["shard-1"], second);

    expect(obligations.report()).toEqual([first, second]);
    expect(obligations.report()).toEqual([]);
    expect(obligations.records()).toEqual([
      expect.objectContaining({ cause: first, reportedSinceResolution: true, units: ["shard-0"] }),
      expect.objectContaining({ cause: second, reportedSinceResolution: true, units: ["shard-1"] }),
    ]);
  });

  it("reports representatives in configured order rather than rejection arrival order", () => {
    const obligations = table();
    const first = new Error("first");
    const second = new Error("second");

    obligations.park(registration("two"), "two-all", ["shard-1"], second);
    obligations.park(registration("one"), "one-all", ["shard-0"], first);

    expect(obligations.report()).toEqual([first, second]);
  });

  it("replaces a reported representative without retaining an error history", () => {
    const obligations = table();
    const first = new Error("first");
    const replacement = new Error("replacement");
    obligations.park(registration("one"), "one-all", ["shard-0"], first);
    obligations.report();

    obligations.park(registration("one"), "one-all", ["shard-0"], replacement);

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        cause: replacement,
        reportedSinceResolution: true,
        occurrences: 2,
      }),
    ]);
    expect(obligations.report()).toEqual([replacement]);
  });

  it("consumes only fulfilled units actually re-evaluated", () => {
    const obligations = table();
    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], new Error("failure"));

    obligations.fulfilled(registration("one"), "one-all", ["shard-0"]);

    expect(obligations.records()).toEqual([expect.objectContaining({ units: ["shard-1"] })]);
    obligations.fulfilled(registration("two"), "two-all", ["shard-1"]);
    expect(obligations.records()).toHaveLength(1);
    obligations.fulfilled(registration("one"), "one-all", ["shard-1"]);
    expect(obligations.records()).toEqual([]);
  });

  it("reclassifies removed-owner work into a configured generation record without subset keys or duplicate causes", () => {
    const obligations = table();
    const one = new Error("one");
    const two = new Error("two");
    obligations.park(registration("one"), "one-all", ["shard-0"], one);
    obligations.park(registration("two"), "two-all", ["shard-1"], two);

    obligations.removeRegistration("two");
    obligations.removeRegistration("one");

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "generation" },
        obligation: "generation-all",
        units: ["shard-0", "shard-1"],
        cause: one,
        occurrences: 2,
      }),
    ]);
    expect(obligations.report()).toEqual([one]);
  });

  it("does not admit new work for a removed registration", () => {
    const obligations = table();

    obligations.removeRegistration("one");

    expect(() => {
      obligations.park(registration("one"), "one-all", ["shard-0"], new Error("late"));
    }).toThrow("Parked delivery obligation is not configured.");
  });

  it("retains inseparable causes in one generation-spanning shared record", () => {
    const obligations = table();
    const first = new Error("first");

    obligations.parkShared(["shard-0", "shard-1"], first);
    obligations.parkShared(["shard-0", "shard-1"], new Error("later"));

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "shared" },
        obligation: "shared",
        units: ["shard-0", "shard-1"],
        cause: first,
        occurrences: 2,
      }),
    ]);
    obligations.fulfilled({ kind: "shared" }, "shared", ["shard-0"]);
    expect(obligations.records()).toEqual([expect.objectContaining({ units: ["shard-1"] })]);
  });

  it("keeps fulfilled FAILED as cause-less operational work", () => {
    const obligations = table();

    obligations.parkFulfilledFailed(registration("one"), "one-all", ["shard-0"]);

    expect(obligations.records()).toEqual([
      expect.objectContaining({ cause: undefined, occurrences: 0, units: ["shard-0"] }),
    ]);
    expect(obligations.report()).toEqual([]);
  });

  it("keeps punctuation-containing configured owner and obligation scopes distinct", () => {
    const obligations = new ParkedDeliveryObligations({
      registrations: [
        { token: "one:two", obligations: [{ key: "three", units: ["shard-0"] }] },
        { token: "one", obligations: [{ key: "two:three", units: ["shard-1"] }] },
      ],
      generation: [{ key: "generation-all", units: ["shard-0", "shard-1"] }],
    });
    const first = new Error("first");
    const second = new Error("second");

    obligations.park(registration("one:two"), "three", ["shard-0"], first);
    obligations.park(registration("one"), "two:three", ["shard-1"], second);

    expect(obligations.records()).toEqual([
      expect.objectContaining({ owner: registration("one:two"), cause: first }),
      expect.objectContaining({ owner: registration("one"), cause: second }),
    ]);
  });
});

function table(): ParkedDeliveryObligations {
  return new ParkedDeliveryObligations({
    registrations: [
      { token: "one", obligations: [{ key: "one-all", units: ["shard-0", "shard-1"] }] },
      { token: "two", obligations: [{ key: "two-all", units: ["shard-0", "shard-1"] }] },
    ],
    generation: [{ key: "generation-all", units: ["shard-0", "shard-1"] }],
  });
}

function registration(token: string): ParkedOwner {
  return { kind: "registration", token };
}
