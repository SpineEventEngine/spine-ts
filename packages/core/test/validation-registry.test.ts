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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  ProjectCriteriaDetailSchema,
  ProjectCriteriaSchema,
} from "../test-fixtures/generated/criteria_types_pb.js";
import {
  FindProjectsSchema,
  ProjectBatchSchema,
  ProjectCriteriaSetSchema,
  ProjectFilterGroupSchema,
  ProjectLabelSchema,
  ProjectSearchTermSchema,
  ProjectSelectionSchema,
  ProjectAnyEnvelopeSchema,
  ProjectTier,
} from "../test-fixtures/generated/project_types_pb.js";
import { AnyPacker, TypeRegistry, TypeUrls, Validate } from "../src/index.js";

const registry = new TypeRegistry([ProjectCriteriaSchema]);

describe("shared validation with application types", () => {
  it("validates an application type in an annotated Any using the registry", () => {
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(ProjectCriteriaSchema, create(ProjectCriteriaSchema, {})),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    const result = Validate.message(FindProjectsSchema, query, registry);

    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["criteria", "keyword"],
    ]);
    expect(result.violations[0]?.typeName).toBe(FindProjectsSchema.typeName);
    expect(JSON.stringify(result.error)).not.toContain("p1");
  });

  it("rejects malformed bytes for a known annotated Any type", () => {
    const query = create(FindProjectsSchema, {
      criteria: create(AnySchema, {
        typeUrl: registry.getBySchema(ProjectCriteriaSchema).typeUrl,
        value: new Uint8Array([255]),
      }),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    const result = Validate.message(FindProjectsSchema, query, registry);

    expect(result.valid).toBe(false);
    expect(result.violations[0]?.fieldPath?.fieldName).toEqual(["criteria"]);
    expect(JSON.stringify(result.error)).not.toContain("255");
  });

  it("allows unknown annotated Any and leaves unannotated known Any opaque", () => {
    const query = create(FindProjectsSchema, {
      criteria: create(AnySchema, { typeUrl: "type.spine.io/example.Unknown" }),
      opaque: AnyPacker.pack(ProjectCriteriaSchema, create(ProjectCriteriaSchema, {})),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    expect(Validate.message(FindProjectsSchema, query, registry).valid).toBe(true);
  });

  it("rejects missing values inside required lists and maps", () => {
    const query = create(FindProjectsSchema, {
      projectId: ["p1", ""],
      tags: { team: "" },
    });

    const result = Validate.message(FindProjectsSchema, query);

    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["project_id", "1"],
      ["tags", "team"],
    ]);
  });

  it("keeps repeated, map, nested, and oneof locations for application payloads", () => {
    const invalid = AnyPacker.pack(ProjectCriteriaSchema, create(ProjectCriteriaSchema, {}));
    const query = create(FindProjectsSchema, {
      projectId: ["p1"],
      tags: { team: "platform" },
      alternatives: [invalid],
      namedCriteria: { primary: invalid },
      group: create(ProjectFilterGroupSchema, { criteria: invalid }),
      advanced: { case: "advancedCriteria", value: invalid },
    });

    const result = Validate.message(FindProjectsSchema, query, registry);

    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["alternatives", "0", "keyword"],
      ["named_criteria", "primary", "keyword"],
      ["group", "criteria", "keyword"],
      ["advanced_criteria", "keyword"],
    ]);
    expect(result.violations.every((item) => item.typeName === FindProjectsSchema.typeName)).toBe(
      true,
    );
  });

  it("validates selected nondefault oneof messages through declared recursion", () => {
    const invalid = create(FindProjectsSchema, {
      projectId: ["p1"],
      tags: { team: "platform" },
      advanced: {
        case: "selectedCriteria",
        value: create(ProjectSearchTermSchema, { source: "catalog" }),
      },
    });
    const defaults = create(FindProjectsSchema, {
      projectId: ["p1"],
      tags: { team: "platform" },
      advanced: { case: "selectedCriteria", value: create(ProjectSearchTermSchema) },
    });

    expect(
      Validate.message(FindProjectsSchema, invalid, registry).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["selected_criteria", "keyword"]]);
    expect(Validate.message(FindProjectsSchema, defaults, registry).valid).toBe(true);
  });

  it("checks selected scalar oneof constraints and require presence", () => {
    const selected = create(ProjectSelectionSchema, {
      term: { case: "keyword", value: "BAD" },
    });
    const valid = create(ProjectSelectionSchema, {
      term: { case: "keyword", value: "catalog" },
    });

    expect(
      Validate.message(ProjectSelectionSchema, selected).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["keyword"]]);
    expect(Validate.message(ProjectSelectionSchema, valid).valid).toBe(true);
  });

  it("checks a selected oneof inside known descriptor-closure Any without duplicates", () => {
    const selection = create(ProjectSelectionSchema, {
      term: { case: "keyword", value: "BAD" },
    });
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(ProjectSelectionSchema, selection),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    expect(
      Validate.message(FindProjectsSchema, query).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["criteria", "keyword"]]);
  });

  it("preserves required Any presence for valid default payloads", () => {
    const defaults = create(ProjectAnyEnvelopeSchema, {
      requiredCriteria: AnyPacker.pack(ProjectLabelSchema, create(ProjectLabelSchema)),
    });
    const missing = create(ProjectAnyEnvelopeSchema, {
      requiredCriteria: create(AnySchema),
    });
    const unknown = create(ProjectAnyEnvelopeSchema, {
      requiredCriteria: create(AnySchema, { typeUrl: "type.spine.io/example.Unknown" }),
    });

    expect(Validate.message(ProjectAnyEnvelopeSchema, defaults).valid).toBe(true);
    expect(
      Validate.message(ProjectAnyEnvelopeSchema, missing).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["required_criteria"]]);
    expect(Validate.message(ProjectAnyEnvelopeSchema, unknown).valid).toBe(true);
  });

  it("does not duplicate violations for a packed type already in descriptor dependencies", () => {
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(FindProjectsSchema, create(FindProjectsSchema, {})),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    const result = Validate.message(FindProjectsSchema, query);

    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["criteria", "project_id"],
      ["criteria", "tags"],
    ]);
  });

  it("rejects malformed known descriptor payloads without an application registry", () => {
    const query = create(FindProjectsSchema, {
      criteria: create(AnySchema, {
        typeUrl: TypeUrls.derive(FindProjectsSchema),
        value: new Uint8Array([255]),
      }),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    expect(Validate.message(FindProjectsSchema, query).violations[0]?.fieldPath?.fieldName).toEqual(
      ["criteria"],
    );
  });

  it("checks required bytes, enum, and message members without rejecting numeric defaults", () => {
    const batch = create(ProjectBatchSchema, {
      fingerprints: [new Uint8Array()],
      tiers: [ProjectTier.PROJECT_TIER_UNSPECIFIED],
      labels: [create(ProjectLabelSchema)],
      assets: { missing: new Uint8Array() },
      ranks: { missing: ProjectTier.PROJECT_TIER_UNSPECIFIED },
      metadata: { missing: create(ProjectLabelSchema) },
      counts: [0],
      flags: [false],
    });

    const result = Validate.message(ProjectBatchSchema, batch);

    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["fingerprints", "0"],
      ["tiers", "0"],
      ["labels", "0"],
      ["assets", "missing"],
      ["ranks", "missing"],
      ["metadata", "missing"],
    ]);
    expect(
      Validate.message(
        ProjectBatchSchema,
        create(ProjectBatchSchema, {
          fingerprints: [new Uint8Array([1])],
          tiers: [ProjectTier.BASIC],
          labels: [create(ProjectLabelSchema, { value: "active" })],
          assets: { "": new Uint8Array([1]) },
          ranks: { active: ProjectTier.BASIC },
          metadata: { active: create(ProjectLabelSchema, { value: "active" }) },
          counts: [0],
          flags: [false],
        }),
      ).valid,
    ).toBe(true);
  });

  it("rejects a missing message member inside a required collection", () => {
    const batch = create(ProjectBatchSchema, {
      labels: [null as never],
      fingerprints: [new Uint8Array([1])],
      tiers: [ProjectTier.BASIC],
      assets: { active: new Uint8Array([1]) },
      ranks: { active: ProjectTier.BASIC },
      metadata: { active: create(ProjectLabelSchema, { value: "active" }) },
      counts: [0],
      flags: [false],
    });

    expect(Validate.message(ProjectBatchSchema, batch).violations[0]?.fieldPath?.fieldName).toEqual(
      ["labels", "0"],
    );
  });

  it("rejects absent numeric and boolean members while keeping zero and false valid", () => {
    const batch = create(ProjectBatchSchema, {
      fingerprints: [new Uint8Array([1])],
      tiers: [ProjectTier.BASIC],
      labels: [create(ProjectLabelSchema, { value: "active" })],
      assets: { active: new Uint8Array([1]) },
      ranks: { active: ProjectTier.BASIC },
      metadata: { active: create(ProjectLabelSchema, { value: "active" }) },
      counts: [0, undefined as never],
      flags: [false, null as never],
    });

    expect(
      Validate.message(ProjectBatchSchema, batch).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([
      ["counts", "1"],
      ["flags", "1"],
    ]);
  });

  it("keeps missing annotated Any list and map members as constraint violations", () => {
    const criteria = create(ProjectCriteriaSetSchema, {
      alternatives: [null as never],
      namedCriteria: { primary: undefined as never },
    });

    expect(
      Validate.message(ProjectCriteriaSetSchema, criteria, registry).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([
      ["alternatives", "0"],
      ["named_criteria", "primary"],
    ]);
  });

  it("reports a sparse required numeric list index as an input violation", () => {
    const batch = create(ProjectBatchSchema, {
      fingerprints: [new Uint8Array([1])],
      tiers: [ProjectTier.BASIC],
      labels: [create(ProjectLabelSchema, { value: "active" })],
      assets: { active: new Uint8Array([1]) },
      ranks: { active: ProjectTier.BASIC },
      metadata: { active: create(ProjectLabelSchema, { value: "active" }) },
      counts: Array(1) as never[],
      flags: [false],
    });

    expect(
      Validate.message(ProjectBatchSchema, batch).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["counts", "0"]]);
  });

  it("reports a sparse required annotated Any list index as an input violation", () => {
    const criteria = create(ProjectCriteriaSetSchema, {
      alternatives: Array(1) as never[],
      namedCriteria: {
        active: AnyPacker.pack(
          ProjectCriteriaSchema,
          create(ProjectCriteriaSchema, {
            keyword: "active",
          }),
        ),
      },
    });

    expect(
      Validate.message(ProjectCriteriaSetSchema, criteria, registry).violations.map(
        (item) => item.fieldPath?.fieldName,
      ),
    ).toEqual([["alternatives", "0"]]);
  });

  it("reports one root-relative required member under nested application Any", () => {
    const detail = create(ProjectCriteriaDetailSchema, { term: [""] });
    const criteria = create(ProjectCriteriaSchema, {
      keyword: "active",
      detail: AnyPacker.pack(ProjectCriteriaDetailSchema, detail),
    });
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(ProjectCriteriaSchema, criteria),
      projectId: ["p1"],
      tags: { team: "platform" },
    });

    const result = Validate.message(FindProjectsSchema, query, registry);

    expect(result.violations.map((item) => item.fieldPath?.fieldName)).toEqual([
      ["criteria", "detail", "term", "0"],
    ]);
    expect(result.violations[0]?.typeName).toBe(FindProjectsSchema.typeName);
  });

  it("sanitizes a throwing application registry lookup as a technical error", () => {
    const query = create(FindProjectsSchema, {
      criteria: AnyPacker.pack(ProjectCriteriaSchema, create(ProjectCriteriaSchema, {})),
      projectId: ["p1"],
      tags: { team: "platform" },
    });
    const throwing = {
      findByTypeUrl: () => {
        throw new Error("raw registry payload secret");
      },
    } as unknown as TypeRegistry;

    for (const invoke of [
      () => Validate.message(FindProjectsSchema, query, throwing),
      () => Validate.check(FindProjectsSchema, query, throwing),
    ]) {
      expect(invoke).toThrow("Validation runtime failed.");
      try {
        invoke();
      } catch (error) {
        expect(error).not.toHaveProperty("violations");
        expect(JSON.stringify(error)).not.toContain("raw registry payload secret");
      }
    }
  });
});
