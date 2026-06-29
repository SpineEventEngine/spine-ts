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
  child?: SetOnceDetails;
};

type RichSetOnceState = Message<"RichSetOnceState"> & {
  id: string;
  fingerprint: Uint8Array;
  tags: string[];
  details?: SetOnceDetails;
  mutableNote: string;
};

type MapSetOnceState = Message<"MapSetOnceState"> & {
  id: string;
  labels: Record<string, string>;
  mutableNote: string;
};

interface RichSetOnceStateOverrides {
  readonly id?: string;
  readonly fingerprint?: Uint8Array;
  readonly tags?: string[];
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

  it("allows descriptor-valid singular message set-once fields absent from both states", () => {
    const previous = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      mutableNote: "before",
    });
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects descriptor-valid singular message set-once fields moving absent to present", () => {
    const previous = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      mutableNote: "before",
    });
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      details: { value: "now-present" },
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous,
        next,
      }),
      "details",
    );
  });

  it("rejects descriptor-valid singular message set-once fields moving present to absent", () => {
    const previous = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      details: { value: "was-present" },
      mutableNote: "before",
    });
    const next = create(RichSetOnceStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["alpha", "beta"],
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
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
    const previous = createRichSetOnceState({
      details: { value: "private-previous-details" },
      mutableNote: "secret-previous-nested-proxy",
    });
    const changedDetails = create(SetOnceDetailsSchema, { value: "private-next-details" });
    const next = createRichSetOnceState({
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
      schema: RichSetOnceStateSchema,
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
    const previous = createRichSetOnceState({
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
      schema: RichSetOnceStateSchema,
      previous,
      next: createRichSetOnceState({
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
        schema: RichSetOnceStateSchema,
        previous: forgeRichSetOnceState({
          details: sameCustomObject as unknown as SetOnceDetails,
          mutableNote: "secret-previous-same-details",
        }),
        next: forgeRichSetOnceState({
          details: sameCustomObject as unknown as SetOnceDetails,
          mutableNote: "secret-next-same-details",
        }),
      }),
      "details",
    );

    const sameSparseTags = [] as string[];
    sameSparseTags.length = 1;

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous: createRichSetOnceState({
          tags: sameSparseTags,
          mutableNote: "secret-previous-same-tags",
        }),
        next: createRichSetOnceState({
          tags: sameSparseTags,
          mutableNote: "secret-next-same-tags",
        }),
      }),
      "tags",
    );
  });

  it("fails closed for forged set-once bytes collections", () => {
    const previousWithOverriddenMethod = createRichSetOnceState({
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "secret-previous-bytes-method",
    });
    Object.defineProperty(previousWithOverriddenMethod.fingerprint, "every", {
      enumerable: true,
      value: () => true,
    });
    const changedBytes = createRichSetOnceState({
      fingerprint: new Uint8Array([1, 3]),
      mutableNote: "secret-next-bytes-method",
    });

    const overriddenMethodResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: previousWithOverriddenMethod,
      next: changedBytes,
    });

    expectSetOnceViolation(overriddenMethodResult, "fingerprint");
    expectNoValueLeak(
      overriddenMethodResult,
      "secret-previous-bytes-method",
      "secret-next-bytes-method",
    );

    const previous = createRichSetOnceState({
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
    const nextWithProxy = createRichSetOnceState({
      fingerprint: proxiedBytes,
      mutableNote: "secret-next-bytes-proxy",
    });

    const proxyResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous,
      next: nextWithProxy,
    });

    expectSetOnceViolation(proxyResult, "fingerprint");
    expectNoValueLeak(proxyResult, "secret-previous-bytes-proxy", "secret-next-bytes-proxy");

    class SubclassedBytes extends Uint8Array {}
    const changedPrototypeBytes = new SubclassedBytes([1, 2]);
    const changedPrototypeResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: createRichSetOnceState({ mutableNote: "secret-previous-bytes-prototype" }),
      next: createRichSetOnceState({
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
  });

  it("fails closed for forged set-once repeated collections", () => {
    const tagsWithOverriddenMethod = ["alpha"];
    Object.defineProperty(tagsWithOverriddenMethod, "every", {
      enumerable: true,
      value: () => true,
    });
    const previousWithOverriddenMethod = createRichSetOnceState({
      tags: tagsWithOverriddenMethod,
      mutableNote: "secret-previous-tags-method",
    });
    const nextWithChangedTags = createRichSetOnceState({
      tags: ["secret-next-tag"],
      mutableNote: "secret-next-tags-method",
    });

    const overriddenMethodResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: previousWithOverriddenMethod,
      next: nextWithChangedTags,
    });

    expectSetOnceViolation(overriddenMethodResult, "tags");
    expectNoValueLeak(
      overriddenMethodResult,
      "secret-previous-tags-method",
      "secret-next-tags-method",
      "secret-next-tag",
    );

    const inheritedIndexTags = [] as string[];
    inheritedIndexTags.length = 1;
    Object.setPrototypeOf(inheritedIndexTags, { 0: "alpha", __proto__: Array.prototype });
    const nextWithInheritedIndex = createRichSetOnceState({
      tags: inheritedIndexTags,
      mutableNote: "secret-next-tags-inherited",
    });

    const inheritedIndexResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: createRichSetOnceState({ mutableNote: "secret-previous-tags-inherited" }),
      next: nextWithInheritedIndex,
    });

    expectSetOnceViolation(inheritedIndexResult, "tags");
    expectNoValueLeak(
      inheritedIndexResult,
      "secret-previous-tags-inherited",
      "secret-next-tags-inherited",
    );

    const proxiedTags = new Proxy(["secret-next-proxy-tag"], {
      get(target, property, receiver): unknown {
        if (property === "0") {
          return "alpha";
        }

        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const nextWithProxy = createRichSetOnceState({
      tags: proxiedTags,
      mutableNote: "secret-next-tags-proxy",
    });

    const proxyResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: createRichSetOnceState({ mutableNote: "secret-previous-tags-proxy" }),
      next: nextWithProxy,
    });

    expectSetOnceViolation(proxyResult, "tags");
    expectNoValueLeak(
      proxyResult,
      "secret-previous-tags-proxy",
      "secret-next-tags-proxy",
      "secret-next-proxy-tag",
    );

    const accessorIndexTags = ["placeholder"];
    Object.defineProperty(accessorIndexTags, "0", {
      enumerable: true,
      get: () => "alpha",
    });
    const nextWithAccessorIndex = createRichSetOnceState({
      tags: accessorIndexTags,
      mutableNote: "secret-next-tags-accessor",
    });

    const accessorIndexResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: createRichSetOnceState({ mutableNote: "secret-previous-tags-accessor" }),
      next: nextWithAccessorIndex,
    });

    expectSetOnceViolation(accessorIndexResult, "tags");
    expectNoValueLeak(
      accessorIndexResult,
      "secret-previous-tags-accessor",
      "secret-next-tags-accessor",
    );

    const symbolKeyTags = ["alpha"];
    Object.defineProperty(symbolKeyTags, Symbol("hidden"), {
      enumerable: true,
      value: "private-next-symbol-tag",
    });
    const symbolKeyResult = validateEntityStateTransition({
      schema: RichSetOnceStateSchema,
      previous: createRichSetOnceState({ mutableNote: "secret-previous-tags-symbol" }),
      next: createRichSetOnceState({
        tags: symbolKeyTags,
        mutableNote: "secret-next-tags-symbol",
      }),
    });

    expectSetOnceViolation(symbolKeyResult, "tags");
    expectNoValueLeak(
      symbolKeyResult,
      "secret-previous-tags-symbol",
      "secret-next-tags-symbol",
      "private-next-symbol-tag",
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
        schema: RichSetOnceStateSchema,
        previous: forgeRichSetOnceState({
          details: previousCycle,
          mutableNote: "secret-previous-details-cycle",
        }),
        next: forgeRichSetOnceState({
          details: nextCycle,
          mutableNote: "secret-next-details-cycle",
        }),
      }),
      "details",
    );

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: RichSetOnceStateSchema,
        previous: createRichSetOnceState({
          details: createDeepDetails(80),
          mutableNote: "secret-previous-details-depth",
        }),
        next: createRichSetOnceState({
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
});

function validateForgedSetOnceId(previousId: unknown, nextId: unknown) {
  return validateEntityStateTransition({
    schema: ProjectionStateSchema,
    previous: { id: previousId } as ProjectionState,
    next: { id: nextId } as ProjectionState,
  });
}

function createRichSetOnceState(overrides: RichSetOnceStateOverrides = {}): RichSetOnceState {
  return create(RichSetOnceStateSchema, {
    id: "rich-1",
    fingerprint: new Uint8Array([1, 2]),
    tags: ["alpha"],
    details: { value: "same" },
    mutableNote: "mutable",
    ...overrides,
  });
}

function forgeRichSetOnceState(overrides: RichSetOnceStateOverrides = {}): RichSetOnceState {
  return {
    $typeName: "RichSetOnceState",
    id: "rich-1",
    fingerprint: new Uint8Array([1, 2]),
    tags: ["alpha"],
    details: create(SetOnceDetailsSchema, { value: "same" }),
    mutableNote: "mutable",
    ...overrides,
  } as RichSetOnceState;
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
