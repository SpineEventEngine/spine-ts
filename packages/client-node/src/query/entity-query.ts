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
  EntityColumn,
  type EntityColumnOperator,
  type EntityColumnValue,
} from "../entity/entity-column.js";

type EntityColumnCollection<Schema extends GenMessage<Message>> = Readonly<
  Record<string, EntityColumn<Schema>>
>;
type PredicateColumn<Predicate> = Predicate extends EntityPredicate<infer Column> ? Column : never;
type ColumnSchema<Column> = Column extends EntityColumn<infer Schema> ? Schema : never;
type ColumnName<Column> =
  Column extends EntityColumn<GenMessage<Message>, infer Name> ? Name : never;

const maximumPredicateDepth = 64;
const maximumPredicateNodes = 10_000;

type StateName<Schema extends GenMessage<Message>> = Exclude<
  keyof MessageShape<Schema>,
  "$typeName" | "$unknown"
> &
  string;

/** Represents one typed leaf comparison in an Entity query predicate. */
export interface EntityComparisonPredicate<Column extends EntityColumn = EntityColumn> {
  /** Identifies this predicate as a leaf comparison. */
  readonly kind: "comparison";
  /** Identifies the column compared by this predicate. */
  readonly column: Column;
  /** Identifies the comparison operator applied to the column. */
  readonly operator: EntityColumnOperator<Column>;
  /** Stores the value compared with the column. */
  readonly value: Exclude<EntityColumnValue<Column>, undefined>;
}

/** Represents a nested conjunction or disjunction in an Entity query predicate. */
export interface EntityGroup<Column extends EntityColumn = EntityColumn> {
  /** Identifies the logical operation that combines the predicates. */
  readonly kind: "all" | "either";
  /** Lists the predicates combined by this group. */
  readonly predicates: readonly EntityPredicate<Column>[];
}

/** Represents a typed predicate accepted by the Entity query builder. */
export type EntityPredicate<Column extends EntityColumn = EntityColumn> =
  EntityComparisonPredicate<Column> | EntityGroup<Column>;

/** Builds a typed Entity query for the frozen Spine wire contract. */
export class EntityQueryBuilder<
  Schema extends GenMessage<Message>,
  Columns extends EntityColumnCollection<Schema>,
> {
  readonly #schema: Schema;
  readonly #context: ActorContext;
  readonly #columns: Columns;
  readonly #ids: unknown[] = [];
  readonly #predicates: EntityPredicate[] = [];
  readonly #mask: string[] = [];
  readonly #order: { readonly column: EntityColumn; readonly direction: "asc" | "desc" }[] = [];
  #limit: number | undefined;

  /** Creates a builder for one Entity query.
   *
   * @param input - Schema, registered columns, and actor context for the query.
   */
  constructor(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }) {
    this.#schema = input.schema;
    this.#columns = input.columns;
    this.#context = clone(ActorContextSchema, input.context);
  }

  /** Restricts the query to one or more Entity IDs.
   *
   * @param ids - Entity IDs to include.
   * @returns This builder.
   */
  byId(...ids: readonly unknown[]): this {
    if (ids.length === 0 || ids.some((id) => id === undefined)) {
      throw new TypeError("Entity query ID filter must not be empty.");
    }
    this.#ids.push(...ids);
    return this;
  }

  /** Adds a typed predicate. Repeated calls are combined with `ALL`.
   *
   * @param predicate - Predicate owned by this builder's registered columns.
   * @returns This builder.
   */
  where<Predicate extends EntityPredicate>(
    predicate: ColumnSchema<PredicateColumn<Predicate>> extends Schema
      ? ColumnName<PredicateColumn<Predicate>> extends keyof Columns
        ? Predicate
        : never
      : never,
  ): this {
    if (this.#predicates.length >= maximumPredicateNodes) {
      throw new TypeError(
        `Entity query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
      );
    }
    this.#predicates.push(predicate);
    return this;
  }

  /** Selects top-level state fields returned by the server.
   *
   * @param paths - Generated property names of state fields.
   * @returns This builder.
   */
  mask(...paths: readonly StateName<Schema>[]): this {
    for (const path of paths) {
      const field = EntityQueryWire.findField(this.#schema, path);
      if (field === undefined) {
        throw new TypeError(`Entity query mask path "${path}" is not a state field.`);
      }
      this.#mask.push(field.name);
    }
    return this;
  }

  /** Adds one ordering clause in caller order.
   *
   * @param column - Ordered column owned by this builder's Entity schema.
   * @param direction - Sort direction, ascending by default.
   * @returns This builder.
   */
  orderBy<Column extends EntityColumn<Schema>>(
    column: "greaterThan" extends EntityColumnOperator<Column> ? Column : never,
    direction: "asc" | "desc" = "asc",
  ): this {
    EntityQueryWire.requireOwnedColumn(this.#schema, this.#columns, column);
    this.#order.push({ column, direction });
    return this;
  }

  /** Bounds the result count. A positive limit requires ordering.
   *
   * @param value - Positive maximum number of returned entities.
   * @returns This builder.
   */
  limit(value: number): this {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("Entity query limit must be a positive integer.");
    }
    this.#limit = value;
    return this;
  }

  /** Compiles this builder to the frozen `spine.client.Query` message.
   *
   * @returns Immutable wire query message.
   */
  build(): Query {
    if (this.#limit !== undefined && this.#order.length === 0) {
      throw new TypeError("Entity query limit requires ordering.");
    }
    const filters = this.#filters();
    const format = this.#format();
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: EntityQueryWire.nextId() }),
      target: create(TargetSchema, {
        type: EntityQueryWire.typeUrl(this.#schema),
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
      throw new TypeError("Entity query target has no ID field.");
    }
    const predicates = EntityQueryCompiler.compileGroups(
      this.#predicates,
      this.#schema,
      this.#columns,
    );
    if (this.#ids.length === 0 && predicates.length === 0) return undefined;
    return create(TargetFiltersSchema, {
      ...(this.#ids.length === 0
        ? {}
        : {
            idFilter: create(IdFilterSchema, {
              id: this.#ids.map((id) => EntityQueryWire.packField(idField, id)),
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

/** Creates typed predicates and builders for Entity queries. */
export const EntityQuery: Readonly<{
  /** Creates an equality predicate for a descriptor-backed Entity column.
   *
   * @param column - Column to compare.
   * @param value - Value to match.
   * @returns Immutable equality predicate.
   */
  eq<Column extends EntityColumn>(
    column: Column,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column>;
  /** Creates a greater-than predicate for an ordered Entity column.
   *
   * @param column - Ordered column to compare.
   * @param value - Lower exclusive bound.
   * @returns Immutable greater-than predicate.
   */
  gt<Column extends EntityColumn>(
    column: "greaterThan" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column>;
  /** Creates a less-than predicate for an ordered Entity column.
   *
   * @param column - Ordered column to compare.
   * @param value - Upper exclusive bound.
   * @returns Immutable less-than predicate.
   */
  lt<Column extends EntityColumn>(
    column: "lessThan" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column>;
  /** Creates a greater-than-or-equal predicate for an ordered Entity column.
   *
   * @param column - Ordered column to compare.
   * @param value - Lower inclusive bound.
   * @returns Immutable inclusive lower-bound predicate.
   */
  ge<Column extends EntityColumn>(
    column: "greaterOrEqual" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column>;
  /** Creates a less-than-or-equal predicate for an ordered Entity column.
   *
   * @param column - Ordered column to compare.
   * @param value - Upper inclusive bound.
   * @returns Immutable inclusive upper-bound predicate.
   */
  le<Column extends EntityColumn>(
    column: "lessOrEqual" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column>;
  /** Combines predicates conjunctively.
   *
   * @param first - First predicate in the group.
   * @param rest - Remaining predicates in the group.
   * @returns Immutable conjunction predicate.
   */
  all<First extends EntityPredicate, Rest extends readonly EntityPredicate[]>(
    first: First,
    ...rest: Rest
  ): EntityGroup<PredicateColumn<First | Rest[number]>>;
  /** Combines predicates disjunctively.
   *
   * @param first - First predicate in the group.
   * @param rest - Remaining predicates in the group.
   * @returns Immutable disjunction predicate.
   */
  either<First extends EntityPredicate, Rest extends readonly EntityPredicate[]>(
    first: First,
    ...rest: Rest
  ): EntityGroup<PredicateColumn<First | Rest[number]>>;
  /** Creates a builder for one Entity schema.
   *
   * @param input - Schema, registered columns, and actor context for the query.
   * @returns A mutable query builder.
   */
  select<
    Schema extends GenMessage<Message>,
    Columns extends EntityColumnCollection<Schema>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }): EntityQueryBuilder<Schema, Columns>;
}> = Object.freeze({
  eq<Column extends EntityColumn>(
    column: Column,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    return EntityQueryCompiler.comparison(column, "equal" as EntityColumnOperator<Column>, value);
  },
  gt<Column extends EntityColumn>(
    column: "greaterThan" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    return EntityQueryCompiler.comparison(
      column,
      "greaterThan" as EntityColumnOperator<Column>,
      value,
    );
  },
  lt<Column extends EntityColumn>(
    column: "lessThan" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    return EntityQueryCompiler.comparison(
      column,
      "lessThan" as EntityColumnOperator<Column>,
      value,
    );
  },
  ge<Column extends EntityColumn>(
    column: "greaterOrEqual" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    return EntityQueryCompiler.comparison(
      column,
      "greaterOrEqual" as EntityColumnOperator<Column>,
      value,
    );
  },
  le<Column extends EntityColumn>(
    column: "lessOrEqual" extends EntityColumnOperator<Column> ? Column : never,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    return EntityQueryCompiler.comparison(
      column,
      "lessOrEqual" as EntityColumnOperator<Column>,
      value,
    );
  },
  all<First extends EntityPredicate, Rest extends readonly EntityPredicate[]>(
    first: First,
    ...rest: Rest
  ): EntityGroup<PredicateColumn<First | Rest[number]>> {
    return EntityQueryCompiler.group("all", first, rest);
  },
  either<First extends EntityPredicate, Rest extends readonly EntityPredicate[]>(
    first: First,
    ...rest: Rest
  ): EntityGroup<PredicateColumn<First | Rest[number]>> {
    return EntityQueryCompiler.group("either", first, rest);
  },
  select<
    Schema extends GenMessage<Message>,
    Columns extends EntityColumnCollection<Schema>,
  >(input: {
    readonly schema: Schema;
    readonly columns: Columns;
    readonly context: ActorContext;
  }): EntityQueryBuilder<Schema, Columns> {
    return new EntityQueryBuilder(input);
  },
});

/** Internal compiler for predicates, descriptors, and wire query messages. */
const EntityQueryCompiler = Object.freeze({
  comparison<Column extends EntityColumn>(
    column: Column,
    operator: EntityColumnOperator<Column>,
    value: Exclude<EntityColumnValue<Column>, undefined>,
  ): EntityComparisonPredicate<Column> {
    if (!(column.operators as readonly string[]).includes(operator)) {
      throw new TypeError(`Entity column "${column.name}" does not support ${operator}.`);
    }
    EntityQueryWire.requireValue(column, value);
    return Object.freeze({ kind: "comparison", column, operator, value });
  },

  group<First extends EntityPredicate, Rest extends readonly EntityPredicate[]>(
    kind: "all" | "either",
    first: First,
    rest: Rest,
  ): EntityGroup<PredicateColumn<First | Rest[number]>> {
    return Object.freeze({
      kind,
      predicates: Object.freeze([first, ...rest]),
    }) as EntityGroup<PredicateColumn<First | Rest[number]>>;
  },

  compileGroups<Schema extends GenMessage<Message>>(
    roots: readonly EntityPredicate[],
    schema: Schema,
    columns: EntityColumnCollection<Schema>,
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
      const predicate = EntityQueryWire.requirePredicate(current.predicate);
      if (current.expanded) {
        if (predicate.kind === "comparison") {
          throw new TypeError("Entity query predicate compilation state is invalid.");
        }
        const simple = [];
        const nested = [];
        for (const child of predicate.predicates) {
          const childResult = compiled.get(child);
          if (childResult === undefined)
            throw new TypeError("Entity query predicate is incomplete.");
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
        throw new TypeError("Entity query predicate must not contain cycles.");
      seen.add(predicate);
      if (current.depth > maximumPredicateDepth) {
        throw new TypeError(
          `Entity query predicate exceeds maximum depth ${String(maximumPredicateDepth)}.`,
        );
      }
      if (predicate.kind === "comparison") {
        EntityQueryWire.requireOwnedColumn(schema, columns, predicate.column);
        compiled.set(predicate, {
          kind: "comparison",
          filter: EntityQueryWire.compileComparison(predicate),
        });
        continue;
      }
      if (predicate.predicates.length === 0) {
        throw new TypeError(`${predicate.kind.toUpperCase()} predicate must not be empty.`);
      }
      if (scheduled + predicate.predicates.length > maximumPredicateNodes) {
        throw new TypeError(
          `Entity query predicate exceeds maximum node count ${String(maximumPredicateNodes)}.`,
        );
      }
      scheduled += predicate.predicates.length;
      pending.push({ ...current, expanded: true });
      for (let index = predicate.predicates.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(predicate.predicates, index)) {
          throw new TypeError("Entity query predicate entries must be defined.");
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
      if (result === undefined) throw new TypeError("Entity query predicate is incomplete.");
      return result.kind === "group"
        ? result.filter
        : create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            filter: [result.filter],
          });
    });
  },
});

interface CompileFrame {
  readonly predicate: unknown;
  readonly depth: number;
  readonly expanded: boolean;
}

type CompiledPredicate =
  | {
      readonly kind: "comparison";
      readonly filter: ReturnType<typeof EntityQueryWire.compileComparison>;
    }
  | { readonly kind: "group"; readonly filter: CompositeFilter };

/** Validates and compiles Entity query details. */
const EntityQueryWire = Object.freeze({
  requirePredicate(value: unknown): EntityPredicate {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Entity query predicate must be an object.");
    }
    const predicate = value as Partial<EntityPredicate>;
    if (predicate.kind === "comparison") {
      if (!(predicate.column instanceof EntityColumn)) {
        throw new TypeError("Entity query comparison column is required.");
      }
      return predicate as EntityComparisonPredicate;
    }
    if (predicate.kind !== "all" && predicate.kind !== "either") {
      throw new TypeError("Entity query predicate kind must be recognized.");
    }
    if (!Array.isArray(predicate.predicates)) {
      throw new TypeError(`${predicate.kind.toUpperCase()} predicate predicates must be an array.`);
    }
    return predicate as EntityGroup;
  },

  compileComparison(predicate: EntityComparisonPredicate) {
    return create(FilterSchema, {
      fieldPath: { fieldName: [predicate.column.name] },
      value: EntityQueryWire.packColumn(predicate.column, predicate.value),
      operator: EntityQueryWire.wireOperator(predicate.operator),
    });
  },

  wireOperator(operator: string): Filter_Operator {
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
        throw new TypeError("Entity query comparison operator is not recognized.");
    }
  },

  packColumn(column: EntityColumn, value: unknown) {
    if (column.source === "system") {
      if (column.name === "version")
        return EntityQueryWire.packMessage(VersionSchema, value as never);
      return EntityQueryWire.packMessage(
        BoolValueSchema,
        create(BoolValueSchema, { value: value as boolean }),
      );
    }
    if (column.descriptor === undefined) {
      throw new TypeError("Entity query application column descriptor is required.");
    }
    return EntityQueryWire.packField(column.descriptor, value);
  },

  packField(field: EntityColumn["descriptor"], value: unknown) {
    if (field === undefined) throw new TypeError("Entity query field descriptor is required.");
    if (field.fieldKind === "message") {
      return EntityQueryWire.packMessage(field.message as GenMessage<Message>, value as never);
    }
    if (field.fieldKind === "enum") {
      return EntityQueryWire.packMessage(
        Int32ValueSchema,
        create(Int32ValueSchema, { value: value as number }),
      );
    }
    if (field.fieldKind !== "scalar")
      throw new TypeError("Entity query field kind is unsupported.");
    const schema = EntityQueryWire.scalarSchema(field.scalar);
    return EntityQueryWire.packMessage(schema, create(schema, { value } as never));
  },

  scalarSchema(scalar: ScalarType): GenMessage<Message> {
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
  },

  requireOwnedColumn<Schema extends GenMessage<Message>>(
    schema: Schema,
    columns: EntityColumnCollection<Schema>,
    column: EntityColumn,
  ): void {
    if (
      column.schema !== schema ||
      !Object.values(columns).some((candidate) => candidate === column)
    ) {
      throw new TypeError("Entity query column does not belong to the selected target.");
    }
  },

  requireValue(column: EntityColumn, value: unknown): void {
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
    if (!valid) throw new TypeError(`Entity query value for "${column.name}" has the wrong type.`);
  },

  findField(schema: GenMessage<Message>, name: string) {
    return schema.fields.find((field) => field.name === name || field.localName === name);
  },

  nextId(): string {
    return `query-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  },

  typeUrl(schema: GenMessage<Message>): string {
    const prefix = hasOption(schema.file, type_url_prefix)
      ? getOption(schema.file, type_url_prefix)
      : "type.googleapis.com";
    return `${prefix.replace(/\/+$/u, "")}/${schema.typeName}`;
  },

  packMessage<Schema extends GenMessage<Message>>(schema: Schema, value: MessageShape<Schema>) {
    return create(AnySchema, {
      typeUrl: EntityQueryWire.typeUrl(schema),
      value: toBinary(schema, value, { writeUnknownFields: false }),
    });
  },
});
