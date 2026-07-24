import {
  clone,
  create,
  getOption,
  hasOption,
  ScalarType,
  toBinary,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  BoolValueSchema,
  AnySchema,
  BytesValueSchema,
  DoubleValueSchema,
  FloatValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  UInt32ValueSchema,
  UInt64ValueSchema,
} from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  VersionSchema,
  type_url_prefix,
  type ActorContext,
} from "@spine-event-engine/proto";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  IdFilterSchema,
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  TargetFiltersSchema,
  TargetSchema,
  type CompositeFilter,
  type Query,
} from "@spine-event-engine/proto/client";

import {
  ProjectionColumn,
  type ProjectionColumnOperator,
  type ProjectionColumnValue,
} from "../projection/projection-column.js";

type ProjectionColumnCollection<Schema extends GenMessage<Message>> = Readonly<
  Record<string, ProjectionColumn<Schema>>
>;
type PredicateColumn<Predicate> =
  Predicate extends ProjectionPredicate<infer Column> ? Column : never;
type ColumnSchema<Column> = Column extends ProjectionColumn<infer Schema> ? Schema : never;
type ColumnName<Column> =
  Column extends ProjectionColumn<GenMessage<Message>, infer Name> ? Name : never;

const maximumPredicateDepth = 64;
const maximumPredicateNodes = 10_000;

type StateName<Schema extends GenMessage<Message>> = Exclude<
  keyof MessageShape<Schema>,
  "$typeName" | "$unknown"
> &
  string;

/** One typed leaf comparison in a Projection query predicate. */
export interface ProjectionComparisonPredicate<Column extends ProjectionColumn = ProjectionColumn> {
  readonly kind: "comparison";
  readonly column: Column;
  readonly operator: ProjectionColumnOperator<Column>;
  readonly value: Exclude<ProjectionColumnValue<Column>, undefined>;
}

/** A nested conjunction or disjunction in a Projection query predicate. */
export interface ProjectionGroup<Column extends ProjectionColumn = ProjectionColumn> {
  readonly kind: "all" | "either";
  readonly predicates: readonly ProjectionPredicate<Column>[];
}

/** Typed predicate accepted by the Projection query builder. */
export type ProjectionPredicate<Column extends ProjectionColumn = ProjectionColumn> =
  ProjectionComparisonPredicate<Column> | ProjectionGroup<Column>;

/** Create an equality predicate for a descriptor-backed Projection column. */
export function eq<Column extends ProjectionColumn>(
  column: Column,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  return comparison(column, "equal" as ProjectionColumnOperator<Column>, value);
}

/** Create a greater-than predicate for an ordered Projection column. */
export function gt<Column extends ProjectionColumn>(
  column: "greaterThan" extends ProjectionColumnOperator<Column> ? Column : never,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  return comparison(column, "greaterThan" as ProjectionColumnOperator<Column>, value);
}

/** Create a less-than predicate for an ordered Projection column. */
export function lt<Column extends ProjectionColumn>(
  column: "lessThan" extends ProjectionColumnOperator<Column> ? Column : never,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  return comparison(column, "lessThan" as ProjectionColumnOperator<Column>, value);
}

/** Create a greater-than-or-equal predicate for an ordered Projection column. */
export function ge<Column extends ProjectionColumn>(
  column: "greaterOrEqual" extends ProjectionColumnOperator<Column> ? Column : never,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  return comparison(column, "greaterOrEqual" as ProjectionColumnOperator<Column>, value);
}

/** Create a less-than-or-equal predicate for an ordered Projection column. */
export function le<Column extends ProjectionColumn>(
  column: "lessOrEqual" extends ProjectionColumnOperator<Column> ? Column : never,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  return comparison(column, "lessOrEqual" as ProjectionColumnOperator<Column>, value);
}

/** Combine predicates conjunctively. */
export function all<First extends ProjectionPredicate, Rest extends readonly ProjectionPredicate[]>(
  first: First,
  ...rest: Rest
): ProjectionGroup<PredicateColumn<First | Rest[number]>> {
  return group("all", first, rest);
}

/** Combine predicates disjunctively. */
export function either<
  First extends ProjectionPredicate,
  Rest extends readonly ProjectionPredicate[],
>(first: First, ...rest: Rest): ProjectionGroup<PredicateColumn<First | Rest[number]>> {
  return group("either", first, rest);
}

/** Fluent builder that compiles typed Projection queries to the frozen wire contract. */
export class ProjectionQueryBuilder<
  Schema extends GenMessage<Message>,
  Columns extends ProjectionColumnCollection<Schema>,
> {
  readonly #schema: Schema;
  readonly #context: ActorContext;
  readonly #columns: Columns;
  readonly #ids: unknown[] = [];
  readonly #predicates: ProjectionPredicate[] = [];
  readonly #mask: string[] = [];
  readonly #order: { readonly column: ProjectionColumn; readonly direction: "asc" | "desc" }[] = [];
  #limit: number | undefined;

  /** @internal Construct through `ProjectionQuery.select()`. */
  constructor(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }) {
    this.#schema = input.schema;
    this.#columns = input.columns;
    this.#context = clone(ActorContextSchema, input.context);
  }

  /** Restrict the query to one or more entity IDs. */
  byId(...ids: readonly unknown[]): this {
    if (ids.length === 0 || ids.some((id) => id === undefined)) {
      throw new TypeError("Projection query ID filter must not be empty.");
    }
    this.#ids.push(...ids);
    return this;
  }

  /** Add a typed predicate. Repeated calls are combined with `ALL`. */
  where<Predicate extends ProjectionPredicate>(
    predicate: ColumnSchema<PredicateColumn<Predicate>> extends Schema
      ? ColumnName<PredicateColumn<Predicate>> extends keyof Columns
        ? Predicate
        : never
      : never,
  ): this {
    if (this.#predicates.length >= maximumPredicateNodes) {
      throw new TypeError(
        `Projection query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
      );
    }
    this.#predicates.push(predicate);
    return this;
  }

  /** Select top-level state fields returned by the server. */
  mask(...paths: readonly StateName<Schema>[]): this {
    for (const path of paths) {
      const field = findField(this.#schema, path);
      if (field === undefined) {
        throw new TypeError(`Projection query mask path "${path}" is not a state field.`);
      }
      this.#mask.push(field.name);
    }
    return this;
  }

  /** Add one ordering clause in caller order. */
  orderBy<Column extends ProjectionColumn<Schema>>(
    column: "greaterThan" extends ProjectionColumnOperator<Column> ? Column : never,
    direction: "asc" | "desc" = "asc",
  ): this {
    requireOwnedColumn(this.#schema, this.#columns, column);
    this.#order.push({ column, direction });
    return this;
  }

  /** Bound the result count. A positive limit requires ordering. */
  limit(value: number): this {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("Projection query limit must be a positive integer.");
    }
    this.#limit = value;
    return this;
  }

  /** Compile this builder to the frozen `spine.client.Query` message. */
  build(): Query {
    if (this.#limit !== undefined && this.#order.length === 0) {
      throw new TypeError("Projection query limit requires ordering.");
    }
    const filters = this.#filters();
    const format = this.#format();
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: nextQueryId() }),
      target: create(TargetSchema, {
        type: typeUrl(this.#schema),
        criterion:
          filters === undefined
            ? { case: "includeAll", value: true }
            : { case: "filters", value: filters },
      }),
      context: clone(ActorContextSchema, this.#context),
      ...(format === undefined ? {} : { format }),
    });
  }

  #filters() {
    const idField = this.#schema.fields[0];
    if (this.#ids.length > 0 && idField === undefined) {
      throw new TypeError("Projection query target has no ID field.");
    }
    const predicates = compileGroups(this.#predicates, this.#schema, this.#columns);
    if (this.#ids.length === 0 && predicates.length === 0) return undefined;
    return create(TargetFiltersSchema, {
      ...(this.#ids.length === 0
        ? {}
        : {
            idFilter: create(IdFilterSchema, {
              id: this.#ids.map((id) => packField(idField, id)),
            }),
          }),
      filter: [...predicates],
    });
  }

  #format() {
    if (this.#mask.length === 0 && this.#order.length === 0 && this.#limit === undefined) {
      return undefined;
    }
    return create(ResponseFormatSchema, {
      ...(this.#mask.length === 0 ? {} : { fieldMask: { paths: [...this.#mask] } }),
      orderBy: this.#order.map(({ column, direction }) =>
        create(OrderBySchema, {
          column: column.name,
          direction:
            direction === "desc" ? OrderBy_Direction.DESCENDING : OrderBy_Direction.ASCENDING,
        }),
      ),
      limit: this.#limit ?? 0,
    });
  }
}

/** Projection-only high-level query construction entrypoint. */
export const ProjectionQuery: Readonly<{
  select<
    Schema extends GenMessage<Message>,
    Columns extends ProjectionColumnCollection<Schema>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }): ProjectionQueryBuilder<Schema, Columns>;
}> = Object.freeze({
  select<
    Schema extends GenMessage<Message>,
    Columns extends ProjectionColumnCollection<Schema>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }): ProjectionQueryBuilder<Schema, Columns> {
    return new ProjectionQueryBuilder(input);
  },
});

function comparison<Column extends ProjectionColumn>(
  column: Column,
  operator: ProjectionColumnOperator<Column>,
  value: Exclude<ProjectionColumnValue<Column>, undefined>,
): ProjectionComparisonPredicate<Column> {
  if (!(column.operators as readonly string[]).includes(operator)) {
    throw new TypeError(`Projection column "${column.name}" does not support ${operator}.`);
  }
  requireValue(column, value);
  return Object.freeze({ kind: "comparison", column, operator, value });
}

function group<First extends ProjectionPredicate, Rest extends readonly ProjectionPredicate[]>(
  kind: "all" | "either",
  first: First,
  rest: Rest,
): ProjectionGroup<PredicateColumn<First | Rest[number]>> {
  return Object.freeze({
    kind,
    predicates: Object.freeze([first, ...rest]),
  }) as ProjectionGroup<PredicateColumn<First | Rest[number]>>;
}

function compileGroups<Schema extends GenMessage<Message>>(
  roots: readonly ProjectionPredicate[],
  schema: Schema,
  columns: ProjectionColumnCollection<Schema>,
): readonly CompositeFilter[] {
  const compiled = new WeakMap<object, CompiledPredicate>();
  const seen = new WeakSet<object>();
  const pending: CompileFrame[] = [];
  let scheduled = 0;
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    pending.push({ predicate: roots[index], depth: 0, expanded: false });
    scheduled += 1;
  }
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const predicate = requirePredicate(current.predicate);
    if (current.expanded) {
      if (predicate.kind === "comparison") {
        throw new TypeError("Projection query predicate compilation state is invalid.");
      }
      const simple = [];
      const nested = [];
      for (const child of predicate.predicates) {
        const childResult = compiled.get(child);
        if (childResult === undefined)
          throw new TypeError("Projection query predicate is incomplete.");
        if (childResult.kind === "comparison") simple.push(childResult.filter);
        else nested.push(childResult.filter);
      }
      compiled.set(predicate, {
        kind: "group",
        filter: create(CompositeFilterSchema, {
          operator:
            predicate.kind === "either"
              ? CompositeFilter_CompositeOperator.EITHER
              : CompositeFilter_CompositeOperator.ALL,
          filter: simple,
          compositeFilter: nested,
        }),
      });
      continue;
    }
    if (seen.has(predicate))
      throw new TypeError("Projection query predicate must not contain cycles.");
    seen.add(predicate);
    if (current.depth > maximumPredicateDepth) {
      throw new TypeError(
        `Projection query predicate exceeds maximum depth ${String(maximumPredicateDepth)}.`,
      );
    }
    if (predicate.kind === "comparison") {
      requireOwnedColumn(schema, columns, predicate.column);
      compiled.set(predicate, { kind: "comparison", filter: compileComparison(predicate) });
      continue;
    }
    if (predicate.predicates.length === 0) {
      throw new TypeError(`${predicate.kind.toUpperCase()} predicate must not be empty.`);
    }
    if (scheduled + predicate.predicates.length > maximumPredicateNodes) {
      throw new TypeError(
        `Projection query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
      );
    }
    scheduled += predicate.predicates.length;
    pending.push({ ...current, expanded: true });
    for (let index = predicate.predicates.length - 1; index >= 0; index -= 1) {
      if (!Object.hasOwn(predicate.predicates, index)) {
        throw new TypeError("Projection query predicate entries must be defined.");
      }
      pending.push({
        predicate: predicate.predicates[index],
        depth: current.depth + 1,
        expanded: false,
      });
    }
  }
  return roots.map((root) => {
    const result = compiled.get(root);
    if (result === undefined) throw new TypeError("Projection query predicate is incomplete.");
    return result.kind === "group"
      ? result.filter
      : create(CompositeFilterSchema, {
          operator: CompositeFilter_CompositeOperator.ALL,
          filter: [result.filter],
        });
  });
}

interface CompileFrame {
  readonly predicate: unknown;
  readonly depth: number;
  readonly expanded: boolean;
}

type CompiledPredicate =
  | { readonly kind: "comparison"; readonly filter: ReturnType<typeof compileComparison> }
  | { readonly kind: "group"; readonly filter: CompositeFilter };

function requirePredicate(value: unknown): ProjectionPredicate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Projection query predicate must be an object.");
  }
  const predicate = value as Partial<ProjectionPredicate>;
  if (predicate.kind === "comparison") {
    if (!(predicate.column instanceof ProjectionColumn)) {
      throw new TypeError("Projection query comparison column is required.");
    }
    return predicate as ProjectionComparisonPredicate;
  }
  if (predicate.kind !== "all" && predicate.kind !== "either") {
    throw new TypeError("Projection query predicate kind must be recognized.");
  }
  if (!Array.isArray(predicate.predicates)) {
    throw new TypeError(`${predicate.kind.toUpperCase()} predicate predicates must be an array.`);
  }
  return predicate as ProjectionGroup;
}

function compileComparison(predicate: ProjectionComparisonPredicate) {
  return create(FilterSchema, {
    fieldPath: { fieldName: [predicate.column.name] },
    value: packColumn(predicate.column, predicate.value),
    operator: wireOperator(predicate.operator),
  });
}

function wireOperator(operator: string): Filter_Operator {
  switch (operator) {
    case "equal":
      return Filter_Operator.EQUAL;
    case "greaterThan":
      return Filter_Operator.GREATER_THAN;
    case "lessThan":
      return Filter_Operator.LESS_THAN;
    case "greaterOrEqual":
      return Filter_Operator.GREATER_OR_EQUAL;
    case "lessOrEqual":
      return Filter_Operator.LESS_OR_EQUAL;
    default:
      throw new TypeError("Projection query comparison operator is not recognized.");
  }
}

function packColumn(column: ProjectionColumn, value: unknown) {
  if (column.source === "system") {
    if (column.name === "version") return packMessage(VersionSchema, value as never);
    return packMessage(BoolValueSchema, create(BoolValueSchema, { value: value as boolean }));
  }
  if (column.descriptor === undefined) {
    throw new TypeError("Projection query application column descriptor is required.");
  }
  return packField(column.descriptor, value);
}

function packField(field: ProjectionColumn["descriptor"], value: unknown) {
  if (field === undefined) throw new TypeError("Projection query field descriptor is required.");
  if (field.fieldKind === "message") {
    return packMessage(field.message as GenMessage<Message>, value as never);
  }
  if (field.fieldKind === "enum") {
    return packMessage(Int32ValueSchema, create(Int32ValueSchema, { value: value as number }));
  }
  if (field.fieldKind !== "scalar")
    throw new TypeError("Projection query field kind is unsupported.");
  const schema = scalarSchema(field.scalar);
  return packMessage(schema, create(schema, { value } as never));
}

function scalarSchema(scalar: ScalarType): GenMessage<Message> {
  switch (scalar) {
    case ScalarType.BOOL:
      return BoolValueSchema;
    case ScalarType.BYTES:
      return BytesValueSchema;
    case ScalarType.DOUBLE:
      return DoubleValueSchema;
    case ScalarType.FLOAT:
      return FloatValueSchema;
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return Int64ValueSchema;
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return UInt64ValueSchema;
    case ScalarType.UINT32:
    case ScalarType.FIXED32:
      return UInt32ValueSchema;
    case ScalarType.STRING:
      return StringValueSchema;
    default:
      return Int32ValueSchema;
  }
}

function requireOwnedColumn<Schema extends GenMessage<Message>>(
  schema: Schema,
  columns: ProjectionColumnCollection<Schema>,
  column: ProjectionColumn,
): void {
  if (
    column.schema !== schema ||
    !Object.values(columns).some((candidate) => candidate === column)
  ) {
    throw new TypeError("Projection query column does not belong to the selected target.");
  }
}

function requireValue(column: ProjectionColumn, value: unknown): void {
  const valid =
    value !== undefined &&
    (column.valueKind === "message"
      ? typeof value === "object" &&
        value !== null &&
        Reflect.get(value, "$typeName") === column.messageType
      : column.valueKind === "bytes"
        ? value instanceof Uint8Array
        : column.valueKind === "enum" || column.valueKind === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === column.valueKind);
  if (!valid)
    throw new TypeError(`Projection query value for "${column.name}" has the wrong type.`);
}

function findField(schema: GenMessage<Message>, name: string) {
  return schema.fields.find((field) => field.name === name || field.localName === name);
}

function nextQueryId(): string {
  return `query-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function typeUrl(schema: GenMessage<Message>): string {
  const prefix = hasOption(schema.file, type_url_prefix)
    ? getOption(schema.file, type_url_prefix)
    : "type.googleapis.com";
  return `${prefix.replace(/\/+$/u, "")}/${schema.typeName}`;
}

function packMessage<Schema extends GenMessage<Message>>(
  schema: Schema,
  value: MessageShape<Schema>,
) {
  return create(AnySchema, {
    typeUrl: typeUrl(schema),
    value: toBinary(schema, value, { writeUnknownFields: false }),
  });
}
