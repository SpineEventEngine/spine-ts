import { describe, expect, it } from "vitest";

import type {
  DeliveryRunScope,
  DeliveryScopeSettlement,
} from "../../src/delivery/delivery-run-coordinator.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { EnvironmentDeliveryRecords } from "../../src/server/environment-delivery-records.js";

describe("EnvironmentDeliveryRecords", () => {
  it("represents and detaches a zero-scope registration as a no-record operation", () => {
    const records = new EnvironmentDeliveryRecords();

    records.register("registration-empty", []);

    expect(records.configuredScopes("registration-empty")).toEqual([]);
    expect(records.detach("registration-empty")).toEqual([]);
    expect(records.records()).toEqual([]);
  });

  it("bounds repeated rejection evidence and consumes only the fulfilled unit", () => {
    const first = scope("one", "First", 0);
    const second = scope("one", "Second", 1);
    const records = new EnvironmentDeliveryRecords();
    const failure = new Error("rejected");

    records.register("registration-one", [first, second]);
    records.observe(rejected(first, failure));
    records.observe(rejected(first, failure));
    records.observe(rejected(second, failure));
    records.observe(idle(first));

    expect(records.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "registration", token: "registration-one" },
        units: [unit(second)],
        occurrences: 3,
        hasCause: true,
        cause: failure,
      }),
    ]);
  });

  it("keeps rejected work parked when a worker reports STOPPED", () => {
    const selected = scope("one", "Selected", 0);
    const records = new EnvironmentDeliveryRecords();
    const failure = new Error("rejected");

    records.register("registration-one", [selected]);
    records.observe(rejected(selected, failure));
    records.observe(stopped(selected));

    expect(records.records()).toEqual([
      expect.objectContaining({ units: [unit(selected)], cause: failure, occurrences: 1 }),
    ]);
  });

  it("deduplicates dynamic scope registration and observes the joined scope", () => {
    const initial = scope("one", "Initial", 0);
    const dynamic = scope("one", "Dynamic", 1);
    const records = new EnvironmentDeliveryRecords();
    const failure = new Error("dynamic rejected");

    records.register("registration-one", [initial]);
    records.register("registration-one", [dynamic, dynamic]);
    records.observe(rejected(dynamic, failure));

    expect(records.configuredScopes("registration-one")).toEqual([initial, dynamic]);
    expect(records.records()).toEqual([
      expect.objectContaining({ units: [unit(dynamic)], cause: failure, occurrences: 1 }),
    ]);
  });

  it("atomically detaches exact ownership and consumes only newly orphaned units", () => {
    const exclusive = scope("one", "Exclusive", 0);
    const shared = scope("shared", "Shared", 1);
    const records = new EnvironmentDeliveryRecords();
    const exclusiveFailure = new Error("exclusive rejected");
    const sharedFailure = new Error("shared rejected");
    records.register("registration-one", [exclusive, shared]);
    records.register("registration-two", [shared]);
    records.observe(rejected(exclusive, exclusiveFailure));
    records.observe(rejected(shared, sharedFailure));

    expect(records.detach("registration-one")).toEqual([exclusiveFailure]);

    expect(records.configuredScopes("registration-one")).toEqual([]);
    expect(records.configuredScopes("registration-two")).toEqual([shared]);
    expect(records.configuredScopeCount).toBe(1);
    expect(records.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "registration", token: "registration-two" },
        units: [unit(shared)],
        cause: sharedFailure,
      }),
      expect.objectContaining({
        owner: { kind: "generation" },
        units: [unit(shared)],
        cause: sharedFailure,
      }),
    ]);

    expect(records.detach("registration-two")).toEqual([sharedFailure]);
    expect(records.records()).toEqual([]);
    expect(records.configuredScopeCount).toBe(0);
  });

  it("reports a newly orphaned cause before a retained earlier shared cause", () => {
    const shared = scope("shared", "Shared", 0);
    const orphaned = scope("one", "Orphaned", 1);
    const records = new EnvironmentDeliveryRecords();
    const sharedFailure = new Error("shared rejected");
    const orphanedFailure = new Error("orphaned rejected");
    records.register("registration-one", [shared, orphaned]);
    records.register("registration-two", [shared]);
    records.observe(rejected(shared, sharedFailure));
    records.observe(rejected(orphaned, orphanedFailure));

    expect(records.detach("registration-one")).toEqual([orphanedFailure]);
    expect(records.records()).toEqual([
      expect.objectContaining({
        owner: { kind: "registration", token: "registration-two" },
        units: [unit(shared)],
        cause: sharedFailure,
      }),
      expect.objectContaining({
        owner: { kind: "generation" },
        units: [unit(shared)],
        cause: sharedFailure,
      }),
    ]);

    expect(records.detach("registration-two")).toEqual([sharedFailure]);
    expect(records.records()).toEqual([]);
  });

  it("atomically retires all configured ownership and operational records in stable order", () => {
    const first = scope("one", "First", 0);
    const second = scope("two", "Second", 1);
    const records = new EnvironmentDeliveryRecords();
    const firstFailure = new Error("first rejected");
    const secondFailure = new Error("second rejected");
    records.register("registration-one", [first]);
    records.register("registration-two", [second]);
    records.observe(rejected(second, secondFailure));
    records.observe(rejected(first, firstFailure));

    expect(records.retire()).toEqual([firstFailure, secondFailure]);

    expect(records.records()).toEqual([]);
    expect(records.configuredScopes("registration-one")).toEqual([]);
    expect(records.configuredScopes("registration-two")).toEqual([]);
    expect(records.configuredScopeCount).toBe(0);
  });
});

function scope(owner: string, target: string, index: number): DeliveryRunScope {
  return Object.freeze({
    owner: Object.freeze({ key: owner }),
    ready: Object.freeze({
      tenantId: "tenant",
      label: "UPDATE_SUBSCRIBER",
      targetTypeUrl: `type.example.dev/${target}`,
      shard: new ShardIndex(index, 2),
    }),
  });
}

function rejected(scope: DeliveryRunScope, cause: unknown): DeliveryScopeSettlement {
  return Object.freeze({ scope, disposition: "REJECTED", cause });
}

function idle(scope: DeliveryRunScope): DeliveryScopeSettlement {
  return Object.freeze({ scope, disposition: "IDLE" });
}

function stopped(scope: DeliveryRunScope): DeliveryScopeSettlement {
  return Object.freeze({ scope, disposition: "STOPPED" });
}

function unit(scope: DeliveryRunScope): string {
  return JSON.stringify([
    scope.owner.key,
    scope.ready.tenantId ?? null,
    scope.ready.label,
    scope.ready.targetTypeUrl,
    scope.ready.shard.index,
    scope.ready.shard.ofTotal,
  ]);
}
