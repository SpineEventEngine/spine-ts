import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "./index.js";
import { describeEntityMetadata, Entity } from "./index.js";

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

describe("entities", () => {
  it("exports the common entity base class from the server root", () => {
    expect(serverRoot.Entity).toBe(Entity);
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
});
