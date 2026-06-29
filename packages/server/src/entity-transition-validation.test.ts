import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "./index.js";
import { validateEntityStateTransition } from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type GenericState = Message<"GenericState"> & {
  id: string;
  searchable: string;
};

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server entity transition validation fixture descriptor set is empty.");
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
const GenericStateSchema = messageDesc(fileEntityMetadataFixture, 2) as GenMessage<GenericState>;

describe("entity state transition validation", () => {
  it("exports the public high-level entity state transition validator", () => {
    expect(serverRoot.validateEntityStateTransition).toBe(validateEntityStateTransition);
  });

  it("allows creation transitions to initialize set-once fields", () => {
    const next = create(ProjectionStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectionStateSchema,
        previous: undefined,
        next,
      }),
    ).toMatchInlineSnapshot(`
      {
        "error": undefined,
        "valid": true,
        "violations": [],
      }
    `);
  });

  it("allows existing-state transitions when set-once values are unchanged", () => {
    const previous = create(ProjectionStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectionStateSchema, {
      id: "task-1",
      name: "Ready",
      priority: 2,
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectionStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects existing-state transitions when a set-once field changes without leaking values", () => {
    const previous = create(ProjectionStateSchema, {
      id: "private-previous-id",
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectionStateSchema, {
      id: "private-next-id",
      name: "Draft",
      priority: 1,
    });

    const result = validateEntityStateTransition({
      schema: ProjectionStateSchema,
      previous,
      next,
    });

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected set-once transition validation to fail.");
    }

    const [violation] = result.violations;

    expect(violation.typeName).toBe("ProjectionState");
    expect(violation.fieldPath?.fieldName).toEqual(["id"]);
    expect(violation.fieldValue).toBeUndefined();
    expect(result.error.$typeName).toBe("spine.validation.ValidationError");
    expect(result.error.constraintViolation).toEqual(result.violations);
    expect(JSON.stringify(result)).not.toContain("private-previous-id");
    expect(JSON.stringify(result)).not.toContain("private-next-id");
  });

  it("passes when an entity schema has no set-once fields", () => {
    const previous = create(GenericStateSchema, {
      id: "generic-1",
      searchable: "before",
    });
    const next = create(GenericStateSchema, {
      id: "generic-2",
      searchable: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: GenericStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("compares protobuf-shaped set-once values by content", () => {
    expect(validateForgedSetOnceId(new Uint8Array([1, 2]), new Uint8Array([1, 2])).valid).toBe(
      true,
    );
    expect(validateForgedSetOnceId(new Uint8Array([1, 2]), new Uint8Array([1, 3])).valid).toBe(
      false,
    );
    expect(validateForgedSetOnceId(["a", "b"], ["a", "b"]).valid).toBe(true);
    expect(validateForgedSetOnceId(["a"], ["a", "b"]).valid).toBe(false);
    expect(
      validateForgedSetOnceId(
        { nested: { value: "same" }, unordered: ["a", "b"] },
        { unordered: ["a", "b"], nested: { value: "same" } },
      ).valid,
    ).toBe(true);
    expect(validateForgedSetOnceId({ nested: { value: "before" } }, { nested: {} }).valid).toBe(
      false,
    );
  });
});

function validateForgedSetOnceId(previousId: unknown, nextId: unknown) {
  return validateEntityStateTransition({
    schema: ProjectionStateSchema,
    previous: { id: previousId } as ProjectionState,
    next: { id: nextId } as ProjectionState,
  });
}
