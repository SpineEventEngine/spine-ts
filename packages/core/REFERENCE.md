# @spine-event-engine/core reference

This reference is for agents integrating the public core package.

## Message interfaces

`MessageInterfaces.define()` creates the nominal runtime token corresponding to
a structural TypeScript interface and its member schemas. A route accepts that token
as well as an exact schema. Tokens are checked at declaration time; matching is
ordered after exact schemas and before replacement/default routing. They are not
transport semantic tags.

## Public entry point

Import from `@spine-event-engine/core`. The package exports `Validate`,
`ValidationException`, `RejectionThrowable`, `AnyMessages`, `SignalEnvelopes`,
`TypeUrls`, `TypeRegistry`, `spineCoreRegistry`, `Identifiers`, `Stringifiers`,
`StringifierRegistry`, the `Stringifier` contract, and their exported input,
result, and metadata types.

## Subscription lifecycle SPI

Framework integrations that coordinate subscription activation import
`SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS` from
`@spine-event-engine/core/spi/subscription-lifecycle`. This is not an
application subscription API and is not exported from the core root.

## Storage value helpers

`Identifiers` packs and unpacks the generated-message and supported primitive
identifier kinds used by storage contracts. `Stringifiers.forMessage()` maps a
generated message reversibly to compact Proto JSON by default.
`StringifierRegistry` lets an application register another reversible mapping
for a particular message schema. Providers snapshot the registry they accept;
use the same mapping for stored IDs or columns and their query operands.
Call `setTypeRegistry(applicationTypes)` before provider construction when
default Proto JSON may encounter `Any`. The generated type registry supplies
the descriptor needed to expand and restore the packed application message;
without it, an `Any` cannot be converted to interoperable Proto JSON.

## Validation

`Validate.message(schema, message)` returns a `MessageValidationResult` whose
`valid` discriminator controls access to either an empty violation list or a
non-empty list and a `ValidationError`. It sanitizes validation details and
turns a validation-runtime failure into a structured invalid result.

`Validate.check(schema, message)` returns the supplied message when valid and
throws `ValidationException` otherwise. `ValidationException.asMessage()`
returns the structured validation message. `Validate.transition(request,
rules)` applies only the supplied state-transition rules; it does not perform
single-message validation. A throwing transition rule contributes a sanitized
violation and does not stop later rules.

## Rejections

`RejectionThrowable.create(schema, input)` is the public factory used by the
generated rejection companion. It validates the input and snapshots it.
`schema`, `messageData`, and `messageThrown()` expose the schema or defensive
message clones. Rejection throwables are ordinary `Error` values; they do not
route, persist, or publish themselves.

## Any and envelopes

`TypeUrls.derive(schema)` uses the file's `type_url_prefix` option, or
`type.googleapis.com` when no prefix is present. A fallback prefix must be
non-empty and whitespace-free. `AnyMessages.pack()` validates unless
`validate: false` is given, serializes without unknown fields, and returns a
Spine-aware `Any`. `unpack()` and `unpackUsing()` return `undefined` for an
unknown/mismatched URL or malformed bytes.

`SignalEnvelopes.command()` and `.event()` clone caller-supplied IDs and
contexts and pack the supplied domain message. They do not create IDs,
timestamps, actor context, tenant context, storage records, or routing data.

## Registry

`TypeRegistry` maintains registrations by full Protobuf name, type URL, and
schema identity. Duplicate full names, URLs, or conflicting schema identities
throw during `register()`. `getBy*()` throws for a missing registration;
`findBy*()` returns `undefined`; `list()` preserves registration order.
`TypeRegistry.from(...modules)` composes `ProtoModule` dependencies in
dependency order. `spineCoreRegistry` is lookup-only; callers needing a mutable
copy use `TypeRegistry.spineCore()`. Copied Proto `(is)` and `(every_is)` options
are wire metadata, not TypeRegistry data or repository-routing/runtime-topic
input.

## Boundaries

This package has no buses, repository lifecycle, storage implementation,
handlers, decorators, transport, or authentication policy. Those belong to
other Spine TS packages.
