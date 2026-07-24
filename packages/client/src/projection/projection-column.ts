import {
  getOption,
  hasOption,
  type DescField,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { column, entity, EntityOption_Kind, type Version } from "@spine-event-engine/proto";
import { classifyProjectionField } from "../../codegen/projection-field-classification.mjs";

/** Operators available for every Projection column. */
export type ProjectionEqualityOperator = "equal";

/** Operators available for naturally ordered Projection column values. */
export type ProjectionOrderingOperator =
  ProjectionEqualityOperator | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";

/** Comparison family derived from a column's Protobuf field descriptor. */
export type ProjectionComparison = "equality" | "ordering";

/** Runtime value category derived from a column's Protobuf field descriptor. */
export type ProjectionColumnValueKind =
  "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";

/** One generated column declaration paired with its descriptor. */
export interface ProjectionColumnDefinitionEntry<
  Comparison extends ProjectionComparison = ProjectionComparison,
> {
  readonly field: DescField;
  readonly comparison: Comparison;
}

type StateFieldName<Schema extends GenMessage<Message>> = Exclude<
  keyof MessageShape<Schema>,
  "$typeName" | "$unknown"
> &
  string;

type CollectionFieldName<Schema extends GenMessage<Message>> = {
  [Name in StateFieldName<Schema>]: NonNullable<
    MessageShape<Schema>[Name]
  > extends readonly unknown[]
    ? Name
    : NonNullable<MessageShape<Schema>[Name]> extends object
      ? string extends keyof NonNullable<MessageShape<Schema>[Name]>
        ? Name
        : never
      : never;
}[StateFieldName<Schema>];

type SupportedStateFieldName<Schema extends GenMessage<Message>> = Exclude<
  StateFieldName<Schema> & keyof Schema["field"],
  CollectionFieldName<Schema>
>;

type ProjectionColumnEntries = Readonly<Record<string, ProjectionColumnDefinitionEntry>>;
type SupportedEntryConstraint<
  Schema extends GenMessage<Message>,
  Entries extends ProjectionColumnEntries,
> = Exclude<keyof Entries, SupportedStateFieldName<Schema>> extends never ? unknown : never;

/**
 * Nominal descriptor-backed column metadata emitted next to a Projection schema.
 *
 * The package root exports this type, but not its value constructor. Application
 * code therefore consumes generated metadata instead of authoring string keys.
 */
declare const generatedDefinitionBrand: unique symbol;

export interface ProjectionColumnDefinition<
  Schema extends GenMessage<Message>,
  Entries extends ProjectionColumnEntries,
> {
  readonly [generatedDefinitionBrand]: readonly [Schema, Entries];
  /** @internal Exact generated entries, validated again during registration. */
  readonly entries: Entries;
}

/** @internal Construct metadata from generated code; not exported by the package root. */
export function defineGeneratedProjectionColumns<
  Schema extends GenMessage<Message>,
  const Entries extends ProjectionColumnEntries,
>(
  _schema: Schema,
  entries: Entries & SupportedEntryConstraint<NoInfer<Schema>, Entries>,
): ProjectionColumnDefinition<Schema, Entries> {
  const captured = captureDefinitionFacts(_schema, entries);
  const copiedEntries = Object.fromEntries(
    (Object.entries(entries) as [string, ProjectionColumnDefinitionEntry][]).map(
      ([name, entry]) => {
        deepFreezeDescriptorGraph(entry.field);
        return [name, Object.freeze({ field: entry.field, comparison: entry.comparison })];
      },
    ),
  );
  const definition = Object.freeze({
    entries: Object.freeze(copiedEntries),
  }) as unknown as ProjectionColumnDefinition<Schema, Entries>;
  capturedDefinitions.set(definition, captured);
  return definition;
}

type OperatorsFor<Entry> =
  Entry extends ProjectionColumnDefinitionEntry<"ordering">
    ? ProjectionOrderingOperator
    : ProjectionEqualityOperator;

/** Typed column collection returned for one generated Projection definition. */
export type ProjectionColumns<
  Schema extends GenMessage<Message>,
  Entries extends ProjectionColumnEntries,
> = Readonly<
  {
    [Name in keyof Entries & StateFieldName<Schema>]: ProjectionColumn<
      Schema,
      Name,
      MessageShape<Schema>[Name],
      OperatorsFor<Entries[Name]>
    >;
  } & {
    readonly version: ProjectionColumn<Schema, "version", Version>;
    readonly archived: ProjectionColumn<Schema, "archived", boolean, ProjectionEqualityOperator>;
    readonly deleted: ProjectionColumn<Schema, "deleted", boolean, ProjectionEqualityOperator>;
  }
>;

/** Extract the value type carried by a Projection column. */
export type ProjectionColumnValue<Column extends ProjectionColumn> =
  Column extends ProjectionColumn<GenMessage<Message>, string, infer Value> ? Value : never;

/** Extract the legal operator union carried by a Projection column. */
export type ProjectionColumnOperator<Column extends ProjectionColumn> =
  Column extends ProjectionColumn<GenMessage<Message>, string, unknown, infer Operator>
    ? Operator
    : never;

const equalityOperators = Object.freeze(["equal"] as const);
const orderingOperators = Object.freeze([
  "equal",
  "greaterThan",
  "lessThan",
  "greaterOrEqual",
  "lessOrEqual",
] as const);
const systemNames = new Set(["version", "archived", "deleted"]);
interface CachedProjectionColumns {
  readonly definitions: WeakSet<object>;
  readonly columns: object;
}

const cache = new WeakMap<object, CachedProjectionColumns>();
const projectionColumnConstructionToken = Symbol("ProjectionColumnConstructionToken");
type FieldClassification = ReturnType<typeof classifyProjectionField>;
interface CapturedFieldFacts {
  readonly field: DescField;
  readonly parent: object;
  readonly localName: string;
  readonly name: string;
  readonly markedColumn: boolean;
  readonly classification: FieldClassification;
}
interface CapturedDefinitionFacts {
  readonly schema: object;
  readonly projection: boolean;
  readonly annotated: ReadonlyMap<string, DescField>;
  readonly entries: ReadonlyMap<string, CapturedFieldFacts>;
}
const capturedDefinitions = new WeakMap<object, CapturedDefinitionFacts>();

/**
 * An immutable, nominal, descriptor-backed Projection column.
 *
 * Instances can only be obtained by registering generated metadata for a
 * Projection schema. This prevents consumers from constructing arbitrary
 * string columns that have no corresponding Protobuf declaration.
 */
export class ProjectionColumn<
  Schema extends GenMessage<Message> = GenMessage<Message>,
  Name extends string = string,
  Value = unknown,
  Operator extends ProjectionOrderingOperator = ProjectionOrderingOperator,
> {
  declare private readonly projectionColumnBrand: [Value, Operator];

  /** Generated Protobuf schema that owns this column. */
  readonly schema: Schema;
  /** Protobuf field name, or the canonical system-column name. */
  readonly name: string;
  /** Protobuf-ES property name, or the canonical system-column name. */
  readonly localName: Name;
  /** Whether the column came from the state descriptor or Projection storage metadata. */
  readonly source: "declared" | "system";
  /** Exact declared field descriptor; system columns have no state field. */
  readonly descriptor: DescField | undefined;
  /** Runtime value category derived from the descriptor. */
  readonly valueKind: ProjectionColumnValueKind;
  /** Fully qualified message type for message-valued columns. */
  readonly messageType: string | undefined;
  /** Supported comparison family. */
  readonly comparison: ProjectionComparison;
  /** Exact operator set accepted for this column. */
  readonly operators: readonly Operator[];

  private constructor(
    input: {
      schema: Schema;
      name: string;
      localName: Name;
      source: "declared" | "system";
      descriptor?: DescField;
      valueKind: ProjectionColumnValueKind;
      messageType?: string | undefined;
      comparison: ProjectionComparison;
      operators: readonly Operator[];
    },
    token?: symbol,
  ) {
    if (token !== projectionColumnConstructionToken) {
      throw new TypeError("Projection columns can only be constructed during registration.");
    }
    this.schema = input.schema;
    this.name = input.name;
    this.localName = input.localName;
    this.source = input.source;
    this.descriptor = input.descriptor;
    this.valueKind = input.valueKind;
    this.messageType = input.messageType;
    this.comparison = input.comparison;
    this.operators = input.operators;
    Object.freeze(this);
  }

  /** Validate and register generated Projection column metadata. */
  static register<
    Schema extends GenMessage<Message>,
    const Entries extends ProjectionColumnEntries,
  >(
    schema: Schema,
    definition: ProjectionColumnDefinition<Schema, Entries>,
  ): ProjectionColumns<Schema, Entries> {
    const existing = cache.get(schema);
    if (existing?.definitions.has(definition) === true) {
      return existing.columns as ProjectionColumns<Schema, Entries>;
    }
    const captured = capturedDefinitions.get(definition);
    validateProjectionSchema(schema, captured);
    const declared = validateDefinition(schema, definition, captured);
    if (existing !== undefined) {
      existing.definitions.add(definition);
      return existing.columns as ProjectionColumns<Schema, Entries>;
    }

    const result: Record<string, ProjectionColumn> = {};
    for (const [localName, field, fieldName, metadata] of declared) {
      result[localName] = new ProjectionColumn(
        {
          schema,
          name: fieldName,
          localName,
          source: "declared",
          descriptor: field,
          valueKind: metadata.valueKind,
          messageType: metadata.messageType,
          comparison: metadata.comparison,
          operators: operatorsFor(metadata.comparison),
        },
        projectionColumnConstructionToken,
      );
    }
    result.version = new ProjectionColumn(
      {
        schema,
        name: "version",
        localName: "version",
        source: "system",
        valueKind: "message",
        messageType: "spine.core.Version",
        comparison: "ordering",
        operators: orderingOperators,
      },
      projectionColumnConstructionToken,
    );
    for (const name of ["archived", "deleted"] as const) {
      result[name] = new ProjectionColumn(
        {
          schema,
          name,
          localName: name,
          source: "system",
          valueKind: "boolean",
          comparison: "equality",
          operators: equalityOperators,
        },
        projectionColumnConstructionToken,
      );
    }
    const columns = Object.freeze(result) as ProjectionColumns<Schema, Entries>;
    cache.set(schema, {
      definitions: new WeakSet([definition]),
      columns,
    });
    return columns;
  }
}

type RuntimeMetadata = Readonly<{
  valueKind: ProjectionColumnValueKind;
  messageType?: string;
  comparison: ProjectionComparison;
}>;

function validateProjectionSchema(
  schema: GenMessage<Message>,
  captured: CapturedDefinitionFacts | undefined,
): void {
  const projection =
    captured?.schema === schema
      ? captured.projection
      : hasOption(schema, entity) &&
        getOption(schema, entity).kind === EntityOption_Kind.PROJECTION;
  if (!projection) {
    throw new TypeError(
      `Projection column schema "${schema.typeName}" must declare Projection kind.`,
    );
  }
}

function validateDefinition(
  schema: GenMessage<Message>,
  definition: ProjectionColumnDefinition<GenMessage<Message>, ProjectionColumnEntries>,
  captured: CapturedDefinitionFacts | undefined,
): readonly (readonly [string, DescField, string, RuntimeMetadata])[] {
  const facts =
    captured?.schema === schema ? captured : captureDefinitionFacts(schema, definition.entries);
  const annotated = new Map(facts.annotated);
  const result: (readonly [string, DescField, string, RuntimeMetadata])[] = [];

  for (const [localName, entry] of Object.entries(definition.entries) as [
    string,
    ProjectionColumnDefinitionEntry | undefined,
  ][]) {
    if (systemNames.has(localName)) {
      throw new TypeError(
        `Projection column definition cannot replace system column "${localName}".`,
      );
    }
    if (entry === undefined) continue;
    const fieldFacts = facts.entries.get(localName) ?? captureFieldFacts(entry.field);
    if (fieldFacts.parent !== schema || fieldFacts.localName !== localName) {
      throw new TypeError(
        `Projection column definition key "${localName}" must reference field "${localName}".`,
      );
    }
    if (!fieldFacts.markedColumn) {
      throw new TypeError(`Projection field "${localName}" is not marked (column).`);
    }
    const metadata = describeField(fieldFacts);
    if (entry.comparison !== metadata.comparison) {
      throw new TypeError(
        `Projection column "${localName}" requires ${metadata.comparison} comparison metadata.`,
      );
    }
    annotated.delete(localName);
    result.push([localName, fieldFacts.field, fieldFacts.name, metadata]);
  }

  const missing = annotated.keys().next().value;
  if (missing !== undefined) {
    throw new TypeError(`Projection column definition is missing annotated field "${missing}".`);
  }
  return result;
}

function describeField(field: CapturedFieldFacts): RuntimeMetadata {
  const metadata = field.classification;
  if (!metadata.supported && metadata.reason === "singular") {
    throw new TypeError(
      `Projection column "${field.localName}" must be singular; repeated and map fields are unsupported.`,
    );
  }
  if (!metadata.supported) {
    throw new TypeError(`Projection column "${field.localName}" cannot belong to a oneof.`);
  }
  return metadata;
}

function captureDefinitionFacts(
  schema: GenMessage<Message>,
  entries: ProjectionColumnEntries,
): CapturedDefinitionFacts {
  const annotated = new Map(
    schema.fields
      .filter((field) => hasOption(field, column) && getOption(field, column))
      .map((field) => [field.localName, field]),
  );
  const capturedEntries = new Map<string, CapturedFieldFacts>();
  for (const [localName, entry] of Object.entries(entries)) {
    capturedEntries.set(localName, captureFieldFacts(entry.field));
  }
  return Object.freeze({
    schema,
    projection:
      hasOption(schema, entity) && getOption(schema, entity).kind === EntityOption_Kind.PROJECTION,
    annotated,
    entries: capturedEntries,
  });
}

function captureFieldFacts(field: DescField): CapturedFieldFacts {
  return Object.freeze({
    field,
    parent: field.parent,
    localName: field.localName,
    name: field.name,
    markedColumn: hasOption(field, column) && getOption(field, column),
    classification: Object.freeze(classifyProjectionField(field)),
  });
}

function deepFreezeDescriptorGraph(root: object): void {
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (ArrayBuffer.isView(current)) continue;
    for (const key of Reflect.ownKeys(current)) {
      const property = Object.getOwnPropertyDescriptor(current, key);
      if (property !== undefined && "value" in property && isObject(property.value)) {
        pending.push(property.value);
      }
    }
    Object.freeze(current);
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function operatorsFor(
  comparison: ProjectionComparison,
): typeof equalityOperators | typeof orderingOperators {
  return comparison === "ordering" ? orderingOperators : equalityOperators;
}
