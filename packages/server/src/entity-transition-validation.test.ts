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

type SetOnceDetails = Message<"SetOnceDetails"> & {
  value: string;
};

type RichSetOnceState = Message<"RichSetOnceState"> & {
  id: string;
  fingerprint: Uint8Array;
  tags: string[];
  details?: SetOnceDetails;
  mutableNote: string;
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
const RichSetOnceStateSchema = messageDesc(
  fileEntityMetadataFixture,
  4,
) as GenMessage<RichSetOnceState>;

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

  it("rejects default-to-non-default existing-state changes for set-once fields", () => {
    const previous = create(ProjectionStateSchema, {
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectionStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });

    const result = validateEntityStateTransition({
      schema: ProjectionStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "id");
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

  it("compares descriptor-valid bytes, arrays, and nested messages by content", () => {
    const previous = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      details: { value: "same" },
      mutableNote: "before",
    });
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      details: { value: "same" },
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next: create(RichSetOnceStateSchema, {
          id: "rich-1",
          fingerprint: new Uint8Array([1, 3]),
          tags: ["alpha", "beta"],
          details: { value: "same" },
          mutableNote: "after",
        }),
      }),
      "fingerprint",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next: create(RichSetOnceStateSchema, {
          id: "rich-1",
          fingerprint: new Uint8Array([1, 2]),
          tags: ["alpha", "gamma"],
          details: { value: "same" },
          mutableNote: "after",
        }),
      }),
      "tags",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next: create(RichSetOnceStateSchema, {
          id: "rich-1",
          fingerprint: new Uint8Array([1, 2]),
          tags: ["alpha", "beta"],
          details: { value: "changed" },
          mutableNote: "after",
        }),
      }),
      "details",
    );
  });

  it("fails closed when forged set-once fields are inherited or accessor-backed", () => {
    const previous = create(ProjectionStateSchema, {
      id: "stable-id",
      name: "Draft",
      priority: 1,
    });
    const inheritedNext = Object.create({ id: "stable-id" }) as ProjectionState;
    const accessorNext = Object.defineProperty({} as ProjectionState, "id", {
      enumerable: true,
      get: () => "stable-id",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectionStateSchema,
        previous,
        next: inheritedNext,
      }),
      "id",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectionStateSchema,
        previous,
        next: accessorNext,
      }),
      "id",
    );
  });

  it("fails closed for forged non-plain set-once object values", () => {
    expectSetOnceViolation(validateForgedSetOnceId(new Date(0), new Date(0)), "id");

    const prototype = { inherited: "not protobuf state" };
    const previous: Record<string, unknown> = { value: "same" };
    const next: Record<string, unknown> = { value: "same" };
    Object.setPrototypeOf(previous, prototype);
    Object.setPrototypeOf(next, prototype);

    expectSetOnceViolation(validateForgedSetOnceId(previous, next), "id");
  });

  it("fails closed for cyclic and too-deep forged set-once object values", () => {
    const previousCycle: Record<string, unknown> = {};
    const nextCycle: Record<string, unknown> = {};
    previousCycle.self = previousCycle;
    nextCycle.self = nextCycle;

    expectSetOnceViolation(validateForgedSetOnceId(previousCycle, nextCycle), "id");

    expectSetOnceViolation(
      validateForgedSetOnceId(createDeepObject(80), createDeepObject(80)),
      "id",
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

function expectSetOnceViolation(
  result: ReturnType<typeof validateEntityStateTransition>,
  fieldName: string,
) {
  expect(result.valid).toBe(false);
  if (result.valid) {
    throw new Error("Expected set-once transition validation to fail.");
  }

  expect(result.violations).toHaveLength(1);
  expect(result.violations[0].fieldPath?.fieldName).toEqual([fieldName]);
  expect(result.violations[0].fieldValue).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("stable-id");
}

function createDeepObject(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: "same" };

  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
}
