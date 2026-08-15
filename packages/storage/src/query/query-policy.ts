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

/**
 * Normalized comparison operators understood by storage providers.
 */
export type NormalizedComparisonOperator =
  "equal" | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";

/**
 * Provider-independent normalized query predicate.
 */
export type NormalizedQueryPredicate<Id> =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies the predicate as an explicit ID set.
       */
      kind: "ids";

      /**
       * Lists the IDs selected by the predicate.
       */
      ids: readonly Id[];
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies the predicate as a column comparison.
       */
      kind: "comparison";

      /**
       * Names the compared record column.
       */
      column: string;

      /**
       * Selects the comparison operator.
       */
      operator: NormalizedComparisonOperator;

      /**
       * Provides the value compared against the column.
       */
      value: unknown;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies the predicate as an all-or-either composition.
       */
      kind: "all" | "either";

      /**
       * Lists the component predicates.
       */
      predicates: readonly NormalizedQueryPredicate<Id>[];
    }>;

/**
 * Provider-independent normalized query ordering.
 */
export interface NormalizedQueryOrder {
  // prettier-ignore

  /**
   * Names the column used for ordering.
   */
  readonly column: string;

  /**
   * Selects ascending or descending order.
   */
  readonly direction: "asc" | "desc";
}

/**
 * Provider-independent normalized field mask.
 */
export interface NormalizedQueryMask {
  // prettier-ignore

  /**
   * Lists the record paths retained by the mask.
   */
  readonly paths: readonly string[];
}

/**
 * Canonical query plan accepted at the storage-provider boundary.
 */
export interface NormalizedQueryPlan<Id> {
  // prettier-ignore

  /**
   * Defines the optional predicate.
   */
  readonly predicate?: NormalizedQueryPredicate<Id>;

  /**
   * Defines the optional ordering.
   */
  readonly order?: readonly NormalizedQueryOrder[];

  /**
   * Defines the optional field mask.
   */
  readonly mask?: NormalizedQueryMask;

  /**
   * Limits matching rows after ordering.
   */
  readonly limit?: number;

  /**
   * Maximum provider rows materialized before semantic evaluation. Values must
   * be positive safe integers; the default and inclusive maximum are 10,000.
   */
  readonly candidateLimit?: number;
}

/**
 * Optional normalized query features a storage provider can execute.
 */
export type StorageQueryFeature = "either" | "nested" | "order" | "mask" | "limit";

/**
 * Explicit query capabilities advertised by a storage provider.
 */
export interface StorageQueryCapabilities {
  // prettier-ignore

  /**
   * Lists supported comparison operators.
   */
  readonly comparisons: readonly NormalizedComparisonOperator[];

  /**
   * Lists supported normalized query features.
   */
  readonly features: readonly StorageQueryFeature[];
}

const maximumPredicateDepth = 64;
const maximumPredicateNodes = 10_000;
const knownComparisons = new Set<NormalizedComparisonOperator>([
  "equal",
  "greaterThan",
  "lessThan",
  "greaterOrEqual",
  "lessOrEqual",
]);
const knownFeatures = new Set<StorageQueryFeature>(["either", "nested", "order", "mask", "limit"]);
const knownPlanProperties = new Set(["predicate", "order", "mask", "limit", "candidateLimit"]);

/**
 * Shared fail-fast validation for normalized plans before provider execution.
 */
export const StorageQueryPolicy: Readonly<{
  validate<Id>(plan: NormalizedQueryPlan<Id>, capabilities: StorageQueryCapabilities): void;
}> = Object.freeze({
  validate<Id>(plan: NormalizedQueryPlan<Id>, capabilities: StorageQueryCapabilities): void {
    const normalizedPlan = QueryPlanValidator.requireRecord(plan, "query plan must be an object.");
    const normalizedCapabilities = QueryPlanValidator.requireRecord(
      capabilities,
      "query capabilities must be an object.",
    );
    QueryPlanValidator.validatePlanProperties(normalizedPlan);
    const comparisons = QueryCapabilities.validateComparisons(normalizedCapabilities.comparisons);
    const features = QueryCapabilities.validateFeatures(normalizedCapabilities.features);
    const requirements: QueryRequirements = {
      comparisons: new Set(),
      features: new Set(),
    };

    if (normalizedPlan.predicate !== undefined) {
      QueryPlanValidator.validatePredicate(normalizedPlan.predicate, requirements);
    }
    QueryPlanValidator.validateOrder(normalizedPlan.order, requirements);
    QueryPlanValidator.validateMask(normalizedPlan.mask, requirements);
    QueryPlanValidator.validateLimit(normalizedPlan.limit, normalizedPlan.order, requirements);
    QueryPlanValidator.validateCandidateLimit(normalizedPlan.candidateLimit);
    QueryCapabilities.admit(requirements, comparisons, features);
  },
});

/**
 * Captures normalized features and comparisons required by a validated plan.
 */
interface QueryRequirements {
  readonly comparisons: Set<NormalizedComparisonOperator>;
  readonly features: Set<StorageQueryFeature>;
}

/**
 * Validates normalized plan values and accumulates their required capabilities.
 */
const QueryPlanValidator = {
  // prettier-ignore

  /**
   * Rejects unsupported or misspelled normalized-plan properties.
   */
  validatePlanProperties(plan: Record<string, unknown>): void {
    if (Object.hasOwn(plan, "offset")) {
      throw new TypeError("normalized query plans do not support offset.");
    }
    for (const property of Object.keys(plan)) {
      if (!knownPlanProperties.has(property)) {
        throw new TypeError("query plan property must be recognized.");
      }
    }
  },

  /**
   * Validates the maximum materialized candidate count.
   */
  validateCandidateLimit(value: unknown): void {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("query candidate limit must be a positive safe integer.");
    }
    if (value > 10_000) throw new TypeError("query candidate limit must not exceed 10,000.");
  },

  /**
   * Validates a normalized predicate tree and records its required capabilities.
   */
  validatePredicate(root: unknown, requirements: QueryRequirements): void {
    const pending: { readonly predicate: unknown; readonly depth: number }[] = [
      { predicate: root, depth: 0 },
    ];
    const seen = new WeakSet<object>();
    let visited = 0;

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      visited += 1;
      if (visited > maximumPredicateNodes) {
        throw new TypeError(
          `query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
        );
      }
      if (current.depth > maximumPredicateDepth) {
        throw new TypeError(
          `query predicate exceeds maximum depth ${String(maximumPredicateDepth)}.`,
        );
      }

      const predicate = QueryPlanValidator.requireRecord(
        current.predicate,
        "query predicate must be an object.",
      );
      if (seen.has(predicate)) throw new TypeError("query predicate must not contain cycles.");
      seen.add(predicate);

      if (predicate.kind === "ids") {
        if (!Array.isArray(predicate.ids))
          throw new TypeError("ID predicate IDs must be an array.");
        if (predicate.ids.length === 0) throw new TypeError("ID predicate must not be empty.");
        for (let index = 0; index < predicate.ids.length; index += 1) {
          if (!Object.hasOwn(predicate.ids, index) || predicate.ids[index] === undefined) {
            throw new TypeError("ID predicate entries must be defined.");
          }
        }
        continue;
      }
      if (predicate.kind === "comparison") {
        if (typeof predicate.column !== "string") {
          throw new TypeError("comparison column must be a string.");
        }
        if (predicate.column.trim().length === 0) {
          throw new TypeError("comparison column must not be blank.");
        }
        if (
          typeof predicate.operator !== "string" ||
          !knownComparisons.has(predicate.operator as never)
        ) {
          throw new TypeError("comparison operator must be recognized.");
        }
        if (predicate.value === undefined) throw new TypeError("comparison value must be defined.");
        requirements.comparisons.add(predicate.operator as NormalizedComparisonOperator);
        continue;
      }
      if (predicate.kind !== "all" && predicate.kind !== "either") {
        throw new TypeError("query predicate kind must be recognized.");
      }
      if (!Array.isArray(predicate.predicates)) {
        throw new TypeError(
          `${predicate.kind.toUpperCase()} predicate predicates must be an array.`,
        );
      }
      if (predicate.predicates.length === 0) {
        throw new TypeError(`${predicate.kind.toUpperCase()} predicate must not be empty.`);
      }
      if (predicate.kind === "either") requirements.features.add("either");
      if (current.depth > 0) requirements.features.add("nested");
      if (visited + pending.length + predicate.predicates.length > maximumPredicateNodes) {
        throw new TypeError(
          `query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
        );
      }
      for (let index = predicate.predicates.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(predicate.predicates, index)) {
          throw new TypeError("query predicate entries must be defined.");
        }
        pending.push({ predicate: predicate.predicates[index], depth: current.depth + 1 });
      }
    }
  },

  /**
   * Validates normalized ordering and records the ordering capability.
   */
  validateOrder(value: unknown, requirements: QueryRequirements): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new TypeError("query order must be an array.");
    if (value.length === 0) throw new TypeError("query order must not be empty.");
    for (const candidate of value as unknown[]) {
      const order = QueryPlanValidator.requireRecord(
        candidate,
        "query order entry must be an object.",
      );
      if (typeof order.column !== "string")
        throw new TypeError("query order column must be a string.");
      if (order.column.trim().length === 0)
        throw new TypeError("query order column must not be blank.");
      if (order.direction !== "asc" && order.direction !== "desc") {
        throw new TypeError("query order direction must be asc or desc.");
      }
    }
    requirements.features.add("order");
  },

  /**
   * Validates a normalized field mask and records the mask capability.
   */
  validateMask(value: unknown, requirements: QueryRequirements): void {
    if (value === undefined) return;
    const mask = QueryPlanValidator.requireRecord(value, "field mask must be an object.");
    if (!Array.isArray(mask.paths)) throw new TypeError("field-mask paths must be an array.");
    if (mask.paths.length === 0) throw new TypeError("field mask must not be empty.");
    const paths = mask.paths as unknown[];
    for (let index = 0; index < paths.length; index += 1) {
      const path: unknown = paths[index];
      if (!Object.hasOwn(paths, index) || typeof path !== "string") {
        throw new TypeError("field-mask paths must be strings.");
      }
      if (path.trim().length === 0) throw new TypeError("field-mask paths must not be blank.");
    }
    requirements.features.add("mask");
  },

  /**
   * Validates a result limit and records the limit capability.
   */
  validateLimit(value: unknown, order: unknown, requirements: QueryRequirements): void {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new TypeError("query limit must be a positive integer.");
    }
    if (!Array.isArray(order) || order.length === 0) {
      throw new TypeError("query limit requires ordering.");
    }
    requirements.features.add("limit");
  },

  /**
   * Requires a non-array object value and returns its properties.
   */
  requireRecord(value: unknown, message: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(message);
    }
    return value as Record<string, unknown>;
  },
};

/**
 * Validates advertised capabilities and admits normalized query requirements.
 */
const QueryCapabilities = {
  // prettier-ignore

  /**
   * Validates advertised comparison operators.
   */
  validateComparisons(value: unknown): ReadonlySet<NormalizedComparisonOperator> {
    if (!Array.isArray(value)) throw new TypeError("comparison capabilities must be an array.");
    const validated: NormalizedComparisonOperator[] = [];
    for (const comparison of value as unknown[]) {
      if (typeof comparison !== "string" || !knownComparisons.has(comparison as never)) {
        throw new TypeError("comparison capability must be recognized.");
      }
      validated.push(comparison as NormalizedComparisonOperator);
    }
    return new Set(validated);
  },

  /**
   * Validates advertised normalized query features.
   */
  validateFeatures(value: unknown): ReadonlySet<StorageQueryFeature> {
    if (!Array.isArray(value)) throw new TypeError("query features must be an array.");
    const validated: StorageQueryFeature[] = [];
    for (const feature of value as unknown[]) {
      if (typeof feature !== "string" || !knownFeatures.has(feature as never)) {
        throw new TypeError("query feature must be recognized.");
      }
      validated.push(feature as StorageQueryFeature);
    }
    return new Set(validated);
  },

  /**
   * Rejects requirements that an advertised provider capability set does not satisfy.
   */
  admit(
    requirements: QueryRequirements,
    comparisons: ReadonlySet<NormalizedComparisonOperator>,
    features: ReadonlySet<StorageQueryFeature>,
  ): void {
    for (const feature of requirements.features) {
      QueryCapabilities.requireFeature(
        features,
        feature,
        QueryCapabilities.featureDescription(feature),
      );
    }
    for (const comparison of requirements.comparisons) {
      if (!comparisons.has(comparison)) {
        throw new TypeError(
          `Storage provider does not support comparison operator "${comparison}".`,
        );
      }
    }
  },

  /**
   * Describes a capability in a provider-rejection message.
   */
  featureDescription(feature: StorageQueryFeature): string {
    if (feature === "either") return "EITHER predicates";
    if (feature === "nested") return "nested predicates";
    if (feature === "order") return "ordering";
    if (feature === "mask") return "field masks";
    return "limits";
  },

  /**
   * Rejects a missing required feature with its provider-facing description.
   */
  requireFeature(
    features: ReadonlySet<StorageQueryFeature>,
    feature: StorageQueryFeature,
    description: string,
  ): void {
    if (!features.has(feature)) {
      throw new TypeError(`Storage provider does not support ${description}.`);
    }
  },
};
