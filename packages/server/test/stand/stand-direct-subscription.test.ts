/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import { VersionSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";
import { tenant } from "../tenant-fixture.js";
import {
  BoundedContext,
  Stand,
  StandSubscriptionCapacityError,
  type StandUpdate,
} from "../../src/index.js";
import { standAccess } from "../../src/stand/stand.js";
import { ReadSideFilter, type ReadSideContext } from "../../src/stand/read-side-filter.js";
import {
  ServerEnvironment,
  ServerEnvironmentLifecycle,
} from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import "../../test-fixtures/generated/proto-module.js";
import {
  ProjectOverviewStateSchema,
  type ProjectOverviewState,
} from "../../test-fixtures/generated/repository-routing/project_states_pb.js";

const state = (name: string) =>
  create(ProjectOverviewStateSchema, {
    id: "project-1",
    name,
    priority: 1,
  });

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const standWithState = () => {
  const stand = new Stand({
    context: { name: "Projects", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
  stand.register(ProjectOverviewStateSchema);
  return stand;
};

describe("direct Stand subscription filtering", () => {
  it("uses environment zero capacity without Server setup", async () => {
    await ServerEnvironmentLifecycle.resetForTest();
    ServerEnvironment.when(EnvironmentType.Local).use({ subscriptionQueueCapacity: 0 });
    const stand = standWithState();
    const entered = deferred();
    const release = deferred();
    const errors: Error[] = [];
    const handle = stand.subscribe(ProjectOverviewStateSchema, {
      next: async () => {
        entered.resolve();
        await release.promise;
      },
      error: (error) => {
        errors.push(error);
      },
    });
    try {
      await stand.update(ProjectOverviewStateSchema, state("active"));
      await entered.promise;
      expect(handle.closed).toBe(false);
      await stand.update(ProjectOverviewStateSchema, state("overflow"));
      expect(handle.closed).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(StandSubscriptionCapacityError);
    } finally {
      release.resolve();
      await stand.close();
      await ServerEnvironmentLifecycle.resetForTest();
    }
  });

  it("runs one filter and delivery at a time, with 100 waiting updates plus one active", async () => {
    const stand = standWithState();
    const gate = deferred();
    const entered = deferred();
    const delivered: string[] = [];
    const errors: Error[] = [];
    let calls = 0;
    class Wait extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(value: ProjectOverviewState): Promise<ProjectOverviewState> {
        calls++;
        if (calls === 1) {
          entered.resolve();
          await gate.promise;
        }
        return value;
      }
    }
    standAccess.installReadFilters(stand, [new Wait()]);
    const handle = stand.subscribe(ProjectOverviewStateSchema, {
      next: (update) => {
        if (update.kind === "state") delivered.push(update.state.name);
      },
      error: (error) => {
        errors.push(error);
      },
    });

    await stand.update(ProjectOverviewStateSchema, state("active"));
    await entered.promise;
    for (let index = 0; index < 100; index++) {
      await stand.update(ProjectOverviewStateSchema, state(`waiting-${String(index)}`));
    }
    expect(calls).toBe(1);
    expect(errors).toEqual([]);
    expect(handle.closed).toBe(false);
    await stand.update(ProjectOverviewStateSchema, state("overflow"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(StandSubscriptionCapacityError);
    expect(handle.closed).toBe(true);
    gate.resolve();
    await Promise.resolve();
    expect(delivered).toEqual([]);
    await expect(stand.read(ProjectOverviewStateSchema, "project-1")).resolves.toMatchObject({
      name: "overflow",
    });
    await stand.close();
  });

  it("filters current and previous state sequentially without changing original metadata", async () => {
    const stand = standWithState();
    const calls: string[] = [];
    class Redact extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(value: ProjectOverviewState): ProjectOverviewState | null {
        calls.push(value.name);
        if (value.name === "Hidden") return null;
        value.name = `visible-${value.name}`;
        value.id = "changed-by-filter";
        return value;
      }
    }
    standAccess.installReadFilters(stand, [new Redact()]);
    const delivered: unknown[] = [];
    const allDelivered = deferred();
    const errors: Error[] = [];
    stand.subscribe(ProjectOverviewStateSchema, {
      next: (update) => {
        delivered.push(update);
        if (delivered.length === 3) allDelivered.resolve();
      },
      error: (error) => {
        errors.push(error);
      },
    });
    await stand.update(ProjectOverviewStateSchema, state("First"));
    await stand.update(ProjectOverviewStateSchema, state("Second"), {
      version: create(VersionSchema, { number: 2 }),
    });
    await stand.update(ProjectOverviewStateSchema, state("Hidden"));
    await allDelivered.promise;
    expect(errors).toEqual([]);
    expect(calls).toEqual(["First", "Second", "First", "Hidden"]);
    expect(delivered).toMatchObject([
      { kind: "state", id: "project-1", state: { name: "visible-First" } },
      {
        kind: "state",
        id: "project-1",
        state: { name: "visible-Second" },
        previousState: { name: "visible-First" },
        version: { number: 2 },
      },
      { kind: "removal", id: "project-1", noLongerMatching: true },
    ]);
    await expect(
      standAccess.readCurrent(stand, ProjectOverviewStateSchema, "project-1", {}),
    ).resolves.toMatchObject({ state: { name: "Hidden" } });
    await stand.close();
  });

  it("lets a peer continue when a configured one-waiting subscriber overflows", async () => {
    await ServerEnvironmentLifecycle.resetForTest();
    ServerEnvironment.when(EnvironmentType.Local).use({ subscriptionQueueCapacity: 1 });
    const stand = standWithState();
    const entered = deferred();
    const gate = deferred();
    const peerDone = deferred();
    const peer: string[] = [];
    const slowErrors: Error[] = [];
    const principals: string[] = [];
    class ReaderPolicy extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(
        value: ProjectOverviewState,
        context: ReadSideContext,
      ): Promise<ProjectOverviewState> {
        principals.push(context.principal?.id ?? "anonymous");
        if (context.principal?.id === "slow" && value.name === "First") {
          entered.resolve();
          await gate.promise;
        }
        return value;
      }
    }
    standAccess.installReadFilters(stand, [new ReaderPolicy()]);
    const slow = stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: () => {
          throw new Error("Invalid late slow delivery.");
        },
        error: (error) => {
          slowErrors.push(error);
        },
      },
      { reader: { principal: { id: "slow" }, authorityFacts: { role: "viewer" } } },
    );
    stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: (update) => {
          if (update.kind === "state") peer.push(update.state.name);
          if (peer.length === 3) peerDone.resolve();
        },
        error: (error) => {
          throw error;
        },
      },
      { reader: { principal: { id: "fast" } } },
    );

    await stand.update(ProjectOverviewStateSchema, state("First"));
    await entered.promise;
    await stand.update(ProjectOverviewStateSchema, state("Second"));
    expect(slow.closed).toBe(false);
    await stand.update(ProjectOverviewStateSchema, state("Third"));
    expect(slow.closed).toBe(true);
    expect(slowErrors).toHaveLength(1);
    expect(slowErrors[0]).toBeInstanceOf(StandSubscriptionCapacityError);
    gate.resolve();
    await peerDone.promise;
    expect(peer).toEqual(["First", "Second", "Third"]);
    expect(principals).toContain("slow");
    expect(principals).toContain("fast");
    await stand.close();
    await ServerEnvironmentLifecycle.resetForTest();
  });

  it("awaits asynchronous next delivery before starting the following update", async () => {
    const stand = standWithState();
    const delivered: string[] = [];
    const release = deferred();
    const second = deferred();
    stand.subscribe(ProjectOverviewStateSchema, {
      next: async (update) => {
        if (update.kind !== "state") throw new Error("Unexpected removal.");
        delivered.push(update.state.name);
        if (delivered.length === 1) await release.promise;
        if (delivered.length === 2) second.resolve();
      },
      error: (error) => {
        throw error;
      },
    });
    await stand.update(ProjectOverviewStateSchema, state("First"));
    await stand.update(ProjectOverviewStateSchema, state("Second"));
    expect(delivered).toEqual(["First"]);
    release.resolve();
    await second.promise;
    expect(delivered).toEqual(["First", "Second"]);
    await stand.close();
  });

  it("closes after a rejected async next and contains a rejected async error callback", async () => {
    const stand = standWithState();
    const delivered: string[] = [];
    const firstEntered = deferred();
    const failed = deferred();
    let rejectNext!: (reason: Error) => void;
    const pendingNext = new Promise<void>((_resolve, reject) => {
      rejectNext = reject;
    });
    const handle = stand.subscribe(ProjectOverviewStateSchema, {
      next: (update) => {
        if (update.kind === "state") delivered.push(update.state.name);
        firstEntered.resolve();
        return pendingNext;
      },
      error: (error) => {
        expect(error.message).toBe("next failed");
        failed.resolve();
        return Promise.reject(new Error("error observer also failed"));
      },
    });
    await stand.update(ProjectOverviewStateSchema, state("First"));
    await firstEntered.promise;
    await stand.update(ProjectOverviewStateSchema, state("Second"));
    rejectNext(new Error("next failed"));
    await failed.promise;
    expect(handle.closed).toBe(true);
    expect(delivered).toEqual(["First"]);
    await stand.close();
  });

  it("reports the producing Bounded Context for a direct subscription", async () => {
    await ServerEnvironment.instance().completeSetup();
    const seen: ReadSideContext[] = [];
    class Inspect extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(value: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        seen.push(context);
        return value;
      }
    }
    const context = await BoundedContext.singleTenant("Projects")
      .addReadSideFilter(new Inspect())
      .build();
    try {
      const stand = context.stand();
      stand.register(ProjectOverviewStateSchema);
      const done = deferred();
      stand.subscribe(ProjectOverviewStateSchema, {
        next: () => {
          done.resolve();
        },
        error: (error) => {
          throw error;
        },
      });
      await stand.update(ProjectOverviewStateSchema, state("First"));
      await done.promise;
      expect(seen[0]?.producingContext).toBe(context);
      expect(seen[0]?.operation).toMatchObject({
        kind: "direct",
        subscription: {
          typeUrl: "type.googleapis.com/repository_routing.ProjectOverviewState",
        },
      });
    } finally {
      await context.close();
      await ServerEnvironmentLifecycle.resetForTest();
    }
  });

  it("closes promptly with a nonsettling filter and ignores its late rejection", async () => {
    const stand = standWithState();
    const entered = deferred();
    let reject!: (reason: Error) => void;
    const pending = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    class Wait extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(): Promise<ProjectOverviewState> {
        entered.resolve();
        return await pending;
      }
    }
    standAccess.installReadFilters(stand, [new Wait()]);
    const delivered: StandUpdate<typeof ProjectOverviewStateSchema>[] = [];
    const errors: Error[] = [];
    const subscription = stand.subscribe(ProjectOverviewStateSchema, {
      next: (update) => {
        delivered.push(update);
      },
      error: (error) => {
        errors.push(error);
      },
    });
    await stand.update(ProjectOverviewStateSchema, state("First"));
    await entered.promise;
    await stand.close();
    expect(subscription.closed).toBe(true);
    reject(new Error("late policy rejection"));
    await Promise.resolve();
    expect(delivered).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("keeps committed writes and peer delivery after a filter fault", async () => {
    const stand = standWithState();
    const fault = new Error("policy failed");
    class RejectOne extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(value: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        if (context.principal?.id === "denied") throw fault;
        return value;
      }
    }
    standAccess.installReadFilters(stand, [new RejectOne()]);
    const failed = deferred();
    const peerDone = deferred();
    const peer: string[] = [];
    const denied = stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: () => {
          throw new Error("Unexpected denied delivery.");
        },
        error: (error) => {
          expect(error).toBe(fault);
          failed.resolve();
          throw error;
        },
      },
      { reader: { principal: { id: "denied" } } },
    );
    stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: (update) => {
          if (update.kind === "state") peer.push(update.state.name);
          peerDone.resolve();
        },
        error: (error) => {
          throw error;
        },
      },
      { reader: { principal: { id: "allowed" } } },
    );
    await expect(stand.update(ProjectOverviewStateSchema, state("First"))).resolves.toBeUndefined();
    await Promise.all([failed.promise, peerDone.promise]);
    expect(denied.closed).toBe(true);
    expect(peer).toEqual(["First"]);
    await expect(
      standAccess.readCurrent(stand, ProjectOverviewStateSchema, "project-1", {}),
    ).resolves.toMatchObject({ state: { name: "First" } });
    await stand.close();
  });

  it("omits a removed previous state and snapshots trusted direct reader facts", async () => {
    const stand = new Stand({
      context: { name: "Projects", multitenant: true },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    const seen: ReadSideContext[] = [];
    class Inspect extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(value: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState | null {
        seen.push(context);
        return value.name === "Hidden" ? null : value;
      }
    }
    standAccess.installReadFilters(stand, [new Inspect()]);
    const delivered: StandUpdate<typeof ProjectOverviewStateSchema>[] = [];
    const done = deferred();
    const reader = { principal: { id: "reader-a" }, authorityFacts: { role: "viewer" } };
    stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: (update) => {
          delivered.push(update);
          if (delivered.length === 2) done.resolve();
        },
        error: (error) => {
          throw error;
        },
      },
      { tenantId: tenant("tenant-a"), reader },
    );
    reader.principal.id = "changed-after-subscribe";
    reader.authorityFacts.role = "changed-after-subscribe";
    await stand.update(ProjectOverviewStateSchema, state("Hidden"), {
      tenantId: tenant("tenant-a"),
    });
    await stand.update(ProjectOverviewStateSchema, state("Visible"), {
      tenantId: tenant("tenant-a"),
    });
    await done.promise;
    expect(delivered).toMatchObject([
      { kind: "removal", id: "project-1", noLongerMatching: true },
      { kind: "state", id: "project-1", state: { name: "Visible" } },
    ]);
    expect(delivered[1]).not.toHaveProperty("previousState");
    expect(seen.map((context) => context.principal?.id)).toEqual([
      "reader-a",
      "reader-a",
      "reader-a",
    ]);
    expect(seen[0]?.authorityFacts?.role).toBe("viewer");
    expect(seen[0]?.operation).toMatchObject({
      kind: "direct",
      subscription: {
        typeUrl: "type.googleapis.com/repository_routing.ProjectOverviewState",
      },
    });
    expect(seen[0]?.effectiveTenant).toEqual(tenant("tenant-a"));
    await stand.close();
  });

  it("aborts a policy suspended on previous state without a late callback", async () => {
    const stand = standWithState();
    const priorEntered = deferred();
    const release = deferred();
    let firstCompleted = false;
    class WaitPrior extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(value: ProjectOverviewState): Promise<ProjectOverviewState> {
        if (value.name === "First" && firstCompleted) {
          priorEntered.resolve();
          await release.promise;
        }
        return value;
      }
    }
    standAccess.installReadFilters(stand, [new WaitPrior()]);
    const firstDone = deferred();
    const delivered: string[] = [];
    const errors: Error[] = [];
    const signal = new AbortController();
    const subscription = stand.subscribe(
      ProjectOverviewStateSchema,
      {
        next: (update) => {
          if (update.kind === "state") delivered.push(update.state.name);
          firstCompleted = true;
          firstDone.resolve();
        },
        error: (error) => {
          errors.push(error);
        },
      },
      { signal: signal.signal },
    );
    await stand.update(ProjectOverviewStateSchema, state("First"));
    await firstDone.promise;
    await stand.update(ProjectOverviewStateSchema, state("Second"));
    await priorEntered.promise;
    signal.abort();
    release.resolve();
    await stand.close();
    expect(subscription.closed).toBe(true);
    expect(delivered).toEqual(["First"]);
    expect(errors).toEqual([]);
  });

  it("rejects the removed raw callback overload at subscription time", async () => {
    const stand = standWithState();
    const rawCallback = (() => undefined) as unknown as Parameters<typeof stand.subscribe>[1];
    expect(() => stand.subscribe(ProjectOverviewStateSchema, rawCallback)).toThrow(TypeError);
    await expect(stand.update(ProjectOverviewStateSchema, state("First"))).resolves.toBeUndefined();
    await stand.close();
  });

  it("does not attach an observer whose cancellation signal was already aborted", async () => {
    const stand = standWithState();
    const signal = new AbortController();
    signal.abort();
    const next = vi.fn();
    const error = vi.fn();
    const handle = stand.subscribe(
      ProjectOverviewStateSchema,
      { next, error },
      {
        signal: signal.signal,
      },
    );
    expect(handle.closed).toBe(true);
    await stand.update(ProjectOverviewStateSchema, state("First"));
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await stand.close();
  });

  it("reports a non-Error policy rejection as a local Error without losing a committed write", async () => {
    const stand = standWithState();
    class RejectInvalid extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(): Promise<ProjectOverviewState> {
        // Exercise the runtime boundary when third-party policy code rejects with a non-Error value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject("policy rejected");
      }
    }
    standAccess.installReadFilters(stand, [new RejectInvalid()]);
    const failed = deferred();
    const faults: Error[] = [];
    const handle = stand.subscribe(ProjectOverviewStateSchema, {
      next: () => {
        throw new Error("Unexpected delivery.");
      },
      error: (error) => {
        faults.push(error);
        failed.resolve();
      },
    });
    await expect(stand.update(ProjectOverviewStateSchema, state("First"))).resolves.toBeUndefined();
    await failed.promise;
    expect(faults).toHaveLength(1);
    expect(faults[0]).toBeInstanceOf(Error);
    expect(faults[0]?.message).toBe("policy rejected");
    expect(handle.closed).toBe(true);
    await expect(
      standAccess.readCurrent(stand, ProjectOverviewStateSchema, "project-1", {}),
    ).resolves.toMatchObject({ state: { name: "First" } });
    await stand.close();
  });
});
