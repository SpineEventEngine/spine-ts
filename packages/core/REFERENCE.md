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
`StringifierRegistry`, the `Stringifier` contract, `Time`, and their exported input,
result, and metadata types.

## Time

Import `Time` from `@spine-event-engine/core/time` or the core root. Both entry
points expose the same object and configured provider. The dedicated entry
point needs no generated Spine model modules and works in browsers and Node.
All operations are synchronous.

| Operation                  | Result and purpose                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Time.currentTime()`       | Configured provider's Protobuf `Timestamp`, including seconds and nanoseconds.                              |
| `Time.systemTime()`        | System provider's timestamp, bypassing provider replacement.                                                |
| `Time.currentTimeZone()`   | Configured provider's IANA zone identifier, or the runtime's zone when the provider omits it.               |
| `Time.currentTimeMillis()` | Configured current time as integer epoch milliseconds; discards submillisecond precision.                   |
| `Time.monotonicTime()`     | Elapsed milliseconds from an arbitrary local origin; the system provider uses the platform monotonic clock. |

Use complete timestamps for occurrence order and storage boundaries. Use epoch
milliseconds for APIs that require that representation, and monotonic readings
for elapsed durations. Timer scheduling still uses ordinary platform timers.

The system provider follows Spine JVM `IncrementalNanos`: its first reading of
a millisecond has no added offset; further readings add 1,000 nanoseconds each,
through 999,000 nanoseconds. The next reading in that same millisecond wraps to
zero. A changed millisecond resets the offset, including when the system clock
moves backward. `currentTime()` with the system provider and `systemTime()`
share that sequence.

This behavior is local to one loaded Time module. It does not establish unique
or increasing timestamps across separate workers, processes, duplicate package
installations, restarts or backward clock adjustments. Preserve the supplied
timestamp when copying a message instead of reading Time again.

### Controlled time in tests

The `TimeProvider` contract requires `currentTime(): Timestamp`. It can also
supply `currentZone(): string` and `monotonicTime(): number`; omitted operations
use the system provider. Provider controls are internal test support.

`Time.setProvider(provider)` returns the previous provider. Restore it in
`finally`; `Time.resetProvider()` restores the system provider. Replacement
affects every consumer of that module instance, so tests that share the
instance must not replace its provider concurrently. Separate workers have
separate module state. Install the provider before starting work, and await all
work that uses it before replacing or restoring it. Monotonic readings from
different providers may use different origins and must not be compared.
Use existing per-consumer clock inputs when independent consumers need different
clocks within one runtime.

```ts
import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Time, type TimeProvider } from "@spine-event-engine/core/time";

const provider: TimeProvider = {
  /**
   * Returns the instant used by this test.
   * @returns A timestamp with the test's seconds and nanoseconds.
   */
  currentTime(): Timestamp {
    return create(TimestampSchema, { seconds: 1_800_000_000n, nanos: 123_456_000 });
  },
};
const previous = Time.setProvider(provider);
try {
  const occurredAt = Time.currentTime();
  console.log(occurredAt.nanos); // 123456000
} finally {
  Time.setProvider(previous);
}
```

Freezing `currentTime()` does not freeze the default monotonic clock. Supply
`monotonicTime()` as well when a duration test needs controlled readings.

Descriptor-backed `EntityColumn` and `EntityQuery` behavior is canonical in
core. The generated `GeneratedEntityColumns` helper is intentionally excluded
from the root: generated model code imports it from
`@spine-event-engine/core/codegen`. `@spine-event-engine/client-node` retains
its compatibility exports and its `/codegen` forwarding entry point.

Normal Proto generation emits `_query.ts` companions for eligible Entity states, including nested
states. Their exported `StateQuery.create()` methods expose marked columns and the `version`,
`archived`, and `deleted` system columns. `build()` returns an independent query description with
no actor or tenant context; it can be reused by a Process Manager, browser client, or subscription.
Successive comparisons form a conjunction, and `either(...)` combines synchronous condition-only
callback branches as a disjunction. Apply IDs, ordering, limits, and build to the outer query.
Generated field methods that conflict with `build`, `either`, `byId`, `orderBy`,
`limit`, `create`, `constructor`, or JavaScript object methods receive a `Column` suffix; a
numeric suffix resolves a further collision. Nested query exports join message names with `_`.
The first declared state field supplies the ID type even when its name is not `id`.

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

`SignalEnvelopes.command()` and `.event()` generate fresh secure UUID v4 IDs,
clone caller-supplied contexts, and pack the supplied domain message. They use
`crypto.randomUUID()` when available, otherwise secure `crypto.getRandomValues()`;
they fail when neither secure API exists. They do not create timestamps, actor
context, tenant context, storage records, or routing data. Existing envelope
transport and storage continue to retain their supplied IDs without validating
that those existing values have UUID format.

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
