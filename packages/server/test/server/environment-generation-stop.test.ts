import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { TenantId } from "@spine-event-engine/proto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ContextDeliveryDescriptor,
  DeliveryTenantScope,
} from "../../src/context/bounded-context.js";
import {
  DeliveryReadiness,
  type DeliveryReady,
  type OnDeliveryReady,
} from "../../src/context/local-inbox-handoff.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import {
  DeliveryRunCoordinator,
  DeliveryRunQuiescenceError,
  type DeliveryRunObligation,
  type DeliveryRunScope,
} from "../../src/delivery/delivery-run-coordinator.js";
import type { DeliveryWorkerEvidence } from "../../src/delivery/delivery-worker.js";
import {
  EnvironmentAttachments,
  type EnvironmentGenerationWorker,
  RegistrationReadiness,
} from "../../src/server/environment-attachment.js";
import type { EnvironmentDeliveryRuntime } from "../../src/server/environment-delivery-worker.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import { tenant } from "../tenant-fixture.js";

describe("environment generation stop", () => {
  beforeEach(async () => {
    await resetServerEnvironmentForTest();
  });

  afterEach(async () => {
    await resetServerEnvironmentForTest();
  });

  it("admits a queued attachment before selecting stop survivors", async () => {
    const oldWorker = new ControlledWorker([], "queued-old");
    const candidateWorker = new ControlledWorker([], "queued-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const target = descriptor(
      "QueuedAttach",
      "type.example.dev/QueuedAttach",
      new InMemoryStorageFactory(),
    );

    const attaching = attachments.attach({ ownership: "caller", descriptors: [target.value] });
    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.then(() => {
      stopSettled = true;
    });
    const handle = await attaching;
    const oldGeneration = handle.generation;
    await Promise.resolve();

    expect(stopSettled).toBe(false);
    await until(() => candidateWorker.starts === 1);
    expect(handle.generation).toBe(oldGeneration);
    candidateGate.resolve(undefined);
    await stopping;
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);
  });

  it("defers an attachment ordered after stop and joins the published candidate", async () => {
    const oldWorker = new ControlledWorker([], "after-stop-old");
    const candidateWorker = new ControlledWorker([], "after-stop-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "AfterStopInitial",
      "type.example.dev/AfterStopInitial",
      new InMemoryStorageFactory(),
    );
    const later = descriptor(
      "AfterStopLater",
      "type.example.dev/AfterStopLater",
      new InMemoryStorageFactory(),
    );
    const final = descriptor(
      "AfterStopFinal",
      "type.example.dev/AfterStopFinal",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });
    let descriptorEnumerations = 0;
    const laterDescriptors = countedDescriptors([later.value], () => {
      descriptorEnumerations += 1;
    });

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    const attaching = attachments.attach({ ownership: "caller", descriptors: laterDescriptors });
    const finalAttaching = attachments.attach({
      ownership: "caller",
      descriptors: [final.value],
    });
    let attachSettled = false;
    void attaching.then(
      () => {
        attachSettled = true;
      },
      () => {
        attachSettled = true;
      },
    );

    expect(descriptorEnumerations).toBe(0);
    expect(later.startupCalls).toBe(0);
    expect(later.contextCalls).toBe(0);
    expect(later.endpointCalls).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(factoryCalls).toBe(2);
    expect(attachSettled).toBe(false);

    candidateGate.resolve(undefined);
    await stopping;
    const laterHandle = await attaching;
    const finalHandle = await finalAttaching;

    expect(descriptorEnumerations).toBe(1);
    expect(laterHandle.generation).toBe(initialHandle.generation);
    expect(finalHandle.generation).toBe(initialHandle.generation);
    expect(candidateWorker.targets.slice(-2)).toEqual([
      "type.example.dev/AfterStopLater",
      "type.example.dev/AfterStopFinal",
    ]);
    expect(factoryCalls).toBe(2);
    await attachments.detach(initialHandle);
    await attachments.detach(laterHandle);
    await attachments.detach(finalHandle);
  });

  it("preserves call order when stop completion races two conflicting waiters", async () => {
    const oldWorker = new ControlledWorker([], "cohort-race-old");
    const candidateWorker = new ControlledWorker([], "cohort-race-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "CohortRaceInitial",
      "type.example.dev/CohortRaceInitial",
      new InMemoryStorageFactory(),
    );
    const shared = descriptor(
      "CohortRaceShared",
      "type.example.dev/CohortRaceShared",
      new InMemoryStorageFactory(),
    );
    const spacers = Array.from({ length: 4 }, (_, index) =>
      descriptor(
        `CohortRaceSpacer${index.toString()}`,
        `type.example.dev/CohortRaceSpacer${index.toString()}`,
        new InMemoryStorageFactory(),
      ),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    const earlier = attachments.attach({ ownership: "caller", descriptors: [shared.value] });
    await Promise.resolve();
    const spacerAttachments = spacers.map((spacer) =>
      attachments.attach({ ownership: "caller", descriptors: [spacer.value] }),
    );
    const later = attachments.attach({ ownership: "caller", descriptors: [shared.value] });
    expect(shared.startupCalls).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);

    candidateGate.resolve(undefined);
    const [stopOutcome, earlierOutcome, ...remainingOutcomes] = await Promise.allSettled([
      stopping,
      earlier,
      ...spacerAttachments,
      later,
    ]);
    const laterOutcome = remainingOutcomes.at(-1);
    if (laterOutcome === undefined) {
      throw new Error("Expected the later attachment outcome.");
    }
    const spacerOutcomes = remainingOutcomes.slice(0, -1);

    expect(stopOutcome.status).toBe("fulfilled");
    expect(earlierOutcome.status).toBe("fulfilled");
    expect(spacerOutcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(laterOutcome.status).toBe("rejected");
    if (laterOutcome.status === "rejected") {
      expect(laterOutcome.reason).toEqual(
        expect.objectContaining({ message: "Context delivery descriptor is already attached." }),
      );
    }
    expect(shared.startupCalls).toBe(1);
    expect(attachments.activeRegistrationCount).toBe(2 + spacers.length);
    expect(factoryCalls).toBe(2);

    if (earlierOutcome.status !== "fulfilled") throw earlierOutcome.reason;
    await attachments.detach(initialHandle);
    await attachments.detach(earlierOutcome.value);
    for (const outcome of spacerOutcomes) {
      if (outcome.status !== "fulfilled") throw outcome.reason;
      await attachments.detach(outcome.value);
    }
  });

  it("keeps an after-stop attachment pending across unsafe retirement and explicit retry", async () => {
    const oldWorker = new ControlledWorker([], "waiting-unsafe-old");
    const candidateWorker = new ControlledWorker([], "waiting-unsafe-candidate");
    const retryGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(retryGate.promise);
    const stopFailure = new Error("waiting unsafe stop failed");
    oldWorker.stopFailures.push(stopFailure);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "WaitingUnsafeInitial",
      "type.example.dev/WaitingUnsafeInitial",
      new InMemoryStorageFactory(),
    );
    const later = descriptor(
      "WaitingUnsafeLater",
      "type.example.dev/WaitingUnsafeLater",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });
    let descriptorEnumerations = 0;
    const laterDescriptors = countedDescriptors([later.value], () => {
      descriptorEnumerations += 1;
    });

    const stopping = attachments.stopDelivery();
    const attaching = attachments.attach({ ownership: "caller", descriptors: laterDescriptors });
    let attachSettled = false;
    void attaching.then(
      () => {
        attachSettled = true;
      },
      () => {
        attachSettled = true;
      },
    );
    await expect(stopping).rejects.toBeInstanceOf(DeliveryRunQuiescenceError);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await until(() => candidateWorker.starts === 1);
    expect(attachSettled).toBe(false);
    expect(descriptorEnumerations).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(factoryCalls).toBe(2);

    retryGate.resolve(undefined);
    await retry;
    const laterHandle = await attaching;

    expect(descriptorEnumerations).toBe(1);
    expect(laterHandle.generation).toBe(initialHandle.generation);
    expect(factoryCalls).toBe(2);
    expect(oldWorker.stopCalls).toBe(2);
    await attachments.detach(initialHandle);
    await attachments.detach(laterHandle);
  });

  it("keeps an after-stop attachment pending across partial candidate retry", async () => {
    const oldWorker = new ControlledWorker([], "waiting-partial-old");
    const candidateWorker = new ControlledWorker([], "waiting-partial-candidate");
    const retryGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(Promise.resolve(), retryGate.promise);
    const transitionFailure = new Error("waiting partial transfer failed");
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    let transferAttempts = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer() {
          transferAttempts += 1;
          if (transferAttempts === 1) throw transitionFailure;
        },
      },
    });
    const initial = descriptor(
      "WaitingPartialInitial",
      "type.example.dev/WaitingPartialInitial",
      new InMemoryStorageFactory(),
    );
    const later = descriptor(
      "WaitingPartialLater",
      "type.example.dev/WaitingPartialLater",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });

    const stopping = attachments.stopDelivery();
    const attaching = attachments.attach({ ownership: "caller", descriptors: [later.value] });
    let attachSettled = false;
    void attaching.then(
      () => {
        attachSettled = true;
      },
      () => {
        attachSettled = true;
      },
    );
    await expect(stopping).rejects.toBe(transitionFailure);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await until(() => candidateWorker.starts === 2);
    expect(attachSettled).toBe(false);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(factoryCalls).toBe(2);

    retryGate.resolve(undefined);
    await retry;
    const laterHandle = await attaching;

    expect(laterHandle.generation).toBe(initialHandle.generation);
    expect(factoryCalls).toBe(2);
    expect(transferAttempts).toBe(2);
    await attachments.detach(initialHandle);
    await attachments.detach(laterHandle);
  });

  it("releases an after-stop attachment when replacement succeeds before old failure propagation", async () => {
    const oldWorker = new ControlledWorker([], "waiting-safe-old");
    const candidateWorker = new ControlledWorker([], "waiting-safe-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    const waiterGate = Promise.withResolvers<undefined>();
    const waiterStarted = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise, waiterGate.promise);
    const retirementFailure = new Error("waiting replacement-safe retirement failed");
    oldWorker.retireFailures.push(retirementFailure);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "WaitingSafeInitial",
      "type.example.dev/WaitingSafeInitial",
      new InMemoryStorageFactory(),
    );
    const later = descriptor(
      "WaitingSafeLater",
      "type.example.dev/WaitingSafeLater",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    const attaching = attachments.attach({ ownership: "caller", descriptors: [later.value] });
    const events: string[] = [];
    let stopSettled = false;
    const observedStop = stopping.catch((reason: unknown) => {
      stopSettled = true;
      events.push("stop");
      return reason;
    });
    const observedAttach = attaching.then((handle) => {
      events.push("attach");
      return handle;
    });
    candidateWorker.onStarts.push(() => {
      waiterStarted.resolve(undefined);
    });
    candidateGate.resolve(undefined);

    expect(
      await Promise.race([
        waiterStarted.promise.then(() => "attach-started" as const),
        observedStop.then(() => "stop-settled" as const),
      ]),
    ).toBe("attach-started");
    expect(stopSettled).toBe(false);

    waiterGate.resolve(undefined);
    const laterHandle = await observedAttach;
    expect(await observedStop).toBe(retirementFailure);

    expect(laterHandle.generation).toBe(initialHandle.generation);
    expect(events).toEqual(["attach", "stop"]);
    expect(factoryCalls).toBe(2);
    await attachments.detach(initialHandle);
    await attachments.detach(laterHandle);
  });

  it.each([
    { name: "successful", oldFailure: undefined },
    {
      name: "replacement-safe",
      oldFailure: new Error("waiter failure replacement-safe retirement failed"),
    },
  ])("keeps a rejected waiter independent from a $name stop result", async ({ oldFailure }) => {
    const oldWorker = new ControlledWorker([], "waiter-failure-old");
    const candidateWorker = new ControlledWorker([], "waiter-failure-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    const waiterGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise, waiterGate.promise);
    if (oldFailure !== undefined) oldWorker.retireFailures.push(oldFailure);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "WaiterFailureInitial",
      "type.example.dev/WaiterFailureInitial",
      new InMemoryStorageFactory(),
    );
    const later = descriptor(
      "WaiterFailureLater",
      "type.example.dev/WaiterFailureLater",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    const attaching = attachments.attach({ ownership: "caller", descriptors: [later.value] });
    const events: string[] = [];
    let stopSettled = false;
    const stopOutcome = stopping.then(
      () => {
        stopSettled = true;
        events.push("stop");
        return Object.freeze({ status: "fulfilled" as const });
      },
      (reason: unknown) => {
        stopSettled = true;
        events.push("stop");
        return Object.freeze({ status: "rejected" as const, reason });
      },
    );
    const attachOutcome = attaching.then(
      () => Object.freeze({ status: "fulfilled" as const }),
      (reason: unknown) => {
        events.push("attach");
        return Object.freeze({ status: "rejected" as const, reason });
      },
    );

    candidateGate.resolve(undefined);
    await until(() => candidateWorker.starts === 2);
    expect(stopSettled).toBe(false);

    const waiterFailure = new Error("waiter candidate startup failed");
    waiterGate.reject(waiterFailure);
    const rejectedAttach = await attachOutcome;
    const settledStop = await stopOutcome;

    expect(rejectedAttach.status).toBe("rejected");
    if (rejectedAttach.status === "rejected") {
      expect(rejectedAttach.reason).toBe(waiterFailure);
    }
    if (oldFailure === undefined) {
      expect(settledStop.status).toBe("fulfilled");
    } else {
      expect(settledStop.status).toBe("rejected");
      if (settledStop.status === "rejected") {
        expect(settledStop.reason).toBe(oldFailure);
      }
    }
    expect(events).toEqual(["attach", "stop"]);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(factoryCalls).toBe(2);
    await attachments.detach(initialHandle);
  });

  it("applies ownership conflict only when an after-stop attachment is re-admitted", async () => {
    const oldWorker = new ControlledWorker([], "waiting-conflict-old");
    const candidateWorker = new ControlledWorker([], "waiting-conflict-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const initial = descriptor(
      "WaitingConflictInitial",
      "type.example.dev/WaitingConflictInitial",
      new InMemoryStorageFactory(),
    );
    const conflicting = descriptor(
      "WaitingConflictLater",
      "type.example.dev/WaitingConflictLater",
      new InMemoryStorageFactory(),
    );
    const initialHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });
    let descriptorEnumerations = 0;
    const conflictingDescriptors = countedDescriptors([conflicting.value], () => {
      descriptorEnumerations += 1;
    });

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    const attaching = attachments.attach({
      ownership: "server",
      descriptors: conflictingDescriptors,
    });

    expect(descriptorEnumerations).toBe(0);
    expect(conflicting.startupCalls).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);
    candidateGate.resolve(undefined);
    await stopping;
    await expect(attaching).rejects.toThrow(
      "Server-owned environment registration requires exclusive ownership.",
    );

    expect(descriptorEnumerations).toBe(1);
    expect(conflicting.startupCalls).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(factoryCalls).toBe(2);
    await attachments.detach(initialHandle);
  });

  it("serially refuses a queued stop after unsafe last detach takes recovery ownership", async () => {
    const worker = new ControlledWorker([], "queued-detach");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "QueuedDetach",
      "type.example.dev/QueuedDetach",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({ ownership: "caller", descriptors: [target.value] });
    worker.awaitFailures.push(new Error("queued detach quiescence failed"));

    const detaching = attachments.detach(handle);
    const stopping = attachments.stopDelivery();
    await expect(detaching).rejects.toBeDefined();
    await expect(stopping).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect(worker.retireCalls).toBe(0);

    await attachments.retryDetach(handle);
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("retains a refused stop identity through waiter settlement callbacks", async () => {
    const worker = new ControlledWorker([], "refused-waiter");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        return worker;
      },
    });
    const initial = descriptor(
      "RefusedWaiterInitial",
      "type.example.dev/RefusedWaiterInitial",
      new InMemoryStorageFactory(),
    );
    const waiting = descriptor(
      "RefusedWaiterLater",
      "type.example.dev/RefusedWaiterLater",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [initial.value],
    });
    worker.awaitFailures.push(new Error("refused waiter detach quiescence failed"));
    await expect(attachments.detach(handle)).rejects.toBeDefined();
    const lifecycleBeforeStop = [worker.stopCalls, worker.awaitCalls, worker.retireCalls];

    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.then(
      () => {
        stopSettled = true;
      },
      () => {
        stopSettled = true;
      },
    );
    const attaching = attachments.attach({ ownership: "caller", descriptors: [waiting.value] });
    const waiterSettled = Promise.withResolvers<unknown>();
    let nestedStop: Promise<void> | undefined;
    let stopSettledDuringWaiterCallback: boolean | undefined;
    void attaching.catch((reason: unknown) => {
      stopSettledDuringWaiterCallback = stopSettled;
      nestedStop = attachments.stopDelivery();
      void nestedStop.catch(() => undefined);
      waiterSettled.resolve(reason);
    });
    const stopOutcome = stopping.then(
      () => Object.freeze({ status: "fulfilled" as const }),
      (reason: unknown) => Object.freeze({ status: "rejected" as const, reason }),
    );

    const waiterReason = await waiterSettled.promise;
    expect(stopSettledDuringWaiterCallback).toBe(false);
    expect(nestedStop).toBe(stopping);
    expect(waiterReason).toEqual(
      expect.objectContaining({
        message: "Environment generation detach requires an explicit retry.",
      }),
    );
    const outcome = await stopOutcome;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toEqual(
        expect.objectContaining({
          message: "Environment generation detach requires an explicit retry.",
        }),
      );
    }
    expect(factoryCalls).toBe(1);
    expect(waiting.startupCalls).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(lifecycleBeforeStop);

    await attachments.retryDetach(handle);
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("refuses stop while rejected non-last detach owns a live registration", async () => {
    const oldWorker = new ControlledWorker([], "non-last-old");
    const candidateWorker = new ControlledWorker([], "non-last-candidate");
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("NonLastFirst", "type.example.dev/NonLastFirst", storage);
    const second = descriptor("NonLastSecond", "type.example.dev/NonLastSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = secondHandle.generation;
    oldWorker.awaitOwnerFailures.push(new Error("non-last detach quiescence failed"));

    await expect(attachments.detach(firstHandle)).rejects.toThrow(
      "non-last detach quiescence failed",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    const generationRetirementCalls = [
      oldWorker.stopCalls,
      oldWorker.awaitCalls,
      oldWorker.retireCalls,
    ];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(factoryCalls).toBe(1);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual(
      generationRetirementCalls,
    );
    second.readiness.claim(second.ready);
    await until(() => second.notifications === 1);

    await attachments.retryDetach(firstHandle);
    expect(attachments.activeRegistrationCount).toBe(1);
    await attachments.stopDelivery();
    expect(secondHandle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(secondHandle);
  });

  it("retries one retained stop after candidate construction fails without repeating old retirement", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "old");
    const candidateWorker = new ControlledWorker(events, "candidate");
    const constructionFailure = new Error("candidate construction failed");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        if (factoryCalls === 1) return oldWorker;
        if (factoryCalls === 2) throw constructionFailure;
        if (factoryCalls === 3) return candidateWorker;
        throw new Error("Unexpected generation worker.");
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("RetryFirst", "type.example.dev/RetryFirst", storage);
    const second = descriptor("RetrySecond", "type.example.dev/RetrySecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });

    const initial = attachments.stopDelivery();
    await expect(initial).rejects.toBe(constructionFailure);
    const retiredBeforeRetry = [oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls];
    const oldGeneration = firstHandle.generation;
    await expect(attachments.detach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    await expect(attachments.retryDetach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual(
      retiredBeforeRetry,
    );
    expect(factoryCalls).toBe(2);
    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;

    expect(oldWorker.stopCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(1);
    expect(oldWorker.retireCalls).toBe(1);
    expect(factoryCalls).toBe(3);
    expect(firstHandle.generation).toBe(secondHandle.generation);
    await attachments.detach(firstHandle);
    await attachments.detach(secondHandle);
  });

  it("retries complete descriptor preflight before constructing one candidate", async () => {
    const oldWorker = new ControlledWorker([], "preflight-old");
    const candidateWorker = new ControlledWorker([], "preflight-candidate");
    const workers = [oldWorker, candidateWorker];
    const preflightFailure = new Error("candidate descriptor storage context preflight failed");
    let factoryCalls = 0;
    const first = descriptor(
      "PreflightFirst",
      "type.example.dev/PreflightFirst",
      new InMemoryStorageFactory(),
    );
    const target = descriptor(
      "PreflightSecond",
      "type.example.dev/PreflightSecond",
      new InMemoryStorageFactory(),
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value, target.value],
    });
    const oldGeneration = handle.generation;
    const firstBaseline = [first.startupCalls, first.contextCalls, first.endpointCalls];
    const targetBaseline = [target.startupCalls, target.contextCalls, target.endpointCalls];
    target.contextFailures.push(preflightFailure);

    await expect(attachments.stopDelivery()).rejects.toBe(preflightFailure);
    expect(factoryCalls).toBe(1);
    expect([first.startupCalls, first.contextCalls, first.endpointCalls]).toEqual(
      firstBaseline.map((calls) => calls + 1),
    );
    expect([target.startupCalls, target.contextCalls, target.endpointCalls]).toEqual(
      targetBaseline.map((calls) => calls + 1),
    );
    expect(handle.generation).toBe(oldGeneration);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(factoryCalls).toBe(1);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect([first.startupCalls, first.contextCalls, first.endpointCalls]).toEqual(
      firstBaseline.map((calls) => calls + 2),
    );
    expect([target.startupCalls, target.contextCalls, target.endpointCalls]).toEqual(
      targetBaseline.map((calls) => calls + 2),
    );
    expect(factoryCalls).toBe(2);
    expect(candidateWorker.starts).toBe(2);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("captures a fallible storage factory before candidate construction", async () => {
    const oldWorker = new ControlledWorker([], "factory-preflight-old");
    const candidateWorker = new ControlledWorker([], "factory-preflight-candidate");
    const workers = [oldWorker, candidateWorker];
    const preflightFailure = new Error("candidate descriptor storage factory preflight failed");
    let generationFactoryCalls = 0;
    const target = descriptor(
      "FactoryPreflight",
      "type.example.dev/FactoryPreflight",
      new InMemoryStorageFactory(),
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[generationFactoryCalls];
        generationFactoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;
    const storageFactoryBaseline = target.storageFactoryCalls;
    target.storageFactoryFailures.push(preflightFailure);

    await expect(attachments.stopDelivery()).rejects.toBe(preflightFailure);
    expect(generationFactoryCalls).toBe(1);
    expect(target.storageFactoryCalls).toBe(storageFactoryBaseline + 1);
    expect(handle.generation).toBe(oldGeneration);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(generationFactoryCalls).toBe(1);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(generationFactoryCalls).toBe(2);
    expect(target.storageFactoryCalls).toBe(storageFactoryBaseline + 2);
    expect(candidateWorker.starts).toBe(1);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("retries partial candidate route installation on the same candidate", async () => {
    const oldWorker = new ControlledWorker([], "installation-old");
    const candidateWorker = new ControlledWorker([], "installation-candidate");
    const installationFailure = new Error("candidate runtime installation failed");
    candidateWorker.addFailures.set(2, installationFailure);
    const workers = [oldWorker, candidateWorker];
    let generationFactoryCalls = 0;
    const target = descriptor(
      "Installation",
      "type.example.dev/Installation",
      new InMemoryStorageFactory(),
      {
        multitenant: true,
        startupTenantIds: ["tenant-first", "tenant-second"],
      },
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[generationFactoryCalls];
        generationFactoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;

    await expect(attachments.stopDelivery()).rejects.toBe(installationFailure);
    expect(generationFactoryCalls).toBe(2);
    expect(candidateWorker.addedTenants).toEqual(["tenant-first"]);
    expect(candidateWorker.addAttemptTenants).toEqual(["tenant-first", "tenant-second"]);
    expect(candidateWorker.starts).toBe(0);
    expect(handle.generation).toBe(oldGeneration);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(generationFactoryCalls).toBe(2);
    expect(candidateWorker.addAttemptTenants).toEqual([
      "tenant-first",
      "tenant-second",
      "tenant-second",
    ]);
    expect(candidateWorker.addedTenants).toEqual(["tenant-first", "tenant-second"]);
    expect(candidateWorker.starts).toBe(2);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("retains a completed route checkpoint separately from canonical transfer", async () => {
    const oldWorker = new ControlledWorker([], "route-old");
    const candidateWorker = new ControlledWorker([], "route-candidate");
    const workers = [oldWorker, candidateWorker];
    const routeFailure = new Error("second route preparation failed");
    const routeAttempts: string[] = [];
    const transferAttempts: string[] = [];
    let failSecondRoute = true;
    let factoryCalls = 0;
    const storage = new InMemoryStorageFactory();
    const first = descriptor("RouteFirst", "type.example.dev/RouteFirst", storage);
    const second = descriptor("RouteSecond", "type.example.dev/RouteSecond", storage);
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onRoutePrepare(descriptor: ContextDeliveryDescriptor) {
          routeAttempts.push(descriptor === first.value ? "first" : "second");
          if (descriptor === second.value && failSecondRoute) {
            failSecondRoute = false;
            throw routeFailure;
          }
        },
        onScopeTransfer(descriptor: ContextDeliveryDescriptor) {
          transferAttempts.push(descriptor === first.value ? "first" : "second");
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value, second.value],
    });
    const oldGeneration = handle.generation;

    await expect(attachments.stopDelivery()).rejects.toBe(routeFailure);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect(routeAttempts).toEqual(["first", "second"]);
    expect(transferAttempts).toEqual([]);
    expect(candidateWorker.starts).toBe(0);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(factoryCalls).toBe(2);
    expect(routeAttempts).toEqual(["first", "second", "second"]);
    expect(transferAttempts).toEqual(["first", "second"]);
    expect(candidateWorker.starts).toBe(2);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("coalesces configured startup buffered and retained provenance into one transfer", async () => {
    const oldWorker = new ControlledWorker([], "capture-old");
    const candidateWorker = new ControlledWorker([], "capture-candidate");
    const workers = [oldWorker, candidateWorker];
    const oldSettlementGate = Promise.withResolvers<undefined>();
    oldWorker.awaitGates.push(oldSettlementGate.promise);
    const sources: string[][] = [];
    let factoryCalls = 0;
    const storage = new InMemoryStorageFactory();
    const target = descriptor("Capture", "type.example.dev/Capture", storage);
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer(_descriptor, provenance) {
          sources.push([...provenance]);
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    oldWorker.startFailures.push(new Error("park retained readiness"));
    target.readiness.claim(target.ready);
    await until(() => oldWorker.starts === 2);
    await Promise.resolve();
    await Promise.resolve();

    const stopping = attachments.stopDelivery();
    await until(() => oldWorker.awaitCalls === 1);
    target.readiness.claim(target.ready);
    expect(candidateWorker.starts).toBe(0);
    oldSettlementGate.resolve(undefined);
    await stopping;

    expect(sources).toEqual([["configured", "startup", "buffered", "retained"]]);
    expect(candidateWorker.starts).toBe(2);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);
  });

  it("settles a failed partial transfer and retries only its unpublished candidate unit", async () => {
    const oldWorker = new ControlledWorker([], "transfer-old");
    const candidateWorker = new ControlledWorker([], "transfer-candidate");
    const firstGate = Promise.withResolvers<undefined>();
    const secondGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(firstGate.promise, secondGate.promise);
    const workers = [oldWorker, candidateWorker];
    const transferFailure = new Error("second canonical transfer failed");
    const transferAttempts: string[] = [];
    let failSecondTransfer = true;
    let factoryCalls = 0;
    const storage = new InMemoryStorageFactory();
    const first = descriptor("TransferFirst", "type.example.dev/TransferFirst", storage);
    const second = descriptor("TransferSecond", "type.example.dev/TransferSecond", storage);
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer(descriptor) {
          const unit = descriptor === first.value ? "first" : "second";
          transferAttempts.push(unit);
          if (unit === "second" && failSecondTransfer) {
            failSecondTransfer = false;
            throw transferFailure;
          }
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value, second.value],
    });
    const oldGeneration = handle.generation;

    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.catch(() => {
      stopSettled = true;
    });
    await until(() => candidateWorker.starts === 1);
    firstGate.resolve(undefined);
    await until(() => candidateWorker.starts === 2);
    expect(stopSettled).toBe(false);
    expect(handle.generation).toBe(oldGeneration);
    secondGate.resolve(undefined);
    await expect(stopping).rejects.toBe(transferFailure);
    expect(stopSettled).toBe(true);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    second.readiness.claim(second.ready);
    await Promise.resolve();
    expect(candidateWorker.starts).toBe(2);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(factoryCalls).toBe(2);
    expect(transferAttempts).toEqual(["first", "second", "second"]);
    expect(candidateWorker.targets).toEqual([
      "type.example.dev/TransferFirst",
      "type.example.dev/TransferSecond",
      "type.example.dev/TransferSecond",
      "type.example.dev/TransferSecond",
    ]);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("restores a directly rejected candidate recovery unit on the same candidate", async () => {
    const oldWorker = new ControlledWorker([], "recovery-old");
    const candidateWorker = new ControlledWorker([], "recovery-candidate");
    const recoveryGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(Promise.resolve(), recoveryGate.promise);
    const workers = [oldWorker, candidateWorker];
    const recoveryFailure = new Error("candidate recovery rejected");
    let factoryCalls = 0;
    const storage = new InMemoryStorageFactory();
    const first = descriptor("RecoveryFirst", "type.example.dev/RecoveryFirst", storage);
    const second = descriptor("RecoverySecond", "type.example.dev/RecoverySecond", storage);
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value, second.value],
    });
    const oldGeneration = handle.generation;

    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.catch(() => {
      stopSettled = true;
    });
    await until(() => candidateWorker.starts === 2);
    expect(stopSettled).toBe(false);
    expect(handle.generation).toBe(oldGeneration);
    recoveryGate.reject(recoveryFailure);
    await expect(stopping).rejects.toBe(recoveryFailure);
    expect(stopSettled).toBe(true);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    second.readiness.claim(second.ready);
    await Promise.resolve();
    expect(candidateWorker.starts).toBe(2);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(factoryCalls).toBe(2);
    expect(candidateWorker.targets).toEqual([
      "type.example.dev/RecoveryFirst",
      "type.example.dev/RecoverySecond",
      "type.example.dev/RecoverySecond",
      "type.example.dev/RecoverySecond",
    ]);
    expect(handle.generation).not.toBe(oldGeneration);
    await attachments.detach(handle);
  });

  it("retains a queued detach while a rejected stop owns its frozen survivor", async () => {
    const oldWorker = new ControlledWorker([], "queued-stop-old");
    const candidateWorker = new ControlledWorker([], "queued-stop-candidate");
    const constructionFailure = new Error("queued candidate construction failed");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        if (factoryCalls === 1) return oldWorker;
        if (factoryCalls === 2) throw constructionFailure;
        if (factoryCalls === 3) return candidateWorker;
        throw new Error("Unexpected generation worker.");
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("QueuedStopFirst", "type.example.dev/QueuedStopFirst", storage);
    const second = descriptor("QueuedStopSecond", "type.example.dev/QueuedStopSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;

    const stopping = attachments.stopDelivery();
    const detaching = attachments.detach(firstHandle);
    await expect(stopping).rejects.toBe(constructionFailure);
    await expect(detaching).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    const duplicateDetach = attachments.detach(firstHandle);
    void duplicateDetach.catch(() => undefined);
    expect(duplicateDetach).toBe(detaching);
    await expect(attachments.retryDetach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);

    await attachments.retryDeliveryStop();
    expect(firstHandle.generation).toBe(secondHandle.generation);
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(3);
    await attachments.retryDetach(firstHandle);
    expect(attachments.activeRegistrationCount).toBe(1);
    await attachments.detach(secondHandle);
  });

  it("refuses stop while failed-start rollback owns the generation", async () => {
    const worker = new ControlledWorker([], "rollback");
    worker.startFailures.push(new Error("startup failed"));
    worker.awaitFailures.push(new Error("rollback quiescence failed"));
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "RollbackOwner",
      "type.example.dev/RollbackOwner",
      new InMemoryStorageFactory(),
    );
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [target.value] }),
    ).rejects.toBeDefined();
    const calls = [worker.stopCalls, worker.awaitCalls, worker.retireCalls];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(calls);
    await attachments.retryFailedStart();
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("refuses stop while unsafe last-detach recovery owns the generation", async () => {
    const worker = new ControlledWorker([], "detach");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "DetachOwner",
      "type.example.dev/DetachOwner",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({ ownership: "caller", descriptors: [target.value] });
    worker.awaitFailures.push(new Error("detach quiescence failed"));
    await expect(attachments.detach(handle)).rejects.toBeDefined();
    const calls = [worker.stopCalls, worker.awaitCalls, worker.retireCalls];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(calls);
    await attachments.retryDetach(handle);
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("keeps routes closed and handle generations old until sequential candidate recovery publishes", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "old");
    const candidateWorker = new ControlledWorker(events, "candidate");
    const firstGate = Promise.withResolvers<undefined>();
    const secondGate = Promise.withResolvers<undefined>();
    const readinessGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(firstGate.promise, secondGate.promise, readinessGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("BarrierFirst", "type.example.dev/BarrierFirst", storage);
    const second = descriptor("BarrierSecond", "type.example.dev/BarrierSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;
    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.then(() => {
      stopSettled = true;
    });
    expect(attachments.stopDelivery()).toBe(stopping);
    await expect(attachments.retryDeliveryStop()).rejects.toThrow(
      "Environment has no failed delivery stop to retry.",
    );
    await until(() => candidateWorker.starts === 1);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    first.readiness.claim(first.ready);
    await Promise.resolve();
    expect(candidateWorker.starts).toBe(1);
    firstGate.resolve(undefined);
    await until(() => candidateWorker.starts === 2);
    expect(candidateWorker.targets[1]).toBe("type.example.dev/BarrierSecond");
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    secondGate.resolve(undefined);
    await until(() => candidateWorker.starts === 3);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    expect(stopSettled).toBe(false);
    readinessGate.resolve(undefined);
    await stopping;
    expect(stopSettled).toBe(true);
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(secondHandle.generation).toBe(firstHandle.generation);
    expect(candidateWorker.targets).toEqual([
      "type.example.dev/BarrierFirst",
      "type.example.dev/BarrierSecond",
      "type.example.dev/BarrierFirst",
      "type.example.dev/BarrierFirst",
    ]);
    expect(events.indexOf("old:retire")).toBeLessThan(events.indexOf("candidate:start"));
    expect(factoryCalls).toBe(2);
    await attachments.detach(firstHandle);
    await attachments.detach(secondHandle);
  });

  it("captures a new tenant readiness key during old retirement and settles it before publication", async () => {
    const oldRetirementGate = Promise.withResolvers<undefined>();
    const originalGate = Promise.withResolvers<undefined>();
    const newTenantGate = Promise.withResolvers<undefined>();
    const oldWorker = new ControlledWorker([], "new-key-old");
    oldWorker.awaitGates.push(oldRetirementGate.promise);
    const candidateWorker = new ControlledWorker([], "new-key-candidate");
    candidateWorker.gates.push(originalGate.promise, newTenantGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const target = descriptor(
      "NewTenantKey",
      "type.example.dev/NewTenantKey",
      new InMemoryStorageFactory(),
      { multitenant: true, startupTenantId: "tenant-original" },
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;

    const stopping = attachments.stopDelivery();
    await until(() => oldWorker.awaitCalls === 1);
    target.readiness.claim(
      Object.freeze({
        ...target.ready,
        tenantId: tenant("tenant-new"),
      }),
    );
    await Promise.resolve();
    expect(candidateWorker.starts).toBe(0);
    expect(factoryCalls).toBe(1);
    expect(handle.generation).toBe(oldGeneration);

    oldRetirementGate.resolve(undefined);
    await until(() => candidateWorker.starts === 1);
    expect(candidateWorker.tenants).toEqual(["tenant-original"]);
    expect(handle.generation).toBe(oldGeneration);
    originalGate.resolve(undefined);
    await until(() => candidateWorker.starts === 2);
    expect(candidateWorker.tenants).toEqual(["tenant-original", "tenant-new"]);
    expect(handle.generation).toBe(oldGeneration);

    newTenantGate.resolve(undefined);
    await stopping;
    expect(handle.generation).not.toBe(oldGeneration);
    expect(candidateWorker.starts).toBe(3);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);
  });

  it("retains an unsafe synchronous stop failure for one explicit retry", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "unsafe-stop-old");
    const candidateWorker = new ControlledWorker(events, "unsafe-stop-candidate");
    const workers = [oldWorker, candidateWorker];
    const stopFailure = new Error("old generation stop failed");
    oldWorker.stopFailures.push(stopFailure);
    let factoryCalls = 0;
    let routePreparations = 0;
    let transfers = 0;
    const target = descriptor(
      "UnsafeStop",
      "type.example.dev/UnsafeStop",
      new InMemoryStorageFactory(),
      { multitenant: true, startupTenantId: "tenant-startup" },
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onRoutePrepare() {
          routePreparations += 1;
        },
        onScopeTransfer() {
          transfers += 1;
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;
    const preflightCalls = [
      target.startupCalls,
      target.contextCalls,
      target.endpointCalls,
      target.storageFactoryCalls,
    ];
    events.length = 0;

    const stopping = attachments.stopDelivery();
    expect(attachments.stopDelivery()).toBe(stopping);
    const rejection = await stopping.catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(DeliveryRunQuiescenceError);
    expect((rejection as DeliveryRunQuiescenceError).cause).toBe(stopFailure);
    expect(events).toEqual(["unsafe-stop-old:stop"]);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 0, 0]);
    expect(factoryCalls).toBe(1);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(handle.generation).toBe(oldGeneration);
    expect(candidateWorker.addCalls).toBe(0);
    expect(candidateWorker.starts).toBe(0);
    expect([
      target.startupCalls,
      target.contextCalls,
      target.endpointCalls,
      target.storageFactoryCalls,
    ]).toEqual(preflightCalls);

    target.readiness.claim(
      Object.freeze({
        ...target.ready,
        tenantId: tenant("tenant-buffered-while-stop-failed"),
      }),
    );
    expect(target.notifications).toBe(1);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 0, 0]);
    expect(factoryCalls).toBe(1);
    expect([routePreparations, transfers]).toEqual([0, 0]);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;

    expect(events).toEqual([
      "unsafe-stop-old:stop",
      "unsafe-stop-old:stop",
      "unsafe-stop-old:await",
      "unsafe-stop-old:retire",
      "unsafe-stop-candidate:start",
      "unsafe-stop-candidate:start",
      "unsafe-stop-candidate:start",
    ]);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([2, 1, 1]);
    expect(factoryCalls).toBe(2);
    expect(candidateWorker.addCalls).toBe(2);
    expect(candidateWorker.addedTenants).toEqual([
      "tenant-startup",
      "tenant-buffered-while-stop-failed",
    ]);
    expect(candidateWorker.starts).toBe(3);
    expect(candidateWorker.tenants).toEqual([
      "tenant-startup",
      "tenant-buffered-while-stop-failed",
      "tenant-buffered-while-stop-failed",
    ]);
    expect([routePreparations, transfers]).toEqual([1, 2]);
    expect(handle.generation).not.toBe(oldGeneration);

    target.readiness.claim(Object.freeze({ ...target.ready, tenantId: tenant("tenant-startup") }));
    await until(() => candidateWorker.starts === 4);
    expect(target.notifications).toBe(2);
    await attachments.detach(handle);
  });

  it("retains an unsafe await-quiescence rejection after completed stop", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "unsafe-await-old");
    const candidateWorker = new ControlledWorker(events, "unsafe-await-candidate");
    const workers = [oldWorker, candidateWorker];
    const awaitFailure = new Error("old generation quiescence failed");
    oldWorker.awaitFailures.push(awaitFailure);
    let factoryCalls = 0;
    const target = descriptor(
      "UnsafeAwait",
      "type.example.dev/UnsafeAwait",
      new InMemoryStorageFactory(),
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;
    events.length = 0;

    const stopping = attachments.stopDelivery();
    expect(attachments.stopDelivery()).toBe(stopping);
    const rejection = await stopping.catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(DeliveryRunQuiescenceError);
    expect((rejection as DeliveryRunQuiescenceError).cause).toBe(awaitFailure);
    expect(events).toEqual(["unsafe-await-old:stop", "unsafe-await-old:await"]);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 0]);
    expect(factoryCalls).toBe(1);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect(handle.generation).toBe(oldGeneration);
    expect(candidateWorker.addCalls).toBe(0);
    expect(candidateWorker.starts).toBe(0);

    target.readiness.claim(target.ready);
    expect(target.notifications).toBe(1);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 0]);
    expect(factoryCalls).toBe(1);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;

    expect(events).toEqual([
      "unsafe-await-old:stop",
      "unsafe-await-old:await",
      "unsafe-await-old:await",
      "unsafe-await-old:retire",
      "unsafe-await-candidate:start",
      "unsafe-await-candidate:start",
    ]);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 2, 1]);
    expect(factoryCalls).toBe(2);
    expect(candidateWorker.addCalls).toBe(1);
    expect(candidateWorker.starts).toBe(2);
    expect(handle.generation).not.toBe(oldGeneration);

    target.readiness.claim(target.ready);
    await until(() => candidateWorker.starts === 3);
    expect(target.notifications).toBe(2);
    await attachments.detach(handle);
  });

  it.each(["report", "retire"] as const)(
    "settles the published candidate before propagating replacement-safe %s failure",
    async (failureKind) => {
      const events: string[] = [];
      const oldWorker = new ControlledWorker(events, `safe-${failureKind}-old`);
      const candidateWorker = new ControlledWorker(events, `safe-${failureKind}-candidate`);
      const oldFailure = new Error(`old generation ${failureKind} failed`);
      const parkedFailure = new Error(`old generation ${failureKind} retained readiness`);
      if (failureKind === "retire") {
        oldWorker.retireFailures.push(oldFailure);
      }
      const candidateSettlement = Promise.withResolvers<undefined>();
      const reopenedSettlement = Promise.withResolvers<undefined>();
      const candidateStarted = Promise.withResolvers<undefined>();
      const reopenedStarted = Promise.withResolvers<undefined>();
      candidateWorker.gates.push(candidateSettlement.promise, reopenedSettlement.promise);
      candidateWorker.onStarts.push(
        () => {
          candidateStarted.resolve(undefined);
        },
        () => {
          reopenedStarted.resolve(undefined);
        },
      );
      const workers = [oldWorker, candidateWorker];
      let factoryCalls = 0;
      let reportCalls = 0;
      let routePreparations = 0;
      const transferredSources: string[][] = [];
      const target = descriptor(
        `Safe${failureKind}`,
        `type.example.dev/Safe${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const attachments = new EnvironmentAttachments({
        createWorker() {
          const worker = workers[factoryCalls];
          factoryCalls += 1;
          if (worker === undefined) throw new Error("Unexpected generation worker.");
          return worker;
        },
        report() {
          reportCalls += 1;
          events.push(`safe-${failureKind}-old:report`);
          return failureKind === "report" ? Promise.reject(oldFailure) : Promise.resolve();
        },
        transitionFaults: {
          onRoutePrepare() {
            routePreparations += 1;
            events.push(`safe-${failureKind}:route`);
            target.readiness.claim(target.ready);
          },
          onScopeTransfer(_descriptor, sources) {
            transferredSources.push([...sources]);
            events.push(`safe-${failureKind}:transfer`);
          },
        },
      });
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [target.value],
      });
      const oldGeneration = handle.generation;
      const retainedStarted = Promise.withResolvers<undefined>();
      oldWorker.onStarts.push(() => {
        retainedStarted.resolve(undefined);
      });
      oldWorker.startFailures.push(parkedFailure);
      target.readiness.claim(target.ready);
      await retainedStarted.promise;
      await Promise.resolve();
      await Promise.resolve();
      events.length = 0;

      let propagated: unknown;
      const stopping = attachments.stopDelivery();
      const observed = stopping.catch((error: unknown) => {
        propagated = error;
        events.push(`safe-${failureKind}:propagate`);
      });
      expect(
        await Promise.race([
          candidateStarted.promise.then(() => "candidate" as const),
          observed.then(() => "propagated" as const),
        ]),
      ).toBe("candidate");

      expect(propagated).toBeUndefined();
      expect(handle.generation).toBe(oldGeneration);
      expect(factoryCalls).toBe(2);
      expect(candidateWorker.starts).toBe(1);
      expect(routePreparations).toBe(1);
      expect(transferredSources).toEqual([["configured", "startup", "buffered", "retained"]]);
      expect(events).toEqual([
        `safe-${failureKind}-old:stop`,
        `safe-${failureKind}-old:await`,
        `safe-${failureKind}-old:report`,
        `safe-${failureKind}-old:retire`,
        `safe-${failureKind}:route`,
        `safe-${failureKind}-candidate:start`,
        `safe-${failureKind}:transfer`,
      ]);

      candidateSettlement.resolve(undefined);
      expect(
        await Promise.race([
          reopenedStarted.promise.then(() => "reopened" as const),
          observed.then(() => "propagated" as const),
        ]),
      ).toBe("reopened");

      expect(propagated).toBeUndefined();
      expect(handle.generation).not.toBe(oldGeneration);
      expect(candidateWorker.starts).toBe(2);
      expect(events.at(-1)).toBe(`safe-${failureKind}-candidate:start`);

      reopenedSettlement.resolve(undefined);
      await observed;

      expect(propagated).toBe(oldFailure);
      expect(events.at(-1)).toBe(`safe-${failureKind}:propagate`);
      expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
      expect(reportCalls).toBe(1);
      await expect(attachments.retryDeliveryStop()).rejects.toThrow(
        "Environment has no failed delivery stop to retry.",
      );

      const usableStarted = Promise.withResolvers<undefined>();
      candidateWorker.onStarts.push(() => {
        usableStarted.resolve(undefined);
      });
      target.readiness.claim(target.ready);
      await usableStarted.promise;
      expect(candidateWorker.starts).toBe(3);
      expect(target.notifications).toBe(3);
      await attachments.detach(handle);
    },
  );

  it("preserves an undefined replacement-safe retirement rejection", async () => {
    const oldWorker = new ControlledWorker([], "undefined-old");
    const candidateWorker = new ControlledWorker([], "undefined-candidate");
    oldWorker.retireFailures.push(undefined);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const target = descriptor(
      "UndefinedRetirement",
      "type.example.dev/UndefinedRetirement",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;

    const outcome = await attachments.stopDelivery().then(
      () => Object.freeze({ status: "fulfilled" as const }),
      (reason: unknown) => Object.freeze({ status: "rejected" as const, reason }),
    );

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toBeUndefined();
    }
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect(oldWorker.retireCalls).toBe(1);
    await expect(attachments.retryDeliveryStop()).rejects.toThrow(
      "Environment has no failed delivery stop to retry.",
    );
    await attachments.detach(handle);
  });

  it("preserves a non-Error report rejection by identity", async () => {
    const oldWorker = new ControlledWorker([], "non-error-report-old");
    const candidateWorker = new ControlledWorker([], "non-error-report-candidate");
    const workers = [oldWorker, candidateWorker];
    const reportFailure = Object.freeze({ code: "report-rejected" });
    const parkedFailure = new Error("non-error report retained readiness");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      // Exact non-Error rejection identity is the behavior under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      report: () => Promise.reject(reportFailure),
    });
    const target = descriptor(
      "NonErrorReport",
      "type.example.dev/NonErrorReport",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;
    oldWorker.startFailures.push(parkedFailure);
    target.readiness.claim(target.ready);
    await until(() => oldWorker.starts === 2);
    await Promise.resolve();
    await Promise.resolve();

    const propagated = await attachments.stopDelivery().catch((reason: unknown) => reason);

    expect(propagated).toBe(reportFailure);
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);
  });

  it("retains an empty phase AggregateError as one failed transition cause", async () => {
    const oldWorker = new ControlledWorker([], "empty-aggregate-old");
    const candidateWorker = new ControlledWorker([], "empty-aggregate-candidate");
    const workers = [oldWorker, candidateWorker];
    const phaseFailure = new AggregateError([], "empty candidate phase failure");
    let factoryCalls = 0;
    let transferAttempts = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer() {
          transferAttempts += 1;
          if (transferAttempts === 1) throw phaseFailure;
        },
      },
    });
    const target = descriptor(
      "EmptyAggregate",
      "type.example.dev/EmptyAggregate",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;

    const firstFailure = await attachments.stopDelivery().catch((reason: unknown) => reason);

    expect(firstFailure).toBe(phaseFailure);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect(transferAttempts).toBe(2);
    await attachments.detach(handle);
  });

  it("retains an undefined transfer fault for explicit retry", async () => {
    await expectRetainedTransitionFailure(undefined, "UndefinedTransferFault");
  });

  it("preserves a previously coordinator-synthesized aggregate as one later phase cause", async () => {
    const reportFailure = new Error("historical coordinator report failure");
    const retireFailure = new Error("historical coordinator retirement failure");
    const worker = new ControlledWorker([], "historical-coordinator");
    worker.retireFailures.push(retireFailure);
    const configured: DeliveryRunScope = Object.freeze({
      owner: Object.freeze({ key: "historical-coordinator-owner" }),
      ready: Object.freeze({
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: "type.example.dev/HistoricalCoordinator",
        shard: ShardIndex.single(),
      }),
    });
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });
    const historical = await coordinator
      .retire(() => Promise.reject(reportFailure))
      .catch((reason: unknown) => reason);

    expect(historical).toBeInstanceOf(AggregateError);
    const historicalCauses = (historical as AggregateError).errors;
    expect(historicalCauses).toHaveLength(2);
    expect(historicalCauses[0]).toBe(reportFailure);
    expect(historicalCauses[1]).toBe(retireFailure);

    await expectRetainedTransitionFailure(historical, "ReusedCoordinatorAggregate");
  });

  it.each(["report", "retire"] as const)(
    "keeps a historical coordinator aggregate exact as the sole later %s cause",
    async (failureKind) => {
      const historicalReport = new Error(`historical ${failureKind} origin report`);
      const historicalRetire = new Error(`historical ${failureKind} origin retirement`);
      const originWorker = new ControlledWorker([], `historical-${failureKind}-origin`);
      originWorker.retireFailures.push(historicalRetire);
      const originScope: DeliveryRunScope = Object.freeze({
        owner: Object.freeze({ key: `historical-${failureKind}-origin-owner` }),
        ready: Object.freeze({
          label: "UPDATE_SUBSCRIBER",
          targetTypeUrl: `type.example.dev/Historical${failureKind}Origin`,
          shard: ShardIndex.single(),
        }),
      });
      const origin = new DeliveryRunCoordinator({ scopes: [originScope], worker: originWorker });
      const historical = await origin
        .retire(() => Promise.reject(historicalReport))
        .catch((reason: unknown) => reason);
      expect(historical).toBeInstanceOf(AggregateError);

      const oldWorker = new ControlledWorker([], `reused-${failureKind}-old`);
      const candidateWorker = new ControlledWorker([], `reused-${failureKind}-candidate`);
      if (failureKind === "retire") {
        oldWorker.retireFailures.push(historical);
      }
      const workers = [oldWorker, candidateWorker];
      const transitionFailure = new Error(`reused ${failureKind} transition failure`);
      const parkedFailure = new Error(`reused ${failureKind} retained readiness`);
      let factoryCalls = 0;
      let reportCalls = 0;
      let transferAttempts = 0;
      const attachments = new EnvironmentAttachments({
        createWorker() {
          const worker = workers[factoryCalls];
          factoryCalls += 1;
          if (worker === undefined) throw new Error("Unexpected generation worker.");
          return worker;
        },
        report() {
          reportCalls += 1;
          // Exact historical rejection identity is the behavior under test.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return failureKind === "report" ? Promise.reject(historical) : Promise.resolve();
        },
        transitionFaults: {
          onScopeTransfer() {
            transferAttempts += 1;
            if (transferAttempts === 1) throw transitionFailure;
          },
        },
      });
      const target = descriptor(
        `Reused${failureKind}`,
        `type.example.dev/Reused${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [target.value],
      });
      const oldGeneration = handle.generation;
      if (failureKind === "report") {
        oldWorker.startFailures.push(parkedFailure);
        target.readiness.claim(target.ready);
        await until(() => oldWorker.starts === 2);
        await Promise.resolve();
        await Promise.resolve();
      }

      const propagated = await attachments.stopDelivery().catch((reason: unknown) => reason);

      expect(propagated).toBeInstanceOf(AggregateError);
      const orderedCauses = (propagated as AggregateError).errors;
      expect(orderedCauses).toHaveLength(2);
      expect(orderedCauses[0]).toBe(historical);
      expect(orderedCauses[1]).toBe(transitionFailure);
      expect(handle.generation).toBe(oldGeneration);
      expect(factoryCalls).toBe(2);
      expect(transferAttempts).toBe(1);
      expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
      expect(reportCalls).toBe(failureKind === "report" ? 1 : 0);
      await expect(attachments.stopDelivery()).rejects.toThrow(
        "Environment delivery stop requires an explicit retry.",
      );

      const retry = attachments.retryDeliveryStop();
      expect(attachments.retryDeliveryStop()).toBe(retry);
      await retry;
      expect(handle.generation).not.toBe(oldGeneration);
      expect(factoryCalls).toBe(2);
      expect(transferAttempts).toBe(2);
      expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
      expect(reportCalls).toBe(failureKind === "report" ? 1 : 0);
      await attachments.detach(handle);
    },
  );

  it("preserves a previously attachment-synthesized aggregate as one later phase cause", async () => {
    const oldWorker = new ControlledWorker([], "historical-attachment-old");
    const candidateWorker = new ControlledWorker([], "historical-attachment-candidate");
    const candidateGate = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(candidateGate.promise);
    const recoveryFailure = new Error("historical candidate recovery failure");
    const transferFailure = new Error("historical transfer fault");
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    let transferAttempts = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer() {
          transferAttempts += 1;
          if (transferAttempts === 1) throw transferFailure;
        },
      },
    });
    const target = descriptor(
      "HistoricalAttachment",
      "type.example.dev/HistoricalAttachment",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;

    const stopping = attachments.stopDelivery();
    await until(() => candidateWorker.starts === 1);
    candidateGate.reject(recoveryFailure);
    const historical = await stopping.catch((reason: unknown) => reason);

    expect(historical).toBeInstanceOf(AggregateError);
    const historicalCauses = (historical as AggregateError).errors;
    expect(historicalCauses).toHaveLength(2);
    expect(historicalCauses[0]).toBe(recoveryFailure);
    expect(historicalCauses[1]).toBe(transferFailure);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);

    await expectRetainedTransitionFailure(historical, "ReusedAttachmentAggregate");
  });

  it("uses one immutable readiness snapshot for transition capture and reopen", () => {
    const targetTypeUrl = "type.example.dev/MutableReadiness";
    const target = descriptor("MutableReadiness", targetTypeUrl, new InMemoryStorageFactory(), {
      multitenant: true,
      startupTenantId: "tenant-original",
    });
    const owner = Object.freeze({ key: "mutable-readiness-owner" });
    const configured: DeliveryRunScope = Object.freeze({
      owner,
      ready: Object.freeze({
        tenantId: tenant("tenant-original"),
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl,
        shard: ShardIndex.single(),
      }),
    });
    const mutableReady = {
      tenantId: tenant("tenant-original"),
      label: "UPDATE_SUBSCRIBER" as DeliveryReady["label"],
      targetTypeUrl,
      shard: ShardIndex.single(),
    } satisfies DeliveryReady;
    let transitionReady: DeliveryReady | undefined;
    let reopenedReady: DeliveryReady | undefined;
    const route = new RegistrationReadiness(
      [{ descriptor: target.value, scopes: [configured] }],
      (_descriptor, ready) => Object.freeze({ owner, ready }),
      () => undefined,
    );
    route.open([configured]);
    route.prepareTransition((_descriptor, ready) => {
      transitionReady = ready;
    });

    route.notify(target.value, mutableReady);
    mutableReady.tenantId = tenant("tenant-mutated");
    mutableReady.label = "HANDLE_COMMAND";
    mutableReady.targetTypeUrl = "type.example.dev/Mutated";
    route.rebind(
      (_descriptor, ready) => {
        reopenedReady = ready;
        return Object.freeze({ owner, ready });
      },
      () => undefined,
    );
    route.open([]);

    expect(transitionReady).toBe(reopenedReady);
    expect(transitionReady).toMatchObject({
      tenantId: tenant("tenant-original"),
      label: "UPDATE_SUBSCRIBER",
      targetTypeUrl,
    });
  });

  it("orders replacement-safe old causes before a transition failure and retries one candidate", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "combined-old");
    const candidateWorker = new ControlledWorker(events, "combined-candidate");
    const reportFailure = new Error("combined old report failed");
    const retireFailure = new Error("combined old retirement failed");
    const nestedPhaseCause = new Error("combined nested phase cause");
    const transitionFailure = new AggregateError(
      [nestedPhaseCause],
      "combined candidate transfer failed",
    );
    const parkedFailure = new Error("combined retained readiness");
    oldWorker.retireFailures.push(retireFailure);
    const firstSettlement = Promise.withResolvers<undefined>();
    const secondSettlement = Promise.withResolvers<undefined>();
    const reopenedSettlement = Promise.withResolvers<undefined>();
    const firstStarted = Promise.withResolvers<undefined>();
    const secondStarted = Promise.withResolvers<undefined>();
    const reopenedStarted = Promise.withResolvers<undefined>();
    candidateWorker.gates.push(
      firstSettlement.promise,
      secondSettlement.promise,
      reopenedSettlement.promise,
    );
    candidateWorker.onStarts.push(
      () => {
        firstStarted.resolve(undefined);
      },
      () => {
        secondStarted.resolve(undefined);
      },
      () => {
        reopenedStarted.resolve(undefined);
      },
    );
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    let reportCalls = 0;
    let routePreparations = 0;
    let transferAttempts = 0;
    const target = descriptor(
      "CombinedFailure",
      "type.example.dev/CombinedFailure",
      new InMemoryStorageFactory(),
    );
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      report() {
        reportCalls += 1;
        events.push("combined-old:report");
        return Promise.reject(reportFailure);
      },
      transitionFaults: {
        onRoutePrepare() {
          routePreparations += 1;
          events.push("combined:route");
          target.readiness.claim(target.ready);
        },
        onScopeTransfer() {
          transferAttempts += 1;
          events.push("combined:transfer");
          if (transferAttempts === 1) throw transitionFailure;
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [target.value],
    });
    const oldGeneration = handle.generation;
    const retainedStarted = Promise.withResolvers<undefined>();
    oldWorker.onStarts.push(() => {
      retainedStarted.resolve(undefined);
    });
    oldWorker.startFailures.push(parkedFailure);
    target.readiness.claim(target.ready);
    await retainedStarted.promise;
    await Promise.resolve();
    await Promise.resolve();
    events.length = 0;

    let firstPropagated: unknown;
    const stopping = attachments.stopDelivery();
    const firstObserved = stopping.catch((error: unknown) => {
      firstPropagated = error;
      events.push("combined:propagate");
    });
    expect(
      await Promise.race([
        firstStarted.promise.then(() => "candidate" as const),
        firstObserved.then(() => "propagated" as const),
      ]),
    ).toBe("candidate");
    expect(firstPropagated).toBeUndefined();
    expect(handle.generation).toBe(oldGeneration);

    firstSettlement.resolve(undefined);
    await firstObserved;

    expect(firstPropagated).toBeInstanceOf(AggregateError);
    const orderedCauses = (firstPropagated as AggregateError).errors;
    expect(orderedCauses).toHaveLength(3);
    expect(orderedCauses[0]).toBe(reportFailure);
    expect(orderedCauses[1]).toBe(retireFailure);
    expect(orderedCauses[2]).toBe(transitionFailure);
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect(routePreparations).toBe(1);
    expect(transferAttempts).toBe(1);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
    expect(reportCalls).toBe(1);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );

    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await secondStarted.promise;
    expect(handle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect(routePreparations).toBe(1);
    expect(transferAttempts).toBe(2);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);
    expect(reportCalls).toBe(1);

    secondSettlement.resolve(undefined);
    expect(
      await Promise.race([
        reopenedStarted.promise.then(() => "reopened" as const),
        retry.then(() => "resolved" as const),
      ]),
    ).toBe("reopened");

    expect(handle.generation).not.toBe(oldGeneration);
    expect(candidateWorker.starts).toBe(3);

    reopenedSettlement.resolve(undefined);
    await retry;

    expect(factoryCalls).toBe(2);
    const usableStarted = Promise.withResolvers<undefined>();
    candidateWorker.onStarts.push(() => {
      usableStarted.resolve(undefined);
    });
    target.readiness.claim(target.ready);
    await usableStarted.promise;
    expect(candidateWorker.starts).toBe(4);
    await attachments.detach(handle);
  });

  it("replaces one live multi-registration generation while preserving handle identity", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = descriptor("First", "type.example.dev/First", storageFactory);
    const second = descriptor("Second", "type.example.dev/Second", storageFactory);
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory });
    const environment = ServerEnvironment.instance();

    const firstHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;

    const firstStop = serverEnvironmentAccess.stopDelivery(environment);
    const secondStop = serverEnvironmentAccess.stopDelivery(environment);

    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(secondHandle.generation).toBe(firstHandle.generation);
    first.readiness.claim(first.ready);
    await Promise.resolve();
    expect(first.notifications).toBe(1);
    await expect(serverEnvironmentAccess.detach(environment, firstHandle)).resolves.toBeUndefined();
    await expect(
      serverEnvironmentAccess.detach(environment, secondHandle),
    ).resolves.toBeUndefined();
  });
});

function countedDescriptors(
  descriptors: readonly ContextDeliveryDescriptor[],
  onEnumerate: () => void,
): readonly ContextDeliveryDescriptor[] {
  return new Proxy(descriptors, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) onEnumerate();
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function descriptor(
  name: string,
  targetTypeUrl: string,
  storageFactory: InMemoryStorageFactory,
  options: {
    readonly multitenant?: boolean;
    readonly startupTenantId?: string;
    readonly startupTenantIds?: readonly string[];
  } = {},
): {
  readonly value: ContextDeliveryDescriptor;
  readonly readiness: DeliveryReadiness;
  readonly ready: DeliveryReady;
  readonly notifications: number;
  readonly startupFailures: Error[];
  readonly contextFailures: Error[];
  readonly endpointFailures: Error[];
  readonly storageFactoryFailures: Error[];
  readonly startupCalls: number;
  readonly contextCalls: number;
  readonly endpointCalls: number;
  readonly storageFactoryCalls: number;
} {
  const readiness = new DeliveryReadiness();
  const ready: DeliveryReady = Object.freeze({
    label: "UPDATE_SUBSCRIBER",
    targetTypeUrl,
    shard: ShardIndex.single(),
  });
  const multitenant = options.multitenant === true;
  const startupFailures: Error[] = [];
  const contextFailures: Error[] = [];
  const endpointFailures: Error[] = [];
  const storageFactoryFailures: Error[] = [];
  let startupCalls = 0;
  let contextCalls = 0;
  let endpointCalls = 0;
  let storageFactoryCalls = 0;
  let notifications = 0;
  const value: ContextDeliveryDescriptor = Object.freeze({
    get storageFactory() {
      storageFactoryCalls += 1;
      const failure = storageFactoryFailures.shift();
      if (failure !== undefined) throw failure;
      return storageFactory;
    },
    startupScopes: () => {
      startupCalls += 1;
      const failure = startupFailures.shift();
      const startupTenantIds =
        options.startupTenantIds ??
        (options.startupTenantId === undefined ? undefined : [options.startupTenantId]);
      return failure === undefined
        ? Promise.resolve(
            Object.freeze(
              startupTenantIds === undefined
                ? [Object.freeze({})]
                : startupTenantIds.map((value) => Object.freeze({ tenantId: tenant(value) })),
            ),
          )
        : Promise.reject(failure);
    },
    storageContext: (scope: DeliveryTenantScope) => {
      contextCalls += 1;
      const failure = contextFailures.shift();
      if (failure !== undefined) throw failure;
      if (!multitenant) return Object.freeze({ name, multitenant: false });
      if (scope.tenantId === undefined) {
        throw new Error("Multitenant fixture scope requires a tenant ID.");
      }
      return Object.freeze({ name, multitenant: true, tenantId: scope.tenantId });
    },
    endpoints: () => {
      endpointCalls += 1;
      const failure = endpointFailures.shift();
      if (failure !== undefined) throw failure;
      return Object.freeze([ready]);
    },
    onReady: (onReady: OnDeliveryReady) => readiness.onReady(onReady),
    transition: (
      scopes: readonly DeliveryReady[],
      onReady: OnDeliveryReady,
      transitionOptions?: { readonly allowEmpty?: boolean },
    ) =>
      readiness.transition(
        scopes,
        (candidate) => {
          notifications += 1;
          return onReady(candidate);
        },
        transitionOptions,
      ),
    replay: () => Promise.resolve(),
  });
  return {
    value,
    readiness,
    ready,
    startupFailures,
    contextFailures,
    endpointFailures,
    storageFactoryFailures,
    get startupCalls() {
      return startupCalls;
    },
    get contextCalls() {
      return contextCalls;
    },
    get endpointCalls() {
      return endpointCalls;
    },
    get storageFactoryCalls() {
      return storageFactoryCalls;
    },
    get notifications() {
      return notifications;
    },
  };
}

class ControlledWorker implements EnvironmentGenerationWorker {
  readonly gates: Promise<void>[] = [];
  readonly awaitGates: Promise<void>[] = [];
  readonly startFailures: Error[] = [];
  readonly stopFailures: Error[] = [];
  readonly awaitFailures: Error[] = [];
  readonly retireFailures: unknown[] = [];
  readonly awaitOwnerFailures: Error[] = [];
  readonly onStarts: (() => void)[] = [];
  readonly targets: string[] = [];
  readonly tenants: (string | undefined)[] = [];
  readonly addFailures = new Map<number, Error>();
  readonly addAttemptTenants: (string | undefined)[] = [];
  readonly addedTenants: (string | undefined)[] = [];
  addCalls = 0;
  starts = 0;
  stopCalls = 0;
  awaitCalls = 0;
  retireCalls = 0;
  readonly #events: string[];
  readonly #name: string;
  constructor(events: string[], name: string) {
    this.#events = events;
    this.#name = name;
  }
  add(runtime: EnvironmentDeliveryRuntime): void {
    this.addCalls += 1;
    this.addAttemptTenants.push(tenantValue(runtime.tenant.tenantId));
    const failure = this.addFailures.get(this.addCalls);
    if (failure !== undefined) {
      this.addFailures.delete(this.addCalls);
      throw failure;
    }
    this.addedTenants.push(tenantValue(runtime.tenant.tenantId));
  }
  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.starts += 1;
    this.#events.push(`${this.#name}:start`);
    this.onStarts.shift()?.();
    this.targets.push(...obligation.scopes.map((scope) => scope.ready.targetTypeUrl));
    this.tenants.push(...obligation.scopes.map((scope) => tenantValue(scope.ready.tenantId)));
    const failure = this.startFailures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    const gate = this.gates.shift() ?? Promise.resolve();
    return gate.then(() => ({
      obligation,
      shards: Object.freeze(
        shards.map((shard) => ({
          status: "fulfilled" as const,
          shard,
          obligation,
          run: {
            status: "IDLE" as const,
            runs: 1,
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 0,
            failures: Object.freeze([]),
          },
          progress: {
            runs: 1,
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 0,
            failures: Object.freeze([]),
          },
        })),
      ),
    }));
  }
  stop(): void {
    this.stopCalls += 1;
    this.#events.push(`${this.#name}:stop`);
    const failure = this.stopFailures.shift();
    if (failure !== undefined) throw failure;
  }
  awaitSettled(): Promise<void> {
    this.awaitCalls += 1;
    this.#events.push(`${this.#name}:await`);
    const failure = this.awaitFailures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    return this.awaitGates.shift() ?? Promise.resolve();
  }
  retire(): Promise<void> {
    this.retireCalls += 1;
    this.#events.push(`${this.#name}:retire`);
    if (this.retireFailures.length === 0) return Promise.resolve();
    const failure = this.retireFailures.shift();
    // Exact arbitrary rejection identity is exercised by the lifecycle tests.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(failure);
  }
  stopOwners(): void {
    // This test double has no owner-specific stop work.
  }
  awaitOwnersSettled(): Promise<void> {
    const failure = this.awaitOwnerFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }
  retireOwners(): Promise<void> {
    return Promise.resolve();
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not observed.");
}

async function expectRetainedTransitionFailure(reason: unknown, name: string): Promise<void> {
  const oldWorker = new ControlledWorker([], `${name}-old`);
  const candidateWorker = new ControlledWorker([], `${name}-candidate`);
  const workers = [oldWorker, candidateWorker];
  let factoryCalls = 0;
  let transferAttempts = 0;
  const attachments = new EnvironmentAttachments({
    createWorker() {
      const worker = workers[factoryCalls];
      factoryCalls += 1;
      if (worker === undefined) throw new Error("Unexpected generation worker.");
      return worker;
    },
    transitionFaults: {
      onScopeTransfer() {
        transferAttempts += 1;
        if (transferAttempts === 1) throw reason;
      },
    },
  });
  const target = descriptor(name, `type.example.dev/${name}`, new InMemoryStorageFactory());
  const handle = await attachments.attach({
    ownership: "caller",
    descriptors: [target.value],
  });
  const oldGeneration = handle.generation;

  const outcome = await attachments.stopDelivery().then(
    () => Object.freeze({ status: "fulfilled" as const }),
    (failure: unknown) => Object.freeze({ status: "rejected" as const, reason: failure }),
  );

  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(outcome.reason).toBe(reason);
  }
  expect(handle.generation).toBe(oldGeneration);
  expect(factoryCalls).toBe(2);
  expect(candidateWorker.addCalls).toBe(1);
  expect(transferAttempts).toBe(1);
  await expect(attachments.stopDelivery()).rejects.toThrow(
    "Environment delivery stop requires an explicit retry.",
  );

  const retry = attachments.retryDeliveryStop();
  expect(attachments.retryDeliveryStop()).toBe(retry);
  await retry;
  expect(handle.generation).not.toBe(oldGeneration);
  expect(factoryCalls).toBe(2);
  expect(candidateWorker.addCalls).toBe(1);
  expect(transferAttempts).toBe(2);
  await attachments.detach(handle);
}

function tenantValue(tenantId: TenantId | undefined): string | undefined {
  if (tenantId === undefined) return undefined;
  const kind = tenantId.kind;
  return kind.case === "value"
    ? kind.value
    : kind.case === "domain" || kind.case === "email"
      ? kind.value.value
      : undefined;
}
