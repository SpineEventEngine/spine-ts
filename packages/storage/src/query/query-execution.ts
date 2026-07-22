import type {
  NormalizedComparisonOperator,
  NormalizedQueryPlan,
  NormalizedQueryPredicate,
} from "./query-policy.js";

/** One materialized storage row accepted by the shared normalized evaluator. */
export interface NormalizedQueryEntry<Id, Record> {
  readonly id: Id;
  readonly record: Record;
  readonly columns: ReadonlyMap<string, unknown>;
}

/** Raised before evaluating a plan that exceeded its finite candidate budget. */
export class StorageQueryCandidateLimitError extends Error {
  constructor(readonly candidateLimit: number) {
    super(`Storage query exceeded the candidate limit of ${String(candidateLimit)}.`);
    this.name = "StorageQueryCandidateLimitError";
  }
}

/** Shared complete in-process semantics for one validated normalized query plan. */
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
      predicate === undefined ? [...entries] : entries.filter((entry) => matches(entry, predicate));
    const ordered = matching.sort((left, right) => compareEntries(left, right, plan));
    return plan.limit === undefined ? ordered : ordered.slice(0, plan.limit);
  },
});

function matches<Id, Record>(
  entry: NormalizedQueryEntry<Id, Record>,
  predicate: NormalizedQueryPredicate<Id>,
): boolean {
  switch (predicate.kind) {
    case "ids":
      return predicate.ids.some((id) => equalValues(id, entry.id));
    case "comparison":
      return comparePredicate(
        entry.columns.get(predicate.column),
        predicate.operator,
        predicate.value,
      );
    case "all":
      return predicate.predicates.every((child) => matches(entry, child));
    case "either":
      return predicate.predicates.some((child) => matches(entry, child));
  }
}

function comparePredicate(
  actual: unknown,
  operator: NormalizedComparisonOperator,
  expected: unknown,
): boolean {
  if (operator === "equal") return equalValues(actual, expected);
  if (missing(actual) || missing(expected)) return false;
  const result = compareOrdered(actual, expected);
  if (operator === "greaterThan") return result > 0;
  if (operator === "lessThan") return result < 0;
  if (operator === "greaterOrEqual") return result >= 0;
  return result <= 0;
}

function compareEntries<Id, Record>(
  left: NormalizedQueryEntry<Id, Record>,
  right: NormalizedQueryEntry<Id, Record>,
  plan: NormalizedQueryPlan<Id>,
): number {
  for (const order of plan.order ?? []) {
    const comparison = compareWithMissing(
      left.columns.get(order.column),
      right.columns.get(order.column),
    );
    if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
  }
  return compareStable(left.id, right.id);
}

function compareWithMissing(left: unknown, right: unknown): number {
  if (missing(left) || missing(right)) {
    if (missing(left) && missing(right)) return 0;
    return missing(left) ? -1 : 1;
  }
  return compareOrdered(left, right);
}

function compareOrdered(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return compareNumber(left, right);
  if (typeof left === "bigint" && typeof right === "bigint")
    return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === "string" && typeof right === "string") return compareText(left, right);
  if (isOrderedMessage(left) && isOrderedMessage(right) && left.$typeName === right.$typeName) {
    if (left.$typeName === "google.protobuf.Timestamp") {
      return comparePair(left.seconds, left.nanos, right.seconds, right.nanos);
    }
    return comparePair(left.number, left.timestamp, right.number, right.timestamp);
  }
  throw new TypeError("Normalized query ordering value has an unsupported type.");
}

function comparePair(
  leftMajor: unknown,
  leftMinor: unknown,
  rightMajor: unknown,
  rightMinor: unknown,
): number {
  const major = compareStable(leftMajor, rightMajor);
  return major === 0 ? compareStable(leftMinor, rightMinor) : major;
}

function compareStable(left: unknown, right: unknown): number {
  if (missing(left) || missing(right)) return compareWithMissing(left, right);
  if (typeof left === typeof right && ["number", "bigint", "string"].includes(typeof left)) {
    return compareOrdered(left, right);
  }
  return compareText(stableKey(left), stableKey(right));
}

function equalValues(left: unknown, right: unknown): boolean {
  if (missing(left) || missing(right)) return missing(left) && missing(right);
  return stableKey(left) === stableKey(right);
}

function stableKey(value: unknown): string {
  if (value instanceof Uint8Array) return `bytes:${[...value].join(".")}`;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value !== "object" || value === null) return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(stableKey).join(",")}]`;
  return `object:{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(Reflect.get(value, key))}`)
    .join(",")}}`;
}

function isOrderedMessage(value: unknown): value is {
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
}

function compareNumber(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new TypeError("Normalized query ordering numbers must be finite.");
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function missing(value: unknown): boolean {
  return value === undefined || value === null;
}
