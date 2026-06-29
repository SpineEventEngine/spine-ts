# Spine TS User Guide

Current status: early framework guide for the descriptor registry,
single-message validation facade, core envelope construction helpers, the first
server entity and handler metadata layers, and the first storage contracts with
an in-memory adapter.

This guide covers the runnable behavior available now: Spine proto descriptors
are exposed through curated packages, `@spine-ts/core` can derive and look up
type metadata, framework users can validate one Protobuf message at a time, and
callers can pack already-built domain messages into generated Spine
`Command`/`Event` envelopes. `@spine-ts/server` now derives descriptor-backed
entity metadata from `(entity)`, `(column)`, `(set_once)`, `(is)`, and
`(every_is)` options and defines explicit or decorator-collected handler
metadata without invoking handlers or mutating global runtime state. It also
exposes built-in `(set_once)` entity state transition validation and a
caller-owned handler metadata registry for duplicate validation and lookup-only
views.
`@spine-ts/storage` exposes asynchronous record-oriented storage contracts and a
deterministic in-memory adapter for tests/development. Entity runtime,
transport, durable production storage, and the to-do application remain later
slices.

## What Exists Now

- A pnpm workspace with package boundaries for proto, core, server, transport, storage, and testing.
- Strict TypeScript project references configured for ESM-first NodeNext packages.
- Tooling commands for type checking, linting, formatting, tests, coverage, TypeDoc, and Buf/Protobuf-ES generation.
- A first copied Spine proto set under `proto/`, with provenance checksums in
  `proto/spine-sources.json`.
- Curated Protobuf-ES schemas, descriptors, message types, and Spine custom
  options exported from `@spine-ts/proto` for the first intake set.
- A core type registry in `@spine-ts/core` that derives Spine type URLs,
  exposes a read-only default lookup view for the current curated schemas, and
  looks up descriptor-backed metadata by full type name, type URL, or schema.
- Canonical Spine core command/event envelope and context contracts are
  available from `@spine-ts/proto` and pre-registered in
  `spineCoreRegistry`, including `CommandSchema`, `EventSchema`,
  `ActorContextSchema`, `TenantIdSchema`, `UserIdSchema`, and
  `VersionSchema`.
- A core validation facade that validates single Protobuf messages through
  `@spine-event-engine/validation-ts` while returning repo-local Spine
  `ValidationError` and `ConstraintViolation` data.
- Core `packAny()`, `unpackAny()`, `packCommand()`, and `packEvent()` helpers
  for Spine-aware payload packing and generated command/event envelope
  construction.
- Server entity metadata helpers in `@spine-ts/server` that normalize entity
  kind and visibility, expose first-field routing hints, surface `(column)`
  fields for projections/process managers, surface `(set_once)` fields for all
  entity kinds, and preserve semantic tags from `(is)` and `(every_is)`.
- A server entity state transition validator that enforces built-in
  `(set_once)` checks by comparing previous and proposed entity state through
  the core transition validation facade.
- Server handler metadata helpers in `@spine-ts/server` that explicitly bind
  generated command/event schemas to entity method names for command assignment,
  command reaction, event subscription, event reaction, and event application.
- Server standard method decorators in `@spine-ts/server` that collect
  class-owned handler metadata with explicit generated schemas and materialize
  into the same `EntityHandlersMetadata` shape as explicit registration.
- A caller-owned server handler metadata registry that registers explicit
  entity handler metadata, rejects duplicate command assignments and duplicate
  event appliers for the same entity/event pair, and exposes frozen
  deterministic lookup views.
- Storage contracts in `@spine-ts/storage` for write-side entity records,
  aggregate event histories/snapshots, read-side projection records, delivery
  records, tenant indexes, and safe diagnostics.
- `InMemoryStorageAdapter` for deterministic tests and local development. It is
  isolated per instance, snapshots stored values, supports optimistic version
  checks, and is not durable across process restarts.
- A placeholder to-do example workspace.

## What Is Deferred

- Runtime ID generation, timestamp factories, actor/tenant context factories,
  event producer/version/origin policy, command system properties, and runtime
  metadata generation.
- Semantic tag registration from `(is)` and `(every_is)` into handler/routing
  registries. The server metadata APIs preserve entity tags and explicit
  handler declarations now, but no runtime registry consumes them yet.
- gRPC service implementations.
- Entity, bus, transport, durable production storage, and to-do domain runtime
  behavior.

## Type Registry

```ts
import { FieldPathSchema } from "@spine-ts/proto";
import { deriveTypeUrl, spineCoreRegistry } from "@spine-ts/core";

const typeUrl = deriveTypeUrl(FieldPathSchema);
const metadata = spineCoreRegistry.getByFullName("spine.base.FieldPath");
```

The shared `spineCoreRegistry` is lookup-only. Use `createSpineCoreRegistry()`
when application or test code needs a caller-owned mutable registry.

Spine files normally declare `option (type_url_prefix) = "type.spine.io"`.
`deriveTypeUrl()` composes that prefix with the schema's full Protobuf type
name. For files without the Spine option, the core registry uses the documented
fallback prefix `type.googleapis.com`.

The shared registry also contains the canonical core signal contracts:

```ts
import { CommandSchema, EventSchema } from "@spine-ts/proto";
import { spineCoreRegistry } from "@spine-ts/core";

const commandTypeUrl = spineCoreRegistry.getBySchema(CommandSchema).typeUrl;
const eventTypeUrl = spineCoreRegistry.getBySchema(EventSchema).typeUrl;
```

## Validation

Use `@spine-ts/core` for validation. Application code does not import
`@spine-event-engine/validation-ts` directly.

```ts
import { create } from "@bufbuild/protobuf";
import { checkValid, validateMessage, ValidationException } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const command = create(CreateTaskSchema, {});
const result = validateMessage(CreateTaskSchema, command);

if (!result.valid) {
  const fields = result.violations.map(
    (violation) => violation.fieldPath?.fieldName.join(".") ?? violation.typeName,
  );
  console.warn(`Command failed ${result.violations.length} validation rule(s).`, fields);
}

try {
  checkValid(CreateTaskSchema, command);
} catch (error) {
  if (error instanceof ValidationException) {
    const validationError = error.asMessage();
    console.warn(
      `Command rejected with ${validationError.constraintViolation.length} violation(s).`,
    );
  }
}
```

`validateMessage()` is for single-message Spine validation options such as
`(required)`, `(pattern)`, and `(validate)`. Returned
`ConstraintViolation`/`ValidationError` data is safe by default: raw invalid
field values are omitted, upstream and transition-rule placeholder values are
redacted, and upstream validation runtime failures are converted into repo-local
structured violations instead of leaking raw exceptions. Placeholder keys may
remain so callers can understand the template shape, but values do not expose
payload data.

Transition-only rules need previous state and proposed state, so they use the
separate framework seam:

```ts
import { validateTransition } from "@spine-ts/core";

const result = validateTransition({ schema: TaskSchema, previous, next }, rules);
```

`@spine-ts/server` provides the first built-in entity rule for `(set_once)`
fields:

```ts
import { validateEntityStateTransition } from "@spine-ts/server";

const result = validateEntityStateTransition({
  schema: TaskStateSchema,
  previous,
  next,
});
```

`validateEntityStateTransition()` derives set-once fields from
`describeEntityMetadata()`. Creation transitions where `previous === undefined`
pass these checks. Existing-state transitions fail when a set-once field's value
changes and pass when set-once values remain equal. Violations are shaped by the
core `validateTransition()` facade, include the changed field path, and omit raw
previous/next values. Map-valued `(set_once)` fields are explicitly unsupported
in this slice and fail closed with a field-specific violation even if the map
contents are unchanged. The server API is pure validation: it does not
instantiate entities, invoke handlers, read or write storage, assemble
repositories, dispatch buses, or start transport.

Rule-returned violations are sanitized before aggregation. If a transition rule
throws, the core seam records a structured transition-rule failure and continues
later rules in order.

## Envelope Packing

Use `packAny()` when a domain message must be packed into
`google.protobuf.Any` with Spine routing semantics:

```ts
import { create } from "@bufbuild/protobuf";
import { packAny, unpackAny } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const payload = create(CreateTaskSchema, { title: "Ship the thin slice" });
const any = packAny(CreateTaskSchema, payload);
const unpacked = unpackAny(any, CreateTaskSchema);
```

`packAny()` derives the type URL through the core registry policy, so Spine
messages use `type.spine.io/...` when their `.proto` file declares the Spine
`type_url_prefix` option. The helper serializes with Protobuf-ES binary
serialization and validates the enclosed message by default. Pass
`{ validate: false }` only for already-trusted messages. Framework packing omits
unknown fields for stable helper output, but this slice does not claim fully
canonical map ordering because Protobuf-ES 2.12.1 does not provide a
deterministic map-order option.

Command and event helpers wrap the same packing behavior in generated Spine
envelopes:

```ts
import { packCommand, packEvent } from "@spine-ts/core";

const command = packCommand({
  id: commandId,
  context: commandContext,
  schema: CreateTaskSchema,
  message: payload,
});

const event = packEvent({
  id: eventId,
  context: eventContext,
  schema: TaskCreatedSchema,
  message: taskCreated,
});
```

The caller supplies generated IDs and contexts. The core helpers do not create
UUIDs, timestamps, actor/tenant contexts, producer IDs, versions, origins,
system properties, bus deliveries, storage records, or transport metadata.
Validation errors are structured through `ValidationException` and do not expose
packed bytes or payload contents. `unpackAny()` returns `undefined` for type URL
mismatches or malformed payload bytes. Command and event envelopes snapshot the
supplied generated IDs and contexts before returning.

## Entity Metadata

Use `@spine-ts/server` when later runtime code needs deterministic metadata for
entity schemas:

```ts
import { describeEntityMetadata } from "@spine-ts/server";

const metadata = describeEntityMetadata(TaskProjectionStateSchema);

metadata.kind; // "projection"
metadata.visibility; // "full" when `(entity).visibility` is omitted on projections
metadata.idField.name; // "id"
metadata.firstFieldRoutingHint.field.name; // "id"
metadata.columns.map((field) => field.name);
metadata.setOnceFields.map((field) => field.name);
metadata.semanticTags;
```

`describeEntityMetadata()` is pure and descriptor-backed. It does not register
handlers, perform routing, touch storage, or mutate a global registry. Built-in
`(set_once)` enforcement lives in `validateEntityStateTransition()`, which
consumes this descriptor metadata. `describeEntityMetadata()` throws
`DescriptorMetadataError` when a caller requires
entity metadata from a non-entity schema or when the descriptor uses
unsupported combinations such as repeated/map `(column)` fields on projections
or process managers. Aggregate and generic entity `(column)` declarations are
ignored in this slice, matching the Spine option contract.

## Handler Metadata

Use explicit handler metadata when an entity class needs to declare which
methods later runtime slices should inspect. This remains the canonical
metadata contract and the fallback for codebases that avoid decorators:

```ts
import { defineEntityHandlers } from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  create(command: unknown): void {}

  onCreated(event: unknown): void {}
}

const taskHandlers = defineEntityHandlers(TaskAggregate, TaskStateSchema, ({ assign, apply }) => [
  assign(CreateTaskSchema, "create"),
  apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
]);

taskHandlers.entity.fullTypeName;
taskHandlers.handlers.map((handler) => handler.kind);
taskHandlers.commandAssignments[0]?.methodName; // "create"
taskHandlers.eventApplications[0]?.allowImport; // true
```

`defineEntityHandlers()` calls `describeEntityMetadata()` for the state schema,
checks that named methods are own prototype data methods declared with normal
class method syntax, and returns frozen metadata arrays preserving declaration
order. Accessors, `constructor`, inherited methods, and instance fields are
rejected without invoking user code. The builder exposes `assign()`,
`command()`, `subscribe()`, `react()`, and `apply()` for the five first handler
roles. `apply(..., { allowImport: true })` records importability for future
event import/replay work.

Use the standard decorators when TypeScript 5+ decorator syntax fits your
project. Every decorator requires an explicit generated Protobuf-ES schema; the
framework does not infer message types through `emitDecoratorMetadata`,
`reflect-metadata`, or parameter decorators:

```ts
import {
  Apply,
  Assign,
  HandlerMetadataRegistry,
  materializeDecoratedEntityHandlers,
} from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  @Assign(CreateTaskSchema)
  create(command: unknown): void {}

  @Apply(TaskCreatedSchema, { allowImport: true })
  onCreated(event: unknown): void {}
}

const taskHandlers = materializeDecoratedEntityHandlers(TaskAggregate, TaskStateSchema);
const registry = new HandlerMetadataRegistry([taskHandlers]);

registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"
```

`@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` record standard
per-class metadata from public instance methods only.
`materializeDecoratedEntityHandlers()` confirms the recorded handler names are
still own prototype methods and returns the same frozen `EntityHandlersMetadata`
shape as `defineEntityHandlers()`. Decorators do not instantiate the entity,
invoke methods, unpack payloads, register in a global handler registry, validate
transactions, write storage, start buses, or start transport.

Use `HandlerMetadataRegistry` when application assembly or tests need a
caller-owned lookup view over one or more `EntityHandlersMetadata` objects:

```ts
import { HandlerMetadataRegistry, defineEntityHandlers } from "@spine-ts/server";

const registry = new HandlerMetadataRegistry([taskHandlers]);

registry.findEntityHandlersByState(TaskStateSchema.typeName);
registry.findHandlersByKind("event-application");
registry.findHandlersByMessageFullTypeName(TaskCreatedSchema.typeName);
registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"
```

Registry listing and lookup methods return frozen arrays in registration and
handler declaration order. One registry permits only one command assignment for
each command message full type name and only one event application for each
entity state full type name plus event message full type name. Command
reactions, event subscriptions, and event reactions may have multiple handlers
for the same message type, preserving later fan-out behavior. The registry is
metadata-only and caller-owned: it does not instantiate entities, invoke
handlers, unpack `Any` payloads, log payloads, mutate a global registry,
implement an import bus, validate transactions, assemble repositories, write
storage, or start transport.

## Storage

Use `@spine-ts/storage` when a test or later runtime slice needs framework-owned
record stores without a repository or database adapter:

```ts
import { createInMemoryStorageAdapter, StorageVersionConflictError } from "@spine-ts/storage";

const storage = createInMemoryStorageAdapter<{ title: string }>();

const created = await storage.writeEntities.put({
  key: "Task:1",
  payload: { title: "Draft" },
  expectedVersion: "absent",
});

await storage.aggregateEvents.append({
  streamId: "Task:1",
  expectedVersion: 0,
  events: [{ id: "event-1", typeUrl: "type.spine.io/tasks.TaskCreated" }],
});

try {
  await storage.writeEntities.put({
    key: "Task:1",
    payload: { title: "Stale write" },
    expectedVersion: created.version - 1,
  });
} catch (error) {
  if (error instanceof StorageVersionConflictError) {
    console.warn(`Retry record ${error.key} at version ${error.actualVersion}.`);
  }
}
```

The storage surface keeps write-side stores (`writeEntities`,
`aggregateEvents`, `aggregateSnapshots`, and `deliveryRecords`) distinct from
the read-side projection store (`readProjections`). Command-side runtime code
must not query read-side projections inside write transactions. The in-memory
adapter binds payload types to stores, snapshots values with
`structuredClone()`, and preserves structured-clone-compatible byte payloads
such as packed `Any.value` data. It does not log payloads, and diagnostic
records should contain only safe labels, not credentials, auth headers, packed
bytes, or sensitive payload contents.

## First Commands

```shell
pnpm install
pnpm proto:verify
pnpm proto:generate
pnpm docs:check
pnpm verify
```

Generated API docs are written to `docs/api/reference` and are ignored by Git.
