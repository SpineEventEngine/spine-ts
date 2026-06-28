# Architecture Notes

Current status: early implementation notes.

Architecture documentation starts from the build protocol and specification documents under `build-protocol/`. This folder is reserved for implementation-era architecture notes that evolve with actual package boundaries and runtime behavior.

## Proto Contract Boundary

The `proto/` tree now contains the first verbatim copied Spine contract closure.
`@spine-ts/proto` compiles those contracts and exposes a curated root API with
the first-intake Protobuf-ES schemas, descriptors, message types, and custom
options. This boundary is intentionally contract-only:

- generated schemas are available for later metadata and validation tasks;
- copied source provenance is verified by `proto/spine-sources.json`;
- runtime `Any` packing/unpacking, validation facade behavior, buses, storage,
  and transport remain out of scope until later tasks.

## Core Metadata Registry

`@spine-ts/core` owns runtime lookup policy over generated schemas. The first
registry slice consumes curated exports from `@spine-ts/proto`, derives type
URLs from descriptor file options, and exposes immutable metadata by full type
name, type URL, and schema identity.

The shared `spineCoreRegistry` export is a read-only lookup view over the
curated schemas. Mutable registration stays on caller-owned `TypeRegistry`
instances, including those returned by `createSpineCoreRegistry()`, to avoid
process-wide state mutation.

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
`fieldValue` payloads, redacts every upstream placeholder value while
preserving placeholder keys, and translates upstream validator exceptions into
structured `spine.validation.ConstraintViolation` data instead of leaking raw
exception objects or messages.

State-transition validation is a separate framework-owned seam because rules
such as `(set_once)` need both previous and proposed state. The current
`validateTransition()` API only aggregates transition rule violations into the
same structured result shape; built-in entity transaction enforcement remains a
later runtime responsibility. Throwing transition rules are isolated into
structured transition-rule failures so later rules still run deterministically.
