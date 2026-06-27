# Spine Event Engine support runtime facilities for TypeScript/Node

Navigation: [README](README.md) | Previous: [Client APIs, queries, subscriptions, and tests](spine-client-api-queries-subscriptions-and-tests.md) | End of reading order | Related: [Domain model and signals](spine-domain-model-and-signals.md), [Entities, repositories, and state](spine-entities-repositories-and-state.md)

This document specifies supporting runtime facilities in Spine 2.0.0-series source material that a TypeScript/Node implementation should preserve. It focuses on server-consumed validation behavior, storage abstractions, environment selection, time, logging, diagnostics, tracing, and versioned support repos. It intentionally does not document Gradle plugins or compiler internals beyond the generated/runtime boundary.

Primary source baseline:

- `core-jvm`: `2.0.0-SNAPSHOT.381`, from `/private/tmp/spine-research/core-jvm/version.gradle.kts`.
- Support repos: `base`, `time`, `validation`, `logging`, `change`, and `reflect`, each from its local `version.gradle.kts`.

## Generated and runtime boundary

Spine validation is a generated-code feature with a runtime facade. Model options are declared in Protobuf descriptors, generators inject validation behavior into generated messages/builders, and server apps consume validation through the runtime API rather than re-implementing every option in server code.

Relevant sources:

- Protobuf options: `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`.
- Time-specific option: `/private/tmp/spine-research/time/time/src/main/proto/spine/time_options.proto`.
- Runtime validation facade: `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/Validate.java`.
- Validatable generated-message interface: `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/ValidatableMessage.java`.
- Generated builder contract: `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/ValidatingBuilder.java`.
- External/custom validator SPI: `/private/tmp/spine-research/validation/jvm-runtime/src/main/kotlin/io/spine/validation/MessageValidator.kt`.

TypeScript implication: keep the same split. The TS runtime should expose stable validation APIs (`violationsOf`, `check`, `ValidationException`, validator registry), while generated TS code for Protobuf models should implement the option checks and call into that runtime. Server packages should depend on the runtime facade and generated message capabilities, not on compiler implementation details.

See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for the full generated artifact boundary, including descriptor options, validation facade, `Any` registry, and `(set_once)` enforcement.

## Validation runtime

The central runtime API is `Validate`:

- `Validate.check(message)` returns the same message if valid and throws `ValidationException` when violations exist.
- `Validate.violationsOf(message)` returns `List<ConstraintViolation>` and never throws for ordinary validation failure.
- If the message is `google.protobuf.Any`, the runtime attempts to unpack it using `KnownTypes`. If the type URL is unknown, the JVM prints a warning and returns no violations.
- If the unpacked message implements `ValidatableMessage`, `validate()` is invoked and its `ValidationError.constraint_violation` list is returned.
- Otherwise, the message is validated through `ValidatorRegistry.validate(message)`.

Sources:

- `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/Validate.java`.
- `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/ValidationException.java`.
- `/private/tmp/spine-research/validation/jvm-runtime/src/main/proto/spine/validation/validation_error.proto`.

Runtime error shape:

- `ValidationError` contains repeated `ConstraintViolation`.
- `ConstraintViolation` carries a `TemplateString message`, `type_name`, `base.FieldPath field_path`, and `google.protobuf.Any field_value`.
- Deprecated fields `msg_format`, `param`, and nested `violation` remain in the proto for compatibility but should not drive new TS APIs.
- `ValidationException.asMessage()` returns a `ValidationError` containing all violations.

Sources:

- `/private/tmp/spine-research/validation/jvm-runtime/src/main/proto/spine/validation/validation_error.proto`.
- `/private/tmp/spine-research/validation/jvm-runtime/src/main/java/io/spine/validation/ValidationException.java`.

TypeScript implication: represent constraint failures as data, not just thrown errors. Preserve templated message data, field path, root validated type, and packed field value. Unknown `Any` payloads need a descriptor/type registry decision; source behavior treats them as valid for lack of type knowledge.

## Built-in validation semantics

The following options are runtime-visible because generated validators enforce them and server code packages their failures into command/event/query/entity errors.

Field options in `spine/options.proto`:

- `(required)`: field presence/content constraint. For messages, reject the default instance; for enums, reject numeric zero; for strings/bytes, reject empty values; for repeated/map, require at least one element and apply per-element missing checks to string, bytes, message, and enum values. Map keys are not checked for requiredness.
- `(if_missing).error_msg`: custom message for `(required)` failures.
- `(validate)`: deep validation for singular message fields, repeated message fields, map values of message type, and `Any` when unpackable. Singular default message instances are considered valid unless also marked `(required)`. Repeated/map default message instances are validated and can fail.
- `(min)`, `(max)`, `(range)`: numeric constraints on singular and repeated numeric fields. Bound values are strings so they can encode integer, floating point, exponent, or field-reference bounds; compile-time validation checks syntax/type limits, while generated runtime checks actual values.
- `(pattern)`: Java regex baseline for string fields, including repeated strings. Modifiers include dot-all, case-insensitive, multiline, unicode, and partial-match behavior.
- `(goes).with`: if the target field is present, the companion field must be present. Supported types mirror `(required)` presence semantics.
- `(set_once)`: generated builder/merge logic prevents reassignment when the current field value is non-default and differs from the proposed value. It applies only to singular non-optional fields; repeated/map/explicit optional are unsupported at build time.
- `(distinct)`: repeated values or map values must be unique by full equality.
- `(if_set_again)` and `(if_has_duplicates)`: custom messages for `(set_once)` and `(distinct)`.

Oneof/message options:

- `(choice).required`: a oneof group must have a selected case.
- `(require).fields`: at least one declared field group must be set. Groups use `&` for conjunction and `|` for alternatives; oneof group names may participate.

Time option:

- `(when).in = PAST | FUTURE`: applies to `google.protobuf.Timestamp`, Spine time messages, and repeated/map fields of those types.

Sources:

- `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`.
- `/private/tmp/spine-research/time/time/src/main/proto/spine/time_options.proto`.
- `/private/tmp/spine-research/time/README.md`.

TypeScript implication: use descriptor-level option metadata in generated code. Match proto3 default-value semantics carefully, especially for singular message fields under `(validate)`, collections under `(required)`, and `Any` unpacking. JS regex semantics differ from Java regex; TS either needs a documented compatibility subset or a validator that emulates Java behavior for options generated from JVM-era models.

## Custom and external validators

`MessageValidator<M>` supports additional validation rules for both local and external messages.

Runtime behavior:

- Validators return `DetectedViolation` objects; an empty list means valid.
- Multiple validators per message type are allowed. Application order is not guaranteed.
- `ValidatorRegistry` stores validators by message class, loads implementations via `ServiceLoader`, and exposes `add`, `remove`, `clear`, `get`, and `validate`.
- `ValidatorRegistry.validate(message, parentPath, parentName)` converts each `DetectedViolation` to `ConstraintViolation`, appending nested field paths and injecting the validator class name into the `${validator}` placeholder.
- External message validators are applied when external messages appear as fields of local generated messages. Standalone external messages and external messages nested inside other external messages are not automatically validated by generated local code.

Sources:

- `/private/tmp/spine-research/validation/jvm-runtime/src/main/kotlin/io/spine/validation/MessageValidator.kt`.
- `/private/tmp/spine-research/validation/jvm-runtime/src/main/kotlin/io/spine/validation/ValidatorRegistry.kt`.
- `/private/tmp/spine-research/validation/jvm-runtime/src/main/kotlin/io/spine/validation/DetectedViolation.kt`.

TypeScript implication: replace `ServiceLoader` with an explicit registry and optional package-level auto-registration convention. Because Node module loading is less deterministic than JVM service loading, avoid relying on validator ordering. Preserve parent path/name propagation so nested validation reports root-message paths like the JVM runtime.

## Server consumption of validation

Server code consumes validation at boundaries and wraps violations into domain-specific errors.

Commands:

- `CommandValidator.validate()` first checks tenant applicability against the bus mode.
- `CommandValidator.inspect()` validates command ID, command message, and command context.
- Command ID must pass `Validate.violationsOf(id)` and have a non-empty UUID.
- Command message must be non-default and pass `Validate.violationsOf(message)`.
- Command context must be non-default.
- Violations become `InvalidCommandException.onConstraintViolations(...)`.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandValidator.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/InvalidCommandException.java`.

Events:

- `EventValidator` validates `EventEnvelope.outerObject()` via `Validate.violationsOf`.
- Violations become `InvalidEventException.onConstraintViolations(...)`.
- `EventFactoryBase.assemble()` calls `message.checkValid()` before packing the event.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventValidator.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/kotlin/io/spine/server/event/EventFactoryBase.kt`.

Entity state:

- `AbstractEntity.updateState()` validates the new state before replacing it.
- `checkEntityState()` delegates to `Validate.violationsOf(newState)`.
- Violations throw `InvalidEntityStateException`, whose details include `ValidationError`.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`.

Queries, topics, and subscriptions:

- `RequestValidator.validate()` performs message validation through `Validate.violationsOf`, then support checks, then validator-specific rules.
- Validation errors are packed into `base.Error.details` as `ValidationError`.

Source:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/stand/RequestValidator.java`.

TypeScript implication: implement one server-side validation facade and use it consistently in command bus, event factory/bus, entity state updates, and read-side request validation. Preserve domain error envelopes and packed `ValidationError` details so clients can handle violations uniformly.

## Storage abstraction

`StorageFactory` is the storage SPI. Applications store serialized Protobuf messages as records. Higher-level storages are thin delegates over `RecordStorage`.

Core contract:

- `StorageFactory.createRecordStorage(ContextSpec, RecordSpec<I, R>)` is the one method an adapter must implement.
- Default methods build higher-level storage types over record storage: aggregate state, aggregate event records, event store, entity record storage, inbox storage, catch-up storage, and mirror migration storage.
- Context-scoped storages receive `ContextSpec` so implementations can separate bounded contexts and multitenancy. `InboxStorage` and `CatchUpStorage` are environment-wide delivery storages, not per bounded context. Tenant storage is also shared through a special tenants context.
- `StorageFactory` extends server `Closeable`.

Source:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/StorageFactory.java`.

`RecordSpec` describes how a Protobuf record is stored:

- `idType`: identifier type.
- `recordType`: stored message type.
- `sourceType`: original source type, usually same as `recordType`; for `EntityRecord`, it is the entity state type.
- `extractId`: function that extracts ID from a record.
- `columns`: queryable stored columns calculated from the record.
- `valuesIn(record)` returns column values keyed by `ColumnName`.

Source:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/RecordSpec.java`.

`RecordStorage` behavior:

- Records are identified Protobuf messages with optional stored columns.
- Protected write/read/delete methods check that the storage is open.
- Query operations are based on `RecordQuery<I, R>` and support ID filters, column filters, field masks, sorting, and limits depending on implementation.
- `queryBuilder()` creates `RecordQuery.newBuilder(recordSpec.idType(), recordSpec.recordType())`.
- Implementations must provide `index(query)`, `writeRecord`, `writeAllRecords`, `readAllRecords`, and `deleteRecord`.

Source:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/RecordStorage.java`.

TypeScript implication: make record storage the only mandatory database adapter interface. Build event store, entity storage, aggregate storage, delivery inbox/catch-up storage, and tenant storage on top of it. Keep record specs declarative so adapters can map columns to SQL, document DB indexes, or in-memory predicates.

## In-memory storage

`InMemoryStorageFactory` creates `InMemoryRecordStorage` and tracks a closed flag.

`InMemoryRecordStorage`:

- Wraps `MultitenantStorage<TenantRecords<I, R>>`.
- Stores records per current tenant slice when the `ContextSpec` is multitenant.
- Writes `RecordWithColumns` by ID.
- Reads and indexes via `TenantRecords`.

`TenantRecords`:

- Stores a synchronized map of `id -> RecordWithColumns`.
- Filters via `RecordQueryMatcher`.
- Applies sorting and positive limits.
- Applies `FieldMask` through `FieldMaskApplier`.
- Deletes return `false` if the ID was absent.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/InMemoryStorageFactory.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/InMemoryRecordStorage.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/MultitenantStorage.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/TenantRecords.java`.

TypeScript implication: in-memory storage should be a full contract implementation, not a test stub. It should support tenant slices, record columns, query filtering, sorting, limits, masks, and close-state checks. For Node, use `AsyncLocalStorage` or equivalent current-tenant context if multitenant operations can cross async boundaries.

## System-aware storage

`SystemAwareStorageFactory` wraps another `StorageFactory`.

Behavior:

- `ServerEnvironment` wraps configured storage factories automatically.
- For `createEventStore(context)`, if `context.storesEvents()` is false, it returns `EmptyEventStore`; otherwise it delegates.
- All other storage creation delegates to the wrapped factory.
- Closing the wrapper closes the delegate.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/system/SystemAwareStorageFactory.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ServerEnvironment.java`.

TypeScript implication: preserve this wrapper or an equivalent event-store policy so system contexts that do not store events do not accidentally allocate/write event streams.

## Environment selection and server configuration

Environment detection lives in `base/environment`; server configuration lives in `ServerEnvironment`.

`Environment`:

- Singleton.
- Standard types are `Tests` and `DefaultMode`.
- Custom environment types can be registered.
- `type()` detects the first enabled type from most recently registered custom types, then `Tests`, then `DefaultMode`; the result is cached.
- `is(type)` uses assignment compatibility.
- `setTo(type)` explicitly selects the current type and registers custom types if needed.
- `reset`/copy/restore helpers support tests.

Sources:

- `/private/tmp/spine-research/base/environment/src/main/java/io/spine/environment/Environment.java`.
- `/private/tmp/spine-research/base/environment/src/main/java/io/spine/environment/Tests.java`.
- `/private/tmp/spine-research/base/environment/src/main/java/io/spine/environment/DefaultMode.java`.
- `/private/tmp/spine-research/base/environment/src/main/java/io/spine/environment/CustomEnvironmentType.java`.

`Tests` detection:

- Uses the `TestsProperty` override if explicitly set.
- Otherwise scans the stack trace for known test packages: JUnit, TestNG, Spek v2, Spine testing, and Kotest.
- `DefaultMode` is enabled when `Tests` is not enabled.

`ServerEnvironment`:

- Singleton shared by all bounded contexts in the same process.
- Holds environment-specific settings for delivery, storage factory, tracer factory, and transport factory.
- Also owns node ID, command scheduler supplier, and deployment detector.
- Test environment defaults storage to `SystemAwareStorageFactory.wrap(InMemoryStorageFactory.newInstance())`.
- Test environment defaults transport to `InMemoryTransportFactory`.
- Other environments throw if required storage/transport factory is not configured.
- Delivery defaults lazily to `Delivery.local()`.
- `when(EnvironmentType).use(...)` configures a setting for an environment; lazy variants defer construction until requested.
- `close()` closes resolved tracer, transport, and storage factories; unresolved lazy fallbacks are not instantiated just to close.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ServerEnvironment.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/EnvSetting.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/kotlin/io/spine/server/ServerEnvironmentExts.kt`.

TypeScript implication: use process-wide server environment configuration. Prefer explicit environment selection through configuration/environment variables over stack inspection, but preserve the semantic model: test mode has in-memory defaults; production/default mode requires explicit storage and transport; bounded contexts in one Node process share factories unless deployed separately.

## Time utilities

`Time` in `base` is the core current-time abstraction.

Behavior:

- `Time.currentTime()` delegates to the current `Time.Provider`.
- `Time.systemTime()` always uses the system provider.
- `Time.currentTimeZone()` delegates to the current provider.
- `Time.setProvider()` and `resetProvider()` are internal/test-oriented hooks.
- The default provider uses `System.currentTimeMillis()` as the base and adds emulated nanoseconds in 1,000 ns increments.
- Incremental nanos reset for each new millisecond and wrap after 1,000 increments, preserving the original millisecond value.

Source:

- `/private/tmp/spine-research/base/base/src/main/java/io/spine/base/Time.java`.

The `time` repo adds model types and utilities:

- `spine/time/time.proto` defines `Month`, `DayOfWeek`, `YearMonth`, `LocalDate`, `LocalTime`, `LocalDateTime`, `ZoneId`, `ZonedDateTime`, and deprecated `ZoneOffset`, `OffsetTime`, `OffsetDateTime`.
- Time messages use validation options from `spine/options.proto`, plus a `LocalDateValidator` for calendar-valid dates.
- `TimestampExts.kt` and `DurationExts.kt` add comparisons, validity, string rendering, conversions, and arithmetic for Protobuf `Timestamp` and `Duration`.
- `Now` converts `Time.currentTime()` into Spine date/time messages for a fixed zone.
- `time_options.proto` defines `(when)`.

Sources:

- `/private/tmp/spine-research/time/time/src/main/proto/spine/time/time.proto`.
- `/private/tmp/spine-research/time/time/src/main/proto/spine/time_options.proto`.
- `/private/tmp/spine-research/time/time/src/main/java/io/spine/time/Now.java`.
- `/private/tmp/spine-research/time/time/src/main/kotlin/io/spine/time/TimestampExts.kt`.
- `/private/tmp/spine-research/time/time/src/main/kotlin/io/spine/time/DurationExts.kt`.
- `/private/tmp/spine-research/time/time/src/main/kotlin/io/spine/time/validation/LocalDateValidator.kt`.

TypeScript implication: all framework-generated timestamps should call a single injectable clock. Use `bigint` or a structured `{ seconds, nanos }` representation to avoid JS `Date` millisecond precision loss. If uniqueness/order depends on sub-millisecond values, emulate the JVM microsecond increment behavior or document a stronger monotonic clock.

## Logging and scoped context

Spine Logging is a standalone experimental library inspired by Flogger.

Core behavior:

- `WithLogging` provides a class logger and level shortcuts.
- `LoggingFactory` creates one logger per class/name.
- Default JVM backend is JUL; Log4j2 is available as an alternate backend.
- Exactly one non-default backend should be present at runtime.

Sources:

- `/private/tmp/spine-research/logging/README.md`.
- `/private/tmp/spine-research/logging/logging/src/commonMain/kotlin/io/spine/logging/WithLogging.kt`.

Logging context:

- `ContextDataProvider` is a service-loaded provider for scoped metadata, tags, forced logging decisions, mapped levels, and scope lookup.
- Default platform loads `BackendFactory`, `ContextDataProvider`, and `Clock` via system properties first, then `ServiceLoader`, then defaults.
- `ScopedLoggingContext` creates nestable contexts that can add tags, metadata, or log-level maps. Metadata is additive; nested contexts cannot disable logging enabled by a parent context.
- Implementations include standard thread-local context and gRPC context propagation.

Sources:

- `/private/tmp/spine-research/logging/logging/src/commonMain/kotlin/io/spine/logging/context/ContextDataProvider.kt`.
- `/private/tmp/spine-research/logging/logging/src/commonMain/kotlin/io/spine/logging/context/ScopedLoggingContext.kt`.
- `/private/tmp/spine-research/logging/platforms/jvm-default-platform/src/main/kotlin/io/spine/logging/backend/system/DefaultPlatform.kt`.
- `/private/tmp/spine-research/logging/contexts/std-context/src/main/kotlin/io/spine/logging/context/std/StdContextDataProvider.kt`.
- `/private/tmp/spine-research/logging/contexts/grpc-context/src/main/kotlin/io/spine/logging/context/grpc/GrpcContextDataProvider.kt`.

TypeScript implication: use a facade over a Node logger such as pino or Winston, but model scoped context explicitly. `AsyncLocalStorage` maps well to request-scoped tags/metadata and forced debug logging. Keep logging context separate from domain signal context; bridge tenant, command/event IDs, and trace IDs into logs at request/signal boundaries.

## Diagnostic events

Server diagnostics are domain/system events, not just logs.

Important diagnostic messages include:

- `ConstraintViolated`: emitted when entity validation constraints are violated.
- `CannotDispatchDuplicateCommand` and `CannotDispatchDuplicateEvent`: duplicate dispatch diagnostics.
- `HandlerFailedUnexpectedly`: handler runtime failure.
- `RoutingFailed`: routing runtime failure.
- `AggregateHistoryCorrupted`: aggregate history replay failure.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/system/server/diagnostic_events.proto`.
- `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/diagnostics.proto`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/system/server/DiagnosticEvent.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/EntityLifecycle.java`.

TypeScript implication: do not collapse diagnostics into logs only. Implement system diagnostic events as event messages published through the system context or equivalent internal bus. Logs can mirror diagnostics for operations, but the event stream is the machine-readable contract.

## Tracing and OpenTelemetry

The server tracing SPI is optional and environment-configured.

Core tracing SPI:

- `TracerFactory` extends `Closeable`.
- `trace(ContextSpec, Signal)` creates a per-signal `Tracer`.
- A `Tracer` exposes `signal()` and `processedBy(receiver, receiverType)`.
- `processedBy` is invoked after a signal is processed by an entity.
- `SystemContext` installs a `TraceEventObserver` when `ServerEnvironment.tracing()` is configured.

Sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/trace/TracerFactory.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/trace/Tracer.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/system/server/TraceEventObserver.java`.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/system/server/SystemContext.java`.

OpenTelemetry adapter:

- `server-otel` is experimental.
- `OtelTracerFactory` accepts an externally owned `OpenTelemetry` instance and an instrumentation scope name, defaulting to `io.spine.server.trace.otel`.
- The factory lazily obtains an OpenTelemetry tracer and does not shut down the supplied `OpenTelemetry` instance on close.
- `OtelTracer.processedBy` records a `SignalSpan` per signal handling.
- Each span starts at the signal timestamp and ends at `Time.currentTime()`.
- Trace IDs are deterministic from the root signal ID, so a causal signal chain shares a trace.
- The synthetic parent span context is marked sampled.
- Span attributes include bounded context, tenant, entity ID, signal ID, entity type URL, and signal type URL; string attributes are truncated to 256 chars and span display names to 128 chars.
- The implementation records per-handling spans rather than span events.

Sources:

- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/OtelTracerFactory.kt`.
- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/OtelTracer.kt`.
- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/SignalSpan.kt`.
- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/SpanAttribute.kt`.
- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/TraceIds.kt`.
- `/private/tmp/spine-research/core-jvm/server-otel/src/main/kotlin/io/spine/server/trace/otel/ExperimentalOtelTracing.kt`.

TypeScript implication: define tracing as a pluggable SPI and provide an OpenTelemetry implementation over `@opentelemetry/api`/SDK. Keep OpenTelemetry SDK ownership outside the Spine runtime. Generate deterministic trace IDs from root signal IDs if cross-process causal trace stitching is required.

## Versioned support repos

Local source versions:

| Repo | Version source | Version | Runtime relevance |
| --- | --- | --- | --- |
| `core-jvm` | `/private/tmp/spine-research/core-jvm/version.gradle.kts` | `2.0.0-SNAPSHOT.381` | Primary server, storage, validation consumption, tracing SPI. |
| `base` | `/private/tmp/spine-research/base/version.gradle.kts` | `2.0.0-SNAPSHOT.421` | Protobuf options, base types, `Time`, `Environment`, common utilities. |
| `time` | `/private/tmp/spine-research/time/version.gradle.kts` | `2.0.0-SNAPSHOT.242` | Date/time Protobuf types, converters, `(when)` option. |
| `validation` | `/private/tmp/spine-research/validation/version.gradle.kts` | `2.0.0-SNAPSHOT.446` | Validation runtime, generated-code contracts, validator registry/SPI. |
| `logging` | `/private/tmp/spine-research/logging/version.gradle.kts` | `2.0.0-SNAPSHOT.417` | Logging facade, backends, scoped context. |
| `change` | `/private/tmp/spine-research/change/version.gradle.kts` | `2.0.0-SNAPSHOT.206` | Protobuf-based change types; relevant for generated model/runtime type parity. |
| `reflect` | `/private/tmp/spine-research/reflect/version.gradle.kts` | `2.0.0-SNAPSHOT.200` | JVM reflection helpers; TS should replace with descriptor metadata and static registries. |

Notes:

- `base/README.md` says `base` is usually exposed through `spine-client` and `spine-server`, and `environment` is used internally by SDK components.
- `time/README.md` says Core JVM projects do not configure Time manually; Core JVM compiler adds/configures Time including `(when)` validation support.
- `validation/README.md` frames validation as generated type-safe checks from Protobuf constraints, enforced automatically when messages are built.
- `logging/README.md` marks logging experimental and JVM-only for now, with JavaScript implementation as a priority.
- `change/README.md` says Java is currently supported, with JavaScript and Dart on the priority list.
- `reflect/README.md` describes Kotlin/Java reflection utilities.

## TypeScript/Node implementation checklist

- Provide a single validation runtime API: `check(message)`, `violationsOf(message)`, `ValidationException`, `ValidationError`, `ConstraintViolation`, and a validator registry.
- Generate TS validators from `spine/options.proto` and `spine/time_options.proto`; keep server code dependent only on the runtime facade.
- Preserve `Any` unpacking through a type URL registry and document unknown-type behavior.
- Implement `StorageFactory` around one mandatory `createRecordStorage(context, spec)` adapter method.
- Make record specs explicit: ID extraction, record/source type, columns, and column value extraction.
- Build higher-level storages on record storage delegates.
- Provide in-memory storage with tenant slices, query filtering, masks, sorting, and limits.
- Use process-wide `ServerEnvironment` with test defaults and explicit production/default configuration.
- Use one injectable clock for all current-time reads and preserve sub-millisecond ordering semantics.
- Model logging context with async-local scoped metadata.
- Publish diagnostic events as system events, separately from logs.
- Keep tracing optional and environment-configured; make OpenTelemetry SDK ownership caller-controlled.

## Open questions and uncertainties

- How strict must TS regex compatibility be for `(pattern)`? Java regex is the documented baseline, but Node regex differs for some constructs and Unicode behavior.
- Should unknown `Any` payloads remain valid as in JVM `Validate.violationsOf`, or should TS deployments allow a stricter mode for operational safety?
- What is the desired TS equivalent of JVM automatic discovery (`ServiceLoader`) for validators, logging providers, storage adapters, and tracing implementations?
- Should Node test environment detection emulate JVM stack-based detection, or should tests require explicit `Environment.setTo(Tests)`/configuration?
- For persistent storage adapters, which query subset is mandatory at first release: all `RecordQuery` filtering/sorting/masks, or a smaller profile with capability checks?
- The local `pom.xml` files in some repos contain older generated dependency versions than `version.gradle.kts`; this document treats `version.gradle.kts` as source truth for cloned repo versions.
