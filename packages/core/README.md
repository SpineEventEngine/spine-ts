# @spine-ts/core

Core runtime metadata APIs for Spine TS.

The package currently provides descriptor-backed type registry APIs, the first
validation facade over `@spine-event-engine/validation-ts`, and helpers for
packing already-built domain messages into Spine command/event envelopes.

The type registry slice includes:

- deterministic type URL derivation from a schema file's Spine
  `type_url_prefix` option;
- fallback type URL derivation using `type.googleapis.com` for files without a
  Spine prefix option;
- schema registration and lookup by full Protobuf type name, type URL, and
  schema identity;
- fail-fast duplicate detection for full names, type URLs, and descriptor
  identity conflicts;
- descriptor metadata for the registered schema, declaring file, first field,
  and file option access; and
- a read-only default `spineCoreRegistry` lookup view containing the curated
  Spine schemas exported by `@spine-ts/proto`, including the core
  command/event envelope and actor/tenant/user/version context contracts.

```ts
import { FieldPathSchema } from "@spine-ts/proto";
import { deriveTypeUrl, spineCoreRegistry } from "@spine-ts/core";

const typeUrl = deriveTypeUrl(FieldPathSchema);
const metadata = spineCoreRegistry.getByTypeUrl(typeUrl);

console.log(metadata.fullTypeName);
```

Use `createSpineCoreRegistry()` when a caller-owned mutable registry is needed.
The shared `spineCoreRegistry` intentionally exposes lookup methods only, so
application code cannot mutate the process-wide curated registry.

Semantic tag lookup is intentionally empty for the current copied proto closure
because no registered schema currently proves `(is)` or `(every_is)` consumer
metadata in a TypeScript-friendly form. The lookup API is present so later
validation/routing tasks can add descriptor-backed tags without changing
callers.

## Validation

Framework users validate single Protobuf messages through `@spine-ts/core`, not
through the upstream validation package:

```ts
import { create } from "@bufbuild/protobuf";
import { validateMessage, checkValid, ValidationException } from "@spine-ts/core";
import { SomeCommandSchema } from "./generated/some_command_pb.js";

const command = create(SomeCommandSchema, {});
const result = validateMessage(SomeCommandSchema, command);

if (!result.valid) {
  const fields = result.violations.map(
    (violation) => violation.fieldPath?.fieldName.join(".") ?? violation.typeName,
  );
  console.warn(`Command failed ${result.violations.length} validation rule(s).`, fields);
}

try {
  checkValid(SomeCommandSchema, command);
} catch (error) {
  if (error instanceof ValidationException) {
    const validationError = error.asMessage();
    console.warn(
      `Command rejected with ${validationError.constraintViolation.length} violation(s).`,
    );
  }
}
```

`validateMessage()` returns a structured result with repo-local
`spine.validation.ConstraintViolation` and `spine.validation.ValidationError`
message data from `@spine-ts/proto`. `checkValid()` uses the same validation
path and throws `ValidationException` when violations are present.
Validation details are safe by default: the facade omits raw invalid
`fieldValue` data, redacts every upstream or transition-rule placeholder value
while preserving placeholder keys, and converts upstream validation runtime failures into
structured repo-local violations.

Stateful checks such as Spine `(set_once)` require previous and proposed state.
They are intentionally separate from single-message validation and use the
framework-owned `validateTransition()` seam. Full entity transaction enforcement
will attach transition rules in a later runtime task. Rule-returned violations
are sanitized before aggregation, and throwing transition rules are isolated
into structured violations so later rules still run in order.

## Envelope Packing

Use `packAny()` when a caller needs Spine-aware `google.protobuf.Any` values.
It derives the type URL through `deriveTypeUrl(schema)` and serializes with the
Protobuf-ES binary writer, so Spine payloads use `type.spine.io/...` instead of
the default `type.googleapis.com/...` prefix.

```ts
import { create } from "@bufbuild/protobuf";
import { packAny, unpackAny } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const payload = create(CreateTaskSchema, { title: "Ship the thin slice" });
const any = packAny(CreateTaskSchema, payload);
const unpacked = unpackAny(any, CreateTaskSchema);
```

`packAny()` validates the enclosed message through the core validation facade by
default and throws `ValidationException` for structured validation failures. Set
`{ validate: false }` only when the caller has already validated a trusted
message. The helpers do not include packed bytes or payload contents in their
validation errors.

Use `packCommand()` and `packEvent()` to create generated Spine envelopes:

```ts
import { packCommand, packEvent } from "@spine-ts/core";

const command = packCommand({
  id: commandId,
  context: commandContext,
  schema: CreateTaskSchema,
  message: payload,
});

const event = packEvent({
  id: eventId,
  context: eventContext,
  schema: TaskCreatedSchema,
  message: taskCreated,
});
```

The caller supplies generated IDs and generated contexts. These helpers do not
generate UUIDs, timestamps, actor or tenant context, producer IDs, versions,
origins, system properties, storage records, bus deliveries, or transport
metadata.

This package does not yet implement runtime buses, entity repositories, storage,
decorators, handlers, or transport behavior.
