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

import { describe, expect, it } from "vitest";

import {
  StorageQueryPolicy,
  type NormalizedQueryPlan,
  type StorageQueryCapabilities,
} from "../../src/index.js";

const completeCapabilities = Object.freeze<StorageQueryCapabilities>({
  comparisons: Object.freeze(["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"]),
  features: Object.freeze(["either", "nested", "order", "mask", "limit"]),
});

describe("StorageQueryPolicy", () => {
  it("accepts one normalized nested plan before provider execution", () => {
    const plan: NormalizedQueryPlan<string> = {
      predicate: {
        kind: "all",
        predicates: [
          { kind: "ids", ids: ["task-1", "task-2"] },
          {
            kind: "either",
            predicates: [
              { kind: "comparison", column: "priority", operator: "greaterOrEqual", value: 3 },
              { kind: "comparison", column: "status", operator: "equal", value: 1 },
            ],
          },
        ],
      },
      order: [
        { column: "priority", direction: "desc" },
        { column: "id", direction: "asc" },
      ],
      mask: { paths: ["id", "title", "status"] },
      limit: 25,
    };

    expect(() => {
      StorageQueryPolicy.validate(plan, completeCapabilities);
    }).not.toThrow();
  });

  it("rejects unsupported capabilities through the shared policy", () => {
    const equalityOnly: StorageQueryCapabilities = {
      comparisons: ["equal"],
      features: [],
    };

    expect(() => {
      StorageQueryPolicy.validate(
        {
          predicate: {
            kind: "either",
            predicates: [
              { kind: "comparison", column: "priority", operator: "greaterThan", value: 2 },
            ],
          },
          order: [{ column: "priority", direction: "asc" }],
          mask: { paths: ["title"] },
          limit: 5,
        },
        equalityOnly,
      );
    }).toThrow(/provider does not support EITHER predicates/);
    expect(() => {
      StorageQueryPolicy.validate(
        {
          predicate: {
            kind: "comparison",
            column: "priority",
            operator: "greaterThan",
            value: 2,
          },
        },
        equalityOnly,
      );
    }).toThrow(/provider does not support comparison operator "greaterThan"/);
    expect(() => {
      StorageQueryPolicy.validate(
        { order: [{ column: "priority", direction: "asc" }] },
        equalityOnly,
      );
    }).toThrow(/provider does not support ordering/);
    expect(() => {
      StorageQueryPolicy.validate({ mask: { paths: ["title"] } }, equalityOnly);
    }).toThrow(/provider does not support field masks/);
    expect(() => {
      StorageQueryPolicy.validate(
        { order: [{ column: "id", direction: "asc" }], limit: 2 },
        equalityOnly,
      );
    }).toThrow(/provider does not support ordering/);
  });

  it("rejects malformed normalized plans independently of provider policy", () => {
    expect(() => {
      StorageQueryPolicy.validate({ predicate: { kind: "ids", ids: [] } }, completeCapabilities);
    }).toThrow(/ID predicate must not be empty/);
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: { kind: "comparison", column: " ", operator: "equal", value: 1 } },
        completeCapabilities,
      );
    }).toThrow(/comparison column must not be blank/);
    expect(() => {
      StorageQueryPolicy.validate(
        {
          predicate: {
            kind: "comparison",
            column: "title",
            operator: "equal",
            value: undefined,
          },
        },
        completeCapabilities,
      );
    }).toThrow(/comparison value must be defined/);
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: { kind: "all", predicates: [] } },
        completeCapabilities,
      );
    }).toThrow(/ALL predicate must not be empty/);
    expect(() => {
      StorageQueryPolicy.validate({ limit: 5 }, completeCapabilities);
    }).toThrow(/query limit requires ordering/);
    expect(() => {
      StorageQueryPolicy.validate(
        { order: [{ column: "id", direction: "asc" }], limit: 0 },
        completeCapabilities,
      );
    }).toThrow(/query limit must be a positive integer/);
    expect(() => {
      StorageQueryPolicy.validate({ mask: { paths: ["id", " "] } }, completeCapabilities);
    }).toThrow(/field-mask paths must not be blank/);
    expect(() => {
      StorageQueryPolicy.validate(
        { order: [{ column: " ", direction: "asc" }] },
        completeCapabilities,
      );
    }).toThrow(/query order column must not be blank/);
    expect(() => {
      StorageQueryPolicy.validate({ order: [] }, completeCapabilities);
    }).toThrow(/query order must not be empty/);
    expect(() => {
      StorageQueryPolicy.validate({ mask: { paths: [] } }, completeCapabilities);
    }).toThrow(/field mask must not be empty/);
    expect(() => {
      StorageQueryPolicy.validate({ candidateLimit: 0 }, completeCapabilities);
    }).toThrow(/candidate limit must be a positive safe integer/);
    expect(() => {
      StorageQueryPolicy.validate({ candidateLimit: 10_001 }, completeCapabilities);
    }).toThrow(/candidate limit must not exceed 10,000/);
    expect(() => {
      StorageQueryPolicy.validate(
        { candidateLimit: Number.MAX_SAFE_INTEGER },
        completeCapabilities,
      );
    }).toThrow(/candidate limit must not exceed 10,000/);
    expect(() => {
      StorageQueryPolicy.validate({ candidateLimit: 10_000 }, completeCapabilities);
    }).not.toThrow();
  });

  it("detects nested groups separately from the top-level group", () => {
    const noNested: StorageQueryCapabilities = {
      comparisons: ["equal"],
      features: ["either"],
    };

    expect(() => {
      StorageQueryPolicy.validate(
        {
          predicate: {
            kind: "all",
            predicates: [
              {
                kind: "either",
                predicates: [{ kind: "comparison", column: "status", operator: "equal", value: 1 }],
              },
            ],
          },
        },
        noNested,
      );
    }).toThrow(/provider does not support nested predicates/);
  });

  it("rejects cycles and bounded traversal overflow without recursion", () => {
    const cyclic: { kind: "all"; predicates: unknown[] } = { kind: "all", predicates: [] };
    cyclic.predicates.push(cyclic);
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: cyclic } as unknown as NormalizedQueryPlan<string>,
        completeCapabilities,
      );
    }).toThrow(/predicate must not contain cycles/);

    let tooDeep: unknown = { kind: "ids", ids: ["task-1"] };
    for (let depth = 0; depth < 66; depth += 1) {
      tooDeep = { kind: "all", predicates: [tooDeep] };
    }
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: tooDeep } as NormalizedQueryPlan<string>,
        completeCapabilities,
      );
    }).toThrow(/predicate exceeds maximum depth 64/);

    const tooWide = {
      kind: "all",
      predicates: Array.from({ length: 10_001 }, () => ({ kind: "ids", ids: ["task-1"] })),
    };
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: tooWide } as NormalizedQueryPlan<string>,
        completeCapabilities,
      );
    }).toThrow(/predicate exceeds maximum node count 10000/);
  });

  it("validates every normalized runtime shape before capability admission", () => {
    const malformed = (plan: unknown, expected: RegExp): void => {
      expect(() => {
        StorageQueryPolicy.validate(plan as NormalizedQueryPlan<string>, completeCapabilities);
      }).toThrow(expected);
    };

    malformed(null, /query plan must be an object/);
    malformed({ predicate: { kind: "unknown" } }, /predicate kind must be recognized/);
    malformed({ predicate: { kind: "ids", ids: "task-1" } }, /ID predicate IDs must be an array/);
    malformed(
      { predicate: { kind: "comparison", column: 1, operator: "equal", value: 1 } },
      /comparison column must be a string/,
    );
    malformed(
      { predicate: { kind: "comparison", column: "id", operator: "unknown", value: 1 } },
      /comparison operator must be recognized/,
    );
    malformed({ predicate: { kind: "all", predicates: null } }, /predicates must be an array/);
    malformed({ order: {} }, /query order must be an array/);
    malformed({ order: [null] }, /query order entry must be an object/);
    malformed(
      { order: [{ column: "id", direction: "sideways" }] },
      /direction must be asc or desc/,
    );
    malformed({ mask: [] }, /field mask must be an object/);
    malformed({ mask: { paths: "id" } }, /field-mask paths must be an array/);
    malformed({ mask: { paths: [1] } }, /field-mask paths must be strings/);
  });

  it.each([
    [{ offset: 1 }, /do not support offset/],
    [{ unexpected: true }, /query plan property must be recognized/],
  ])("rejects unsupported normalized-plan property %o", (plan, error) => {
    expect(() => {
      StorageQueryPolicy.validate(plan as NormalizedQueryPlan<string>, completeCapabilities);
    }).toThrow(error);
  });

  it("rejects sparse arrays and malformed descendants before capability admission", () => {
    const sparseIds = Array<string>(1);
    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: { kind: "ids", ids: sparseIds } },
        completeCapabilities,
      );
    }).toThrow(/ID predicate entries must be defined/);

    const sparseMask = Array<string>(1);
    expect(() => {
      StorageQueryPolicy.validate({ mask: { paths: sparseMask } }, completeCapabilities);
    }).toThrow(/field-mask paths must be strings/);

    const sparseOrder = Array(1);
    expect(() => {
      StorageQueryPolicy.validate({ order: sparseOrder }, completeCapabilities);
    }).toThrow(/query order entry must be an object/);

    expect(() => {
      StorageQueryPolicy.validate(
        {
          predicate: {
            kind: "either",
            predicates: [{ kind: "ids", ids: [] }],
          },
        },
        { comparisons: [], features: [] },
      );
    }).toThrow(/ID predicate must not be empty/);
  });

  it("rejects an over-budget group before reading or enqueueing its children", () => {
    const children = Array<NormalizedQueryPlan<string>["predicate"]>(10_000);
    let childReads = 0;
    Object.defineProperty(children, 0, {
      configurable: true,
      get() {
        childReads += 1;
        return { kind: "ids", ids: ["task-1"] };
      },
    });

    expect(() => {
      StorageQueryPolicy.validate(
        { predicate: { kind: "all", predicates: children as never } },
        completeCapabilities,
      );
    }).toThrow(/predicate exceeds maximum node count 10000/);
    expect(childReads).toBe(0);
  });

  it("validates capability containers and discriminants", () => {
    expect(() => {
      StorageQueryPolicy.validate({}, null as unknown as StorageQueryCapabilities);
    }).toThrow(/query capabilities must be an object/);
    expect(() => {
      StorageQueryPolicy.validate({}, { comparisons: "equal", features: [] } as never);
    }).toThrow(/comparison capabilities must be an array/);
    expect(() => {
      StorageQueryPolicy.validate({}, { comparisons: ["unknown"], features: [] } as never);
    }).toThrow(/comparison capability must be recognized/);
    expect(() => {
      StorageQueryPolicy.validate({}, { comparisons: [], features: "order" } as never);
    }).toThrow(/query features must be an array/);
    expect(() => {
      StorageQueryPolicy.validate({}, { comparisons: [], features: ["unknown"] } as never);
    }).toThrow(/query feature must be recognized/);
  });
});
