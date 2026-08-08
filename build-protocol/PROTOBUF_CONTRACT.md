# Protobuf Contract

Navigation: [README](README.md) | Previous: [Technical Spec](TECHNICAL_SPEC.md) | Next: [Runtime Architecture](RUNTIME_ARCHITECTURE.md)

## Required Compatibility

The TypeScript framework must use Spine Protobuf definitions as the canonical contract. Required Spine `.proto` files must be copied into the TS framework repository and kept verbatim unless a deliberate compatibility decision is recorded in [DECISION_LOG.md](DECISION_LOG.md).

The copied set starts with `spine/options.proto` and includes all messages needed by:

- core command/event/context/actor/tenant/version/ack/response/enrichment messages;
- client command/query/subscription services and request messages;
- server entity, aggregate, delivery, dispatch, integration, migration, tenant, transport, and system messages;
- validation option definitions and validation error messages needed by
  `@spine-event-engine/validation`;
- common base/time/value types referenced transitively by the above.

## Buf and Protobuf-ES

Generation must use Buf and Protobuf-ES:

- Runtime package: `@bufbuild/protobuf`.
- Generator: `@bufbuild/protoc-gen-es`, invoked through Buf.
- Generated outputs must expose message schemas that can be passed to Protobuf-ES functions such as `create`, reflection helpers, and validation.
- The framework must not support hand-written TS Protobuf bindings, `protobuf.js` bindings, or `ts-proto` bindings as first-class inputs.

The selected validation runtime is `@spine-event-engine/validation`
`2.0.0-snapshot.7`.

## Domain Modeling Conventions

The TS framework preserves Spine conventions:

- Commands live in files ending with `commands.proto`.
- Events live in files ending with `events.proto`.
- Rejections/failures use the same conventions as the copied Spine proto set.
- Entity state messages declare `(entity).kind`.
- Type URL prefixes are preserved and must be deterministic.
- The first declared field remains semantically important for entity IDs and default command routing.
- Field options such as `(required)`, `(validate)`, `(goes)`, `(set_once)`, `(column)`, `(is)`, and `(every_is)` must be visible to the runtime metadata layer.

## Generated/Runtime Metadata

The framework needs a metadata layer over Protobuf-ES schemas. This layer may be generated, registered by decorators, or both. It must expose:

- full type name and type URL;
- file name and declaration order;
- custom options for files, messages, fields, oneofs, and services;
- entity kind and visibility;
- entity ID field and ID type;
- queryable columns and field paths;
- semantic interface tags from `(is)` and `(every_is)`;
- default route hints;
- validation option data;
- service descriptors for `CommandService`, `QueryService`, and `SubscriptionService`.

This is not a compiler specification. It is a runtime contract. The implementation phase must investigate whether Protobuf-ES descriptors alone are sufficient or whether an additional custom generation step is required.

## Type URL and Any Registry

The framework must provide a registry that maps:

- fully qualified Protobuf type name to schema;
- type URL to schema;
- schema to type URL;
- semantic tags to schemas.

All command, event, query, subscription, enrichment, validation, and storage paths must use the registry rather than ad hoc string parsing.

## Validation Contract

`@spine-event-engine/validation` `2.0.0-snapshot.7` is mandatory for validation
of single Protobuf messages.

Observed constraints of the validation runtime:

- It is designed for Buf/Protobuf-ES generated TypeScript.
- It supports major Spine validation options such as `(required)`, `(pattern)`, `(min)`, `(max)`, `(range)`, `(distinct)`, `(validate)`, `(goes)`, message-level required combinations, and oneof choice.
- It currently does not support `(set_once)` because that option needs state-transition history, not just one message.

Therefore:

- command, event, state, query, and subscription message validation uses
  `@spine-event-engine/validation`;
- entity state transitions enforce `(set_once)` in the framework transaction layer;
- validation results are structured data, not only thrown exceptions;
- server-side command acknowledgement and client-side errors must preserve packed validation details where Spine messages support them.

## Copying Spine Proto Files

The implementation repository must contain a copied `proto/spine/...` tree or equivalent package-internal path. The copy must be mechanically reproducible from pinned Spine repositories. Any local edits are forbidden unless recorded as compatibility exceptions.

The implementation phase must add a script that:

- records source repo and commit for every copied proto file;
- verifies copied files match upstream;
- runs Buf lint and generation;
- fails CI if copied proto files drift silently.
