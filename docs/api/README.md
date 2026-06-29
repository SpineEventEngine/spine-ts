# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts, the `@spine-ts/core` metadata/type
registry and validation facade APIs, the first `@spine-ts/server`
descriptor-derived entity metadata and explicit handler metadata APIs, and the
first `@spine-ts/storage` contracts.

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

Server exports include `describeEntityMetadata()`, `isEntitySchema()`,
`DescriptorMetadataError`, normalized entity kind/visibility types, first-field
routing hints, field metadata, and the descriptor-derived `EntityMetadata`
contract for later handler registration, transaction validation, and repository
assembly. Column metadata is exposed only for projection/process-manager
schemas, matching the underlying Spine option contract. Server handler metadata
exports include `defineEntityHandlers()`, `HandlerRegistrationBuilder`, the
five handler metadata roles for command assignment, command reaction, event
subscription, event reaction, and event application, and `HandlerMetadataError`
for registration-time structural failures. Handler names must refer to own
prototype data methods declared with normal class method syntax. The server
registry exports include `HandlerMetadataRegistry`,
`HandlerMetadataRegistryLookup`, `RegisteredHandlerMetadata`, and
`HandlerMetadataRegistryError` for caller-owned lookup-only registration and
duplicate-policy validation. These APIs are metadata-only and do not execute
handlers.

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
