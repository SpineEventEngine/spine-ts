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

import type {
  NormalizedComparisonOperator,
  NormalizedQueryPlan,
  NormalizedQueryPredicate,
} from "./query-policy.js";

/**
 * Finite default number of provider candidates a normalized plan may materialize.
 */
export const defaultQueryCandidateLimit = 10_000;

/**
 * One materialized storage row accepted by the shared normalized evaluator.
 */
export interface NormalizedQueryEntry<Id, Record> {
  // prettier-ignore

  /**
   * Identifies the stored row.
   */
  readonly id: Id;

  /**
   * Carries the materialized stored record.
   */
  readonly record: Record;

  /**
   * Maps normalized query columns to row values.
   */
  readonly columns: ReadonlyMap<string, unknown>;
}

/**
 * Raised before evaluating a plan that exceeded its finite candidate budget.
 */
export class QueryCandidateLimitError extends Error {
  // prettier-ignore

  /**
   * Creates a candidate-limit error.
   *
   * @param candidateLimit Specifies the exceeded candidate budget.
   */
  constructor(readonly candidateLimit: number) {
    super(`Storage query exceeded the candidate limit of ${String(candidateLimit)}.`);
    this.name = "QueryCandidateLimitError";
  }
}

/**
 * Shared complete in-process semantics for one validated normalized query plan.
 */
export const StorageQueryEvaluator: Readonly<{
  evaluate<Id, Record>(
    entries: readonly NormalizedQueryEntry<Id, Record>[],
    plan: NormalizedQueryPlan<Id>,
  ): readonly NormalizedQueryEntry<Id, Record>[];
}> = Object.freeze({
  evaluate<Id, Record>(
    entries: readonly NormalizedQueryEntry<Id, Record>[],
    plan: NormalizedQueryPlan<Id>,
  ): readonly NormalizedQueryEntry<Id, Record>[] {
    const predicate = plan.predicate;
    const matching =
      predicate === undefined
        ? [...entries]
        : entries.filter((entry) => QueryPredicateMatcher.matches(entry, predicate));
    const ordered = matching.sort((left, right) => QueryOrdering.compareEntries(left, right, plan));
    return plan.limit === undefined ? ordered : ordered.slice(0, plan.limit);
  },
});

/**
 * Shared deterministic value semantics for provider-side query adapters.
 *
 * @internal
 */
export const StorageQueryValues: Readonly<{
  equal(left: unknown, right: unknown): boolean;
  compare(left: unknown, right: unknown): number;
}> = Object.freeze({
  equal(left: unknown, right: unknown): boolean {
    return QueryPredicateMatcher.equalValues(left, right);
  },

  compare(left: unknown, right: unknown): number {
    return QueryOrdering.compareStable(left, right);
  },
});

/**
 * Matches normalized predicates against materialized storage rows.
 */
const QueryPredicateMatcher = {
  // prettier-ignore

  /**
   * Matches a row against one normalized predicate.
   */
  matches<Id, Record>(
    entry: NormalizedQueryEntry<Id, Record>,
    predicate: NormalizedQueryPredicate<Id>,
  ): boolean {
    switch (predicate.kind) {
      case "ids":
        return predicate.ids.some((id) => QueryPredicateMatcher.equalValues(id, entry.id));
      case "comparison":
        return QueryPredicateMatcher.comparePredicate(
          entry.columns.get(predicate.column),
          predicate.operator,
          predicate.value,
        );
      case "all":
        return predicate.predicates.every((child) => QueryPredicateMatcher.matches(entry, child));
      case "either":
        return predicate.predicates.some((child) => QueryPredicateMatcher.matches(entry, child));
    }
  },

  /**
   * Evaluates one normalized comparison predicate.
   */
  comparePredicate(
    actual: unknown,
    operator: NormalizedComparisonOperator,
    expected: unknown,
  ): boolean {
    if (operator === "equal") return QueryPredicateMatcher.equalValues(actual, expected);
    if (QueryOrdering.isMissing(actual) || QueryOrdering.isMissing(expected)) return false;
    const result = QueryOrdering.compareOrdered(actual, expected);
    if (operator === "greaterThan") return result > 0;
    if (operator === "lessThan") return result < 0;
    if (operator === "greaterOrEqual") return result >= 0;
    return result <= 0;
  },

  /**
   * Compares values using normalized query equality semantics.
   */
  equalValues(left: unknown, right: unknown): boolean {
    if (QueryOrdering.isMissing(left) || QueryOrdering.isMissing(right)) {
      return QueryOrdering.isMissing(left) && QueryOrdering.isMissing(right);
    }
    return QueryOrdering.stableKey(left) === QueryOrdering.stableKey(right);
  },
};

/**
 * Orders normalized query values and materialized rows deterministically.
 */
const QueryOrdering = {
  // prettier-ignore

  /**
   * Compares two rows by requested ordering and stable ID tie-breaker.
   */
  compareEntries<Id, Record>(
    left: NormalizedQueryEntry<Id, Record>,
    right: NormalizedQueryEntry<Id, Record>,
    plan: NormalizedQueryPlan<Id>,
  ): number {
    for (const order of plan.order ?? []) {
      const comparison = QueryOrdering.compareWithMissing(
        left.columns.get(order.column),
        right.columns.get(order.column),
      );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return QueryOrdering.compareStable(left.id, right.id);
  },

  /**
   * Compares values while placing missing values before present values.
   */
  compareWithMissing(left: unknown, right: unknown): number {
    if (QueryOrdering.isMissing(left) || QueryOrdering.isMissing(right)) {
      if (QueryOrdering.isMissing(left) && QueryOrdering.isMissing(right)) return 0;
      return QueryOrdering.isMissing(left) ? -1 : 1;
    }
    return QueryOrdering.compareOrdered(left, right);
  },

  /**
   * Compares values supported by normalized query ordering.
   */
  compareOrdered(left: unknown, right: unknown): number {
    if (typeof left === "number" && typeof right === "number")
      return QueryOrdering.compareNumber(left, right);
    if (typeof left === "bigint" && typeof right === "bigint") {
      return left < right ? -1 : left > right ? 1 : 0;
    }
    if (typeof left === "string" && typeof right === "string")
      return QueryOrdering.compareText(left, right);
    if (
      QueryOrdering.isOrderedMessage(left) &&
      QueryOrdering.isOrderedMessage(right) &&
      left.$typeName === right.$typeName
    ) {
      if (left.$typeName === "google.protobuf.Timestamp") {
        return QueryOrdering.comparePair(left.seconds, left.nanos, right.seconds, right.nanos);
      }
      return QueryOrdering.comparePair(left.number, left.timestamp, right.number, right.timestamp);
    }
    throw new TypeError("Normalized query ordering value has an unsupported type.");
  },

  /**
   * Compares ordered-message major and minor components.
   */
  comparePair(
    leftMajor: unknown,
    leftMinor: unknown,
    rightMajor: unknown,
    rightMinor: unknown,
  ): number {
    const major = QueryOrdering.compareStable(leftMajor, rightMajor);
    return major === 0 ? QueryOrdering.compareStable(leftMinor, rightMinor) : major;
  },

  /**
   * Compares values with a deterministic fallback for distinct shapes.
   */
  compareStable(left: unknown, right: unknown): number {
    if (QueryOrdering.isMissing(left) || QueryOrdering.isMissing(right))
      return QueryOrdering.compareWithMissing(left, right);
    if (typeof left === typeof right && ["number", "bigint", "string"].includes(typeof left)) {
      return QueryOrdering.compareOrdered(left, right);
    }
    return QueryOrdering.compareText(QueryOrdering.stableKey(left), QueryOrdering.stableKey(right));
  },

  /**
   * Creates a deterministic value representation for equality and tie-breaking.
   */
  stableKey(value: unknown): string {
    if (value instanceof Uint8Array) return `bytes:${[...value].join(".")}`;
    if (typeof value === "bigint") return `bigint:${value.toString()}`;
    if (typeof value !== "object" || value === null) return `${typeof value}:${String(value)}`;
    if (Array.isArray(value))
      return `array:[${value.map((item) => QueryOrdering.stableKey(item)).join(",")}]`;
    return `object:{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${QueryOrdering.stableKey(Reflect.get(value, key))}`)
      .join(",")}}`;
  },

  /**
   * Identifies ordered Protobuf timestamp and version values.
   */
  isOrderedMessage(value: unknown): value is {
    readonly $typeName: "google.protobuf.Timestamp" | "spine.core.Version";
    readonly seconds?: bigint;
    readonly nanos?: number;
    readonly number?: number;
    readonly timestamp?: unknown;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      (Reflect.get(value, "$typeName") === "google.protobuf.Timestamp" ||
        Reflect.get(value, "$typeName") === "spine.core.Version")
    );
  },

  /**
   * Compares finite numeric values.
   */
  compareNumber(left: number, right: number): number {
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      throw new TypeError("Normalized query ordering numbers must be finite.");
    }
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares text values in code-unit order.
   */
  compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Identifies absent normalized query values.
   */
  isMissing(value: unknown): boolean {
    return value === undefined || value === null;
  },
};
