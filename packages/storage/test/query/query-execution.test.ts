import { describe, expect, it } from "vitest";

import { StorageQueryEvaluator, type NormalizedQueryEntry } from "../../src/index.js";

interface Row {
  readonly id: string;
}

const rows: readonly NormalizedQueryEntry<string, Row>[] = [
  entry("a", { priority: 2, title: "Beta", owner: undefined }),
  entry("b", { priority: 2, title: "Alpha", owner: "Ada" }),
  entry("c", { priority: 4, title: "Gamma", owner: null }),
  entry("d", { priority: 1, title: "Alpha", owner: "Bob" }),
];

describe("StorageQueryEvaluator", () => {
  it("evaluates nested ALL/EITHER comparisons with the complete truth table", () => {
    const result = StorageQueryEvaluator.evaluate(rows, {
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "priority", operator: "greaterOrEqual", value: 2 },
          {
            kind: "either",
            predicates: [
              { kind: "comparison", column: "title", operator: "equal", value: "Alpha" },
              { kind: "comparison", column: "priority", operator: "greaterThan", value: 3 },
            ],
          },
        ],
      },
    });

    expect(result.map(({ id }) => id)).toEqual(["b", "c"]);
  });

  it("preserves repeated ordering, places missing first ascending, and breaks ties by ID", () => {
    const ascending = StorageQueryEvaluator.evaluate(rows, {
      order: [
        { column: "owner", direction: "asc" },
        { column: "title", direction: "asc" },
      ],
    });
    const descending = StorageQueryEvaluator.evaluate(rows, {
      order: [{ column: "owner", direction: "desc" }],
      limit: 3,
    });

    expect(ascending.map(({ id }) => id)).toEqual(["a", "c", "b", "d"]);
    expect(descending.map(({ id }) => id)).toEqual(["d", "b", "a"]);
  });

  it("supports IDs and every comparison operator", () => {
    const operators = [
      ["equal", 2, ["a", "b"]],
      ["greaterThan", 2, ["c"]],
      ["lessThan", 2, ["d"]],
      ["greaterOrEqual", 2, ["a", "b", "c"]],
      ["lessOrEqual", 2, ["a", "b", "d"]],
    ] as const;

    for (const [operator, value, expected] of operators) {
      const result = StorageQueryEvaluator.evaluate(rows, {
        predicate: {
          kind: "all",
          predicates: [
            { kind: "ids", ids: ["a", "b", "c", "d"] },
            { kind: "comparison", column: "priority", operator, value },
          ],
        },
      });
      expect(result.map(({ id }) => id)).toEqual(expected);
    }
  });

  it("compares ordered protobuf values, bigints, and stable structured values", () => {
    const typedRows = [
      entry("a", {
        sequence: 2n,
        timestamp: { $typeName: "google.protobuf.Timestamp", seconds: 3n, nanos: 1 },
        version: { $typeName: "spine.core.Version", number: 1, timestamp: "b" },
        bytes: new Uint8Array([1, 2]),
        structured: { tags: ["a", 1] },
      }),
      entry("b", {
        sequence: 1n,
        timestamp: { $typeName: "google.protobuf.Timestamp", seconds: 2n, nanos: 9 },
        version: { $typeName: "spine.core.Version", number: 1, timestamp: "a" },
        bytes: new Uint8Array([1, 3]),
        structured: { tags: ["b", 1] },
      }),
    ];

    expect(
      StorageQueryEvaluator.evaluate(typedRows, {
        predicate: {
          kind: "all",
          predicates: [
            { kind: "comparison", column: "sequence", operator: "greaterThan", value: 1n },
            {
              kind: "comparison",
              column: "bytes",
              operator: "equal",
              value: new Uint8Array([1, 2]),
            },
            {
              kind: "comparison",
              column: "structured",
              operator: "equal",
              value: { tags: ["a", 1] },
            },
          ],
        },
      }).map(({ id }) => id),
    ).toEqual(["a"]);
    expect(
      StorageQueryEvaluator.evaluate(typedRows, {
        order: [
          { column: "timestamp", direction: "asc" },
          { column: "version", direction: "asc" },
        ],
      }).map(({ id }) => id),
    ).toEqual(["b", "a"]);
    expect(
      StorageQueryEvaluator.evaluate(typedRows, {
        order: [{ column: "version", direction: "asc" }],
      }).map(({ id }) => id),
    ).toEqual(["b", "a"]);
  });

  it("handles missing equality and rejects unsupported or non-finite ordering values", () => {
    expect(
      StorageQueryEvaluator.evaluate(rows, {
        predicate: { kind: "comparison", column: "owner", operator: "equal", value: undefined },
      }).map(({ id }) => id),
    ).toEqual(["a", "c"]);
    expect(
      StorageQueryEvaluator.evaluate(rows, {
        predicate: {
          kind: "comparison",
          column: "owner",
          operator: "greaterThan",
          value: undefined,
        },
      }),
    ).toEqual([]);
    expect(() =>
      StorageQueryEvaluator.evaluate([entry("a", { value: true }), entry("b", { value: false })], {
        order: [{ column: "value", direction: "asc" }],
      }),
    ).toThrow("unsupported type");
    expect(() =>
      StorageQueryEvaluator.evaluate(
        [entry("a", { value: Number.NaN }), entry("b", { value: 1 })],
        {
          order: [{ column: "value", direction: "asc" }],
        },
      ),
    ).toThrow("must be finite");
  });

  it("uses stable ordering for numeric, bigint, and structured IDs", () => {
    expect(
      StorageQueryEvaluator.evaluate([entry(2, {}), entry(1, {})], {}).map(({ id }) => id),
    ).toEqual([1, 2]);
    expect(
      StorageQueryEvaluator.evaluate([entry(2n, {}), entry(1n, {})], {}).map(({ id }) => id),
    ).toEqual([1n, 2n]);
    expect(
      StorageQueryEvaluator.evaluate(
        [entry({ value: "b" }, {}), entry({ value: "a" }, {})],
        {},
      ).map(({ id }) => id),
    ).toEqual([{ value: "a" }, { value: "b" }]);
  });
});

function entry<Id>(
  id: Id,
  columns: Readonly<Record<string, unknown>>,
): NormalizedQueryEntry<Id, Row> {
  return { id, record: { id: String(id) }, columns: new Map(Object.entries(columns)) };
}
