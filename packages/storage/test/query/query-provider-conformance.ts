import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { expect } from "vitest";

import type { NormalizedQueryPlan } from "../../src/index.js";

export const queryProviderConformanceRecords = ["a-1", "b-2", "c-3"] as const;

export interface QueryProviderConformanceAdapter {
  readonly name: "in-memory" | "mysql" | "datastore";
  readonly storage: {
    writeAll(records: Iterable<StringValue>): Promise<void>;
    queryPlan(plan: NormalizedQueryPlan<string>): Promise<readonly StringValue[]>;
  };
  readonly providerCalls: () => number;
  readonly beforeRead?: () => void | Promise<void>;
}

/** Shared result and pre-provider policy fixture for every Wave 1 query adapter. */
export async function assertQueryProviderConformance(
  adapter: QueryProviderConformanceAdapter,
): Promise<void> {
  await adapter.storage.writeAll(
    queryProviderConformanceRecords.map((value) => create(StringValueSchema, { value })),
  );
  await adapter.beforeRead?.();

  const result = await adapter.storage.queryPlan({
    predicate: {
      kind: "all",
      predicates: [
        { kind: "comparison", column: "group", operator: "greaterOrEqual", value: "b" },
        {
          kind: "either",
          predicates: [
            { kind: "ids", ids: ["b-2"] },
            { kind: "ids", ids: ["c-3"] },
          ],
        },
      ],
    },
    order: [{ column: "group", direction: "desc" }],
    mask: { paths: ["value"] },
    limit: 2,
  });

  expect(
    result.map((record) => record.value),
    `${adapter.name} supported query result`,
  ).toEqual(["c-3", "b-2"]);

  const callsBeforeRejection = adapter.providerCalls();
  await expect(
    adapter.storage.queryPlan({ predicate: { kind: "either", predicates: [] } }),
    `${adapter.name} malformed plan rejection`,
  ).rejects.toThrow("EITHER predicate must not be empty");
  expect(adapter.providerCalls(), `${adapter.name} provider access after policy rejection`).toBe(
    callsBeforeRejection,
  );
}
