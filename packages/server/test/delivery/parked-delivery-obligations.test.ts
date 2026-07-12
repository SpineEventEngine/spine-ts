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

    const selected = [
      selection(registration("one"), "one-all", ["shard-0"]),
      selection(registration("two"), "two-all", ["shard-1"]),
    ];
    expect(obligations.report(selected)).toEqual([first, second]);
    expect(obligations.report(selected)).toEqual([]);
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

    expect(
      obligations.report([
        selection(registration("two"), "two-all", ["shard-1"]),
        selection(registration("one"), "one-all", ["shard-0"]),
      ]),
    ).toEqual([first, second]);
  });

  it("replaces a reported representative without retaining an error history", () => {
    const obligations = table();
    const first = new Error("first");
    const replacement = new Error("replacement");
    obligations.park(registration("one"), "one-all", ["shard-0"], first);
    const selected = [selection(registration("one"), "one-all", ["shard-0"])];
    obligations.report(selected);

    obligations.park(registration("one"), "one-all", ["shard-0"], replacement);

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        cause: replacement,
        reportedSinceResolution: true,
        occurrences: 2,
      }),
    ]);
    expect(obligations.report(selected)).toEqual([replacement]);
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

  it("reclassifies removed-owner work without subset keys or duplicate causes", () => {
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
    expect(
      obligations.report([selection({ kind: "generation" }, "generation-all", ["shard-0"])]),
    ).toEqual([one]);
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
    expect(obligations.report([selection(registration("one"), "one-all", ["shard-0"])])).toEqual(
      [],
    );
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

  it("selects same-record representatives by configured unit order for normal and shared records", () => {
    const obligations = table();
    const normalFirst = new Error("normal-first");
    const normalLater = new Error("normal-later");
    const sharedFirst = new Error("shared-first");
    const sharedLater = new Error("shared-later");

    obligations.park(registration("one"), "one-all", ["shard-1"], normalLater);
    obligations.park(registration("one"), "one-all", ["shard-0"], normalFirst);
    obligations.parkShared(["shard-1"], sharedLater);
    obligations.parkShared(["shard-0"], sharedFirst);

    expect(
      obligations.report([
        selection(registration("one"), "one-all", ["shard-0", "shard-1"]),
        selection({ kind: "shared" }, "shared", ["shard-0", "shard-1"]),
      ]),
    ).toEqual([normalFirst, sharedFirst]);
  });

  it("discards an unreported representative when its exact unit is fulfilled", () => {
    const obligations = table();
    const resolved = new Error("resolved");
    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], resolved);

    obligations.fulfilled(registration("one"), "one-all", ["shard-0"]);

    expect(
      obligations.report([selection(registration("one"), "one-all", ["shard-0", "shard-1"])]),
    ).toEqual([]);
    expect(obligations.records()).toEqual([
      expect.objectContaining({ units: ["shard-1"], hasCause: false }),
    ]);
  });

  it("reclassifies one removed owner across plural generation destinations", () => {
    const obligations = splitTable();
    const failure = new Error("failure");
    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], failure, 2);

    obligations.removeRegistration("one");

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "generation" },
        obligation: "generation-0",
        units: ["shard-0"],
        cause: failure,
        hasCause: true,
        occurrences: 2,
      }),
      expect.objectContaining({
        owner: { kind: "generation" },
        obligation: "generation-1",
        units: ["shard-1"],
        hasCause: false,
        occurrences: 2,
      }),
    ]);
  });

  it("leaves owner records and configuration unchanged when reclassification cannot complete", () => {
    const obligations = new ParkedDeliveryObligations({
      registrations: [
        { token: "one", obligations: [{ key: "one-all", units: ["shard-0", "shard-1"] }] },
      ],
      generation: [{ key: "generation-0", units: ["shard-0"] }],
    });
    const failure = new Error("failure");
    obligations.park(registration("one"), "one-all", ["shard-0", "shard-1"], failure);

    expect(() => {
      obligations.removeRegistration("one");
    }).toThrow("Removed registration obligation has no configured generation destination.");
    expect(obligations.records()).toEqual([
      expect.objectContaining({ owner: registration("one"), cause: failure }),
    ]);
    expect(() => {
      obligations.park(registration("one"), "one-all", ["shard-0"], new Error("still-live"));
    }).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid occurrence increment %s before normal or shared mutation",
    (occurrences) => {
      const obligations = table();

      expect(() => {
        obligations.park(
          registration("one"),
          "one-all",
          ["shard-0"],
          new Error("normal"),
          occurrences,
        );
      }).toThrow("Parked delivery occurrence increment must be a positive safe integer.");
      expect(() => {
        obligations.parkShared(["shard-0"], new Error("shared"), occurrences);
      }).toThrow("Parked delivery occurrence increment must be a positive safe integer.");
      expect(obligations.records()).toEqual([]);
    },
  );

  it("retains and reports undefined rejected causes for normal and shared records", () => {
    const obligations = table();
    obligations.park(registration("one"), "one-all", ["shard-0"], undefined);
    obligations.parkShared(["shard-1"], undefined);

    expect(obligations.records()).toEqual([
      expect.objectContaining({ hasCause: true, cause: undefined }),
      expect.objectContaining({ hasCause: true, cause: undefined }),
    ]);
    const selected = [
      selection(registration("one"), "one-all", ["shard-0"]),
      selection({ kind: "shared" }, "shared", ["shard-1"]),
    ];
    expect(obligations.report(selected)).toEqual([undefined, undefined]);
    expect(obligations.report(selected)).toEqual([]);
  });

  it("reports and consumes only exact selected records", () => {
    const obligations = table();
    const selectedCause = new Error("selected");
    const untouchedCause = new Error("untouched");
    obligations.park(registration("one"), "one-all", ["shard-0"], selectedCause);
    obligations.park(registration("two"), "two-all", ["shard-1"], untouchedCause);

    expect(obligations.report([selection(registration("one"), "one-all", ["shard-0"])])).toEqual([
      selectedCause,
    ]);
    obligations.fulfilled(registration("one"), "one-all", ["shard-0"]);

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        owner: registration("two"),
        cause: untouchedCause,
        reportedSinceResolution: false,
      }),
    ]);
    expect(obligations.report([selection(registration("two"), "two-all", ["shard-1"])])).toEqual([
      untouchedCause,
    ]);
  });

  it("replaces exact prior rejection with cause-less fulfilled FAILED work", () => {
    const obligations = table();
    obligations.park(registration("one"), "one-all", ["shard-0"], new Error("resolved"), 3);

    obligations.parkFulfilledFailed(registration("one"), "one-all", ["shard-0"]);

    expect(obligations.records()).toEqual([
      expect.objectContaining({
        units: ["shard-0"],
        hasCause: false,
        occurrences: 0,
        reportedSinceResolution: false,
      }),
    ]);
    expect(obligations.report([selection(registration("one"), "one-all", ["shard-0"])])).toEqual(
      [],
    );
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

function selection(owner: ParkedOwner, obligation: string, units: readonly string[]) {
  return { owner, obligation, units };
}

function splitTable(): ParkedDeliveryObligations {
  return new ParkedDeliveryObligations({
    registrations: [
      { token: "one", obligations: [{ key: "one-all", units: ["shard-0", "shard-1"] }] },
    ],
    generation: [
      { key: "generation-0", units: ["shard-0"] },
      { key: "generation-1", units: ["shard-1"] },
    ],
  });
}
