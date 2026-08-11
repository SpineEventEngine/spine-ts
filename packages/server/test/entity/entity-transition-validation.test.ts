import {
  clone,
  create,
  fromBinary,
  setExtension,
  toBinary,
  type Message,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FieldOptionsSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { file_spine_options } from "@spine-event-engine/proto";
import { required } from "@spine-event-engine/proto/generated/spine/options_pb.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "../../src/index.js";
import { validateEntityStateTransition } from "../../src/index.js";

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
  child?: SetOnceDetails;
};

type RichSetOnceState = Message<"RichSetOnceState"> & {
  id: string;
  fingerprint: Uint8Array;
  tags: string[];
  details?: SetOnceDetails;
  mutableNote: string;
};

type SingularSetOnceState = Message<"SingularSetOnceState"> & {
  id: string;
  fingerprint: Uint8Array;
  details?: SetOnceDetails;
  mutableNote: string;
};

type MapSetOnceState = Message<"MapSetOnceState"> & {
  id: string;
  labels: Record<string, string>;
  mutableNote: string;
};

type OptionalSetOnceState = Message<"OptionalSetOnceState"> & {
  id: string;
  explicitId?: string;
  mutableNote: string;
};

interface SingularSetOnceStateOverrides {
  readonly id?: string;
  readonly fingerprint?: Uint8Array;
  readonly details?: { readonly value?: string; readonly child?: SetOnceDetails };
  readonly mutableNote?: string;
}

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

function projectionStateWithRequired(value: boolean) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  if (source === undefined) throw new Error("Entity metadata fixture descriptor is missing.");
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const state = descriptor.messageType[0];
  const id = state?.field[0];
  if (state === undefined || id === undefined) {
    throw new Error("Projection state ID fixture is missing.");
  }
  descriptor.name = value ? "explicit_required_state.proto" : "explicit_optional_state.proto";
  state.name = value ? "ExplicitRequiredState" : "ExplicitOptionalState";
  id.options ??= create(FieldOptionsSchema);
  setExtension(id.options, required, value);
  descriptor.messageType = [state];
  const file = fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    [file_spine_options],
  );
  return messageDesc(file, 0) as GenMessage<ProjectionState>;
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const GenericStateSchema = messageDesc(fileEntityMetadataFixture, 2) as GenMessage<GenericState>;
const SetOnceDetailsSchema = messageDesc(
  fileEntityMetadataFixture,
  3,
) as GenMessage<SetOnceDetails>;
const RichSetOnceStateSchema = messageDesc(
  fileEntityMetadataFixture,
  4,
) as GenMessage<RichSetOnceState>;
const MapSetOnceStateSchema = messageDesc(
  fileEntityMetadataFixture,
  5,
) as GenMessage<MapSetOnceState>;
const SingularSetOnceStateSchema = messageDesc(
  fileEntityMetadataFixture,
  6,
) as GenMessage<SingularSetOnceState>;
const OptionalSetOnceStateSchema = messageDesc(
  fileEntityMetadataFixture,
  7,
) as GenMessage<OptionalSetOnceState>;
const ExplicitRequiredStateSchema = projectionStateWithRequired(true);
const ExplicitOptionalStateSchema = projectionStateWithRequired(false);

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

  it("rejects creation with an empty implicit Entity ID", () => {
    const result = validateEntityStateTransition({
      schema: ProjectionStateSchema,
      previous: undefined,
      next: create(ProjectionStateSchema, { name: "Draft", priority: 1 }),
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected an implicit Entity ID violation.");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].fieldPath?.fieldName).toEqual(["id"]);
  });

  it("keeps explicit required true authoritative and explicit false disabling", () => {
    const requiredResult = validateEntityStateTransition({
      schema: ExplicitRequiredStateSchema,
      previous: undefined,
      next: create(ExplicitRequiredStateSchema),
    });
    const optionalResult = validateEntityStateTransition({
      schema: ExplicitOptionalStateSchema,
      previous: undefined,
      next: create(ExplicitOptionalStateSchema),
    });

    expect(requiredResult.valid).toBe(false);
    if (requiredResult.valid) throw new Error("Expected explicit required validation.");
    expect(requiredResult.violations).toHaveLength(1);
    expect(requiredResult.violations[0].fieldPath?.fieldName).toEqual(["id"]);
    expect(optionalResult.valid).toBe(true);
  });

  it("caches descriptor-derived transition rules per schema", () => {
    const firstSchema = countSchemaFieldsReads(ProjectionStateSchema);
    const secondSchema = countSchemaFieldsReads(ProjectionStateSchema);
    const next = create(ProjectionStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });

    expect(
      validateEntityStateTransition({
        schema: firstSchema.schema,
        previous: undefined,
        next,
      }).valid,
    ).toBe(true);

    const fieldsReadsAfterFirstValidation = firstSchema.getFieldsReadCount();

    expect(fieldsReadsAfterFirstValidation).toBeGreaterThan(0);
    expect(
      validateEntityStateTransition({
        schema: firstSchema.schema,
        previous: undefined,
        next,
      }).valid,
    ).toBe(true);
    const fieldsReadsAfterSecondValidation = firstSchema.getFieldsReadCount();
    const repeatedValidationReads =
      fieldsReadsAfterSecondValidation - fieldsReadsAfterFirstValidation;
    expect(repeatedValidationReads).toBeGreaterThan(0);
    expect(repeatedValidationReads).toBeLessThan(fieldsReadsAfterFirstValidation);
    expect(
      validateEntityStateTransition({
        schema: firstSchema.schema,
        previous: undefined,
        next,
      }).valid,
    ).toBe(true);
    expect(firstSchema.getFieldsReadCount() - fieldsReadsAfterSecondValidation).toBe(
      repeatedValidationReads,
    );

    expect(
      validateEntityStateTransition({
        schema: secondSchema.schema,
        previous: undefined,
        next,
      }).valid,
    ).toBe(true);
    expect(secondSchema.getFieldsReadCount()).toBeGreaterThan(0);
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

  it("rejects descriptor-valid repeated set-once fields as unsupported even when unchanged", () => {
    const previous = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-previous-repeated",
    });
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-next-repeated",
    });

    const result = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "tags");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Repeated set-once fields are not supported by entity state transition validation.",
    );
    expectNoValueLeak(
      result,
      "private-repeated-tag",
      "secret-previous-repeated",
      "secret-next-repeated",
    );
  });

  it("rejects creation transitions with repeated set-once fields as unsupported", () => {
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-creation-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-creation-repeated",
    });

    const result = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: undefined,
      next,
    });

    expectSetOnceViolation(result, "tags");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Repeated set-once fields are not supported by entity state transition validation.",
    );
    expectNoValueLeak(result, "private-creation-repeated-tag", "secret-creation-repeated");
  });

  it("compares descriptor-valid bytes and singular nested messages by content", () => {
    const previous = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "same" },
      mutableNote: "before",
    });
    const next = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "same" },
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next: create(SingularSetOnceStateSchema, {
          id: "singular-1",
          fingerprint: new Uint8Array([1, 3]),
          details: { value: "same" },
          mutableNote: "after",
        }),
      }),
      "fingerprint",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next: create(SingularSetOnceStateSchema, {
          id: "singular-1",
          fingerprint: new Uint8Array([1, 2]),
          details: { value: "changed" },
          mutableNote: "after",
        }),
      }),
      "details",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next: create(SingularSetOnceStateSchema, {
          id: "singular-1",
          fingerprint: new Uint8Array([1, 2]),
          details: { value: "same", child: { value: "now-present" } },
          mutableNote: "after",
        }),
      }),
      "details",
    );
  });

  it("allows descriptor-valid singular message set-once fields absent from both states", () => {
    const previous = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "before",
    });
    const next = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects descriptor-valid singular message set-once fields moving absent to present", () => {
    const previous = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "before",
    });
    const next = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "now-present" },
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next,
      }),
      "details",
    );
  });

  it("rejects descriptor-valid singular message set-once fields moving present to absent", () => {
    const previous = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "was-present" },
      mutableNote: "before",
    });
    const next = create(SingularSetOnceStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous,
        next,
      }),
      "details",
    );
  });

  it("uses canonical protobuf values instead of proxy-forged top-level descriptors", () => {
    const previous = create(ProjectionStateSchema, {
      id: "private-previous-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const changedNext = create(ProjectionStateSchema, {
      id: "private-next-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const next = new Proxy(changedNext, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "id") {
          return {
            configurable: true,
            enumerable: true,
            value: "private-previous-proxy-id",
            writable: true,
          };
        }

        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    const result = validateEntityStateTransition({
      schema: ProjectionStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "id");
    expectNoValueLeak(result, "private-previous-proxy-id", "private-next-proxy-id");
  });

  it("preserves a field-specific violation when top-level proxy reflection throws", () => {
    const previous = create(ProjectionStateSchema, {
      id: "private-previous-throwing-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const changedNext = create(ProjectionStateSchema, {
      id: "private-next-throwing-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const next = new Proxy(changedNext, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
    });

    const result = validateEntityStateTransition({
      schema: ProjectionStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "id");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Set-once fields cannot change after entity state creation.",
    );
    expectNoValueLeak(
      result,
      "private-previous-throwing-proxy-id",
      "private-next-throwing-proxy-id",
      "descriptor trap",
    );
  });

  it("uses canonical protobuf values instead of proxy-forged nested descriptors", () => {
    const previous = createSingularSetOnceState({
      details: { value: "private-previous-details" },
      mutableNote: "secret-previous-nested-proxy",
    });
    const changedDetails = create(SetOnceDetailsSchema, { value: "private-next-details" });
    const next = createSingularSetOnceState({
      details: new Proxy(changedDetails, {
        getOwnPropertyDescriptor(target, property) {
          if (property === "value") {
            return {
              configurable: true,
              enumerable: true,
              value: "private-previous-details",
              writable: true,
            };
          }

          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      }),
      mutableNote: "secret-next-nested-proxy",
    });

    const result = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "details");
    expectNoValueLeak(
      result,
      "private-previous-details",
      "private-next-details",
      "secret-previous-nested-proxy",
      "secret-next-nested-proxy",
    );
  });

  it("fails closed when nested message canonicalization cannot read protobuf values", () => {
    const previous = createSingularSetOnceState({
      details: { value: "private-previous-throwing-details" },
      mutableNote: "secret-previous-throwing-nested",
    });
    const throwingDetails = new Proxy(
      create(SetOnceDetailsSchema, { value: "private-next-throwing-details" }),
      {
        get(target, property, receiver): unknown {
          if (property === "value") {
            throw new Error("boom");
          }

          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const result = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous,
      next: createSingularSetOnceState({
        details: throwingDetails,
        mutableNote: "secret-next-throwing-nested",
      }),
    });

    expectSetOnceViolation(result, "details");
    expectNoValueLeak(
      result,
      "private-previous-throwing-details",
      "private-next-throwing-details",
      "secret-previous-throwing-nested",
      "secret-next-throwing-nested",
    );
  });

  it("fails closed for same-reference unsupported set-once object and collection values", () => {
    const sameCustomObject = new Date(0);
    expectSetOnceViolation(validateForgedSetOnceId(sameCustomObject, sameCustomObject), "id");

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous: forgeSingularSetOnceState({
          details: sameCustomObject as unknown as SetOnceDetails,
          mutableNote: "secret-previous-same-details",
        }),
        next: forgeSingularSetOnceState({
          details: sameCustomObject as unknown as SetOnceDetails,
          mutableNote: "secret-next-same-details",
        }),
      }),
      "details",
    );
  });

  it("fails closed for forged set-once bytes collections", () => {
    const previousWithOverriddenMethod = createSingularSetOnceState({
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "secret-previous-bytes-method",
    });
    Object.defineProperty(previousWithOverriddenMethod.fingerprint, "every", {
      enumerable: true,
      value: () => true,
    });
    const changedBytes = createSingularSetOnceState({
      fingerprint: new Uint8Array([1, 3]),
      mutableNote: "secret-next-bytes-method",
    });

    const overriddenMethodResult = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous: previousWithOverriddenMethod,
      next: changedBytes,
    });

    expectSetOnceViolation(overriddenMethodResult, "fingerprint");
    expectNoValueLeak(
      overriddenMethodResult,
      "secret-previous-bytes-method",
      "secret-next-bytes-method",
    );

    const previous = createSingularSetOnceState({
      fingerprint: new Uint8Array([4, 5]),
      mutableNote: "secret-previous-bytes-proxy",
    });
    const proxiedBytes = new Proxy(new Uint8Array([4, 6]), {
      get(target, property, receiver): unknown {
        if (property === "1") {
          return 5;
        }

        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const nextWithProxy = createSingularSetOnceState({
      fingerprint: proxiedBytes,
      mutableNote: "secret-next-bytes-proxy",
    });

    const proxyResult = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous,
      next: nextWithProxy,
    });

    expectSetOnceViolation(proxyResult, "fingerprint");
    expectNoValueLeak(proxyResult, "secret-previous-bytes-proxy", "secret-next-bytes-proxy");

    class SubclassedBytes extends Uint8Array {}
    const changedPrototypeBytes = new SubclassedBytes([1, 2]);
    const changedPrototypeResult = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous: createSingularSetOnceState({ mutableNote: "secret-previous-bytes-prototype" }),
      next: createSingularSetOnceState({
        fingerprint: changedPrototypeBytes,
        mutableNote: "secret-next-bytes-prototype",
      }),
    });

    expectSetOnceViolation(changedPrototypeResult, "fingerprint");
    expectNoValueLeak(
      changedPrototypeResult,
      "secret-previous-bytes-prototype",
      "secret-next-bytes-prototype",
    );

    const symbolKeyBytes = new Uint8Array([1, 2]);
    Object.defineProperty(symbolKeyBytes, Symbol("hidden"), {
      enumerable: true,
      value: "private-symbol-byte",
    });
    const symbolKeyResult = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous: createSingularSetOnceState({ mutableNote: "secret-previous-bytes-symbol" }),
      next: createSingularSetOnceState({
        fingerprint: symbolKeyBytes,
        mutableNote: "secret-next-bytes-symbol",
      }),
    });

    expectSetOnceViolation(symbolKeyResult, "fingerprint");
    expectNoValueLeak(
      symbolKeyResult,
      "private-symbol-byte",
      "secret-previous-bytes-symbol",
      "secret-next-bytes-symbol",
    );
  });

  it("preserves a field-specific violation when set-once bytes shape checks throw", () => {
    const previous = createSingularSetOnceState({
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "secret-previous-throwing-bytes-shape",
    });
    const throwingBytesShape = new Proxy(new Uint8Array([1, 2]), {
      getPrototypeOf() {
        throw new Error("bytes prototype trap");
      },
    });
    const next = forgeSingularSetOnceState({
      fingerprint: throwingBytesShape,
      mutableNote: "secret-next-throwing-bytes-shape",
    });

    const result = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "fingerprint");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Set-once fields cannot change after entity state creation.",
    );
    expectNoValueLeak(
      result,
      "bytes prototype trap",
      "secret-previous-throwing-bytes-shape",
      "secret-next-throwing-bytes-shape",
    );
  });

  it("preserves a field-specific violation when set-once message shape checks throw", () => {
    const previous = createSingularSetOnceState({
      details: { value: "same" },
      mutableNote: "secret-previous-throwing-message-shape",
    });
    const throwingMessageShape = new Proxy(create(SetOnceDetailsSchema, { value: "same" }), {
      getPrototypeOf() {
        throw new Error("message prototype trap");
      },
    });
    const next = forgeSingularSetOnceState({
      details: throwingMessageShape,
      mutableNote: "secret-next-throwing-message-shape",
    });

    const result = validateEntityStateTransition({
      schema: SingularSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "details");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Set-once fields cannot change after entity state creation.",
    );
    expectNoValueLeak(
      result,
      "message prototype trap",
      "secret-previous-throwing-message-shape",
      "secret-next-throwing-message-shape",
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

  it("fails closed for cyclic and too-deep descriptor-backed nested set-once messages", () => {
    const previousCycle = { value: "same" } as SetOnceDetails;
    const nextCycle = { value: "same" } as SetOnceDetails;
    previousCycle.child = previousCycle;
    nextCycle.child = nextCycle;

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous: forgeSingularSetOnceState({
          details: previousCycle,
          mutableNote: "secret-previous-details-cycle",
        }),
        next: forgeSingularSetOnceState({
          details: nextCycle,
          mutableNote: "secret-next-details-cycle",
        }),
      }),
      "details",
    );

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: SingularSetOnceStateSchema,
        previous: createSingularSetOnceState({
          details: createDeepDetails(80),
          mutableNote: "secret-previous-details-depth",
        }),
        next: createSingularSetOnceState({
          details: createDeepDetails(80),
          mutableNote: "secret-next-details-depth",
        }),
      }),
      "details",
    );
  });

  it("rejects map-valued set-once fields as unsupported even when unchanged", () => {
    const previous = create(MapSetOnceStateSchema, {
      id: "map-1",
      labels: { alpha: "private-map-value" },
      mutableNote: "secret-previous-map",
    });
    const next = create(MapSetOnceStateSchema, {
      id: "map-1",
      labels: { alpha: "private-map-value" },
      mutableNote: "secret-next-map",
    });

    const result = validateEntityStateTransition({
      schema: MapSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "labels");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Map-valued set-once fields are not supported by entity state transition validation.",
    );
    expectNoValueLeak(result, "private-map-value", "secret-previous-map", "secret-next-map");
  });

  it("rejects explicit optional set-once fields as unsupported even when unchanged", () => {
    const previous = create(OptionalSetOnceStateSchema, {
      id: "optional-1",
      explicitId: "private-explicit-optional",
      mutableNote: "secret-previous-optional",
    });
    const next = create(OptionalSetOnceStateSchema, {
      id: "optional-1",
      explicitId: "private-explicit-optional",
      mutableNote: "secret-next-optional",
    });

    const result = validateEntityStateTransition({
      schema: OptionalSetOnceStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "explicit_id");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Explicit optional set-once fields are not supported by entity state transition validation.",
    );
    expectNoValueLeak(
      result,
      "private-explicit-optional",
      "secret-previous-optional",
      "secret-next-optional",
    );
  });

  it("rejects creation transitions with map-valued set-once fields as unsupported", () => {
    const next = create(MapSetOnceStateSchema, {
      id: "map-1",
      labels: { alpha: "private-creation-map-value" },
      mutableNote: "secret-creation-map",
    });

    const result = validateEntityStateTransition({
      schema: MapSetOnceStateSchema,
      previous: undefined,
      next,
    });

    expectSetOnceViolation(result, "labels");
    expect(result.error?.constraintViolation[0]?.message?.withPlaceholders).toBe(
      "Map-valued set-once fields are not supported by entity state transition validation.",
    );
    expectNoValueLeak(result, "private-creation-map-value", "secret-creation-map");
  });
});

function validateForgedSetOnceId(previousId: unknown, nextId: unknown) {
  return validateEntityStateTransition({
    schema: ProjectionStateSchema,
    previous: { id: previousId } as ProjectionState,
    next: { id: nextId } as ProjectionState,
  });
}

function countSchemaFieldsReads<Schema extends typeof ProjectionStateSchema>(schema: Schema) {
  let fieldsReadCount = 0;

  return {
    schema: new Proxy(schema, {
      get(target, property, receiver) {
        if (property === "fields") {
          fieldsReadCount += 1;
        }

        return Reflect.get(target, property, receiver);
      },
    }),
    getFieldsReadCount: () => fieldsReadCount,
  };
}

function createSingularSetOnceState(
  overrides: SingularSetOnceStateOverrides = {},
): SingularSetOnceState {
  return create(SingularSetOnceStateSchema, {
    id: "singular-1",
    fingerprint: new Uint8Array([1, 2]),
    details: { value: "same" },
    mutableNote: "mutable",
    ...overrides,
  });
}

function forgeSingularSetOnceState(
  overrides: SingularSetOnceStateOverrides = {},
): SingularSetOnceState {
  return {
    $typeName: "SingularSetOnceState",
    id: "singular-1",
    fingerprint: new Uint8Array([1, 2]),
    details: create(SetOnceDetailsSchema, { value: "same" }),
    mutableNote: "mutable",
    ...overrides,
  } as SingularSetOnceState;
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

function expectNoValueLeak(
  result: ReturnType<typeof validateEntityStateTransition>,
  ...values: readonly string[]
) {
  const serializedResult = JSON.stringify(result);

  for (const value of values) {
    expect(serializedResult).not.toContain(value);
  }
}

function createDeepObject(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: "same" };

  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
}

function createDeepDetails(depth: number): SetOnceDetails {
  let value = create(SetOnceDetailsSchema, { value: "same" });

  for (let index = 0; index < depth; index += 1) {
    value = create(SetOnceDetailsSchema, {
      value: "same",
      child: value,
    });
  }

  return value;
}
