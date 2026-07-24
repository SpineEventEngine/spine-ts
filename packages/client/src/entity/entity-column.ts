import {
  getOption,
  hasOption,
  type DescField,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { column, entity, EntityOption_Kind, type Version } from "@spine-event-engine/proto";
import { classifyEntityField } from "../../codegen/entity-field-classification.mjs";

/** Operators available for every Entity column. */
export type EntityEqualityOperator = "equal";

/** Operators available for naturally ordered Entity column values. */
export type EntityOrderingOperator =
  EntityEqualityOperator | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";

/** Comparison family derived from a column's Protobuf field descriptor. */
export type EntityComparison = "equality" | "ordering";

/** Runtime value category derived from a column's Protobuf field descriptor. */
export type EntityColumnValueKind =
  "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";

/** One generated column declaration paired with its descriptor. */
export interface EntityColumnDefinitionEntry<
  Comparison extends EntityComparison = EntityComparison,
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

type EntityColumnEntries = Readonly<Record<string, EntityColumnDefinitionEntry>>;
type SupportedEntryConstraint<
  Schema extends GenMessage<Message>,
  Entries extends EntityColumnEntries,
> = Exclude<keyof Entries, SupportedStateFieldName<Schema>> extends never ? unknown : never;

/**
 * Nominal descriptor-backed column metadata emitted next to a Entity schema.
 *
 * The package root exports this type, but not its value constructor. Application
 * code therefore consumes generated metadata instead of authoring string keys.
 */
declare const generatedDefinitionBrand: unique symbol;

export interface EntityColumnDefinition<
  Schema extends GenMessage<Message>,
  Entries extends EntityColumnEntries,
> {
  readonly [generatedDefinitionBrand]: readonly [Schema, Entries];
  /** @internal Exact generated entries, validated again during registration. */
  readonly entries: Entries;
}

/** @internal Construct metadata from generated code; not exported by the package root. */
export function defineGeneratedEntityColumns<
  Schema extends GenMessage<Message>,
  const Entries extends EntityColumnEntries,
>(
  _schema: Schema,
  entries: Entries & SupportedEntryConstraint<NoInfer<Schema>, Entries>,
): EntityColumnDefinition<Schema, Entries> {
  const captured = captureDefinitionFacts(_schema, entries);
  const copiedEntries = Object.fromEntries(
    (Object.entries(entries) as [string, EntityColumnDefinitionEntry][]).map(([name, entry]) => {
      deepFreezeDescriptorGraph(entry.field);
      return [name, Object.freeze({ field: entry.field, comparison: entry.comparison })];
    }),
  );
  const definition = Object.freeze({
    entries: Object.freeze(copiedEntries),
  }) as unknown as EntityColumnDefinition<Schema, Entries>;
  capturedDefinitions.set(definition, captured);
  return definition;
}

type OperatorsFor<Entry> =
  Entry extends EntityColumnDefinitionEntry<"ordering">
    ? EntityOrderingOperator
    : EntityEqualityOperator;

/** Typed column collection returned for one generated Entity definition. */
export type EntityColumns<
  Schema extends GenMessage<Message>,
  Entries extends EntityColumnEntries,
> = Readonly<
  {
    [Name in keyof Entries & StateFieldName<Schema>]: EntityColumn<
      Schema,
      Name,
      MessageShape<Schema>[Name],
      OperatorsFor<Entries[Name]>
    >;
  } & {
    readonly version: EntityColumn<Schema, "version", Version>;
    readonly archived: EntityColumn<Schema, "archived", boolean, EntityEqualityOperator>;
    readonly deleted: EntityColumn<Schema, "deleted", boolean, EntityEqualityOperator>;
  }
>;

/** Extract the value type carried by a Entity column. */
export type EntityColumnValue<Column extends EntityColumn> =
  Column extends EntityColumn<GenMessage<Message>, string, infer Value> ? Value : never;

/** Extract the legal operator union carried by a Entity column. */
export type EntityColumnOperator<Column extends EntityColumn> =
  Column extends EntityColumn<GenMessage<Message>, string, unknown, infer Operator>
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
interface CachedEntityColumns {
  readonly definitions: WeakSet<object>;
  readonly columns: object;
}

const cache = new WeakMap<object, CachedEntityColumns>();
const entityColumnConstructionToken = Symbol("EntityColumnConstructionToken");
type FieldClassification = ReturnType<typeof classifyEntityField>;
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
  readonly entityKind: number | undefined;
  readonly annotated: ReadonlyMap<string, DescField>;
  readonly entries: ReadonlyMap<string, CapturedFieldFacts>;
}
const capturedDefinitions = new WeakMap<object, CapturedDefinitionFacts>();

/**
 * An immutable, nominal, descriptor-backed Entity column.
 *
 * Instances can only be obtained by registering generated metadata for a
 * Entity schema. This prevents consumers from constructing arbitrary
 * string columns that have no corresponding Protobuf declaration.
 */
export class EntityColumn<
  Schema extends GenMessage<Message> = GenMessage<Message>,
  Name extends string = string,
  Value = unknown,
  Operator extends EntityOrderingOperator = EntityOrderingOperator,
> {
  declare private readonly entityColumnBrand: [Value, Operator];

  /** Generated Protobuf schema that owns this column. */
  readonly schema: Schema;
  /** Protobuf field name, or the canonical system-column name. */
  readonly name: string;
  /** Protobuf-ES property name, or the canonical system-column name. */
  readonly localName: Name;
  /** Whether the column came from the state descriptor or Entity storage metadata. */
  readonly source: "declared" | "system";
  /** Exact declared field descriptor; system columns have no state field. */
  readonly descriptor: DescField | undefined;
  /** Runtime value category derived from the descriptor. */
  readonly valueKind: EntityColumnValueKind;
  /** Fully qualified message type for message-valued columns. */
  readonly messageType: string | undefined;
  /** Supported comparison family. */
  readonly comparison: EntityComparison;
  /** Exact operator set accepted for this column. */
  readonly operators: readonly Operator[];

  private constructor(
    input: {
      schema: Schema;
      name: string;
      localName: Name;
      source: "declared" | "system";
      descriptor?: DescField;
      valueKind: EntityColumnValueKind;
      messageType?: string | undefined;
      comparison: EntityComparison;
      operators: readonly Operator[];
    },
    token?: symbol,
  ) {
    if (token !== entityColumnConstructionToken) {
      throw new TypeError("Entity columns can only be constructed during registration.");
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

  /** Validate and register generated Entity column metadata. */
  static register<Schema extends GenMessage<Message>, const Entries extends EntityColumnEntries>(
    schema: Schema,
    definition: EntityColumnDefinition<Schema, Entries>,
  ): EntityColumns<Schema, Entries> {
    const existing = cache.get(schema);
    if (existing?.definitions.has(definition) === true) {
      return existing.columns as EntityColumns<Schema, Entries>;
    }
    const captured = capturedDefinitions.get(definition);
    validateEntitySchema(schema, captured);
    const declared = validateDefinition(schema, definition, captured);
    if (existing !== undefined) {
      existing.definitions.add(definition);
      return existing.columns as EntityColumns<Schema, Entries>;
    }

    const result: Record<string, EntityColumn> = {};
    for (const [localName, field, fieldName, metadata] of declared) {
      result[localName] = new EntityColumn(
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
        entityColumnConstructionToken,
      );
    }
    result.version = new EntityColumn(
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
      entityColumnConstructionToken,
    );
    for (const name of ["archived", "deleted"] as const) {
      result[name] = new EntityColumn(
        {
          schema,
          name,
          localName: name,
          source: "system",
          valueKind: "boolean",
          comparison: "equality",
          operators: equalityOperators,
        },
        entityColumnConstructionToken,
      );
    }
    const columns = Object.freeze(result) as EntityColumns<Schema, Entries>;
    cache.set(schema, {
      definitions: new WeakSet([definition]),
      columns,
    });
    return columns;
  }
}

type RuntimeMetadata = Readonly<{
  valueKind: EntityColumnValueKind;
  messageType?: string;
  comparison: EntityComparison;
}>;

function validateEntitySchema(
  schema: GenMessage<Message>,
  captured: CapturedDefinitionFacts | undefined,
): void {
  const entityKind =
    captured?.schema === schema
      ? captured.entityKind
      : hasOption(schema, entity)
        ? getOption(schema, entity).kind
        : undefined;
  if (
    entityKind !== EntityOption_Kind.AGGREGATE &&
    entityKind !== EntityOption_Kind.PROJECTION &&
    entityKind !== EntityOption_Kind.PROCESS_MANAGER
  ) {
    throw new TypeError(`Entity column schema "${schema.typeName}" must declare Entity kind.`);
  }
}

function validateDefinition(
  schema: GenMessage<Message>,
  definition: EntityColumnDefinition<GenMessage<Message>, EntityColumnEntries>,
  captured: CapturedDefinitionFacts | undefined,
): readonly (readonly [string, DescField, string, RuntimeMetadata])[] {
  const facts =
    captured?.schema === schema ? captured : captureDefinitionFacts(schema, definition.entries);
  const annotated = new Map(facts.annotated);
  const result: (readonly [string, DescField, string, RuntimeMetadata])[] = [];

  for (const [localName, entry] of Object.entries(definition.entries) as [
    string,
    EntityColumnDefinitionEntry | undefined,
  ][]) {
    if (systemNames.has(localName)) {
      throw new TypeError(`Entity column definition cannot replace system column "${localName}".`);
    }
    if (entry === undefined) continue;
    const fieldFacts = facts.entries.get(localName) ?? captureFieldFacts(entry.field);
    if (fieldFacts.parent !== schema || fieldFacts.localName !== localName) {
      throw new TypeError(
        `Entity column definition key "${localName}" must reference field "${localName}".`,
      );
    }
    if (!fieldFacts.markedColumn) {
      throw new TypeError(`Entity field "${localName}" is not marked (column).`);
    }
    const metadata = describeField(fieldFacts);
    if (entry.comparison !== metadata.comparison) {
      throw new TypeError(
        `Entity column "${localName}" requires ${metadata.comparison} comparison metadata.`,
      );
    }
    annotated.delete(localName);
    result.push([localName, fieldFacts.field, fieldFacts.name, metadata]);
  }

  const missing = annotated.keys().next().value;
  if (missing !== undefined) {
    throw new TypeError(`Entity column definition is missing annotated field "${missing}".`);
  }
  return result;
}

function describeField(field: CapturedFieldFacts): RuntimeMetadata {
  const metadata = field.classification;
  if (!metadata.supported && metadata.reason === "singular") {
    throw new TypeError(
      `Entity column "${field.localName}" must be singular; repeated and map fields are unsupported.`,
    );
  }
  if (!metadata.supported) {
    throw new TypeError(`Entity column "${field.localName}" cannot belong to a oneof.`);
  }
  return metadata;
}

function captureDefinitionFacts(
  schema: GenMessage<Message>,
  entries: EntityColumnEntries,
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
    entityKind: hasOption(schema, entity) ? getOption(schema, entity).kind : undefined,
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
    classification: Object.freeze(classifyEntityField(field)),
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
  comparison: EntityComparison,
): typeof equalityOperators | typeof orderingOperators {
  return comparison === "ordering" ? orderingOperators : equalityOperators;
}
