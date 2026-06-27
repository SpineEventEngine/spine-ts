# Spine Domain Model and Signal Surface

Navigation: [README](README.md) | Start here | Next: [Server runtime and bounded context](spine-server-runtime-and-bounded-context.md) | Related: [Entities, repositories, and state](spine-entities-repositories-and-state.md), [Validation and support](spine-validation-storage-observability-and-support.md)

This document captures the developer-facing modeling contract needed for a future TypeScript/Node.js implementation of Spine Event Engine. It treats the Java/Kotlin repositories as source truth for version `2.0.0*`, but describes the functional surface rather than the Java API.

## Functional Shape

Spine applications model their domain in Protobuf. Domain messages are separated by role:

- Entity state messages describe aggregates, projections/views, process managers, or generic entities.
- Command messages describe an instruction to do something.
- Event messages describe something that happened, named in the past tense.
- Rejection messages describe business refusal conditions and are transported as special events.
- Value and identifier messages provide typed fields used by all of the above.

The runtime wraps command and event messages in generic envelopes:

- `spine.core.Command` contains `CommandId`, `google.protobuf.Any message`, and `CommandContext`.
- `spine.core.Event` contains `EventId`, `google.protobuf.Any message`, and `EventContext`.
- Entity records similarly use `Any` for `entity_id` and `state`.

Source: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/command.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/event.proto`, `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/entity/entity.proto`.

## Type URLs and `Any`

Every Spine `.proto` file is expected to import `spine/options.proto` and usually declares:

```proto
option (type_url_prefix) = "type.spine.io";
```

or an application-specific prefix such as `type.todolist.spine.io`. Spine composes type URLs as:

```text
<type_url_prefix>/<fully.qualified.ProtoTypeName>
```

For Google well-known types, the prefix is `type.googleapis.com`. Envelopes and metadata use these URLs when packing messages into `google.protobuf.Any`.

TypeScript implication:

- Generate descriptors with `buf`/`protobuf-es` and preserve custom options from `spine/options.proto`.
- Provide a central `TypeRegistry` keyed by full type URL and by fully qualified type name.
- Provide `pack(message, schema)` and `unpack(any)` helpers. Do not rely on Java class names or `java_package`.
- Respect each file's `(type_url_prefix)` option. The default Spine framework prefix is `type.spine.io`, but application files may override it.
- See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for the required descriptor and registry artifacts.

Sources: `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`, `/private/tmp/spine-research/base/base/src/main/java/io/spine/type/TypeUrl.java`, `/private/tmp/spine-research/example-todo-list/tasks/src/main/proto/todolist/tasks.proto`.

## Identifiers

Domain IDs are commonly modeled as Protobuf messages, e.g. `TaskId { string uuid = 1; }`, but Spine also supports primitive and enum IDs internally.

Supported entity identifier field categories are:

- `string`
- 32-bit and 64-bit integer scalar encodings
- enum
- message

Spine uses the "first field" convention for identifiable messages: the first field in declaration order, not the smallest field number, is treated as the ID. Entity state messages should start with the entity ID. The Java runtime also initializes a matching first ID field in entity state builders unless that field explicitly sets `(required) = false`.

TypeScript implication:

- Model entity ID metadata from descriptors: first field declaration order matters.
- Support message IDs as first-class values, not just strings.
- When constructing empty state for an entity, populate the first field if its type matches the repository/entity ID type and it is not explicitly `(required) = false`.
- Pack IDs into `Any` for `MessageId.id`, `EventContext.producer_id`, and `EntityRecord.entity_id`.

Sources: `/private/tmp/spine-research/base/base/src/main/kotlin/io/spine/base/EntityState.kt`, `/private/tmp/spine-research/base/base/src/main/java/io/spine/base/Identifier.java`, `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/IdField.java`, `/private/tmp/spine-research/example-server-quickstart/model/src/main/proto/spine/tasks/identifiers.proto`.

## Entity State Options

Entity states are ordinary Protobuf messages annotated with the message option `(entity)`.

```proto
message Task {
  option (entity).kind = AGGREGATE;
  option (entity).visibility = FULL;

  TaskId id = 1;
  string title = 2 [(required) = true];
}
```

`EntityOption.Kind` values:

- `AGGREGATE`
- `PROJECTION`
- `VIEW`, alias of `PROJECTION`
- `PROCESS_MANAGER`
- `ENTITY`

`EntityOption.Visibility` values:

- `DEFAULT`
- `NONE`
- `SUBSCRIBE`
- `QUERY`
- `FULL`

Default visibility is kind-dependent: projections default to `FULL`; aggregates, process managers, and other entities default to `NONE`. `FULL` allows both query and subscription; `QUERY` allows querying; `SUBSCRIBE` allows subscriptions; `NONE` hides the state from client reads.

Fields marked `(column) = true` are stored separately for filtering/querying. Spine treats columns as meaningful for projections and process managers. For TypeScript, aggregate columns are supported only when the aggregate state explicitly enables querying via visibility `QUERY` or `FULL`; otherwise aggregate column declarations are ignored for generated query APIs and rejected by server-side query validation. Repeated and map fields cannot be columns. Entity records also carry lifecycle flags: `archived` and `deleted`.

TypeScript implication:

- Treat `(entity)` as the source of entity-kind registration.
- Expose visibility checks for query/subscription APIs.
- Implement lifecycle flags separately from domain state.
- Keep query columns descriptor-driven; reject or ignore unsupported column declarations consistently.
- See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for entity and query metadata requirements.

Sources: `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`, `/private/tmp/spine-research/core-jvm/server/src/main/kotlin/io/spine/server/entity/EntityVisibility.kt`, `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/entity/entity.proto`, `/private/tmp/spine-research/example-todo-list/tasks/src/main/proto/todolist/tasks.proto`.

## Commands

A command message is the domain payload. A `Command` envelope adds:

- `CommandId id`, a UUID string wrapper.
- `Any message`, the packed domain command.
- `CommandContext context`.
- internal `SystemProperties`, currently including scheduling time.

`CommandContext` contains:

- `ActorContext actor_context`, required.
- `int32 target_version`, optional optimistic-concurrency target.
- `map<string, Any> attributes`, domain-specific metadata.
- `Schedule schedule`, currently a delay.
- `Origin origin`, the newer origin-chain representation.

Validation errors for command acceptance are technical and represented by `CommandValidationError`: unsupported command, invalid command, tenant missing/inapplicable, expired scheduled command, duplicate command.

TypeScript implication:

- Command construction should always produce a new `CommandId`, pack the message into `Any`, and attach actor context.
- `target_version` is optional and should mean "any version" when absent/default.
- Scheduled command support needs both the requested delay and internal scheduling-time bookkeeping.
- Command acceptance failures are not business rejections unless a rejection event is returned.

Sources: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/command.proto`, `/private/tmp/spine-research/example-server-quickstart/model/src/main/proto/spine/tasks/commands.proto`, `/private/tmp/spine-research/example-todo-list/tasks/src/main/proto/todolist/commands.proto`.

## Events and Rejections

An event message is the domain payload. An `Event` envelope adds:

- `EventId id`, usually a generated string.
- `Any message`, the packed domain event or rejection message.
- `EventContext context`.

`EventContext` contains:

- `Timestamp timestamp`, required.
- `origin`, a oneof for legacy command/event contexts, newer `Origin past_message`, or `ActorContext import_context`.
- deprecated `origin_id` fields for command/event IDs.
- deprecated `root_command_id`.
- `Any producer_id`, required; examples include aggregate or process-manager IDs.
- `Version version`, the producer entity version after applying the event.
- `Enrichment enrichment`.
- internal `external` flag.
- `RejectionEventContext rejection`, present only for rejection events.

A rejection is not a separate envelope type. It is an event whose context has `rejection` populated. `RejectionEventContext` records the original `Command`, optional stacktrace, and a deprecated command-message copy. Business rejection messages are ordinary Protobuf payloads, often stored in files named `rejections.proto`; standard lifecycle rejections include `CannotModifyArchivedEntity`, `CannotModifyDeletedEntity`, `EntityAlreadyArchived`, and `EntityAlreadyDeleted`.

`EventValidationError` covers technical errors: unsupported event, invalid event, duplicate event.

TypeScript implication:

- Use one `Event` envelope for normal events and rejections.
- Treat `context.rejection != undefined` as the event-kind discriminator.
- Preserve rejection command details for clients that need to explain failed commands.
- Keep technical validation errors and domain rejections distinct in API results.

Sources: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/event.proto`, `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/entity/standard_rejections.proto`, `/private/tmp/spine-research/example-todo-list/tasks/src/main/proto/todolist/rejections.proto`.

## Actor, Tenant, Origin, and Version Metadata

`ActorContext` is attached to commands and origin chains:

- `TenantId tenant_id`, absent in single-tenant applications.
- `UserId actor`, required.
- `Timestamp timestamp`, required.
- `ZoneId zone_id`, strongly encouraged but not marked required.
- `Language language`, optional response-language preference.

`TenantId` is a oneof:

- internet domain
- email
- application-specific string value

`Origin` models causality as a recursive chain:

- `MessageId message`, the direct parent.
- `Origin grand_origin`, the parent's origin.
- `ActorContext actor_context`, shared across the chain.

`MessageId` contains:

- `Any id`, the command ID, event ID, entity ID, or other producer ID.
- `string type_url`, the message type URL.
- optional `Version version`.

`Version` contains a zero-based `number` and required `timestamp`; entity version number `0` is reserved for pre-initialization.

TypeScript implication:

- Keep actor context immutable once a command chain starts.
- Prefer `Origin`/`MessageId` for new implementation paths. Legacy direct context and ID fields in `EventContext` are deprecated but may be needed for interoperability.
- Version should be part of entity state metadata and event metadata, not embedded into the domain state unless the domain model declares such a field.

Sources: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/actor_context.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/tenant_id.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/user_id.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/diagnostics.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/version.proto`.

## Responses and Acknowledgements

`Response.Status` is a required oneof:

- `ok`
- `error`, a technical `spine.base.Error`
- `rejection`, a `spine.core.Event`

`Ack` is for asynchronous posting. Its status uses the same status shape as `Response.Status`: `ok`, `error`, or `rejection`. It says a message was accepted for further processing or failed immediately at posting time; it does not mean the command was handled or delivered.

An immediate `Ack.status.rejection` is a post-time business rejection returned before command-result subscriptions can produce later outcomes. Later asynchronous business rejections are delivered as ordinary rejection events, or as command-result events derived from dispatch, after the command has been accepted. Both use `Response.Status.rejection`/rejection-event semantics, but clients must distinguish "post returned rejection now" from "accepted command later produced a rejection event".

`spine.base.Error` contains type, numeric code, optional `Any details`, developer message, structured attributes, and stacktrace. Validation errors can be packed into `details`.

TypeScript implication:

- API clients must not interpret `Ack.ok` as "business operation completed".
- Use `Response.Status.rejection` for business refusal and `Response.Status.error` for technical failures. The status enum/oneof is reused by immediate acknowledgements and ordinary service responses.
- Preserve `Any details` so validation and other structured errors remain machine-readable.

Sources: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/response.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/ack.proto`, `/private/tmp/spine-research/base/base/src/main/proto/spine/base/error.proto`.

## Validation Options That Affect Modeling

Spine validation is descriptor-driven via custom Protobuf options in `spine/options.proto`. These constraints do not change Protobuf wire validity; they are runtime/model validation rules.

Important field options:

- `(required) = true`: non-default message/enum, non-empty string/bytes, non-empty repeated/map; repeated/map elements or values are checked for missing values where meaningful.
- `(validate) = true`: recursively validate message fields, repeated message elements, map message values, and, when possible, unpacked `Any` payloads. Default singular message instances are allowed unless also `(required)`.
- `(min)`, `(max)`, `(range)`: numeric bounds. Values are strings and may reference other numeric fields, including nested fields.
- `(pattern)`: string regex with selected modifiers. The syntax baseline is Java regex.
- `(goes).with`: companion field must be present when target field is present.
- `(set_once) = true`: field may only be assigned when currently default or assigned to the same value; useful for IDs.
- `(distinct) = true`: repeated elements or map values must be unique.
- `(column) = true`: entity query column.

Important oneof/message options:

- `(choice).required = true`: a `oneof` must have a selected field.
- `(require).fields = "a | b & c"`: at least one listed field group must be present.
- `(entity)`: entity kind and visibility.
- `(is)` and `(every_is)`: Java type/interface markers. These are useful as semantic tags in source, but a TS implementation should avoid depending on Java interface names.
- `(constraint_for)`: deprecated external validation constraint.

Validation errors use `spine.validation.ValidationError` containing repeated `ConstraintViolation`. A violation carries:

- template error message.
- root validated type name.
- `FieldPath` to the invalid field.
- offending field value as `Any`.

TypeScript implication:

- Implement validation from descriptors and custom options, not generated Java builders.
- Preserve custom options in generated descriptor sets; `protobuf-es` message classes alone are not enough if options are stripped.
- For `Any` validation, unknown type URLs should be treated as valid because the runtime cannot unpack and validate the unknown payload.
- Java regex compatibility is an issue for Node.js. The TS port should document or emulate Java regex behavior where patterns rely on Java-specific syntax.
- Validation should produce structured `ValidationError`/`ConstraintViolation` equivalents that can be packed into `base.Error.details`.
- See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for validation facade and `(set_once)` enforcement requirements.

Sources: `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`, `/private/tmp/spine-research/validation/jvm-runtime/src/main/proto/spine/validation/validation_error.proto`, `/private/tmp/spine-research/base/base/src/main/proto/spine/base/field_path.proto`, `/private/tmp/spine-research/validation/tests/validating/src/testFixtures/proto/spine/test/tools/validate/validate.proto`.

## Enrichment and Attributes

Event enrichment is optional metadata attached to `EventContext`.

`Enrichment` is a oneof:

- `do_not_enrich`
- `container`, a map from fully qualified Protobuf type name to packed `Any`.

Commands also allow arbitrary domain-specific context attributes via `CommandContext.attributes: map<string, Any>`.

TypeScript implication:

- Keep enrichment separate from domain event payloads.
- Use fully qualified Protobuf type names as enrichment map keys, not type URLs.
- Treat command attributes as extension metadata and preserve them through command handling.

Sources: `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/enrichment.proto`, `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/command.proto`.

## Naming and File Conventions

The examples use practical conventions that should be supported but not hard-coded as the only valid source of truth:

- `commands.proto` for command payload messages.
- `events.proto` for event payload messages.
- `rejections.proto` for business rejection payload messages.
- `identifiers.proto` for typed IDs.
- state files such as `task.proto` or `tasks.proto` for entity state.

Commands are imperative (`CreateTask`, `UpdateTaskDescription`). Events are past-tense (`TaskCreated`, `TaskDescriptionUpdated`). Rejections commonly start with `Cannot...`.

TypeScript implication:

- Classify messages by descriptor options and model registration, with file/name conventions as helpful defaults.
- Do not require Java package naming or generated Java marker interfaces to determine message role.

Sources: `/private/tmp/spine-research/example-server-quickstart/model/src/main/proto/spine/tasks/commands.proto`, `/private/tmp/spine-research/example-server-quickstart/model/src/main/proto/spine/tasks/events.proto`, `/private/tmp/spine-research/example-server-quickstart/model/src/main/proto/spine/tasks/task.proto`, `/private/tmp/spine-research/example-todo-list/tasks/src/main/proto/todolist/rejections.proto`.

## TypeScript Implementation Checklist

- Generate TS messages and descriptor metadata with `bufbuild/protobuf-es`.
- Compile/include `spine/options.proto` so custom options are visible.
- Build a registry for message schemas, type names, type URLs, entity kinds, visibility, columns, and validation metadata.
- Implement `Any` pack/unpack using Spine type URL prefixes.
- Implement command/event/entity envelopes as generated protobuf messages plus ergonomic factory functions.
- Implement actor/tenant/origin/version factories that preserve causality and multitenancy semantics.
- Implement validation as a descriptor-driven module producing structured violations.
- Implement rejection events as normal `Event` envelopes with `context.rejection` set.
- Keep deprecated fields readable for interoperability, but prefer `Origin`/`MessageId` for newly emitted signals.

## Open Questions and Uncertainties

- The exact TypeScript API shape for semantic tags from `(is)` and `(every_is)` is still a design choice, but the runtime contract requires them to be preserved as descriptor or registered type tags rather than ignored.
- Java regex semantics in `(pattern)` may not map perfectly to JavaScript `RegExp`.
- The complete command/event role discovery mechanism in Java uses model/compiler conventions beyond the wire protos; this document intentionally avoids compiler internals.
- Legacy `EventContext.command_context`, `event_context`, `origin_id`, and `root_command_id` are deprecated but may still appear in stored data or integrations.
