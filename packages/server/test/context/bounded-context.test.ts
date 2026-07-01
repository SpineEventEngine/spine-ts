import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  Aggregate,
  ProcessManager,
  Projection,
  Repository,
  type EntityFamily,
  type RepositoryIdentitySnapshot,
} from "../../src/index.js";
import {
  BoundedContext,
  BoundedContextBuilder,
  BoundedContextNameError,
  BoundedContextRepositoryRegistrationError,
  BoundedContextRuntime,
  ContextSpec,
  type BoundedContextRuntimeOptions,
  type ContextSpecSnapshot,
  type TenantMode,
} from "../../src/context/bounded-context.js";
import type { ServerRuntimeLifecycle, ServerRuntimeState } from "../../src/runtime/runtime.js";

type UntypedConstructor<T> = new (...args: unknown[]) => T;

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
    throw new Error("Server bounded-context fixture descriptor set is empty.");
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
const alternateFileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const AlternateAggregateStateSchema = messageDesc(
  alternateFileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
class TaskSummaryProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {}

const ContextSpecConstructor = ContextSpec as unknown as UntypedConstructor<ContextSpec>;
const BoundedContextBuilderConstructor =
  BoundedContextBuilder as unknown as UntypedConstructor<BoundedContextBuilder>;
const BoundedContextConstructor = BoundedContext as unknown as UntypedConstructor<BoundedContext>;

class RecordingRuntime implements ServerRuntimeLifecycle {
  readonly calls: string[] = [];
  state: ServerRuntimeState = "created";

  start(): Promise<void> {
    this.calls.push("start");
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.calls.push("close");
    this.state = "closed";
    return Promise.resolve();
  }
}

function repositoryWithTaskAggregateSnapshot(
  transformSnapshot: (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) => unknown,
): Repository<typeof TaskAggregate> {
  return new (class extends Repository<typeof TaskAggregate> {
    constructor() {
      super({
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
      });
    }

    override get snapshot(): RepositoryIdentitySnapshot<typeof TaskAggregate> {
      return transformSnapshot(super.snapshot) as RepositoryIdentitySnapshot<typeof TaskAggregate>;
    }
  })();
}

describe("BoundedContext builder shell", () => {
  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
  });

  it("keeps context names as immutable value objects", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const spec = builder.spec;
    const firstSnapshot = spec.snapshot;
    const secondSnapshot = spec.snapshot;

    expect(spec.name.value).toBe("Tasks");
    expect(Object.isFrozen(spec.name)).toBe(true);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(firstSnapshot).toEqual(secondSnapshot);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    expect(firstSnapshot.name).not.toBe(secondSnapshot.name);
  });

  it("creates single-tenant and multitenant builders with expected tenant mode", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks");
    const multitenant = BoundedContext.multitenant("Customers");

    expect(singleTenant.name.value).toBe("Tasks");
    expect(singleTenant.tenantMode).toBe<TenantMode>("single-tenant");
    expect(singleTenant.isMultitenant()).toBe(false);
    expect(singleTenant.spec.multitenant).toBe(false);

    expect(multitenant.name.value).toBe("Customers");
    expect(multitenant.tenantMode).toBe<TenantMode>("multitenant");
    expect(multitenant.isMultitenant()).toBe(true);
    expect(multitenant.spec.multitenant).toBe(true);
  });

  it("builds an immutable copy-safe context snapshot", () => {
    const builder = BoundedContext.multitenant("Tasks");
    const context = builder.build();
    const firstSnapshot = context.snapshot;
    const firstBuilderSpec = builder.spec;
    const secondBuilderSpec = builder.spec;
    const firstContextSpec = context.spec;
    const secondContextSpec = context.spec;

    expect(context.name.value).toBe("Tasks");
    expect(context.tenantMode).toBe<TenantMode>("multitenant");
    expect(context.isMultitenant).toBe(true);
    expect(context.spec.storesEvents).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.name)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.spec)).toBe(true);
    expect(firstSnapshot).toEqual({
      name: { value: "Tasks" },
      tenantMode: "multitenant",
      spec: {
        name: { value: "Tasks" },
        multitenant: true,
        storesEvents: true,
      },
      repositories: [],
    });

    const secondSnapshot = context.snapshot;
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot.name).not.toBe(firstSnapshot.name);
    expect(secondSnapshot.spec).not.toBe(firstSnapshot.spec);
    expect(firstBuilderSpec.snapshot).toEqual(secondBuilderSpec.snapshot);
    expect(firstBuilderSpec).not.toBe(secondBuilderSpec);
    expect(firstBuilderSpec.name).not.toBe(secondBuilderSpec.name);
    expect(firstContextSpec.snapshot).toEqual(secondContextSpec.snapshot);
    expect(firstContextSpec).not.toBe(secondContextSpec);
    expect(firstContextSpec.name).not.toBe(secondContextSpec.name);
  });

  it("exposes the metadata-only builder and built-context surface", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const context = builder.build();
    const forbiddenRuntimeMembers = [
      "close",
      "register",
      "registerCommandDispatcher",
      "registerEventDispatcher",
      "commandBus",
      "eventBus",
      "stand",
      "storage",
      "tenantIndex",
      "systemContext",
    ];

    expect(Object.getOwnPropertyNames(BoundedContextBuilder.prototype).sort()).toEqual([
      "add",
      "build",
      "constructor",
      "isMultitenant",
      "name",
      "remove",
      "repositories",
      "spec",
      "tenantMode",
    ]);
    expect(Object.getOwnPropertyNames(BoundedContext.prototype).sort()).toEqual([
      "constructor",
      "isMultitenant",
      "name",
      "repositories",
      "snapshot",
      "spec",
      "tenantMode",
    ]);
    expect(Object.getOwnPropertyNames(ContextSpec.prototype).sort()).toEqual([
      "constructor",
      "multitenant",
      "name",
      "snapshot",
      "storesEvents",
      "tenantMode",
    ]);
    expect(Object.keys(builder.spec.snapshot).sort()).toEqual([
      "multitenant",
      "name",
      "storesEvents",
    ]);
    expect(Object.keys(context.snapshot).sort()).toEqual([
      "name",
      "repositories",
      "spec",
      "tenantMode",
    ]);
    expect(context.spec.snapshot).toEqual(builder.spec.snapshot);

    for (const member of forbiddenRuntimeMembers) {
      expect(member in context).toBe(false);
      expect(Object.hasOwn(context, member)).toBe(false);
    }
  });

  it("rejects direct JS construction outside the public builder path", () => {
    expect(() =>
      Reflect.construct(ContextSpecConstructor, [
        {
          name: { value: "Tasks" },
          multitenant: false,
          storesEvents: true,
        } satisfies ContextSpecSnapshot,
      ]),
    ).toThrow(/framework-owned/);
    expect(() =>
      Reflect.construct(BoundedContextBuilderConstructor, [
        { name: { value: "Tasks" }, multitenant: false, storesEvents: true },
      ]),
    ).toThrow(/BoundedContext\.singleTenant\(name\)|BoundedContext\.multitenant\(name\)/);
    expect(() =>
      Reflect.construct(BoundedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "single-tenant",
          spec: { name: { value: "Tasks" }, multitenant: false, storesEvents: true },
        },
      ]),
    ).toThrow(/builder\.build\(\)/);
  });

  it("rejects subclass and prototype forgery at the construction boundary", () => {
    class MaliciousContextSpec extends ContextSpecConstructor {
      override get snapshot() {
        return Object.freeze({
          name: Object.freeze({ value: "" }) as never,
          multitenant: "no" as never,
          storesEvents: "yes" as never,
        });
      }
    }

    const forgedBuilder = Object.create(BoundedContextBuilder.prototype) as BoundedContextBuilder;

    expect(() =>
      Reflect.construct(
        ContextSpecConstructor,
        [
          {
            name: { value: "Tasks" },
            multitenant: false,
            storesEvents: true,
          } satisfies ContextSpecSnapshot,
        ],
        MaliciousContextSpec as UntypedConstructor<ContextSpec>,
      ),
    ).toThrow(/framework-owned/);
    expect(() =>
      Reflect.construct(BoundedContextBuilderConstructor, [
        {
          name: { value: "Tasks" },
          multitenant: false,
          storesEvents: true,
        } satisfies ContextSpecSnapshot,
      ]),
    ).toThrow(/framework-owned/);
    expect(() => forgedBuilder.build()).toThrow(TypeError);
  });

  it("does not allow constructor-property leakage to forge valid-looking instances", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const context = builder.build();
    const spec = builder.spec;

    const leakedSpecConstructor = spec.constructor as UntypedConstructor<ContextSpec>;
    const leakedBuilderConstructor =
      builder.constructor as UntypedConstructor<BoundedContextBuilder>;
    const leakedContextConstructor = context.constructor as UntypedConstructor<BoundedContext>;

    expect(() =>
      Reflect.construct(leakedSpecConstructor, [
        {
          name: { value: "" },
          multitenant: "nope",
          storesEvents: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      Reflect.construct(leakedBuilderConstructor, [
        {
          name: { value: "" },
          multitenant: "nope",
          storesEvents: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "" },
          tenantMode: "anything-goes",
          spec: {
            name: { value: "" },
            multitenant: "nope",
            storesEvents: true,
          },
        },
      ]),
    ).toThrow();
    expect(() => Reflect.construct(leakedContextConstructor, [null])).toThrow(
      /snapshot must be an object/,
    );
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "single-tenant",
          spec: {
            name: { value: "OtherTasks" },
            multitenant: false,
            storesEvents: true,
          },
        },
      ]),
    ).toThrow(/must match BoundedContext\.spec\.name/);
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "multitenant",
          spec: {
            name: { value: "Tasks" },
            multitenant: false,
            storesEvents: true,
          },
        },
      ]),
    ).toThrow(/must match BoundedContext\.spec\.multitenant/);
  });

  it("adds and removes explicit repository identities with chainable builder calls", () => {
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks");

    expect(builder.add(aggregateRepository)).toBe(builder);
    expect(builder.add(projectionRepository)).toBe(builder);
    expect(builder.repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      AggregateStateSchema.typeName,
      ProjectionStateSchema.typeName,
    ]);

    expect(builder.remove(aggregateRepository)).toBe(builder);
    expect(builder.repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      ProjectionStateSchema.typeName,
    ]);

    const context = builder.build();
    expect(context.repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      ProjectionStateSchema.typeName,
    ]);
    expect(context.snapshot.repositories.map((repository) => repository.entityType)).toEqual([
      TaskProjection,
    ]);
  });

  it("keeps builder and built-context repository snapshots immutable and copy-safe", () => {
    const repository = new Repository({
      entityType: TaskProcessManager,
      schema: ProcessManagerStateSchema,
    });
    const builder = BoundedContext.multitenant("Tasks").add(repository);
    const firstBuilderRepositories = builder.repositories;
    const secondBuilderRepositories = builder.repositories;
    const contextBeforeRemoval = builder.build();
    const firstContextRepositories = contextBeforeRemoval.repositories;
    const secondContextRepositories = contextBeforeRemoval.repositories;
    const contextBeforeRemovalSnapshot = contextBeforeRemoval.snapshot;

    builder.remove(repository);
    const contextAfterRemoval = builder.build();

    expect(firstBuilderRepositories).toEqual(secondBuilderRepositories);
    expect(firstBuilderRepositories).not.toBe(secondBuilderRepositories);
    expect(firstBuilderRepositories[0]).not.toBe(secondBuilderRepositories[0]);
    expect(Object.isFrozen(firstBuilderRepositories)).toBe(true);
    expect(Object.isFrozen(firstBuilderRepositories[0])).toBe(true);
    expect(Object.isFrozen(firstBuilderRepositories[0]?.idField)).toBe(true);
    expect(firstContextRepositories).toEqual(secondContextRepositories);
    expect(firstContextRepositories).not.toBe(secondContextRepositories);
    expect(firstContextRepositories[0]).not.toBe(secondContextRepositories[0]);
    expect(contextBeforeRemovalSnapshot.repositories).toEqual(firstContextRepositories);
    expect(contextBeforeRemovalSnapshot.repositories).not.toBe(firstContextRepositories);
    expect(contextBeforeRemovalSnapshot.repositories[0]).not.toBe(firstContextRepositories[0]);
    expect(contextBeforeRemoval.repositories.map((snapshot) => snapshot.entityType)).toEqual([
      TaskProcessManager,
    ]);
    expect(contextAfterRemoval.repositories).toEqual([]);
    expect(() => {
      (firstBuilderRepositories[0] as { entityFamily: EntityFamily }).entityFamily = "aggregate";
    }).toThrow(TypeError);
  });

  it("treats repeated registration of the same repository identity as idempotent", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const equivalentRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .add(repository)
      .add(equivalentRepository);

    expect(builder.repositories).toHaveLength(1);
    expect(builder.build().repositories).toHaveLength(1);
  });

  it("rejects repositories that make one entity constructor own conflicting state types", () => {
    class ConflictingTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
    const aggregateRepository = new Repository({
      entityType: ConflictingTaskAggregate,
      schema: AggregateStateSchema,
    });
    const conflictingRepository = new Repository({
      entityType: ConflictingTaskAggregate,
      schema: AlternateAggregateStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks").add(aggregateRepository);

    expect(() => builder.add(conflictingRepository)).toThrow(
      BoundedContextRepositoryRegistrationError,
    );

    try {
      builder.add(conflictingRepository);
      throw new Error("Expected conflicting entity constructor ownership to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("ENTITY_TYPE_CONFLICT");
      expect(registrationError.details).toEqual({
        contextName: "Tasks",
        existing: {
          entityTypeName: "ConflictingTaskAggregate",
          entityFamily: "aggregate",
          stateFullTypeName: AggregateStateSchema.typeName,
        },
        incoming: {
          entityTypeName: "ConflictingTaskAggregate",
          entityFamily: "aggregate",
          stateFullTypeName: AlternateAggregateStateSchema.typeName,
        },
      });
    }
  });

  it("rejects repositories that make one state type belong to multiple entity constructors", () => {
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const conflictingRepository = new Repository({
      entityType: TaskSummaryProjection,
      schema: ProjectionStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks").add(projectionRepository);

    try {
      builder.add(conflictingRepository);
      throw new Error("Expected conflicting state type ownership to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("STATE_TYPE_CONFLICT");
      expect(registrationError.details).toEqual({
        contextName: "Tasks",
        existing: {
          entityTypeName: "TaskProjection",
          entityFamily: "projection",
          stateFullTypeName: ProjectionStateSchema.typeName,
        },
        incoming: {
          entityTypeName: "TaskSummaryProjection",
          entityFamily: "projection",
          stateFullTypeName: ProjectionStateSchema.typeName,
        },
      });
    }
  });

  it("wraps unreadable repository snapshots in a deterministic registration error", () => {
    class UnreadableSnapshotRepository extends Repository<typeof TaskAggregate> {
      constructor() {
        super({
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
        });
      }

      override get snapshot(): RepositoryIdentitySnapshot<typeof TaskAggregate> {
        throw new Error("raw snapshot leak");
      }
    }

    const builder = BoundedContext.singleTenant("Tasks");

    try {
      builder.add(new UnreadableSnapshotRepository());
      throw new Error("Expected unreadable repository snapshots to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("INVALID_REPOSITORY_SNAPSHOT");
      expect(registrationError.message).toContain("BoundedContextBuilder.add");
      expect(registrationError.message).not.toContain("raw snapshot leak");
      expect(registrationError.details).toEqual({
        contextName: "Tasks",
        operation: "add",
      });
    }
  });

  it("wraps malformed repository snapshot metadata in a deterministic registration error", () => {
    class MalformedSnapshotRepository extends Repository<typeof TaskProjection> {
      constructor() {
        super({
          entityType: TaskProjection,
          schema: ProjectionStateSchema,
        });
      }

      override get snapshot(): RepositoryIdentitySnapshot<typeof TaskProjection> {
        const snapshot = super.snapshot;
        const metadata = Object.create(snapshot.metadata) as typeof snapshot.metadata;

        Object.defineProperty(metadata, "columns", {
          get() {
            throw new Error("raw metadata leak");
          },
        });

        return Object.freeze({
          ...snapshot,
          metadata,
        });
      }
    }

    const builder = BoundedContext.singleTenant("Tasks");

    try {
      builder.remove(new MalformedSnapshotRepository());
      throw new Error("Expected malformed repository snapshots to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("INVALID_REPOSITORY_SNAPSHOT");
      expect(registrationError.message).toContain("BoundedContextBuilder.remove");
      expect(registrationError.message).not.toContain("raw metadata leak");
      expect(registrationError.details).toEqual({
        contextName: "Tasks",
        operation: "remove",
      });
    }
  });

  it.each([
    [
      "unsupported entity family",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          entityFamily: "unsupported" as never,
        }),
    ],
    [
      "empty state type name",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          stateFullTypeName: "" as never,
        }),
    ],
    [
      "mismatched metadata type name",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            fullTypeName: "spine.invalid.State",
          }),
        }),
    ],
    [
      "mismatched state schema type name",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            fullTypeName: "spine.invalid.State",
          }),
          stateFullTypeName: "spine.invalid.State" as never,
        }),
    ],
    [
      "forged metadata kind for descriptor state kind",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          stateSchema: ProjectionStateSchema as never,
          stateFullTypeName: ProjectionStateSchema.typeName,
          metadata: Object.freeze({
            ...snapshot.metadata,
            schema: ProjectionStateSchema as never,
            fullTypeName: ProjectionStateSchema.typeName,
            kind: "aggregate",
          }),
        }),
    ],
    [
      "malformed ID field",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          idField: Object.freeze({
            ...snapshot.idField,
            name: 7 as never,
          }),
        }),
    ],
    [
      "non-array metadata columns",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            columns: {
              map() {
                return {
                  forEach() {
                    // Hostile array-like value that used to bypass validation.
                  },
                };
              },
            } as never,
          }),
        }),
    ],
    [
      "non-array metadata set-once fields",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            setOnceFields: {
              map() {
                return {
                  forEach() {
                    // Hostile array-like value that used to bypass validation.
                  },
                };
              },
            } as never,
          }),
        }),
    ],
    [
      "sparse metadata columns",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            columns: Array(1) as never,
          }),
        }),
    ],
    [
      "sparse metadata set-once fields",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            setOnceFields: Array(1) as never,
          }),
        }),
    ],
    [
      "non-array metadata semantic tags",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: new Set(["snapshot"]) as never,
          }),
        }),
    ],
    [
      "sparse metadata semantic tags",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: Array(1) as never,
          }),
        }),
    ],
    [
      "non-string metadata semantic tag",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: [7] as never,
          }),
        }),
    ],
    [
      "empty metadata semantic tag",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: [""] as never,
          }),
        }),
    ],
    [
      "blank metadata semantic tag",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: [" \t\n"] as never,
          }),
        }),
    ],
    [
      "trim-needed metadata semantic tag",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: [" example.tags.AggregateTag "] as never,
          }),
        }),
    ],
    [
      "duplicate metadata semantic tags",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: ["example.tags.AggregateTag", "example.tags.AggregateTag"] as never,
          }),
        }),
    ],
    [
      "unsorted metadata semantic tags",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          metadata: Object.freeze({
            ...snapshot.metadata,
            semanticTags: ["example.tags.ZetaTag", "example.tags.AlphaTag"] as never,
          }),
        }),
    ],
    [
      "arbitrary entity constructor",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          entityType: (() => undefined) as never,
        }),
    ],
    [
      "mismatched entity constructor family",
      (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) =>
        Object.freeze({
          ...snapshot,
          entityType: TaskProjection as never,
        }),
    ],
  ] satisfies readonly [
    string,
    (snapshot: RepositoryIdentitySnapshot<typeof TaskAggregate>) => unknown,
  ][])(
    "wraps copyable repository snapshots with %s in a deterministic registration error",
    (_caseName, transformSnapshot) => {
      const repository = repositoryWithTaskAggregateSnapshot(transformSnapshot);
      const builder = BoundedContext.singleTenant("Tasks");

      try {
        builder.add(repository);
        throw new Error("Expected malformed repository snapshots to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
        const registrationError = error as BoundedContextRepositoryRegistrationError;
        expect(registrationError.code).toBe("INVALID_REPOSITORY_SNAPSHOT");
        expect(registrationError.details).toEqual({
          contextName: "Tasks",
          operation: "add",
        });
      }
    },
  );

  it("sanitizes entity constructor names in repository conflict diagnostics", () => {
    class NamelessTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
    class NumericNameTaskProjection extends Projection<
      string,
      typeof ProjectionStateSchema,
      number
    > {}

    Object.defineProperty(NamelessTaskProjection, "name", {
      get() {
        throw new Error("raw name leak");
      },
    });
    Object.defineProperty(NumericNameTaskProjection, "name", {
      value: 42,
    });

    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const conflictingRepository = new Repository({
      entityType: NamelessTaskProjection,
      schema: ProjectionStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks").add(projectionRepository);

    try {
      builder.add(conflictingRepository);
      throw new Error("Expected conflicting state type ownership to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("STATE_TYPE_CONFLICT");
      expect(registrationError.message).not.toContain("raw name leak");
      expect(registrationError.details).toMatchObject({
        incoming: {
          entityTypeName: "(anonymous)",
        },
      });
    }

    const numericNameConflictingRepository = new Repository({
      entityType: NumericNameTaskProjection,
      schema: ProjectionStateSchema,
    });

    try {
      builder.add(numericNameConflictingRepository);
      throw new Error("Expected conflicting state type ownership to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundedContextRepositoryRegistrationError);
      const registrationError = error as BoundedContextRepositoryRegistrationError;
      expect(registrationError.code).toBe("STATE_TYPE_CONFLICT");
      expect(registrationError.details).toMatchObject({
        incoming: {
          entityTypeName: "(anonymous)",
        },
      });
    }
  });
});

describe("BoundedContextRuntime", () => {
  it("owns a default single-process runtime lifecycle for a built context", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const runtime = new BoundedContextRuntime(context);

    expect(runtime.state).toBe("created");

    await runtime.start();

    expect(runtime.state).toBe("running");

    await runtime.close();

    expect(runtime.state).toBe("closed");
  });

  it("delegates lifecycle state, start, and close to an injected lifecycle", async () => {
    const lifecycle = new RecordingRuntime();
    const runtime = new BoundedContextRuntime(BoundedContext.multitenant("Tasks").build(), {
      runtime: lifecycle,
    });

    expect(runtime.state).toBe("created");

    await runtime.start();
    await runtime.close();

    expect(lifecycle.calls).toEqual(["start", "close"]);
    expect(runtime.state).toBe("closed");
  });

  it("ignores inherited options.runtime and owns a default lifecycle", async () => {
    const inheritedLifecycle = new RecordingRuntime();
    const options = Object.create({
      runtime: inheritedLifecycle,
    }) as BoundedContextRuntimeOptions;

    expect("runtime" in options).toBe(true);
    expect(Object.hasOwn(options, "runtime")).toBe(false);

    const runtime = new BoundedContextRuntime(
      BoundedContext.singleTenant("Tasks").build(),
      options,
    );

    expect(runtime.state).toBe("created");

    await runtime.start();
    await runtime.close();

    expect(runtime.state).toBe("closed");
    expect(inheritedLifecycle.calls).toEqual([]);
  });

  it("exposes copy-safe built context metadata snapshots", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    const runtime = new BoundedContextRuntime(context);
    const firstSnapshot = runtime.contextSnapshot;
    const secondSnapshot = runtime.contextSnapshot;
    const firstRepositories = runtime.repositories;
    const secondRepositories = runtime.repositories;
    const firstSpec = runtime.spec;
    const secondSpec = runtime.spec;

    expect(runtime.name.value).toBe("Tasks");
    expect(runtime.tenantMode).toBe<TenantMode>("multitenant");
    expect(runtime.isMultitenant).toBe(true);
    expect(firstSnapshot).toEqual(context.snapshot);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    expect(firstSnapshot.name).not.toBe(secondSnapshot.name);
    expect(firstSnapshot.spec).not.toBe(secondSnapshot.spec);
    expect(firstSnapshot.repositories).not.toBe(secondSnapshot.repositories);
    expect(firstSnapshot.repositories[0]).not.toBe(secondSnapshot.repositories[0]);
    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.repositories[0])).toBe(true);
    expect(firstRepositories).toEqual(secondRepositories);
    expect(firstRepositories).not.toBe(secondRepositories);
    expect(firstRepositories[0]).not.toBe(secondRepositories[0]);
    expect(firstSpec.snapshot).toEqual(secondSpec.snapshot);
    expect(firstSpec).not.toBe(secondSpec);
    expect(() => {
      (firstRepositories[0] as { entityFamily: EntityFamily }).entityFamily = "projection";
    }).toThrow(TypeError);
  });

  it("keeps queue methods and out-of-scope server graph members absent", () => {
    const runtime = new BoundedContextRuntime(BoundedContext.singleTenant("Tasks").build());
    const forbiddenRuntimeMembers = [
      "enqueue",
      "register",
      "registerRepository",
      "registerCommandDispatcher",
      "registerEventDispatcher",
      "commandBus",
      "eventBus",
      "importBus",
      "stand",
      "storage",
      "tenantIndex",
      "systemContext",
      "integrationBroker",
      "commandService",
      "queryService",
      "subscriptionService",
    ];

    expect(Object.getOwnPropertyNames(BoundedContextRuntime.prototype).sort()).toEqual([
      "close",
      "constructor",
      "contextSnapshot",
      "isMultitenant",
      "name",
      "repositories",
      "spec",
      "start",
      "state",
      "tenantMode",
    ]);

    for (const member of forbiddenRuntimeMembers) {
      expect(member in runtime).toBe(false);
      expect(Object.hasOwn(runtime, member)).toBe(false);
    }
  });
});
