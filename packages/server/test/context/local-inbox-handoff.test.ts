import { describe, expect, it } from "vitest";

import { type DeliveryReady, DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

describe("DeliveryReadiness", () => {
  it("publishes the direct gate before a readiness callback can transition", async () => {
    const scope = ready();
    const release = Promise.withResolvers<undefined>();
    const routed: DeliveryReady[] = [];
    let transition: Promise<void> | undefined;
    const readiness = new DeliveryReadiness(() => {
      transition = readiness.transition([scope], (next) => routed.push(next));
    });

    const handoff = readiness.claim(scope);
    const transferring = transition;
    if (transferring === undefined) {
      throw new Error("Expected the readiness callback to begin transition.");
    }
    let transferred = false;
    void transferring.then(() => {
      transferred = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(transferred).toBe(false);
    const draining = handoff.complete(() => release.promise);
    release.resolve(undefined);
    await Promise.all([draining, transferring]);
    expect(routed).toEqual([]);
  });

  it("closes direct admission, awaits every admitted drain, and transfers bounded readiness once", async () => {
    const scope = ready("tenant-a");
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    const routed: DeliveryReady[] = [];
    const readiness = new DeliveryReadiness();
    let directDrains = 0;

    const firstDrain = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return first.promise;
    });
    const secondDrain = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return second.promise;
    });
    const transition = readiness.transition([scope], (next) => routed.push(next));
    const buffered = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    let transitioned = false;
    void transition.then(() => {
      transitioned = true;
    });

    await buffered;
    expect(directDrains).toBe(2);
    expect(routed).toEqual([]);
    first.resolve(undefined);
    await firstDrain;
    await Promise.resolve();
    expect(transitioned).toBe(false);

    second.resolve(undefined);
    await Promise.all([secondDrain, transition]);
    expect(routed).toEqual([scope]);

    await readiness.claim(scope).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    expect(directDrains).toBe(2);
    expect(routed).toEqual([scope, scope]);
  });

  it("preserves a pre-transition exact-drain rejection", async () => {
    const failure = new Error("exact drain failed");
    const readiness = new DeliveryReadiness();

    await expect(readiness.claim(ready()).complete(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });

  it("rejects a second ownership transfer", async () => {
    const scope = ready();
    const readiness = new DeliveryReadiness();

    await readiness.transition([scope], () => undefined);

    await expect(readiness.transition([scope], () => undefined)).rejects.toThrow(
      "Delivery readiness ownership is already transferred.",
    );
  });

  it("runs direct completion once across concurrent and repeated calls", async () => {
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(ready());
    const release = Promise.withResolvers<undefined>();
    let drains = 0;

    const first = handoff.complete(() => {
      drains += 1;
      return release.promise;
    });
    const concurrent = handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });
    expect(drains).toBe(1);

    release.resolve(undefined);
    await Promise.all([first, concurrent]);
    await handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });
    expect(drains).toBe(1);
  });

  it("does not start direct completion after abandon", async () => {
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(ready());
    let drains = 0;

    handoff.abandon();
    await handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });

    expect(drains).toBe(0);
  });

  it("keeps the installed route when onReady is called after transfer", async () => {
    const scope = ready();
    const routed: DeliveryReady[] = [];
    const replaced: DeliveryReady[] = [];
    const readiness = new DeliveryReadiness();
    await readiness.transition([scope], (next) => routed.push(next));

    readiness.onReady((next) => replaced.push(next));
    await readiness.claim(scope).complete(() => Promise.resolve());

    expect(routed).toEqual([scope]);
    expect(replaced).toEqual([]);
  });
});

function ready(tenantId?: string): DeliveryReady {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    label: "HANDLE_COMMAND",
    targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
    shard: ShardIndex.single(),
  });
}
