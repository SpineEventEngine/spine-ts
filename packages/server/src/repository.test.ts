import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import {
  Aggregate,
  describeEntityMetadata,
  ProcessManager,
  Projection,
  Repository,
  RepositoryIdentityError,
  type DescriptorMessageSchema,
  type EntityOptions,
  type EntityFamily,
  type EntityMetadata,
  type RepositoryEntityType,
  type RepositoryIdentitySnapshot,
  type RepositoryOptions,
} from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type GenericState = Message<"GenericState"> & {
  id: string;
  searchable: boolean;
};

type ProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
};

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server repository fixture descriptor set is empty.");
  }

  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;
const GenericStateSchema = messageDesc(fileEntityMetadataFixture, 2) as GenMessage<GenericState>;

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {}
class RuntimeCheckedAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
const DomainEntityBase = {
  Aggregate,
};
const AggregateAlias = Aggregate;
abstract class DomainAggregateBase extends Aggregate<string, typeof AggregateStateSchema, number> {}
class OtherRepositoryEntityBase {
  otherBase(): string {
    return "other";
  }
}
class PlainEntityClass {
  noop(): string {
    return "plain";
  }
}

describe("repository identity", () => {
  it("constructs metadata-only identity for aggregate, projection, and process-manager entities", () => {
    const aggregate = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projection = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const processManager = new Repository({
      entityType: TaskProcessManager,
      schema: ProcessManagerStateSchema,
    });

    expect(aggregate.entityType).toBe(TaskAggregate);
    expect(aggregate.entityFamily).toBe("aggregate");
    expect(aggregate.metadata).toEqual(describeEntityMetadata(AggregateStateSchema));
    expect(aggregate.stateFullTypeName).toBe(AggregateStateSchema.typeName);
    expect(aggregate.idField.name).toBe("id");
    expect(projection.entityFamily).toBe("projection");
    expect(projection.stateFullTypeName).toBe(ProjectionStateSchema.typeName);
    expect(processManager.entityFamily).toBe("process-manager");
    expect(processManager.stateFullTypeName).toBe(ProcessManagerStateSchema.typeName);
    expectTypeOf(aggregate.metadata).toEqualTypeOf<EntityMetadata<typeof AggregateStateSchema>>();
    expectTypeOf(aggregate.snapshot).toEqualTypeOf<
      RepositoryIdentitySnapshot<typeof TaskAggregate>
    >();
  });

  it("accepts valid same-realm subclass chains through aliases, members, and domain bases", () => {
    class AliasedAggregate extends AggregateAlias<string, typeof AggregateStateSchema, number> {}
    class MemberAggregate extends DomainEntityBase.Aggregate<
      string,
      typeof AggregateStateSchema,
      number
    > {}
    class DomainAggregate extends DomainAggregateBase {}

    for (const entityType of [AliasedAggregate, MemberAggregate, DomainAggregate]) {
      const repository = new Repository({
        entityType,
        schema: AggregateStateSchema,
      });

      expect(repository.entityFamily).toBe("aggregate");
      expect(repository.stateSchema).toBe(AggregateStateSchema);
    }
  });

  it("rejects an entity family whose constructor and state schema kind disagree", () => {
    expect(
      () =>
        new Repository({
          entityType: RuntimeCheckedAggregate,
          schema: ProjectionStateSchema as unknown as typeof AggregateStateSchema,
        }),
    ).toThrow(RepositoryIdentityError);

    try {
      new Repository({
        entityType: RuntimeCheckedAggregate,
        schema: ProjectionStateSchema as unknown as typeof AggregateStateSchema,
      });
      throw new Error("Expected repository identity construction to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      const identityError = error as RepositoryIdentityError;
      expect(identityError.code).toBe("ENTITY_SCHEMA_KIND_MISMATCH");
      expect(identityError.details).toEqual({
        entityTypeName: "RuntimeCheckedAggregate",
        entityFamily: "aggregate",
        stateFullTypeName: ProjectionStateSchema.typeName,
        stateKind: "projection",
      });
    }
  });

  it("rejects generic entity schemas and non-family constructors with structured errors", () => {
    expect(
      () =>
        new Repository({
          entityType: RuntimeCheckedAggregate,
          schema: GenericStateSchema as unknown as typeof AggregateStateSchema,
        }),
    ).toThrow(RepositoryIdentityError);

    try {
      new Repository({
        entityType: RuntimeCheckedAggregate,
        schema: GenericStateSchema as unknown as typeof AggregateStateSchema,
      });
      throw new Error("Expected generic state schema to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("ENTITY_SCHEMA_KIND_MISMATCH");
      expect((error as RepositoryIdentityError).details.stateKind).toBe("entity");
    }

    try {
      new Repository({
        entityType: PlainEntityClass as unknown as typeof TaskProjection,
        schema: ProjectionStateSchema,
      });
      throw new Error("Expected plain entity class to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "PlainEntityClass",
      });
    }

    try {
      new Repository({
        entityType: PlainEntityClass as unknown as typeof TaskProjection,
        schema: undefined as unknown as typeof ProjectionStateSchema,
      });
      throw new Error("Expected unsupported entity type to fail before schema introspection.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "PlainEntityClass",
      });
    }

    const forgedAggregatePrototype = {};
    Object.setPrototypeOf(forgedAggregatePrototype, Aggregate.prototype);

    try {
      new Repository({
        entityType: {
          name: "FakeAggregate",
          prototype: forgedAggregatePrototype,
        } as unknown as typeof RuntimeCheckedAggregate,
        schema: AggregateStateSchema,
      });
      throw new Error("Expected forged non-function entity type to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "FakeAggregate",
      });
    }

    function ForgedAggregateConstructor() {
      return undefined;
    }
    Object.setPrototypeOf(ForgedAggregateConstructor, Aggregate);
    Object.setPrototypeOf(ForgedAggregateConstructor.prototype, Aggregate.prototype);

    try {
      new Repository({
        entityType: ForgedAggregateConstructor as unknown as typeof RuntimeCheckedAggregate,
        schema: AggregateStateSchema,
      });
      throw new Error("Expected forged function entity type to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "ForgedAggregateConstructor",
      });
    }
  });

  it("trusts same-realm ES classes that are explicitly reparented onto an entity family", () => {
    class ForgedAggregateClass {
      forged(): boolean {
        return true;
      }
    }
    Object.setPrototypeOf(ForgedAggregateClass, Aggregate);
    Object.setPrototypeOf(ForgedAggregateClass.prototype, Aggregate.prototype);

    class ForgedAggregateSubclass extends OtherRepositoryEntityBase {}
    Object.setPrototypeOf(ForgedAggregateSubclass, Aggregate);
    Object.setPrototypeOf(ForgedAggregateSubclass.prototype, Aggregate.prototype);

    for (const entityType of [ForgedAggregateClass, ForgedAggregateSubclass]) {
      const repository = new Repository({
        entityType: entityType as unknown as typeof RuntimeCheckedAggregate,
        schema: AggregateStateSchema,
      });

      expect(repository.entityType).toBe(entityType);
      expect(repository.entityFamily).toBe("aggregate");
      expect(repository.stateSchema).toBe(AggregateStateSchema);
    }
  });

  it("rejects malformed nameless entity types with structured errors", () => {
    const entityTypeWithThrowingName = {
      get name(): string {
        throw new Error("entity name accessor should not escape diagnostics");
      },
    };

    for (const entityType of [
      null,
      undefined,
      {},
      { name: undefined },
      { name: "" },
      entityTypeWithThrowingName,
    ]) {
      try {
        new Repository({
          entityType: entityType as unknown as typeof RuntimeCheckedAggregate,
          schema: AggregateStateSchema,
        });
        throw new Error("Expected malformed entity type to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryIdentityError);
        expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
        expect((error as RepositoryIdentityError).details).toEqual({
          entityTypeName: "(anonymous)",
        });
      }
    }
  });

  it("rejects missing or malformed schemas for supported entity types with structured errors", () => {
    for (const schema of [undefined, null, {}, { typeName: "BrokenState" }, { typeName: "" }]) {
      try {
        new Repository({
          entityType: RuntimeCheckedAggregate,
          schema: schema as unknown as typeof AggregateStateSchema,
        });
        throw new Error("Expected malformed repository schema to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryIdentityError);
        expect((error as RepositoryIdentityError).code).toBe("ENTITY_SCHEMA_KIND_MISMATCH");
        expect((error as RepositoryIdentityError).details.entityTypeName).toBe(
          "RuntimeCheckedAggregate",
        );
        expect((error as RepositoryIdentityError).details.entityFamily).toBe("aggregate");
      }
    }

    try {
      new Repository({
        entityType: RuntimeCheckedAggregate,
        schema: { typeName: "BrokenState" } as unknown as typeof AggregateStateSchema,
      });
      throw new Error("Expected malformed named schema to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "RuntimeCheckedAggregate",
        entityFamily: "aggregate",
        stateFullTypeName: "BrokenState",
      });
    }

    try {
      new Repository({
        entityType: RuntimeCheckedAggregate,
        schema: {
          get typeName(): string {
            throw new Error("schema typeName accessor should not escape diagnostics");
          },
        } as unknown as typeof AggregateStateSchema,
      });
      throw new Error("Expected malformed schema with throwing typeName to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "RuntimeCheckedAggregate",
        entityFamily: "aggregate",
      });
    }
  });

  it("rejects nullish options with structured errors", () => {
    for (const options of [null, undefined]) {
      try {
        new Repository(options as unknown as RepositoryOptions<typeof RuntimeCheckedAggregate>);
        throw new Error("Expected malformed repository options to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryIdentityError);
        expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
        expect((error as RepositoryIdentityError).details).toEqual({
          entityTypeName: "(anonymous)",
        });
      }
    }
  });

  it("rejects options whose entity type or schema cannot be read with structured errors", () => {
    const entityThrowingOptions = {
      get entityType(): typeof RuntimeCheckedAggregate {
        throw new Error("entityType accessor should not escape construction");
      },
      schema: AggregateStateSchema,
    } as unknown as RepositoryOptions<typeof RuntimeCheckedAggregate>;

    try {
      new Repository(entityThrowingOptions);
      throw new Error("Expected throwing entityType options to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "(anonymous)",
      });
    }

    const schemaThrowingOptions = {
      entityType: RuntimeCheckedAggregate,
      get schema(): typeof AggregateStateSchema {
        throw new Error("schema accessor should not escape construction");
      },
    } as unknown as RepositoryOptions<typeof RuntimeCheckedAggregate>;

    try {
      new Repository(schemaThrowingOptions);
      throw new Error("Expected throwing schema options to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("ENTITY_SCHEMA_KIND_MISMATCH");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "RuntimeCheckedAggregate",
        entityFamily: "aggregate",
      });
    }

    const revokedOptions = Proxy.revocable(
      {
        entityType: RuntimeCheckedAggregate,
        schema: AggregateStateSchema,
      },
      {},
    );
    revokedOptions.revoke();

    try {
      new Repository(revokedOptions.proxy);
      throw new Error("Expected revoked proxy options to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "(anonymous)",
      });
    }
  });

  it("rejects hostile entity inheritance chains with structured errors", () => {
    class HostileAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
    class StaticParent {
      marker(): string {
        return "static-parent";
      }
    }
    const throwingStaticParent = new Proxy(StaticParent, {
      getPrototypeOf() {
        throw new Error("static prototype chain should not escape family validation");
      },
    });
    Object.setPrototypeOf(HostileAggregate, throwingStaticParent);

    try {
      new Repository({
        entityType: HostileAggregate,
        schema: AggregateStateSchema,
      });
      throw new Error("Expected hostile entity inheritance chain to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect((error as RepositoryIdentityError).code).toBe("UNSUPPORTED_ENTITY_TYPE");
      expect((error as RepositoryIdentityError).details).toEqual({
        entityTypeName: "HostileAggregate",
      });
    }
  });

  it("uses the validated entity type and schema values captured at construction entry", () => {
    let entityTypeReadCount = 0;
    let schemaReadCount = 0;
    const options = {
      get entityType() {
        entityTypeReadCount += 1;
        return entityTypeReadCount === 1 ? TaskAggregate : TaskProjection;
      },
      get schema() {
        schemaReadCount += 1;
        return schemaReadCount === 1 ? AggregateStateSchema : ProjectionStateSchema;
      },
    } as unknown as RepositoryOptions<typeof TaskAggregate>;

    const repository = new Repository(options);

    expect(repository.entityType).toBe(TaskAggregate);
    expect(repository.entityFamily).toBe("aggregate");
    expect(repository.stateSchema).toBe(AggregateStateSchema);
    expect(repository.snapshot.entityType).toBe(TaskAggregate);
    expect(entityTypeReadCount).toBe(1);
    expect(schemaReadCount).toBe(1);
  });

  it("returns frozen fresh snapshots for later builder duplicate and conflict checks", () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });

    const first = repository.snapshot;
    const second = repository.snapshot;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.idField).not.toBe(second.idField);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.idField)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(() => {
      (first as { entityFamily: EntityFamily }).entityFamily = "aggregate";
    }).toThrow(TypeError);
  });

  it("allows repository subclasses to initialize their own fields after super", () => {
    class NamedProjectionRepository extends Repository<typeof TaskProjection> {
      readonly label: string;

      constructor() {
        super({
          entityType: TaskProjection,
          schema: ProjectionStateSchema,
        });
        this.label = "task-projections";
      }
    }

    expect(new NamedProjectionRepository().label).toBe("task-projections");
  });

  it("constrains entity constructor and schema pairs at compile time", () => {
    const assertRepositoryOptionTypes = () => {
      new Repository({
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
      });
      new Repository({
        entityType: TaskProjection,
        schema: ProjectionStateSchema,
      });
      new Repository({
        entityType: TaskProcessManager,
        schema: ProcessManagerStateSchema,
      });
      new Repository({
        entityType: TaskAggregate,
        // @ts-expect-error aggregate repository identity must use the aggregate's state schema.
        schema: ProjectionStateSchema,
      });
      new Repository({
        entityType: TaskProjection,
        // @ts-expect-error projection repository identity must use the projection's state schema.
        schema: AggregateStateSchema,
      });
      new Repository({
        // @ts-expect-error plain classes are not valid repository entity constructors.
        entityType: PlainEntityClass,
        // @ts-expect-error invalid entity constructors do not carry a repository state schema.
        schema: ProjectionStateSchema,
      });
      new Repository({
        // @ts-expect-error non-function object literals are not valid repository entity constructors.
        entityType: {
          name: "ObjectLiteralAggregate",
          prototype: TaskAggregate.prototype,
        },
        // @ts-expect-error invalid entity constructors do not carry a repository state schema.
        schema: AggregateStateSchema,
      });
      // @ts-expect-error bare RepositoryOptions annotations must not erase the constructor-carried schema.
      const erasedAnnotatedOptions: RepositoryOptions = {
        entityType: TaskAggregate,
        schema: ProjectionStateSchema,
      };
      void erasedAnnotatedOptions;
      const mismatchedAnnotatedOptions: RepositoryOptions<typeof TaskAggregate> = {
        entityType: TaskAggregate,
        // @ts-expect-error annotated repository options must preserve the entity constructor's state schema.
        schema: ProjectionStateSchema,
      };
      expectTypeOf(mismatchedAnnotatedOptions).not.toBeAny();
      // @ts-expect-error broad repository options must not erase constructor/schema pairing.
      const broadAnnotatedOptions: RepositoryOptions<RepositoryEntityType> = {
        entityType: TaskAggregate,
        // @ts-expect-error broad repository entity types do not carry one concrete state schema.
        schema: ProjectionStateSchema,
      };
      void broadAnnotatedOptions;
      type BroadAggregateEntityType = RepositoryEntityType<
        Aggregate<unknown, DescriptorMessageSchema, number>
      >;
      // @ts-expect-error family-broad repository options must not erase extracted state schemas.
      const familyBroadAnnotatedOptions: RepositoryOptions<BroadAggregateEntityType> = {
        entityType: TaskAggregate,
        schema: ProjectionStateSchema,
      };
      void familyBroadAnnotatedOptions;
      type ConcreteSchemaFamilyBroadAggregateEntityType = RepositoryEntityType<
        Aggregate<unknown, typeof AggregateStateSchema, number>
      >;
      // @ts-expect-error family-broad repository options must not erase a concrete state schema.
      const concreteSchemaFamilyBroadAnnotatedOptions: RepositoryOptions<ConcreteSchemaFamilyBroadAggregateEntityType> =
        {
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
        };
      void concreteSchemaFamilyBroadAnnotatedOptions;
      type ManuallySpelledFamilyBroadAggregateInstance = Aggregate<
        string,
        typeof AggregateStateSchema,
        number
      >;
      type ManuallySpelledFamilyBroadAggregateEntityType = (abstract new (
        options: EntityOptions<string, typeof AggregateStateSchema, number>,
      ) => ManuallySpelledFamilyBroadAggregateInstance) & {
        readonly name: string;
        readonly prototype: ManuallySpelledFamilyBroadAggregateInstance;
      };
      // @ts-expect-error manually spelled family-broad constructor shapes must not satisfy repository options.
      const manuallySpelledFamilyBroadOptions: RepositoryOptions<ManuallySpelledFamilyBroadAggregateEntityType> =
        {
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
        };
      void manuallySpelledFamilyBroadOptions;
      type PublicStringBrandFamilyBroadAggregateEntityType =
        ManuallySpelledFamilyBroadAggregateEntityType & {
          readonly __spineTsEntityConstructorBrand: true;
        };
      // @ts-expect-error callers must not satisfy repository options by spelling the old public string brand.
      const publicStringBrandFamilyBroadOptions: RepositoryOptions<PublicStringBrandFamilyBroadAggregateEntityType> =
        {
          entityType: undefined as unknown as PublicStringBrandFamilyBroadAggregateEntityType,
          schema: AggregateStateSchema,
        };
      void publicStringBrandFamilyBroadOptions;
      type SchemaUnionAggregateEntityType = RepositoryEntityType<
        Aggregate<unknown, typeof AggregateStateSchema | typeof ProjectionStateSchema, number>
      >;
      // @ts-expect-error schema-union repository options must not erase the concrete state schema.
      const schemaUnionAnnotatedOptions: RepositoryOptions<SchemaUnionAggregateEntityType> = {
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
      };
      void schemaUnionAnnotatedOptions;
      // @ts-expect-error union repository options must not erase constructor/schema pairing.
      const unionAnnotatedOptions: RepositoryOptions<typeof TaskAggregate | typeof TaskProjection> =
        {
          entityType: TaskAggregate,
          // @ts-expect-error union repository entity types do not carry one concrete state schema.
          schema: ProjectionStateSchema,
        };
      void unionAnnotatedOptions;
      // @ts-expect-error subclasses must bind the repository entity constructor type explicitly.
      abstract class UnboundRepositorySubclass extends Repository {}
      void UnboundRepositorySubclass;
      // @ts-expect-error subclasses must not bind the broad repository entity constructor type.
      abstract class BroadRepositorySubclass extends Repository<RepositoryEntityType> {}
      void BroadRepositorySubclass;
      abstract class FamilyBroadRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind family-broad repository entity constructor types.
        BroadAggregateEntityType
      > {}
      void FamilyBroadRepositorySubclass;
      abstract class ConcreteSchemaFamilyBroadRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind family-broad constructor types with concrete schemas.
        ConcreteSchemaFamilyBroadAggregateEntityType
      > {}
      void ConcreteSchemaFamilyBroadRepositorySubclass;
      abstract class ManuallySpelledFamilyBroadRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind manually spelled family-broad constructor shapes.
        ManuallySpelledFamilyBroadAggregateEntityType
      > {}
      void ManuallySpelledFamilyBroadRepositorySubclass;
      abstract class PublicStringBrandFamilyBroadRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind manually spelled constructor shapes by spelling the old public string brand.
        PublicStringBrandFamilyBroadAggregateEntityType
      > {}
      void PublicStringBrandFamilyBroadRepositorySubclass;
      abstract class SchemaUnionRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind schema-union repository entity constructor types.
        SchemaUnionAggregateEntityType
      > {}
      void SchemaUnionRepositorySubclass;
      abstract class UnionRepositorySubclass extends Repository<
        // @ts-expect-error subclasses must not bind a union of repository entity constructor types.
        typeof TaskAggregate | typeof TaskProjection
      > {}
      void UnionRepositorySubclass;
      class MismatchedRepositorySubclass extends Repository<typeof TaskProjection> {
        constructor() {
          super({
            entityType: TaskProjection,
            // @ts-expect-error subclass repository identity must preserve its bound entity schema.
            schema: AggregateStateSchema,
          });
        }
      }
      void MismatchedRepositorySubclass;
      type AggregateSnapshot = RepositoryIdentitySnapshot<typeof TaskAggregate>;
      expectTypeOf<AggregateSnapshot["stateSchema"]>().toEqualTypeOf<typeof AggregateStateSchema>();
      // @ts-expect-error repository snapshots derive the state schema from their constructor generic.
      const impossibleSnapshot: RepositoryIdentitySnapshot<
        typeof ProjectionStateSchema,
        typeof TaskAggregate
      > = undefined as never;
      void impossibleSnapshot;
    };

    expectTypeOf(assertRepositoryOptionTypes).not.toBeAny();
  });
});
