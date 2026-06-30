import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "./index.js";
import {
  Aggregate,
  describeEntityMetadata,
  Entity,
  ProcessManager,
  Projection,
  TransactionalEntity,
  TransactionalEntityScopeError,
  type EntityFamily,
  type EntityOptions,
  type TransactionalEntityScopeOperation,
} from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

interface RevisionMetadata {
  readonly revision: number;
  readonly source: "server";
  readonly labels?: readonly string[];
}

interface NestedRevisionMetadata extends RevisionMetadata {
  readonly audit: {
    readonly actor: string;
    readonly checkpoints: readonly string[];
  };
  readonly history: readonly {
    readonly stage: string;
    readonly counters: readonly number[];
  }[];
}

interface SizedRevisionMetadata {
  readonly revision: number;
  readonly size: number;
}

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server entity fixture descriptor set is empty.");
  }

  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;

function createProjectionState(overrides: Partial<ProjectionState> = {}): ProjectionState {
  return create(ProjectionStateSchema, {
    id: "task-1",
    name: "Draft",
    priority: 1,
    ...overrides,
  });
}

class TestEntity extends Entity<string, typeof ProjectionStateSchema, RevisionMetadata> {
  applyState(state: ProjectionState): void {
    this.replaceState(state);
  }

  applyVersion(version: RevisionMetadata): void {
    this.replaceVersionMetadata(version);
  }

  applyLifecycle(lifecycle: { readonly archived?: boolean; readonly deleted?: boolean }): void {
    this.replaceLifecycleFlags(lifecycle);
  }
}

class NestedVersionEntity extends Entity<
  string,
  typeof ProjectionStateSchema,
  NestedRevisionMetadata
> {
  applyVersion(version: NestedRevisionMetadata): void {
    this.replaceVersionMetadata(version);
  }
}

class TestTransactionalEntity extends TransactionalEntity<
  string,
  typeof ProjectionStateSchema,
  RevisionMetadata
> {
  start(): void {
    this.startTransaction();
  }

  draft(): ProjectionState {
    return this.currentDraft();
  }

  draftVersion(): { readonly previous: RevisionMetadata; readonly draft: RevisionMetadata } {
    return this.draftVersionMetadata();
  }

  draftLifecycle(): { readonly archived: boolean; readonly deleted: boolean } {
    return this.draftLifecycleFlags();
  }

  renameDraft(name: string, priority = this.currentDraft().priority): ProjectionState {
    return this.updateDraftState((draft) => ({
      ...draft,
      name,
      priority,
    }));
  }

  changeDraftId(id: string): ProjectionState {
    return this.updateDraftState((draft) => ({
      ...draft,
      id,
    }));
  }

  reviseDraft(revision: number): {
    readonly previous: RevisionMetadata;
    readonly draft: RevisionMetadata;
  } {
    return this.updateDraftVersionMetadata({ revision, source: "server" });
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

class TestAggregate extends Aggregate<string, typeof ProjectionStateSchema, RevisionMetadata> {
  start(): void {
    this.startTransaction();
  }

  renameDraft(name: string): ProjectionState {
    return this.updateDraftState((draft) => ({
      ...draft,
      name,
    }));
  }

  reviseDraft(revision: number): void {
    this.updateDraftVersionMetadata({ revision, source: "server" });
  }

  commitForTest(): ReturnType<TestAggregate["commitTransaction"]> {
    return this.commitTransaction();
  }
}

class TestProjection extends Projection<string, typeof ProjectionStateSchema, RevisionMetadata> {}

class TestProcessManager extends ProcessManager<
  string,
  typeof ProjectionStateSchema,
  RevisionMetadata
> {}

describe("entities", () => {
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
    const initialState = createProjectionState();
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: initialState,
      version: { revision: 7, source: "server" },
    });

    initialState.name = "Caller-side mutation";

    expect(entity.id).toBe("task-1");
    expect(entity.schema).toBe(ProjectionStateSchema);
    expect(entity.metadata).toEqual(describeEntityMetadata(ProjectionStateSchema));
    expect(entity.state).toEqual(createProjectionState());
    expect(entity.state).not.toBe(initialState);
    expect(entity.version).toEqual({ revision: 7, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.isActive).toBe(true);
    expect(entity.isArchived).toBe(false);
    expect(entity.isDeleted).toBe(false);
    expect(entity.lifecycleFlagsChanged).toBe(false);
    expectTypeOf(entity.id).toEqualTypeOf<string>();
    expectTypeOf(entity.state).toEqualTypeOf<ProjectionState>();
    expectTypeOf(entity.version).toEqualTypeOf<RevisionMetadata>();
  });

  it("returns cloned Protobuf-ES state snapshots so callers cannot mutate stored state", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    const returnedState = entity.state;
    returnedState.name = "Mutated by caller";
    returnedState.priority = 99;

    expect(entity.state).toEqual(createProjectionState());
    expect(entity.state).not.toBe(returnedState);
  });

  it("keeps constructor-provided version metadata isolated from caller mutations", () => {
    const initialVersion = { revision: 1, source: "server" as const, labels: ["initial"] };
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: initialVersion,
    });

    initialVersion.revision = 2;
    initialVersion.labels.push("caller mutation");

    const returnedVersion = entity.version as unknown as {
      revision: number;
      labels: string[];
    };
    returnedVersion.revision = 3;
    returnedVersion.labels.push("getter mutation");

    expect(entity.version).toEqual({
      revision: 1,
      source: "server",
      labels: ["initial"],
    });
    expect(entity.version).not.toBe(initialVersion);
    expect(entity.version).not.toBe(returnedVersion);
  });

  it("rejects non-plain version metadata snapshots", () => {
    class ClassBackedRevision {
      revision = 1;
      source = "server" as const;
    }

    const cyclicVersion = { revision: 1, source: "server" as const } as {
      revision: number;
      source: "server";
      self?: unknown;
    };
    cyclicVersion.self = cyclicVersion;
    const symbolKeyedVersion = {
      revision: 1,
      source: "server" as const,
      [Symbol("trace")]: "caller",
    };
    const nonEnumerableVersion = { revision: 1, source: "server" as const };
    Object.defineProperty(nonEnumerableVersion, "hidden", {
      enumerable: false,
      value: "caller",
    });
    const accessorVersion = { revision: 1, source: "server" as const };
    Object.defineProperty(accessorVersion, "derived", {
      enumerable: true,
      get: () => "caller",
    });
    const invalidVersionInputs = [
      { revision: 1, source: "server" as const, clock: new Date("2026-06-29T00:00:00.000Z") },
      { revision: 1, source: "server" as const, seen: new Set(["task-1"]) },
      { revision: 1, source: "server" as const, lookup: new Map([["task-1", 1]]) },
      { revision: 1, source: "server" as const, bytes: new ArrayBuffer(1) },
      { revision: 1, source: "server" as const, bytes: new SharedArrayBuffer(1) },
      { revision: 1, source: "server" as const, bytes: new Uint8Array(new ArrayBuffer(1)) },
      {
        revision: 1,
        source: "server" as const,
        bytes: new Uint8Array(new SharedArrayBuffer(1)),
      },
      cyclicVersion,
      symbolKeyedVersion,
      nonEnumerableVersion,
      accessorVersion,
      new ClassBackedRevision(),
      () => ({ revision: 1, source: "server" as const }),
    ];

    for (const version of invalidVersionInputs) {
      expect(() => {
        new TestEntity({
          id: "task-1",
          schema: ProjectionStateSchema,
          state: createProjectionState(),
          version: version as unknown as RevisionMetadata,
        });
      }).toThrow(/plain snapshot data/);
    }

    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });
    expect(() => {
      entity.applyVersion({
        revision: 2,
        source: "server",
        bytes: new Uint8Array(new SharedArrayBuffer(1)),
      } as unknown as RevisionMetadata);
    }).toThrow(/plain snapshot data/);
  });

  it("rejects array version metadata with caller-controlled descriptor hazards", () => {
    let speciesRead = false;
    class CallerArray<T> extends Array<T> {
      static override get [Symbol.species](): ArrayConstructor {
        speciesRead = true;
        return Array;
      }
    }

    const speciesVersion = {
      revision: 1,
      source: "server" as const,
      labels: new CallerArray("initial"),
    };
    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: speciesVersion,
      });
    }).toThrow(/plain snapshot data/);
    expect(speciesRead).toBe(false);

    let accessorRead = false;
    const accessorLabels = ["initial"];
    Object.defineProperty(accessorLabels, "0", {
      enumerable: true,
      get: () => {
        accessorRead = true;
        return "caller";
      },
    });
    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: { revision: 1, source: "server", labels: accessorLabels },
      });
    }).toThrow(/plain snapshot data/);
    expect(accessorRead).toBe(false);

    const customPropertyLabels = ["initial"] as string[] & { extra?: string };
    customPropertyLabels.extra = "caller";
    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: { revision: 1, source: "server", labels: customPropertyLabels },
      });
    }).toThrow(/plain snapshot data/);
  });

  it("clones JSON __proto__ version metadata without mutating clone prototypes", () => {
    const version = JSON.parse(
      '{"revision":1,"source":"server","__proto__":{"polluted":true}}',
    ) as RevisionMetadata & { readonly __proto__: { readonly polluted: true } };

    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version,
    });

    const returnedVersion = entity.version as RevisionMetadata & {
      readonly __proto__: { readonly polluted: true };
    };
    expect(Object.prototype.hasOwnProperty.call(returnedVersion, "__proto__")).toBe(true);
    expect(returnedVersion.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(returnedVersion)).toBe(Object.prototype);
    expect(({} as { readonly polluted?: true }).polluted).toBeUndefined();
  });

  it("does not invoke caller-controlled constructor getters while labeling rejected metadata", () => {
    let constructorRead = false;
    const rejectedVersion = Object.create({ arbitrary: true }) as RevisionMetadata;
    Object.defineProperty(rejectedVersion, "constructor", {
      enumerable: true,
      get: () => {
        constructorRead = true;
        return { name: "CallerControlled" };
      },
    });

    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: rejectedVersion,
      });
    }).toThrow(/plain snapshot data/);
    expect(constructorRead).toBe(false);
  });

  it("rejects proxy version metadata without invoking traps", () => {
    let trapInvoked = false;
    const trap = () => {
      trapInvoked = true;
      throw new Error("proxy trap invoked");
    };
    const proxiedVersion = new Proxy(
      { revision: 1, source: "server" as const },
      {
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
        ownKeys: trap,
        get: trap,
        has: trap,
      },
    );

    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: proxiedVersion,
      });
    }).toThrow(/plain snapshot data/);
    expect(trapInvoked).toBe(false);
  });

  it("rejects excessively deep plain version metadata with the domain error", () => {
    let deepVersion: unknown = { revision: 1, source: "server" };
    for (let index = 0; index < 20_000; index += 1) {
      deepVersion = { child: deepVersion };
    }

    expect(() => {
      new TestEntity({
        id: "task-1",
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: deepVersion as RevisionMetadata,
      });
    }).toThrow(/plain snapshot data/);
  });

  it("constrains entity version generics to plain metadata at compile time", () => {
    expectTypeOf<TestEntity["version"]>().toEqualTypeOf<RevisionMetadata>();
    expectTypeOf<
      EntityOptions<string, typeof ProjectionStateSchema, SizedRevisionMetadata>["version"]
    >().toEqualTypeOf<SizedRevisionMetadata>();

    const dateVersionOptions: EntityOptions<string, typeof ProjectionStateSchema, Date> = {
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      // @ts-expect-error Date is non-plain metadata and must be rejected by EntityOptions.
      version: new Date("2026-06-29T00:00:00.000Z"),
    };

    expectTypeOf(dateVersionOptions).not.toBeAny();
  });

  it("keeps nested plain version metadata isolated through construction, reads, and replacement", () => {
    const initialVersion = {
      revision: 1,
      source: "server" as const,
      audit: { actor: "creator", checkpoints: ["created"] },
      history: [{ stage: "draft", counters: [1] }],
    };
    const entity = new NestedVersionEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: initialVersion,
    });

    initialVersion.audit.actor = "caller";
    initialVersion.audit.checkpoints.push("caller mutation");
    initialVersion.history[0]?.counters.push(2);

    const returnedInitialVersion = entity.version as unknown as {
      audit: { actor: string; checkpoints: string[] };
      history: { counters: number[] }[];
    };
    returnedInitialVersion.audit.actor = "getter";
    returnedInitialVersion.audit.checkpoints.push("getter mutation");
    returnedInitialVersion.history[0]?.counters.push(3);

    expect(entity.version).toEqual({
      revision: 1,
      source: "server",
      audit: { actor: "creator", checkpoints: ["created"] },
      history: [{ stage: "draft", counters: [1] }],
    });

    const replacementVersion = {
      revision: 2,
      source: "server" as const,
      audit: { actor: "approver", checkpoints: ["accepted"] },
      history: [{ stage: "ready", counters: [5] }],
    };
    entity.applyVersion(replacementVersion);

    replacementVersion.audit.actor = "caller";
    replacementVersion.audit.checkpoints.push("caller mutation");
    replacementVersion.history[0]?.counters.push(6);

    const returnedReplacementVersion = entity.version as unknown as {
      audit: { actor: string; checkpoints: string[] };
      history: { counters: number[] }[];
    };
    returnedReplacementVersion.audit.actor = "getter";
    returnedReplacementVersion.audit.checkpoints.push("getter mutation");
    returnedReplacementVersion.history[0]?.counters.push(7);

    expect(entity.version).toEqual({
      revision: 2,
      source: "server",
      audit: { actor: "approver", checkpoints: ["accepted"] },
      history: [{ stage: "ready", counters: [5] }],
    });
    expect(entity.version).not.toBe(replacementVersion);
    expect(entity.version).not.toBe(returnedReplacementVersion);
  });

  it("tracks lifecycle flags and keeps lifecycle-change tracking sticky after protected changes", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
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
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
      lifecycle: { deleted: true },
    });

    entity.applyLifecycle({});
    entity.applyLifecycle({ deleted: true });

    expect(entity.lifecycle).toEqual({ archived: false, deleted: true });
    expect(entity.isActive).toBe(false);
    expect(entity.lifecycleFlagsChanged).toBe(false);
  });

  it("lets protected subclass code replace state and caller-owned version metadata without auto-increments", () => {
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.applyState(createProjectionState({ name: "Ready", priority: 2 }));
    entity.applyVersion({ revision: 99, source: "server" });

    expect(entity.state).toEqual(createProjectionState({ name: "Ready", priority: 2 }));
    expect(entity.version).toEqual({ revision: 99, source: "server" });
    expect(entity.lifecycleFlagsChanged).toBe(false);
  });

  it("keeps protected version metadata replacements isolated from caller mutations", () => {
    const replacementVersion = { revision: 2, source: "server" as const, labels: ["accepted"] };
    const entity = new TestEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.applyVersion(replacementVersion);

    replacementVersion.revision = 3;
    replacementVersion.labels.push("caller mutation");

    const returnedVersion = entity.version as unknown as {
      revision: number;
      labels: string[];
    };
    returnedVersion.revision = 4;
    returnedVersion.labels.push("getter mutation");

    expect(entity.version).toEqual({
      revision: 2,
      source: "server",
      labels: ["accepted"],
    });
    expect(entity.version).not.toBe(replacementVersion);
    expect(entity.version).not.toBe(returnedVersion);
  });

  it("requires one active transactional entity scope for draft helpers", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
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

  it("commits accepted draft state, version metadata, and lifecycle flags back to the entity", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.start();
    const returnedDraft = entity.renameDraft("Ready", 2);
    returnedDraft.name = "Caller-side draft mutation";
    entity.reviseDraft(2);
    entity.archiveDraftForTest();

    expect(entity.state).toEqual(createProjectionState());
    expect(entity.version).toEqual({ revision: 1, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);

    const result = entity.commitForTest();

    expect(result.status).toBe("accepted");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectionState({ name: "Ready", priority: 2 }));
    expect(entity.version).toEqual({ revision: 2, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: true, deleted: false });
    expect(entity.lifecycleFlagsChanged).toBe(true);
    expect(entity.changed).toBe(true);
  });

  it("keeps rejected commits active and does not apply state, version, or lifecycle", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.start();
    entity.changeDraftId("task-2");
    entity.reviseDraft(2);
    entity.markDraftDeletedForTest();

    const rejected = entity.commitForTest();

    expect(rejected.status).toBe("rejected");
    expect(entity.hasActiveTransaction()).toBe(true);
    expect(entity.state).toEqual(createProjectionState());
    expect(entity.version).toEqual({ revision: 1, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);

    entity.restoreDraftForTest();
    entity.changeDraftId("task-1");
    entity.renameDraft("Recovered", 3);
    entity.reviseDraft(3);

    const accepted = entity.commitForTest();

    expect(accepted.status).toBe("accepted");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectionState({ name: "Recovered", priority: 3 }));
    expect(entity.version).toEqual({ revision: 3, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(true);
  });

  it("keeps rejected commit version results isolated from the active transaction", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.start();
    entity.changeDraftId("task-2");
    entity.reviseDraft(2);

    const rejected = entity.commitForTest();

    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("Expected the first transaction commit to be rejected.");
    }
    expect(entity.hasActiveTransaction()).toBe(true);

    const rejectedVersion = rejected.version as unknown as {
      draft: { revision: number; labels?: string[] };
    };
    rejectedVersion.draft.revision = 99;
    rejectedVersion.draft.labels = ["caller mutation"];

    entity.changeDraftId("task-1");
    entity.renameDraft("Recovered", 3);

    const accepted = entity.commitForTest();

    expect(accepted.status).toBe("accepted");
    expect(entity.version).toEqual({ revision: 2, source: "server" });
  });

  it("rolls back active transactional entity drafts without applying them", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.start();
    entity.renameDraft("Discarded", 9);
    entity.reviseDraft(9);
    entity.archiveDraftForTest();

    const result = entity.rollbackForTest();

    expect(result.status).toBe("rolled-back");
    expect(entity.hasActiveTransaction()).toBe(false);
    expect(entity.state).toEqual(createProjectionState());
    expect(entity.version).toEqual({ revision: 1, source: "server" });
    expect(entity.lifecycle).toEqual({ archived: false, deleted: false });
    expect(entity.changed).toBe(false);
    expect(() => entity.commitForTest()).toThrow(TransactionalEntityScopeError);
  });

  it("keeps public snapshots isolated while a transaction draft is active", () => {
    const entity = new TestTransactionalEntity({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    entity.start();
    const draft = entity.draft();
    draft.name = "Caller-side mutation";
    const version = entity.draftVersion() as {
      draft: { revision: number };
    };
    version.draft.revision = 99;

    expect(entity.draft()).toEqual(createProjectionState());
    expect(entity.draftVersion()).toEqual({
      previous: { revision: 1, source: "server" },
      draft: { revision: 1, source: "server" },
    });
    expect(entity.state).toEqual(createProjectionState());
    expect(entity.version).toEqual({ revision: 1, source: "server" });
  });

  it("marks aggregate, projection, and process manager families with stable identity", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });
    const projection = new TestProjection({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });
    const processManager = new TestProcessManager({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
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
      TransactionalEntity<string, typeof ProjectionStateSchema, RevisionMetadata>
    >();
    expectTypeOf<TestProjection>().toExtend<
      TransactionalEntity<string, typeof ProjectionStateSchema, RevisionMetadata>
    >();
    expectTypeOf<TestProcessManager>().toExtend<
      TransactionalEntity<string, typeof ProjectionStateSchema, RevisionMetadata>
    >();
    expectTypeOf<TestAggregate["entityFamily"]>().toExtend<EntityFamily>();
  });

  it("keeps family marker accessors stable under runtime reassignment attempts", () => {
    const aggregate = new TestAggregate({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });
    const projection = new TestProjection({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });
    const processManager = new TestProcessManager({
      id: "task-1",
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
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
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
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
        schema: ProjectionStateSchema,
        state: createProjectionState(),
        version: { revision: 1, source: "server" },
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
      schema: ProjectionStateSchema,
      state: createProjectionState(),
      version: { revision: 1, source: "server" },
    });

    aggregate.start();
    const returnedDraft = aggregate.renameDraft("Ready");
    returnedDraft.name = "Caller-side draft mutation";
    aggregate.reviseDraft(2);

    expect(aggregate.state).toEqual(createProjectionState());
    expect(aggregate.version).toEqual({ revision: 1, source: "server" });
    expect(aggregate.changed).toBe(false);

    const result = aggregate.commitForTest();

    expect(result.status).toBe("accepted");
    expect(aggregate.state).toEqual(createProjectionState({ name: "Ready" }));
    expect(aggregate.version).toEqual({ revision: 2, source: "server" });
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
});
