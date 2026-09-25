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
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { VersionSchema, type Version } from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as serverRoot from "../../src/index.js";
import {
  Aggregate,
  describeEntityMetadata,
  Entity,
  ProcessManager,
  Projection,
  TransactionalEntity,
  TransactionalEntityScopeError,
  type EntityFamily,
  type TransactionalEntityScopeOperation,
} from "../../src/index.js";
import { entityHistoryAccess } from "../../src/entity/entity.js";

// @ts-expect-error EntityStorageInput is an internal repository/runtime seam, not a root storage export.
import type { EntityStorageInput } from "@spine-event-engine/storage";

/**
 * Compile-only negative declaration fixtures for intentionally absent APIs.
 */
function verifyHistoryDeclarationAbsence(projection: TestProjection): void {
  // @ts-expect-error Projection deliberately has no event-history API.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  void projection.eventHistoryBackward(1);
  // @ts-expect-error Projection deliberately has no event-history predicate.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  void projection.eventHistoryContains(1, () => true);
  // @ts-expect-error Projection deliberately has no event-history maintenance API.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  void projection.eventStorage();
  // @ts-expect-error The removed maintenance spelling is not a protected API.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  void projection.eventHistoryStorage();
  // @ts-expect-error AggregateStorage was removed from the root server API.
  void serverRoot.AggregateStorage;
  // @ts-expect-error ReplayError was removed from the root server API.
  void serverRoot.ReplayError;
  void (null as unknown as EntityStorageInput);
}

import {
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

function createProjectOverviewState(
  overrides: Partial<ProjectOverviewState> = {},
): ProjectOverviewState {
  return create(ProjectOverviewStateSchema, {
    id: "task-1",
    name: "Draft",
    priority: 1,
    ...overrides,
  });
}

class TestEntity extends Entity<string, typeof ProjectOverviewStateSchema> {
  applyState(state: ProjectOverviewState): void {
    this.replaceState(state);
  }

  applyLifecycle(lifecycle: { readonly archived?: boolean; readonly deleted?: boolean }): void {
    this.replaceLifecycleFlags(lifecycle);
  }
}

class TestTransactionalEntity extends TransactionalEntity<
  string,
  typeof ProjectOverviewStateSchema
> {
  start(): void {
    this.startTransaction();
  }

  draft(): ProjectOverviewState {
    return this.currentDraft();
  }

  draftLifecycle(): { readonly archived: boolean; readonly deleted: boolean } {
    return this.draftLifecycleFlags();
  }

  renameDraft(name: string, priority = this.currentDraft().priority): ProjectOverviewState {
    return this.update((draft) => {
      draft.name = name;
      draft.priority = priority;
    });
  }

  changeDraftId(id: string): ProjectOverviewState {
    return this.update((draft) => {
      draft.id = id;
    });
  }

  tryRenameDraft(name: string): readonly import("@spine-event-engine/proto").ConstraintViolation[] {
    return this.tryUpdate((draft) => {
      draft.name = name;
    });
  }

  tryChangeDraftId(id: string): readonly import("@spine-event-engine/proto").ConstraintViolation[] {
    return this.tryUpdate((draft) => {
      draft.id = id;
    });
  }

  archiveDraftForTest(): void {
    this.archiveDraft();
  }

  unarchiveDraftForTest(): void {
    this.unarchiveDraft();
  }

  markDraftDeletedForTest(): void {
    this.markDraftDeleted();
  }

  restoreDraftForTest(): void {
    this.restoreDraft();
  }

  commitForTest(): ReturnType<TestTransactionalEntity["commitTransaction"]> {
    return this.commitTransaction();
  }

  rollbackForTest(): ReturnType<TestTransactionalEntity["rollbackTransaction"]> {
    return this.rollbackTransaction();
  }

  hasActiveTransaction(): boolean {
    return this.isTransactionInProgress();
  }
}

class GetterCountingTransactionalEntity extends TestTransactionalEntity {
  stateReads = 0;

  override get state(): ProjectOverviewState {
    this.stateReads += 1;
    return super.state;
  }
}

class TestAggregate extends Aggregate<string, typeof ProjectOverviewStateSchema> {
  start(): void {
    this.startTransaction();
  }

  renameDraft(name: string): ProjectOverviewState {
    return this.update((draft) => {
      draft.name = name;
    });
  }

  commitForTest(): ReturnType<TestAggregate["commitTransaction"]> {
    return this.commitTransaction();
  }

  historyStatesForTest(depth: number) {
    return this.stateHistoryBackward(depth);
  }

  stateAtForTest(time: Timestamp) {
    return this.stateAt(time);
  }

  historyEventsForTest(depth: number) {
    return this.eventHistoryBackward(depth);
  }

  stateHistoryMaintenanceForTest() {
    return this.stateHistoryStorage();
  }

  eventHistoryMaintenanceForTest() {
    return this.eventStorage();
  }

  eventHistoryContainsForTest(
    depth: number,
    predicate: (event: Readonly<import("@spine-event-engine/proto").Event>) => boolean,
  ) {
    return this.eventHistoryContains(depth, predicate);
  }
}

class TestProjection extends Projection<string, typeof ProjectOverviewStateSchema> {}

class TestProcessManager extends ProcessManager<string, typeof ProjectOverviewStateSchema> {
  historyEventsForTest(depth: number) {
    return this.eventHistoryBackward(depth);
  }

  eventHistoryMaintenanceForTest() {
    return this.eventStorage();
  }
}

describe("entities", () => {
  it("starts at Spine Version zero and isolates restored version snapshots", () => {
    const initialVersion = create(VersionSchema, { number: 7 });
    const fresh = new TestEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
    });
    const restored = new TestEntity({
      id: "task-2",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState({ id: "task-2" }),
      version: initialVersion,
    });

    expect(fresh.version.number).toBe(0);
    initialVersion.number = 9;
    const snapshot = restored.version;
    snapshot.number = 11;
    expect(restored.version.number).toBe(7);
  });

  it("exports the common entity base class from the server root", () => {
    expect(serverRoot.Entity).toBe(Entity);
  });

  it("exports the transactional entity base class and scope error from the server root", () => {
    expect(serverRoot.TransactionalEntity).toBe(TransactionalEntity);
    expect(serverRoot.TransactionalEntityScopeError).toBe(TransactionalEntityScopeError);
  });

  it("exports entity family marker classes from the server root", () => {
    expect(serverRoot.Aggregate).toBe(Aggregate);
    expect(serverRoot.Projection).toBe(Projection);
    expect(serverRoot.ProcessManager).toBe(ProcessManager);
  });

  it("exposes identity, descriptor metadata, state snapshots, version, and active lifecycle defaults", () => {
    const initialState = createProjectOverviewState();
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: initialState,
      version: create(VersionSchema, { number: 7 }),
    });

    initialState.name = "Caller-side mutation";

    expect(entity.id).toBe("task-1");
    expect(entity.schema).toBe(ProjectOverviewStateSchema);
    expect(entity.metadata).toEqual(describeEntityMetadata(ProjectOverviewStateSchema));
    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.state).not.toBe(initialState);
    expect(entity.version).toMatchObject({ number: 7 });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.isActive).toBe(true);
    expect(entity.isArchived).toBe(false);
    expect(entity.isDeleted).toBe(false);
    expect(entity.lifecycleFlagsChanged).toBe(false);
    expectTypeOf(entity.id).toEqualTypeOf<string>();
    expectTypeOf(entity.state).toEqualTypeOf<ProjectOverviewState>();
    expectTypeOf(entity.version).toEqualTypeOf<Version>();
  });

  it("returns cloned Protobuf-ES state snapshots so callers cannot mutate stored state", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    const returnedState = entity.state;
    returnedState.name = "Mutated by caller";
    returnedState.priority = 99;

    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.state).not.toBe(returnedState);
  });

  it("does not expose a stored-state reader on the exported entity base prototype", () => {
    expect("withStoredState" in Entity.prototype).toBe(false);
  });

  it("tracks lifecycle flags and keeps lifecycle-change tracking sticky after protected changes", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
      lifecycle: { archived: true },
    });

    expect(entity.lifecycle).toEqual({ archived: true, deleted: false });
    expect(entity.isActive).toBe(false);
    expect(entity.isArchived).toBe(true);
    expect(entity.isDeleted).toBe(false);
    expect(entity.lifecycleFlagsChanged).toBe(false);

    const returnedLifecycle = entity.lifecycle as { archived: boolean };
    returnedLifecycle.archived = false;

    expect(entity.lifecycle).toEqual({ archived: true, deleted: false });

    entity.applyLifecycle({ archived: false, deleted: true });

    expect(entity.lifecycle).toEqual({ archived: false, deleted: true });
    expect(entity.isActive).toBe(false);
    expect(entity.isArchived).toBe(false);
    expect(entity.isDeleted).toBe(true);
    expect(entity.lifecycleFlagsChanged).toBe(true);

    entity.applyLifecycle({ archived: true, deleted: false });

    expect(entity.lifecycle).toEqual({ archived: true, deleted: false });
    expect(entity.lifecycleFlagsChanged).toBe(true);
  });

  it("keeps lifecycle-change tracking false for no-op protected lifecycle replacements", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
      lifecycle: { deleted: true },
    });

    entity.applyLifecycle({});
    entity.applyLifecycle({ deleted: true });

    expect(entity.lifecycle).toEqual({ archived: false, deleted: true });
    expect(entity.isActive).toBe(false);
    expect(entity.lifecycleFlagsChanged).toBe(false);
  });

  it("requires one active transactional entity scope for draft helpers", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    expect(entity.hasActiveTransaction()).toBe(false);
    expect(() => entity.draft()).toThrow(TransactionalEntityScopeError);
    expect(() => entity.draft()).toThrow(/requires an active transaction/);

    entity.start();

    expect(entity.hasActiveTransaction()).toBe(true);
    expect(() => {
      entity.start();
    }).toThrow(TransactionalEntityScopeError);
    expect(() => {
      entity.start();
    }).toThrow(/already has an active transaction/);
  });

  it("starts transactions from the public state snapshot boundary", () => {
    const entity = new GetterCountingTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    entity.start();

    expect(entity.stateReads).toBe(1);
    expect(entity.draft()).toEqual(createProjectOverviewState());
  });

  it("exposes protected tryUpdate with atomic validation failures", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    expect(() => entity.tryRenameDraft("Outside transaction")).toThrow(
      TransactionalEntityScopeError,
    );

    entity.start();
    expect(entity.tryRenameDraft("Validated")).toEqual([]);
    const violations = entity.tryChangeDraftId("task-2");

    expect(Object.isFrozen(violations)).toBe(true);
    expect(violations).not.toEqual([]);
    expect(entity.draft()).toEqual(createProjectOverviewState({ name: "Validated" }));
  });

  it("commits accepted draft state, version metadata, and lifecycle flags back to the entity", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    entity.start();
    const returnedDraft = entity.renameDraft("Ready", 2);
    returnedDraft.name = "Caller-side draft mutation";
    entity.archiveDraftForTest();

    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.version).toMatchObject({ number: 1 });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);

    const result = entity.commitForTest();

    expect(result.status).toBe("accepted");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectOverviewState({ name: "Ready", priority: 2 }));
    expect(entity.version).toMatchObject({ number: 2 });
    expect(entity.lifecycle).toEqual({ archived: true, deleted: false });
    expect(entity.lifecycleFlagsChanged).toBe(true);
    expect(entity.changed).toBe(true);
  });

  it("keeps rejected commits active and does not apply state, version, or lifecycle", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    entity.start();
    entity.changeDraftId("task-2");
    entity.markDraftDeletedForTest();

    const rejected = entity.commitForTest();

    expect(rejected.status).toBe("rejected");
    expect(entity.hasActiveTransaction()).toBe(true);
    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.version).toMatchObject({ number: 1 });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);

    entity.restoreDraftForTest();
    entity.changeDraftId("task-1");
    entity.renameDraft("Recovered", 3);

    const accepted = entity.commitForTest();

    expect(accepted.status).toBe("accepted");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectOverviewState({ name: "Recovered", priority: 3 }));
    expect(entity.version).toMatchObject({ number: 2 });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(true);
  });

  it("rolls back active transactional entity drafts without applying them", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    entity.start();
    entity.renameDraft("Discarded", 9);
    entity.archiveDraftForTest();

    const result = entity.rollbackForTest();

    expect(result.status).toBe("rolled-back");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.version).toMatchObject({ number: 1 });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);
    expect(() => entity.commitForTest()).toThrow(TransactionalEntityScopeError);
  });

  it("keeps public snapshots isolated while a transaction draft is active", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    entity.start();
    const draft = entity.draft();
    draft.name = "Caller-side mutation";
    const version = entity.version;
    version.number = 99;

    expect(entity.draft()).toEqual(createProjectOverviewState());
    expect(entity.state).toEqual(createProjectOverviewState());
    expect(entity.version).toMatchObject({ number: 1 });
  });

  it("marks aggregate, projection, and process manager families with stable identity", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const projection = new TestProjection({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const processManager = new TestProcessManager({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    expect(aggregate).toBeInstanceOf(TransactionalEntity);
    expect(projection).toBeInstanceOf(TransactionalEntity);
    expect(processManager).toBeInstanceOf(TransactionalEntity);
    expect(aggregate.entityFamily).toBe("aggregate");
    expect(projection.entityFamily).toBe("projection");
    expect(processManager.entityFamily).toBe("process-manager");
    expectTypeOf(aggregate.entityFamily).toEqualTypeOf<"aggregate">();
    expectTypeOf(projection.entityFamily).toEqualTypeOf<"projection">();
    expectTypeOf(processManager.entityFamily).toEqualTypeOf<"process-manager">();
    expectTypeOf<TestAggregate>().toExtend<
      TransactionalEntity<string, typeof ProjectOverviewStateSchema>
    >();
    expectTypeOf<TestProjection>().toExtend<
      TransactionalEntity<string, typeof ProjectOverviewStateSchema>
    >();
    expectTypeOf<TestProcessManager>().toExtend<
      TransactionalEntity<string, typeof ProjectOverviewStateSchema>
    >();
    expectTypeOf<TestAggregate["entityFamily"]>().toExtend<EntityFamily>();
  });

  it("keeps family marker accessors stable under runtime reassignment attempts", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const projection = new TestProjection({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const processManager = new TestProcessManager({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    expect(Reflect.set(aggregate, "entityFamily", "projection")).toBe(false);
    expect(Reflect.set(projection, "entityFamily", "aggregate")).toBe(false);
    expect(Reflect.set(processManager, "entityFamily", "aggregate")).toBe(false);
    expect(() => {
      Object.defineProperty(aggregate, "entityFamily", { value: "projection" });
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(projection, "entityFamily", { value: "aggregate" });
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(processManager, "entityFamily", { value: "aggregate" });
    }).toThrow(TypeError);
    expect(aggregate.entityFamily).toBe("aggregate");
    expect(projection.entityFamily).toBe("projection");
    expect(processManager.entityFamily).toBe("process-manager");
  });

  it("installs locked own family markers that ignore prototype descriptor tampering", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const originalAggregatePrototypeDescriptor = Object.getOwnPropertyDescriptor(
      Aggregate.prototype,
      "entityFamily",
    );

    expect(Object.getOwnPropertyDescriptor(aggregate, "entityFamily")).toMatchObject({
      configurable: false,
      enumerable: false,
      value: "aggregate",
      writable: false,
    });

    try {
      Object.defineProperty(Aggregate.prototype, "entityFamily", {
        configurable: true,
        value: "projection",
      });

      const laterAggregate = new TestAggregate({
        id: "task-2",
        schema: ProjectOverviewStateSchema,
        state: createProjectOverviewState(),
        version: create(VersionSchema, { number: 1 }),
      });

      expect(aggregate.entityFamily).toBe("aggregate");
      expect(laterAggregate.entityFamily).toBe("aggregate");
    } finally {
      if (originalAggregatePrototypeDescriptor === undefined) {
        delete (Aggregate.prototype as { entityFamily?: unknown }).entityFamily;
      } else {
        Object.defineProperty(
          Aggregate.prototype,
          "entityFamily",
          originalAggregatePrototypeDescriptor,
        );
      }
    }
  });

  it("preserves transactional entity behavior through family marker classes", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    aggregate.start();
    const returnedDraft = aggregate.renameDraft("Ready");
    returnedDraft.name = "Caller-side draft mutation";

    expect(aggregate.state).toEqual(createProjectOverviewState());
    expect(aggregate.version).toMatchObject({ number: 1 });
    expect(aggregate.changed).toBe(false);

    const result = aggregate.commitForTest();

    expect(result.status).toBe("accepted");
    expect(aggregate.state).toEqual(createProjectOverviewState({ name: "Ready" }));
    expect(aggregate.version).toMatchObject({ number: 2 });
    expect(aggregate.changed).toBe(true);
  });

  it("keeps transaction mutators off the public family class types", () => {
    type PublicAggregateTransactionOperations = Extract<
      keyof TestAggregate,
      TransactionalEntityScopeOperation
    >;
    type PublicProjectionTransactionOperations = Extract<
      keyof TestProjection,
      TransactionalEntityScopeOperation
    >;
    type PublicProcessManagerTransactionOperations = Extract<
      keyof TestProcessManager,
      TransactionalEntityScopeOperation
    >;

    expectTypeOf<PublicAggregateTransactionOperations>().toBeNever();
    expectTypeOf<PublicProjectionTransactionOperations>().toBeNever();
    expectTypeOf<PublicProcessManagerTransactionOperations>().toBeNever();
  });

  it("keeps the per-family history declarations protected and readonly", () => {
    expectTypeOf<ReturnType<TestAggregate["stateAtForTest"]>>().toEqualTypeOf<
      Promise<Readonly<ProjectOverviewState> | undefined>
    >();
    expectTypeOf<ReturnType<TestAggregate["historyStatesForTest"]>>().toEqualTypeOf<
      Promise<readonly Readonly<ProjectOverviewState>[]>
    >();
    expectTypeOf<ReturnType<TestAggregate["historyEventsForTest"]>>().toEqualTypeOf<
      Promise<readonly Readonly<import("@spine-event-engine/proto").Event>[]>
    >();
    expectTypeOf<ReturnType<TestProcessManager["historyEventsForTest"]>>().toEqualTypeOf<
      Promise<readonly Readonly<import("@spine-event-engine/proto").Event>[]>
    >();
    expectTypeOf<Parameters<TestAggregate["eventHistoryContainsForTest"]>[1]>().toEqualTypeOf<
      (event: Readonly<import("@spine-event-engine/proto").Event>) => boolean
    >();
    expectTypeOf<TestAggregate>().not.toHaveProperty("stateHistoryBackward");
    expectTypeOf<TestAggregate>().not.toHaveProperty("eventHistoryBackward");
    expectTypeOf<TestProjection>().not.toHaveProperty("eventHistoryBackward");
    expectTypeOf<TestProjection>().not.toHaveProperty("eventStorage");
    expectTypeOf<ReturnType<TestAggregate["stateHistoryMaintenanceForTest"]>>().toHaveProperty(
      "trim",
    );
    expectTypeOf<ReturnType<TestAggregate["stateHistoryMaintenanceForTest"]>>().toHaveProperty(
      "truncate",
    );
    expectTypeOf<ReturnType<TestAggregate["eventHistoryMaintenanceForTest"]>>().toHaveProperty(
      "truncate",
    );
    expectTypeOf<ReturnType<TestAggregate["eventHistoryMaintenanceForTest"]>>().not.toHaveProperty(
      "trim",
    );
    expectTypeOf<ReturnType<TestProcessManager["eventHistoryMaintenanceForTest"]>>().toHaveProperty(
      "truncate",
    );

    void verifyHistoryDeclarationAbsence;
    void TimestampSchema;
  });

  it("rejects protected history reads outside repository execution", () => {
    const aggregate = new TestAggregate({
      id: "task-history-unbound",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    const processManager = new TestProcessManager({
      id: "pm-history-unbound",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });

    expect(() => aggregate.stateAtForTest(create(TimestampSchema))).toThrow(
      "Entity history is available only from repository execution.",
    );
    expect(() => aggregate.historyStatesForTest(1)).toThrow(
      "Entity history is available only from repository execution.",
    );
    expect(() => aggregate.historyEventsForTest(1)).toThrow(
      "Entity history is available only from repository execution.",
    );
    expect(() => processManager.historyEventsForTest(1)).toThrow(
      "Entity history is available only from repository execution.",
    );
  });

  it("rejects invalid protected history depths before repository access", () => {
    const aggregate = new TestAggregate({
      id: "task-history-depth",
      schema: ProjectOverviewStateSchema,
      state: createProjectOverviewState(),
      version: create(VersionSchema, { number: 1 }),
    });
    entityHistoryAccess.bind(aggregate, {
      stateAt: () => Promise.resolve(undefined),
      states: () => Promise.resolve([]),
      events: () => Promise.resolve([]),
      stateMaintenance: undefined as never,
      eventMaintenance: undefined as never,
    });

    for (const depth of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => aggregate.historyStatesForTest(depth)).toThrow(
        "Entity history depth must be a positive safe integer.",
      );
      expect(() => aggregate.historyEventsForTest(depth)).toThrow(
        "Entity history depth must be a positive safe integer.",
      );
    }
  });
});
