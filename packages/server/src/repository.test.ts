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
  type EntityFamily,
  type EntityMetadata,
  type RepositoryIdentitySnapshot,
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
class RuntimeCheckedAggregate extends Aggregate<string, DescriptorMessageSchema, number> {}
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
      RepositoryIdentitySnapshot<typeof AggregateStateSchema, typeof TaskAggregate>
    >();
  });

  it("rejects an entity family whose constructor and state schema kind disagree", () => {
    expect(
      () =>
        new Repository({
          entityType: RuntimeCheckedAggregate,
          schema: ProjectionStateSchema,
        }),
    ).toThrow(RepositoryIdentityError);

    try {
      new Repository({
        entityType: RuntimeCheckedAggregate,
        schema: ProjectionStateSchema,
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
      () => new Repository({ entityType: RuntimeCheckedAggregate, schema: GenericStateSchema }),
    ).toThrow(RepositoryIdentityError);

    try {
      new Repository({ entityType: RuntimeCheckedAggregate, schema: GenericStateSchema });
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
        stateFullTypeName: ProjectionStateSchema.typeName,
        stateKind: "projection",
      });
    }
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
    class NamedProjectionRepository extends Repository {
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
        schema: ProjectionStateSchema,
      });
    };

    expectTypeOf(assertRepositoryOptionTypes).not.toBeAny();
  });
});
