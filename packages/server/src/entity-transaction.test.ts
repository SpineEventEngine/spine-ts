import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "./index.js";
import { createEntityTransaction, EntityTransaction } from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server entity transaction fixture descriptor set is empty.");
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

describe("entity transactions", () => {
  it("exports the public entity transaction surface from the server root", () => {
    expect(serverRoot.EntityTransaction).toBe(EntityTransaction);
    expect(serverRoot.createEntityTransaction).toBe(createEntityTransaction);
  });

  it("starts active with previous state, draft next state, version, and lifecycle defaults", () => {
    const previous = createProjectionState();
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 7, draft: 8 },
    });

    expect(transaction.status).toBe("active");
    expect(transaction.previous).toEqual(previous);
    expect(transaction.previous).not.toBe(previous);
    expect(transaction.currentDraft).toEqual(previous);
    expect(transaction.currentDraft).not.toBe(previous);
    expect(transaction.version).toEqual({ previous: 7, draft: 8 });
    expect(transaction.lifecycle).toEqual({ archived: false, deleted: false });
  });

  it("updates only the draft state and never mutates the previous state", () => {
    const previous = createProjectionState();
    const transaction = new EntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 1 },
    });

    const returnedDraft = transaction.update((draft) => ({
      ...draft,
      name: "Ready",
      priority: 2,
    }));

    expect(returnedDraft).toEqual(createProjectionState({ name: "Ready", priority: 2 }));
    expect(transaction.currentDraft).toEqual(returnedDraft);
    expect(transaction.currentDraft).not.toBe(returnedDraft);
    expect(transaction.previous).toEqual(previous);
    expect(previous).toEqual(createProjectionState());
  });

  it("returns an accepted commit result when transition validation passes", () => {
    const previous = createProjectionState();
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 2 },
    });
    transaction.update((draft) => ({ ...draft, name: "Ready", priority: 2 }));

    const result = transaction.commit();

    expect(result.status).toBe("accepted");
    expect(result.previous).toEqual(previous);
    expect(result.next).toEqual(createProjectionState({ name: "Ready", priority: 2 }));
    expect(result.version).toEqual({ previous: 1, committed: 2 });
    expect(result.lifecycle).toEqual({ archived: false, deleted: false });
    expect(transaction.status).toBe("committed");
  });

  it("returns a rejected commit result with validator violations when set-once state changes", () => {
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState({ id: "task-1" }),
      version: { previous: 1, draft: 2 },
    });
    transaction.update((draft) => ({ ...draft, id: "task-2" }));

    const result = transaction.commit();

    expect(result.status).toBe("rejected");
    expect(result.previous).toEqual(createProjectionState({ id: "task-1" }));
    expect(result.next).toEqual(createProjectionState({ id: "task-2" }));
    expect(result.version).toEqual({ previous: 1, draft: 2 });
    expect(result.lifecycle).toEqual({ archived: false, deleted: false });
    expect(result.validation.valid).toBe(false);
    if (result.validation.valid) {
      throw new Error("Expected set-once transition validation to reject the commit.");
    }
    expect(result.validation.violations[0].fieldPath?.fieldName).toEqual(["id"]);
    expect(transaction.status).toBe("active");
  });

  it("rolls back by releasing the transaction with previous and draft evidence", () => {
    const previous = createProjectionState();
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 3, draft: 4 },
      lifecycle: { archived: true, deleted: false },
    });
    transaction.update((draft) => ({ ...draft, name: "Rolled back" }));

    const result = transaction.rollback();

    expect(result.status).toBe("rolled-back");
    expect(result.previous).toEqual(previous);
    expect(result.draft).toEqual(createProjectionState({ name: "Rolled back" }));
    expect(result.version).toEqual({ previous: 3, draft: 4 });
    expect(result.lifecycle).toEqual({ archived: true, deleted: false });
    expect(transaction.status).toBe("rolled-back");
  });

  it("rejects updates and commits after commit or rollback", () => {
    const committed = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    committed.commit();

    expect(() => committed.update((draft) => draft)).toThrow(/committed/);
    expect(() => committed.commit()).toThrow(/committed/);

    const rolledBack = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    rolledBack.rollback();

    expect(() => rolledBack.update((draft) => draft)).toThrow(/rolled-back/);
    expect(() => rolledBack.commit()).toThrow(/rolled-back/);
  });
});
