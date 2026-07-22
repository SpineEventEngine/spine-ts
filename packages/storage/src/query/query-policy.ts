/** Normalized comparison operators understood by storage providers. */
export type NormalizedComparisonOperator =
  "equal" | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";

/** Provider-independent normalized query predicate. */
export type NormalizedQueryPredicate<Id> =
  | Readonly<{ kind: "ids"; ids: readonly Id[] }>
  | Readonly<{
      kind: "comparison";
      column: string;
      operator: NormalizedComparisonOperator;
      value: unknown;
    }>
  | Readonly<{
      kind: "all" | "either";
      predicates: readonly NormalizedQueryPredicate<Id>[];
    }>;

/** Provider-independent normalized query ordering. */
export interface NormalizedQueryOrder {
  readonly column: string;
  readonly direction: "asc" | "desc";
}

/** Provider-independent normalized field mask. */
export interface NormalizedQueryMask {
  readonly paths: readonly string[];
}

/** Canonical query plan accepted at the storage-provider boundary. */
export interface NormalizedQueryPlan<Id> {
  readonly predicate?: NormalizedQueryPredicate<Id>;
  readonly order?: readonly NormalizedQueryOrder[];
  readonly mask?: NormalizedQueryMask;
  readonly limit?: number;
}

/** Optional normalized query features a storage provider can execute. */
export type StorageQueryFeature = "either" | "nested" | "order" | "mask" | "limit";

/** Explicit query capabilities advertised by a storage provider. */
export interface StorageQueryCapabilities {
  readonly comparisons: readonly NormalizedComparisonOperator[];
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

/** Shared fail-fast validation for normalized plans before provider execution. */
export const StorageQueryPolicy: Readonly<{
  validate<Id>(plan: NormalizedQueryPlan<Id>, capabilities: StorageQueryCapabilities): void;
}> = Object.freeze({
  validate<Id>(plan: NormalizedQueryPlan<Id>, capabilities: StorageQueryCapabilities): void {
    const normalizedPlan = requireRecord(plan, "query plan must be an object.");
    const normalizedCapabilities = requireRecord(
      capabilities,
      "query capabilities must be an object.",
    );
    const comparisons = validateComparisons(normalizedCapabilities.comparisons);
    const features = validateFeatures(normalizedCapabilities.features);
    const requirements: QueryRequirements = {
      comparisons: new Set(),
      features: new Set(),
    };

    if (normalizedPlan.predicate !== undefined) {
      validatePredicate(normalizedPlan.predicate, requirements);
    }
    validateOrder(normalizedPlan.order, requirements);
    validateMask(normalizedPlan.mask, requirements);
    validateLimit(normalizedPlan.limit, normalizedPlan.order, requirements);
    admitCapabilities(requirements, comparisons, features);
  },
});

interface QueryRequirements {
  readonly comparisons: Set<NormalizedComparisonOperator>;
  readonly features: Set<StorageQueryFeature>;
}

function validateComparisons(value: unknown): ReadonlySet<NormalizedComparisonOperator> {
  if (!Array.isArray(value)) throw new TypeError("comparison capabilities must be an array.");
  const validated: NormalizedComparisonOperator[] = [];
  for (const comparison of value as unknown[]) {
    if (typeof comparison !== "string" || !knownComparisons.has(comparison as never)) {
      throw new TypeError("comparison capability must be recognized.");
    }
    validated.push(comparison as NormalizedComparisonOperator);
  }
  return new Set(validated);
}

function validateFeatures(value: unknown): ReadonlySet<StorageQueryFeature> {
  if (!Array.isArray(value)) throw new TypeError("query features must be an array.");
  const validated: StorageQueryFeature[] = [];
  for (const feature of value as unknown[]) {
    if (typeof feature !== "string" || !knownFeatures.has(feature as never)) {
      throw new TypeError("query feature must be recognized.");
    }
    validated.push(feature as StorageQueryFeature);
  }
  return new Set(validated);
}

function validatePredicate(root: unknown, requirements: QueryRequirements): void {
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

    const predicate = requireRecord(current.predicate, "query predicate must be an object.");
    if (seen.has(predicate)) throw new TypeError("query predicate must not contain cycles.");
    seen.add(predicate);

    if (predicate.kind === "ids") {
      if (!Array.isArray(predicate.ids)) throw new TypeError("ID predicate IDs must be an array.");
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
      throw new TypeError(`${predicate.kind.toUpperCase()} predicate predicates must be an array.`);
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
}

function validateOrder(value: unknown, requirements: QueryRequirements): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new TypeError("query order must be an array.");
  if (value.length === 0) throw new TypeError("query order must not be empty.");
  for (const candidate of value as unknown[]) {
    const order = requireRecord(candidate, "query order entry must be an object.");
    if (typeof order.column !== "string")
      throw new TypeError("query order column must be a string.");
    if (order.column.trim().length === 0)
      throw new TypeError("query order column must not be blank.");
    if (order.direction !== "asc" && order.direction !== "desc") {
      throw new TypeError("query order direction must be asc or desc.");
    }
  }
  requirements.features.add("order");
}

function validateMask(value: unknown, requirements: QueryRequirements): void {
  if (value === undefined) return;
  const mask = requireRecord(value, "field mask must be an object.");
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
}

function validateLimit(value: unknown, order: unknown, requirements: QueryRequirements): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError("query limit must be a positive integer.");
  }
  if (!Array.isArray(order) || order.length === 0) {
    throw new TypeError("query limit requires ordering.");
  }
  requirements.features.add("limit");
}

function admitCapabilities(
  requirements: QueryRequirements,
  comparisons: ReadonlySet<NormalizedComparisonOperator>,
  features: ReadonlySet<StorageQueryFeature>,
): void {
  for (const feature of requirements.features) {
    requireFeature(features, feature, featureDescription(feature));
  }
  for (const comparison of requirements.comparisons) {
    if (!comparisons.has(comparison)) {
      throw new TypeError(`Storage provider does not support comparison operator "${comparison}".`);
    }
  }
}

function featureDescription(feature: StorageQueryFeature): string {
  if (feature === "either") return "EITHER predicates";
  if (feature === "nested") return "nested predicates";
  if (feature === "order") return "ordering";
  if (feature === "mask") return "field masks";
  return "limits";
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
  return value as Record<string, unknown>;
}

function requireFeature(
  features: ReadonlySet<StorageQueryFeature>,
  feature: StorageQueryFeature,
  description: string,
): void {
  if (!features.has(feature)) {
    throw new TypeError(`Storage provider does not support ${description}.`);
  }
}
