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
import { describe, expect, it } from "vitest";
import {
  type ProjectCatalogState,
  ProjectCatalogStateSchema,
  type ProjectDraftState,
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
  type ProjectProfile,
  ProjectProfileSchema,
  type ProjectProfileState,
  ProjectProfileStateSchema,
  ProjectDraftStateSchema,
  type ProjectRecordState,
  ProjectRecordStateSchema,
  type ProjectSearchState,
  ProjectSearchStateSchema,
  DraftProjectStateSchema,
  PublishedProjectStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

import * as serverRoot from "../../src/index.js";
import { validateEntityStateTransition } from "../../src/index.js";

interface ProjectRecordStateOverrides {
  readonly id?: string;
  readonly fingerprint?: Uint8Array;
  readonly details?: { readonly value?: string; readonly child?: ProjectProfile | undefined };
  readonly mutableNote?: string;
}

describe("entity state transition validation", () => {
  it("exports the public high-level entity state transition validator", () => {
    expect(serverRoot.validateEntityStateTransition).toBe(validateEntityStateTransition);
  });

  it("allows creation transitions to initialize set-once fields", () => {
    const next = create(ProjectOverviewStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectOverviewStateSchema,
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
      schema: ProjectOverviewStateSchema,
      previous: undefined,
      next: create(ProjectOverviewStateSchema, { name: "Draft", priority: 1 }),
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected an implicit Entity ID violation.");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].fieldPath?.fieldName).toEqual(["id"]);
  });

  it("keeps explicit required true authoritative and explicit false disabling", () => {
    const requiredResult = validateEntityStateTransition({
      schema: PublishedProjectStateSchema,
      previous: undefined,
      next: create(PublishedProjectStateSchema),
    });
    const optionalResult = validateEntityStateTransition({
      schema: DraftProjectStateSchema,
      previous: undefined,
      next: create(DraftProjectStateSchema),
    });

    expect(requiredResult.valid).toBe(false);
    if (requiredResult.valid) throw new Error("Expected explicit required validation.");
    expect(requiredResult.violations).toHaveLength(1);
    expect(requiredResult.violations[0].fieldPath?.fieldName).toEqual(["id"]);
    expect(optionalResult.valid).toBe(true);
  });

  it("caches descriptor-derived transition rules per schema", () => {
    const firstSchema = countSchemaFieldsReads(ProjectOverviewStateSchema);
    const secondSchema = countSchemaFieldsReads(ProjectOverviewStateSchema);
    const next = create(ProjectOverviewStateSchema, {
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
    const previous = create(ProjectOverviewStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectOverviewStateSchema, {
      id: "task-1",
      name: "Ready",
      priority: 2,
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectOverviewStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects existing-state transitions when a set-once field changes without leaking values", () => {
    const previous = create(ProjectOverviewStateSchema, {
      id: "private-previous-id",
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectOverviewStateSchema, {
      id: "private-next-id",
      name: "Draft",
      priority: 1,
    });

    const result = validateEntityStateTransition({
      schema: ProjectOverviewStateSchema,
      previous,
      next,
    });

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected set-once transition validation to fail.");
    }

    const [violation] = result.violations;

    expect(violation.typeName).toBe("ProjectOverviewState");
    expect(violation.fieldPath?.fieldName).toEqual(["id"]);
    expect(violation.fieldValue).toBeUndefined();
    expect(result.error.$typeName).toBe("spine.validation.ValidationError");
    expect(result.error.constraintViolation).toEqual(result.violations);
    expect(JSON.stringify(result)).not.toContain("private-previous-id");
    expect(JSON.stringify(result)).not.toContain("private-next-id");
  });

  it("rejects default-to-non-default existing-state changes for set-once fields", () => {
    const previous = create(ProjectOverviewStateSchema, {
      name: "Draft",
      priority: 1,
    });
    const next = create(ProjectOverviewStateSchema, {
      id: "task-1",
      name: "Draft",
      priority: 1,
    });

    const result = validateEntityStateTransition({
      schema: ProjectOverviewStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "id");
  });

  it("passes when an entity schema has no set-once fields", () => {
    const previous = create(ProjectSearchStateSchema, {
      id: "generic-1",
      searchable: "before",
    });
    const next = create(ProjectSearchStateSchema, {
      id: "generic-2",
      searchable: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectSearchStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects descriptor-valid repeated set-once fields as unsupported even when unchanged", () => {
    const previous = create(ProjectProfileStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-previous-repeated",
    });
    const next = create(ProjectProfileStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-next-repeated",
    });

    const result = validateEntityStateTransition({
      schema: ProjectProfileStateSchema,
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
    const next = create(ProjectProfileStateSchema, {
      id: "rich-1",
      fingerprint: new Uint8Array([1, 2]),
      tags: ["private-creation-repeated-tag"],
      details: { value: "same" },
      mutableNote: "secret-creation-repeated",
    });

    const result = validateEntityStateTransition({
      schema: ProjectProfileStateSchema,
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
    const previous = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "same" },
      mutableNote: "before",
    });
    const next = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "same" },
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous,
        next: create(ProjectRecordStateSchema, {
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
        schema: ProjectRecordStateSchema,
        previous,
        next: create(ProjectRecordStateSchema, {
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
        schema: ProjectRecordStateSchema,
        previous,
        next: create(ProjectRecordStateSchema, {
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
    const previous = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "before",
    });
    const next = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "after",
    });

    expect(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous,
        next,
      }).valid,
    ).toBe(true);
  });

  it("rejects descriptor-valid singular message set-once fields moving absent to present", () => {
    const previous = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "before",
    });
    const next = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "now-present" },
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous,
        next,
      }),
      "details",
    );
  });

  it("rejects descriptor-valid singular message set-once fields moving present to absent", () => {
    const previous = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      details: { value: "was-present" },
      mutableNote: "before",
    });
    const next = create(ProjectRecordStateSchema, {
      id: "singular-1",
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "after",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous,
        next,
      }),
      "details",
    );
  });

  it("uses canonical protobuf values instead of proxy-forged top-level descriptors", () => {
    const previous = create(ProjectOverviewStateSchema, {
      id: "private-previous-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const changedNext = create(ProjectOverviewStateSchema, {
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
      schema: ProjectOverviewStateSchema,
      previous,
      next,
    });

    expectSetOnceViolation(result, "id");
    expectNoValueLeak(result, "private-previous-proxy-id", "private-next-proxy-id");
  });

  it("preserves a field-specific violation when top-level proxy reflection throws", () => {
    const previous = create(ProjectOverviewStateSchema, {
      id: "private-previous-throwing-proxy-id",
      name: "Draft",
      priority: 1,
    });
    const changedNext = create(ProjectOverviewStateSchema, {
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
      schema: ProjectOverviewStateSchema,
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
    const previous = createProjectRecordState({
      details: { value: "private-previous-details" },
      mutableNote: "secret-previous-nested-proxy",
    });
    const changedDetails = create(ProjectProfileSchema, { value: "private-next-details" });
    const next = createProjectRecordState({
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
      schema: ProjectRecordStateSchema,
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
    const previous = createProjectRecordState({
      details: { value: "private-previous-throwing-details" },
      mutableNote: "secret-previous-throwing-nested",
    });
    const throwingDetails = new Proxy(
      create(ProjectProfileSchema, { value: "private-next-throwing-details" }),
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
      schema: ProjectRecordStateSchema,
      previous,
      next: createProjectRecordState({
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
        schema: ProjectRecordStateSchema,
        previous: forgeProjectRecordState({
          details: sameCustomObject as unknown as ProjectProfile,
          mutableNote: "secret-previous-same-details",
        }),
        next: forgeProjectRecordState({
          details: sameCustomObject as unknown as ProjectProfile,
          mutableNote: "secret-next-same-details",
        }),
      }),
      "details",
    );
  });

  it("fails closed for forged set-once bytes collections", () => {
    const previousWithOverriddenMethod = createProjectRecordState({
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "secret-previous-bytes-method",
    });
    Object.defineProperty(previousWithOverriddenMethod.fingerprint, "every", {
      enumerable: true,
      value: () => true,
    });
    const changedBytes = createProjectRecordState({
      fingerprint: new Uint8Array([1, 3]),
      mutableNote: "secret-next-bytes-method",
    });

    const overriddenMethodResult = validateEntityStateTransition({
      schema: ProjectRecordStateSchema,
      previous: previousWithOverriddenMethod,
      next: changedBytes,
    });

    expectSetOnceViolation(overriddenMethodResult, "fingerprint");
    expectNoValueLeak(
      overriddenMethodResult,
      "secret-previous-bytes-method",
      "secret-next-bytes-method",
    );

    const previous = createProjectRecordState({
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
    const nextWithProxy = createProjectRecordState({
      fingerprint: proxiedBytes,
      mutableNote: "secret-next-bytes-proxy",
    });

    const proxyResult = validateEntityStateTransition({
      schema: ProjectRecordStateSchema,
      previous,
      next: nextWithProxy,
    });

    expectSetOnceViolation(proxyResult, "fingerprint");
    expectNoValueLeak(proxyResult, "secret-previous-bytes-proxy", "secret-next-bytes-proxy");

    class SubclassedBytes extends Uint8Array {}
    const changedPrototypeBytes = new SubclassedBytes([1, 2]);
    const changedPrototypeResult = validateEntityStateTransition({
      schema: ProjectRecordStateSchema,
      previous: createProjectRecordState({ mutableNote: "secret-previous-bytes-prototype" }),
      next: createProjectRecordState({
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
      schema: ProjectRecordStateSchema,
      previous: createProjectRecordState({ mutableNote: "secret-previous-bytes-symbol" }),
      next: createProjectRecordState({
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
    const previous = createProjectRecordState({
      fingerprint: new Uint8Array([1, 2]),
      mutableNote: "secret-previous-throwing-bytes-shape",
    });
    const throwingBytesShape = new Proxy(new Uint8Array([1, 2]), {
      getPrototypeOf() {
        throw new Error("bytes prototype trap");
      },
    });
    const next = forgeProjectRecordState({
      fingerprint: throwingBytesShape,
      mutableNote: "secret-next-throwing-bytes-shape",
    });

    const result = validateEntityStateTransition({
      schema: ProjectRecordStateSchema,
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
    const previous = createProjectRecordState({
      details: { value: "same" },
      mutableNote: "secret-previous-throwing-message-shape",
    });
    const throwingMessageShape = new Proxy(create(ProjectProfileSchema, { value: "same" }), {
      getPrototypeOf() {
        throw new Error("message prototype trap");
      },
    });
    const next = forgeProjectRecordState({
      details: throwingMessageShape,
      mutableNote: "secret-next-throwing-message-shape",
    });

    const result = validateEntityStateTransition({
      schema: ProjectRecordStateSchema,
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
    const previous = create(ProjectOverviewStateSchema, {
      id: "stable-id",
      name: "Draft",
      priority: 1,
    });
    const inheritedNext = Object.create({ id: "stable-id" }) as ProjectOverviewState;
    const accessorNext = Object.defineProperty({} as ProjectOverviewState, "id", {
      enumerable: true,
      get: () => "stable-id",
    });

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectOverviewStateSchema,
        previous,
        next: inheritedNext,
      }),
      "id",
    );
    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectOverviewStateSchema,
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
    const previousCycle = { value: "same" } as ProjectProfile;
    const nextCycle = { value: "same" } as ProjectProfile;
    previousCycle.child = previousCycle;
    nextCycle.child = nextCycle;

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous: forgeProjectRecordState({
          details: previousCycle,
          mutableNote: "secret-previous-details-cycle",
        }),
        next: forgeProjectRecordState({
          details: nextCycle,
          mutableNote: "secret-next-details-cycle",
        }),
      }),
      "details",
    );

    expectSetOnceViolation(
      validateEntityStateTransition({
        schema: ProjectRecordStateSchema,
        previous: createProjectRecordState({
          details: createDeepDetails(80),
          mutableNote: "secret-previous-details-depth",
        }),
        next: createProjectRecordState({
          details: createDeepDetails(80),
          mutableNote: "secret-next-details-depth",
        }),
      }),
      "details",
    );
  });

  it("rejects map-valued set-once fields as unsupported even when unchanged", () => {
    const previous = create(ProjectCatalogStateSchema, {
      id: "map-1",
      labels: { alpha: "private-map-value" },
      mutableNote: "secret-previous-map",
    });
    const next = create(ProjectCatalogStateSchema, {
      id: "map-1",
      labels: { alpha: "private-map-value" },
      mutableNote: "secret-next-map",
    });

    const result = validateEntityStateTransition({
      schema: ProjectCatalogStateSchema,
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
    const previous = create(ProjectDraftStateSchema, {
      id: "optional-1",
      explicitId: "private-explicit-optional",
      mutableNote: "secret-previous-optional",
    });
    const next = create(ProjectDraftStateSchema, {
      id: "optional-1",
      explicitId: "private-explicit-optional",
      mutableNote: "secret-next-optional",
    });

    const result = validateEntityStateTransition({
      schema: ProjectDraftStateSchema,
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
    const next = create(ProjectCatalogStateSchema, {
      id: "map-1",
      labels: { alpha: "private-creation-map-value" },
      mutableNote: "secret-creation-map",
    });

    const result = validateEntityStateTransition({
      schema: ProjectCatalogStateSchema,
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
    schema: ProjectOverviewStateSchema,
    previous: { id: previousId } as ProjectOverviewState,
    next: { id: nextId } as ProjectOverviewState,
  });
}

function countSchemaFieldsReads<Schema extends typeof ProjectOverviewStateSchema>(schema: Schema) {
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

function createProjectRecordState(overrides: ProjectRecordStateOverrides = {}): ProjectRecordState {
  return create(ProjectRecordStateSchema, {
    id: "singular-1",
    fingerprint: new Uint8Array([1, 2]),
    details: { value: "same" },
    mutableNote: "mutable",
    ...overrides,
  });
}

function forgeProjectRecordState(overrides: ProjectRecordStateOverrides = {}): ProjectRecordState {
  return {
    $typeName: "ProjectRecordState",
    id: "singular-1",
    fingerprint: new Uint8Array([1, 2]),
    details: create(ProjectProfileSchema, { value: "same" }),
    mutableNote: "mutable",
    ...overrides,
  } as ProjectRecordState;
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

function createDeepDetails(depth: number): ProjectProfile {
  let value = create(ProjectProfileSchema, { value: "same" });

  for (let index = 0; index < depth; index += 1) {
    value = create(ProjectProfileSchema, {
      value: "same",
      child: value,
    });
  }

  return value;
}
