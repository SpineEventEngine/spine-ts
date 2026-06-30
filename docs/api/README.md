# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts, the `@spine-ts/core` metadata/type
registry and validation facade APIs, the first `@spine-ts/server`
descriptor-derived entity metadata, set-once transition validation, and
explicit handler metadata APIs, and the first `@spine-ts/storage` contracts.

Proto exports include message types, generated schemas, enum values and enum
descriptors, file descriptors, and the `type_url_prefix` custom option for the
validation, core signal envelope, actor/tenant/user/version context, time, net,
and UI language contracts.

Core exports include deterministic type URL derivation, registry and metadata
types, the default registry for the curated Spine schema set, single-message
validation result/check helpers, `ValidationException`, structured
`ValidationError` creation, and the initial transition-validation seam. Core
envelope construction exports include `packAny()`, `unpackAny()`,
`packCommand()`, `packEvent()`, `PackAnyOptions`, `PackCommandInput`, and
`PackEventInput`.

Server exports include the abstract `Entity` shell, `TransactionalEntity`,
`Aggregate`, `Projection`, `ProcessManager`, `EntityFamily`,
`TransactionalEntityScopeError`, `TransactionalEntityScopeErrorReason`,
`TransactionalEntityScopeOperation`, `EntityOptions`, `EntityVersionMetadata`,
`PlainEntityVersionMetadata`, and `EntityLifecycleFlags` for local OOP entity
state with identity, descriptor-derived metadata, cloned Protobuf-ES state
snapshots, caller-owned plain version metadata, lifecycle flags, and
active/archive/delete accessors.
`PlainEntityVersionMetadata<T>` is the compile-time plain-shape helper used by
entity inputs so ordinary metadata interfaces can be accepted while non-plain
types such as `Date` are rejected. The shell has protected hooks for future
framework-owned subclasses, but no public state setters, Java builders,
transaction execution, repository/storage writes, handler invocation, dispatch,
lifecycle events, automatic version increments, routing, query APIs, buses,
transports, or global runtime state.
`TransactionalEntity` adds only protected, scoped draft helpers over
`EntityTransaction`: one active transaction can read/update draft state, replace
draft version metadata, update draft lifecycle flags, commit accepted results
back into the entity, or roll back without applying state. Accepted commits
close the scope and update state/version/lifecycle; rejected commits keep the
scope active for correction or explicit rollback and apply nothing. The
`changed` signal reports accepted state changes or committed lifecycle flag
changes, not repository storage policy.
`Aggregate`, `Projection`, and `ProcessManager` are thin abstract family marker
classes over `TransactionalEntity` with the same `<Id, Schema, Version>` generic
shape and a stable readonly `entityFamily` property typed by `EntityFamily`.
They do not add public transaction mutators, repositories, dispatch, aggregate
event history, snapshots, subscriptions, command posting, query clients,
process workflow execution, handler invocation, storage, buses, or lifecycle
events.
Server metadata exports
include `describeEntityMetadata()`, `isEntitySchema()`,
`DescriptorMetadataError`, normalized entity kind/visibility types, first-field
routing hints, field metadata, and the descriptor-derived `EntityMetadata`
contract for handler registration, transaction validation, and later repository
assembly. Column metadata is exposed only for projection/process-manager
schemas, matching the underlying Spine option contract. Server transition
validation exports include `validateEntityStateTransition()`,
`EntityStateTransitionValidationRequest`, and
`EntityStateTransitionValidationResult` for built-in `(set_once)` checks derived
from descriptor metadata and shaped through the core transition validation
facade. Repeated, map-valued, and explicit optional `(set_once)` fields are
unsupported in this slice and fail closed with field-specific validation
violations. The transaction kernel exports `EntityTransaction`,
`createEntityTransaction()`, typed draft/commit/rollback result contracts,
version metadata contracts, lifecycle flags, status/updater/helper operation
types, `EntityTransactionStateError`, and
`EntityTransactionDraftStateError`. This public surface is an in-memory,
framework-owned draft/result boundary over one entity state. It is intentionally
not a storage-backed transaction API, repository unit of work, async-local
transaction context, dispatch phase, or lifecycle-event emitter. Lifecycle
helpers mutate only buffered draft flags, `updateVersionMetadata()` replaces
only caller-owned draft version metadata, and `requireActive()` rejects closed
transactions or active drafts already marked archived/deleted without including
state payloads. `commit()` validates the buffered draft and closes the
transaction only for accepted commits; rejected commits return violations and
leave the transaction active. `rollback()` closes the transaction and returns
the discarded draft evidence.
Server handler metadata exports include
`defineEntityHandlers()`, `HandlerRegistrationBuilder`, the five handler
metadata roles for command assignment, command reaction, event subscription,
event reaction, and event application, and `HandlerMetadataError` for
registration-time structural failures. Handler names must refer to own prototype
data methods declared with normal class method syntax. Decorator adapter exports
include `@Assign`, `@Command`, `@Subscribe`, `@React`, `@Apply`,
`materializeDecoratedEntityHandlers()`, `HandlerMethodDecorator`, and
`HandlerMethodValue`. Decorators require explicit Protobuf-ES schema arguments
and record standard per-class metadata that materializes into the same
`EntityHandlersMetadata` contract as explicit registration. The server registry
exports include `HandlerMetadataRegistry`,
`HandlerMetadataRegistryLookup`, `RegisteredHandlerMetadata`, and
`HandlerMetadataRegistryError` for caller-owned lookup-only registration and
duplicate-policy validation. These APIs are metadata-only and do not execute
handlers, access storage, dispatch buses, or start transport.

Storage exports include `StorageAdapter`, `StorageRecord`,
`WriteSideRecordStore`, `ReadSideRecordStore`, aggregate event history
contracts, tenant/diagnostic stores, `StorageVersionConflictError`,
`StoragePayloadCloneError`, `InMemoryStorageAdapter`, and
`createInMemoryStorageAdapter()`. These APIs document optimistic version
checks, safe structured-clone failure reporting, write-side/read-side
segregation, deterministic in-memory behavior, and non-durability.

The generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON, verifies that expected
`@spine-ts/proto`, `@spine-ts/core`, `@spine-ts/server`, and
`@spine-ts/storage` entry-point exports are present in the API model, and
rejects broad generated wildcard re-exports from the proto package root.
