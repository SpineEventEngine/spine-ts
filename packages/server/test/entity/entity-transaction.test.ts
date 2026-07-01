import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "../../src/index.js";
import {
  createEntityTransaction,
  EntityTransaction,
  EntityTransactionDraftStateError,
  EntityTransactionStateError,
  type EntityTransactionVersionMetadata,
} from "../../src/index.js";

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

  it("archives and unarchives only draft lifecycle metadata reflected in results", () => {
    const previous = createProjectionState();
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 2 },
    });
    const originalDraft = transaction.currentDraft;

    expect(transaction.archive()).toEqual({ archived: true, deleted: false });
    expect(transaction.currentDraft).toEqual(originalDraft);
    expect(transaction.version).toEqual({ previous: 1, draft: 2 });

    const accepted = transaction.commit();

    expect(accepted.status).toBe("accepted");
    expect(accepted.lifecycle).toEqual({ archived: true, deleted: false });

    const rollbackTransaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 2 },
      lifecycle: { archived: true },
    });

    expect(rollbackTransaction.unarchive()).toEqual({ archived: false, deleted: false });
    expect(rollbackTransaction.rollback().lifecycle).toEqual({
      archived: false,
      deleted: false,
    });
  });

  it("marks deleted and restores only draft lifecycle metadata reflected in results", () => {
    const previous = createProjectionState();
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 2 },
    });
    const originalDraft = transaction.currentDraft;

    expect(transaction.markDeleted()).toEqual({ archived: false, deleted: true });
    expect(transaction.currentDraft).toEqual(originalDraft);
    expect(transaction.version).toEqual({ previous: 1, draft: 2 });

    const accepted = transaction.commit();

    expect(accepted.status).toBe("accepted");
    expect(accepted.lifecycle).toEqual({ archived: false, deleted: true });

    const rollbackTransaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous,
      version: { previous: 1, draft: 2 },
      lifecycle: { deleted: true },
    });

    expect(rollbackTransaction.restore()).toEqual({ archived: false, deleted: false });
    expect(rollbackTransaction.rollback().lifecycle).toEqual({
      archived: false,
      deleted: false,
    });
  });

  it("requires active non-archived non-deleted draft state for active-only mutation", () => {
    const active = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });

    active.requireActive();

    const archived = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    archived.archive();

    expect(() => {
      archived.requireActive();
    }).toThrow(EntityTransactionDraftStateError);
    expect(() => {
      archived.requireActive();
    }).toThrow("Cannot mutate active entity state while the draft is archived.");
    expect(() => archived.update((draft) => ({ ...draft, name: "Archived update" }))).toThrow(
      EntityTransactionDraftStateError,
    );

    const deleted = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    deleted.markDeleted();

    expect(() => {
      deleted.requireActive();
    }).toThrow(EntityTransactionDraftStateError);
    expect(() => {
      deleted.requireActive();
    }).toThrow("Cannot mutate active entity state while the draft is deleted.");

    const committed = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    committed.commit();

    expect(() => {
      committed.requireActive();
    }).toThrow(EntityTransactionStateError);
    expect(() => {
      committed.requireActive();
    }).toThrow(/status "committed"/);

    const rolledBack = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    rolledBack.rollback();

    expect(() => {
      rolledBack.requireActive();
    }).toThrow(EntityTransactionStateError);
    expect(() => {
      rolledBack.requireActive();
    }).toThrow(/status "rolled-back"/);
  });

  it("requires active transaction status for lifecycle helper mutation", () => {
    const committed = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    committed.commit();

    expect(() => committed.archive()).toThrow(/committed/);
    expect(() => committed.unarchive()).toThrow(/committed/);
    expect(() => committed.markDeleted()).toThrow(/committed/);
    expect(() => committed.restore()).toThrow(/committed/);

    const rolledBack = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    rolledBack.rollback();

    expect(() => rolledBack.archive()).toThrow(/rolled-back/);
    expect(() => rolledBack.unarchive()).toThrow(/rolled-back/);
    expect(() => rolledBack.markDeleted()).toThrow(/rolled-back/);
    expect(() => rolledBack.restore()).toThrow(/rolled-back/);
  });

  it("updates explicit draft version metadata with preserved generic type", () => {
    interface RevisionMetadata {
      revision: number;
      source: "server";
    }
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: {
        previous: { revision: 1, source: "server" },
        draft: { revision: 1, source: "server" },
      } satisfies EntityTransactionVersionMetadata<RevisionMetadata>,
    });

    const updated = transaction.updateVersionMetadata({ revision: 2, source: "server" });

    expect(updated).toEqual({
      previous: { revision: 1, source: "server" },
      draft: { revision: 2, source: "server" },
    });
    expectTypeOf(updated.draft).toEqualTypeOf<RevisionMetadata>();

    const accepted = transaction.commit();

    expect(accepted.status).toBe("accepted");
    if (accepted.status !== "accepted") {
      throw new Error("Expected unchanged set-once state to commit successfully.");
    }
    expect(accepted.version.committed).toEqual({ revision: 2, source: "server" });
    expectTypeOf(accepted.version.committed).toEqualTypeOf<RevisionMetadata>();
  });

  it("returns updated explicit draft version metadata in rejected commit and rollback results", () => {
    const rejected = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState({ id: "task-1" }),
      version: { previous: 1, draft: 1 },
    });
    rejected.updateVersionMetadata(2);
    rejected.update((draft) => ({ ...draft, id: "task-2" }));

    const rejectedResult = rejected.commit();

    expect(rejectedResult.status).toBe("rejected");
    expect(rejectedResult.version).toEqual({ previous: 1, draft: 2 });
    expect(rejected.status).toBe("active");

    const rolledBack = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 3, draft: 3 },
    });
    rolledBack.updateVersionMetadata(4);

    expect(rolledBack.rollback().version).toEqual({ previous: 3, draft: 4 });
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

  it("preserves caller-supplied version metadata type after an accepted commit", () => {
    interface RevisionMetadata {
      revision: number;
      source: "server";
    }
    const version: EntityTransactionVersionMetadata<RevisionMetadata> = {
      previous: { revision: 1, source: "server" },
      draft: { revision: 2, source: "server" },
    };
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version,
    });

    const result = transaction.commit();

    if (result.status !== "accepted") {
      throw new Error("Expected unchanged set-once state to commit successfully.");
    }
    expect(result.version.committed).toEqual({ revision: 2, source: "server" });
    expectTypeOf(result.version.committed).toEqualTypeOf<RevisionMetadata>();
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
    });
    transaction.update((draft) => ({ ...draft, name: "Rolled back" }));
    transaction.archive();

    const result = transaction.rollback();

    expect(result.status).toBe("rolled-back");
    expect(result.previous).toEqual(previous);
    expect(result.draft).toEqual(createProjectionState({ name: "Rolled back" }));
    expect(result.version).toEqual({ previous: 3, draft: 4 });
    expect(result.lifecycle).toEqual({ archived: true, deleted: false });
    expect(transaction.status).toBe("rolled-back");
  });

  it("rejects rollback after an accepted commit", () => {
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    transaction.commit();

    expect(() => transaction.rollback()).toThrow(/committed/);
    expect(transaction.status).toBe("committed");
  });

  it("rejects rollback after rollback", () => {
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    transaction.rollback();

    expect(() => transaction.rollback()).toThrow(/rolled-back/);
    expect(transaction.status).toBe("rolled-back");
  });

  it("allows rollback after a rejected commit", () => {
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState({ id: "task-1" }),
      version: { previous: 1, draft: 2 },
    });
    transaction.update((draft) => ({ ...draft, id: "task-2" }));

    const rejected = transaction.commit();
    const rolledBack = transaction.rollback();

    expect(rejected.status).toBe("rejected");
    expect(rolledBack.draft).toEqual(createProjectionState({ id: "task-2" }));
    expect(transaction.status).toBe("rolled-back");
  });

  it("keeps status and current draft unchanged when update throws", () => {
    const transaction = createEntityTransaction({
      schema: ProjectionStateSchema,
      previous: createProjectionState(),
      version: { previous: 1, draft: 2 },
    });
    const before = transaction.currentDraft;

    expect(() =>
      transaction.update(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(transaction.status).toBe("active");
    expect(transaction.currentDraft).toEqual(before);
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
