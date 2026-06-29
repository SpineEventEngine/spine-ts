# Architecture Notes

Current status: early implementation notes.

Architecture documentation starts from the build protocol and specification documents under `build-protocol/`. This folder is reserved for implementation-era architecture notes that evolve with actual package boundaries and runtime behavior.

## Proto Contract Boundary

The `proto/` tree now contains the first verbatim copied Spine contract
closures. `@spine-ts/proto` compiles those contracts and exposes a curated root
API with Protobuf-ES schemas, descriptors, message types, enum descriptors, enum
values, and custom options. This boundary is intentionally contract-only:

- generated schemas are available for later metadata and validation tasks;
- copied source provenance is verified by `proto/spine-sources.json`;
- canonical `Command`, `Event`, `ActorContext`, `TenantId`, `UserId`,
  `Version`, diagnostics, enrichment, and transitive time/net/UI support
  contracts are available without hand-written TypeScript shapes; and
- buses, transport, entity runtime behavior, and runtime metadata generation
  remain out of scope until later tasks.

## Core Metadata Registry

`@spine-ts/core` owns runtime lookup policy over generated schemas. The first
registry slice consumes curated exports from `@spine-ts/proto`, derives type
URLs from descriptor file options, and exposes immutable metadata by full type
name, type URL, and schema identity.

The shared `spineCoreRegistry` export is a read-only lookup view over the
curated schemas, including the core signal envelope/context closure. Mutable
registration stays on caller-owned `TypeRegistry` instances, including those
returned by `createSpineCoreRegistry()`, to avoid process-wide state mutation.

The registry fails fast on duplicate full names, duplicate type URLs, and
conflicting descriptor identities. This intentionally differs from the JVM
`TypeDictionary.Builder` overwrite behavior because silent replacement would
corrupt later routing and validation decisions.

Descriptor-backed metadata currently includes:

- full Protobuf type name and canonical type URL;
- generated schema/message descriptor;
- declaring file descriptor and file name;
- first declared field, preserving descriptor declaration order; and
- file option helpers for later validation/runtime tasks.

Semantic tag lookup is available as an API shape, but no tags are registered in
this slice. The current copied proto set defines the Spine `(is)` and
`(every_is)` options but does not include registered message consumers that make
tag extraction provable.

## Core Validation Facade

`@spine-ts/core` owns the validation interface exposed to framework users.
Single-message validation is delegated to
`@spine-event-engine/validation-ts@2.0.0-snapshot.4`, pinned by D-0029, but
callers use `validateMessage()` and `checkValid()` from core. This keeps the
experimental upstream API and generated upstream validation error types behind a
framework seam.

The facade converts upstream violations into repo-local
`spine.validation.ConstraintViolation` messages and builds
`spine.validation.ValidationError` data through `createValidationError()`.
`ValidationException.asMessage()` returns that structured message data for
throwing validation paths. The public contract is the repo-local
`spine.validation.*` namespace.

Validation details are safe by default. The adapter omits raw invalid
`fieldValue` payloads, redacts every upstream or transition-rule placeholder
value while preserving placeholder keys, and translates upstream validator
exceptions into structured `spine.validation.ConstraintViolation` data instead
of leaking raw exception objects or messages.

State-transition validation is a separate framework-owned seam because rules
such as `(set_once)` need both previous and proposed state. The current
`validateTransition()` API only aggregates transition rule violations into the
same structured result shape; built-in entity transaction enforcement remains a
later runtime responsibility. Rule-returned violations are sanitized before
aggregation, and throwing transition rules are isolated into structured
transition-rule failures so later rules still run deterministically.

## Core Envelope Construction

`@spine-ts/core` owns the Spine-aware `Any` packing seam. `packAny()` derives
the canonical type URL with `deriveTypeUrl(schema)` and serializes the payload
with Protobuf-ES `toBinary()`. The implementation intentionally does not call
Buf `anyPack()` directly for Spine domain payloads because that helper emits the
standard `type.googleapis.com/...` prefix rather than the Spine
`type.spine.io/...` prefix required for routing.

Framework-packed payloads pass `writeUnknownFields: false` to the Protobuf-ES
binary writer. This gives the helper stable behavior for messages that carry
retained unknown fields. Protobuf-ES 2.12.1 does not expose deterministic
map-key ordering, so T-0007b does not claim fully canonical map ordering and
leaves any broader canonical serialization policy to a later task.

`unpackAny()` performs exact type URL matching against the requested schema
before binary decoding and returns `undefined` on decode failure, keeping type
URL comparison and malformed payload handling inside the core module interface.
Callers should not parse or concatenate type URL strings in their own code.

`packCommand()` and `packEvent()` construct generated `spine.core.Command` and
`spine.core.Event` messages from caller-supplied generated IDs, generated
contexts, schemas, and already-built domain messages. They validate the enclosed
domain message through the core validation facade by default, then pack it as
Spine-aware `Any`. Supplied IDs and contexts are cloned before embedding so
later caller-side mutation does not mutate returned envelopes.

The helpers deliberately do not own runtime policy. They do not generate UUIDs,
timestamps, actor or tenant context, event producer IDs, entity versions,
origins, command system properties, storage records, acknowledgements, delivery
state, bus dispatch, handler registration, or transport metadata. Those
responsibilities remain with later runtime slices.

## Server Entity Metadata

`@spine-ts/server` now owns the first descriptor-derived entity metadata layer,
following D-0034, and the first explicit handler metadata layer, following
D-0035. The package consumes only curated option exports from `@spine-ts/proto`
and keeps generic schema/type-URL lookup in `@spine-ts/core`.

Current server metadata is pure and deterministic:

- `(entity).kind` is normalized to server-facing entity kinds;
- `(entity).visibility` preserves explicit values and applies Spine defaults
  (`full` for projections, `none` for aggregates/process managers/generic
  entities);
- the first declared field becomes both the canonical entity ID field and the
  first-field routing hint for later handler/repository tasks;
- fields marked `(column) = true` are surfaced in descriptor order only for
  projections and process managers, `(set_once) = true` fields are surfaced for
  every entity kind, and
- semantic tags from message `(is)` and file `(every_is)` options are
  preserved in deterministic sorted order.

The entity extractor throws typed `DescriptorMetadataError` failures for non-entity
schemas, unknown entity kinds, repeated/map column declarations, empty semantic
tag values, and other unsupported combinations in this slice. Aggregate and
generic entity column declarations are ignored to match the source option
contract.

`defineEntityHandlers()` is the explicit metadata target that later decorators
must produce. It accepts an entity class, a state schema, and a builder callback
whose methods record command assignment, command reaction, event subscription,
event reaction, and event application metadata. Each handler record keeps the
generated Protobuf-ES schema, message full type name, handler kind, and entity
method name. Event application metadata also records `allowImport` for future
import/replay machinery.

Handler metadata is deterministic and frozen. The all-handlers array preserves
the user declaration order, and role-specific arrays preserve the same relative
order after filtering. Registration validates only that explicitly named
handlers are own prototype data methods declared with normal class method
syntax; accessors, `constructor`, inherited methods, and instance fields are
rejected without invoking user code. Duplicate-handler rules and lookup
registries belong to the follow-up registry/validation slice. The handler
metadata layer does not execute routes, invoke handlers, validate transactions,
enforce `(set_once)`, assemble repositories, mutate storage, register buses, or
start transport.

## Storage Boundary

`@spine-ts/storage` now owns the first framework storage seam. The package
exports asynchronous, record-oriented contracts and an in-memory adapter, but it
does not implement repositories, transactions, buses, delivery workers, service
APIs, ZeroMQ transport, or production database adapters.

The adapter surface is deliberately split by runtime role:

- write-side stores: `writeEntities`, `aggregateEvents`,
  `aggregateSnapshots`, and `deliveryRecords`;
- read-side stores: `readProjections`;
- shared framework support stores: `tenantIndex` and `diagnostics`.

Entity, snapshot, projection, and delivery stores use versioned records with
optimistic `expectedVersion` checks. Their payload type is bound to the store
interface rather than to each read call, so package-level storage defaults to
`unknown` while caller-owned seams can declare a typed store. Aggregate event
histories append ordered stream records with expected stream versions and
adapter-local global positions. Empty appends validate the expected stream
version but do not retain an empty stream. These metadata fields provide the
future repository seam without introducing repository classes in this slice.

`InMemoryStorageAdapter` is a test/development adapter. Each instance is
isolated, keeps deterministic counters, snapshots values on write/read with
Node's `structuredClone()`, and advertises `durability.durable === false`.
Payloads stored in this adapter must be structured-clone compatible, which
preserves byte arrays used by packed Protobuf `Any` payloads. Diagnostics are
intended for safe framework metadata only; storage errors and diagnostics must
not include credentials, auth headers, packed bytes, or sensitive payload
contents.
