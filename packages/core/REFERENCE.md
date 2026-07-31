# @spine-event-engine/core reference

This reference is for agents integrating the public core package.

## Public entry point

Import from `@spine-event-engine/core`. The package exports `Validate`,
`ValidationException`, `RejectionThrowable`, `AnyMessages`, `SignalEnvelopes`,
`TypeUrls`, `TypeRegistry`, `spineCoreRegistry`, and their exported input,
result, and metadata types.

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

`TypeRegistry` maintains registrations by full Protobuf name, type URL, schema
identity, and optional semantic tag. Duplicate full names, URLs, or conflicting
schema identities throw during `register()`. `getBy*()` throws for a missing
registration; `findBy*()` returns `undefined`; `list()` preserves registration
order. `TypeRegistry.from(...modules)` composes `ProtoModule` dependencies in
dependency order. `spineCoreRegistry` is lookup-only; callers needing a mutable
copy use `TypeRegistry.spineCore()`.

## Boundaries

This package has no buses, repository lifecycle, storage implementation,
handlers, decorators, transport, or authentication policy. Those belong to
other Spine TS packages.
