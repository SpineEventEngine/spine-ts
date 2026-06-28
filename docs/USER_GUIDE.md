# Spine TS User Guide

Current status: early framework guide for the descriptor registry and
single-message validation facade.

This guide covers the runnable behavior available now: Spine proto descriptors
are exposed through curated packages, `@spine-ts/core` can derive and look up
type metadata, and framework users can validate one Protobuf message at a time.
Entity runtime, transport, storage, and the to-do application remain later
slices.

## What Exists Now

- A pnpm workspace with package boundaries for proto, core, server, transport, storage, and testing.
- Strict TypeScript project references configured for ESM-first NodeNext packages.
- Tooling commands for type checking, linting, formatting, tests, coverage, TypeDoc, and Buf/Protobuf-ES generation.
- A first copied Spine proto set under `proto/`, with provenance checksums in
  `proto/spine-sources.json`.
- Curated Protobuf-ES schemas, descriptors, message types, and Spine custom
  options exported from `@spine-ts/proto` for the first intake set.
- A core type registry in `@spine-ts/core` that derives Spine type URLs,
  exposes a read-only default lookup view for the current curated schemas, and
  looks up descriptor-backed metadata by full type name, type URL, or schema.
- Canonical Spine core command/event envelope and context contracts are
  available from `@spine-ts/proto` and pre-registered in
  `spineCoreRegistry`, including `CommandSchema`, `EventSchema`,
  `ActorContextSchema`, `TenantIdSchema`, `UserIdSchema`, and
  `VersionSchema`.
- A core validation facade that validates single Protobuf messages through
  `@spine-event-engine/validation-ts` while returning repo-local Spine
  `ValidationError` and `ConstraintViolation` data.
- A placeholder to-do example workspace.

## What Is Deferred

- `Any` pack/unpack helpers.
- High-level `packCommand()` and `packEvent()` construction helpers.
- Semantic tag registration from `(is)` and `(every_is)` consumers; the lookup
  API exists, but the current copied proto closure has no provable registered
  tag consumers.
- gRPC service implementations.
- Entity, bus, transport, storage, and to-do domain runtime behavior.

## Type Registry

```ts
import { FieldPathSchema } from "@spine-ts/proto";
import { deriveTypeUrl, spineCoreRegistry } from "@spine-ts/core";

const typeUrl = deriveTypeUrl(FieldPathSchema);
const metadata = spineCoreRegistry.getByFullName("spine.base.FieldPath");
```

The shared `spineCoreRegistry` is lookup-only. Use `createSpineCoreRegistry()`
when application or test code needs a caller-owned mutable registry.

Spine files normally declare `option (type_url_prefix) = "type.spine.io"`.
`deriveTypeUrl()` composes that prefix with the schema's full Protobuf type
name. For files without the Spine option, the core registry uses the documented
fallback prefix `type.googleapis.com`.

The shared registry also contains the canonical core signal contracts:

```ts
import { CommandSchema, EventSchema } from "@spine-ts/proto";
import { spineCoreRegistry } from "@spine-ts/core";

const commandTypeUrl = spineCoreRegistry.getBySchema(CommandSchema).typeUrl;
const eventTypeUrl = spineCoreRegistry.getBySchema(EventSchema).typeUrl;
```

## Validation

Use `@spine-ts/core` for validation. Application code does not import
`@spine-event-engine/validation-ts` directly.

```ts
import { create } from "@bufbuild/protobuf";
import { checkValid, validateMessage, ValidationException } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const command = create(CreateTaskSchema, {});
const result = validateMessage(CreateTaskSchema, command);

if (!result.valid) {
  const fields = result.violations.map(
    (violation) => violation.fieldPath?.fieldName.join(".") ?? violation.typeName,
  );
  console.warn(`Command failed ${result.violations.length} validation rule(s).`, fields);
}

try {
  checkValid(CreateTaskSchema, command);
} catch (error) {
  if (error instanceof ValidationException) {
    const validationError = error.asMessage();
    console.warn(
      `Command rejected with ${validationError.constraintViolation.length} violation(s).`,
    );
  }
}
```

`validateMessage()` is for single-message Spine validation options such as
`(required)`, `(pattern)`, and `(validate)`. Returned
`ConstraintViolation`/`ValidationError` data is safe by default: raw invalid
field values are omitted, upstream and transition-rule placeholder values are
redacted, and upstream validation runtime failures are converted into repo-local
structured violations instead of leaking raw exceptions. Placeholder keys may
remain so callers can understand the template shape, but values do not expose
payload data.

Transition-only rules such as `(set_once)` need previous state and proposed
state, so they use the separate framework seam:

```ts
import { validateTransition } from "@spine-ts/core";

const result = validateTransition({ schema: TaskSchema, previous, next }, rules);
```

The first seam is intentionally minimal. Later entity/runtime tasks will provide
the built-in transition rules and call this seam from framework-controlled
transactions. Rule-returned violations are sanitized before aggregation. If a
transition rule throws, the seam records a structured transition-rule failure
and continues later rules in order.

## First Commands

```shell
pnpm install
pnpm proto:verify
pnpm proto:generate
pnpm docs:check
pnpm verify
```

Generated API docs are written to `docs/api/reference` and are ignored by Git.
