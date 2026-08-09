# T-0147: JVM-Compatible Storage Contract

Status: In progress; non-releasable stacked checkpoint.

## Objective

Prepare the common storage contracts required by the approved tenancy and
physical-interoperability correction. Introduce typed, collision-free tenant
identity, provider-owned tenant enumeration, schema-aware record columns,
JVM-shaped identifier and stringifier behavior, provider column-mapping ports,
and cross-runtime golden vectors before either physical provider changes its
layout.

This checkpoint is not independently releasable. T-0148 through T-0150 must
complete the MySQL, Datastore, memory, server, example, documentation,
migration, and release cutover before this train may merge to `main`.

## Classification

High-risk. The task prepares public and serialized storage contracts, tenant
trust boundaries, provider conversion rules, and cross-runtime physical
compatibility. It does not yet modify a provider's persisted layout.

## Baseline

- Branch: `task/T-0147-storage-contract`.
- Worktree:
  `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0139-inbox-shards`.
- Baseline: `341e2d52` (`docs(protocol): require JVM storage interoperability`).
- Canonical plan:
  `build-protocol/planning/STORAGE_TENANCY_CORRECTION_PLAN.md`.

## Human-Imposed Requirements Ledger

- Copy Spine JVM's typed storage approach: identifiers, reversible
  stringifiers, provider column mappings, and symmetric write/query
  conversion.
- Spine TS and Spine JVM must be physically interoperable for stored IDs,
  declared columns, and query operands.
- `_scope` and MySQL `_revision` are inventions and must disappear without a
  replacement discriminator, revision, facade, or dual layout.
- Bounded Context names never divide persisted data or participate in physical
  identity.
- MySQL multitenancy selects a tenant-specific database/data source.
- Datastore multitenancy selects a native namespace.
- Preserve full generated `TenantId` values; domain, email, and value variants
  with equal text must not collide.
- A stored column value and a `Query` operand targeting that column must pass
  through the identical schema-aware provider mapping.
- Compact Proto JSON means the Protobuf JSON mapping, not generic
  `JSON.stringify()` output.
- Do not add attempts, claims, receipts, markers, dedup records, quarantine,
  fingerprints, stored tenant-index records, or another hidden persistence
  mechanism.
- Beginner-facing documentation must remain simple, and any later README edits
  must preserve that README's existing look and feel.
- Work only in the existing linked worktree. Preserve every unrelated change.
- Push only to `origin`; never push to `spine-event-engine`; push every commit
  immediately; never rewrite a published branch.
- Do not merge an intermediate T-0147 through T-0149 checkpoint to `main`.

## Acceptance

- `TenantBoundary` derives a deterministic collision-free internal key from a
  complete `TenantId`; domain/email/value variants and adversarial prefix text
  remain distinct.
- A factory-owned tenant-catalog port represents one single-tenant boundary or
  enumerable typed multitenant boundaries without persisted records or
  Bounded-Context ownership.
- `RecordColumn` retains generated Proto field type information sufficient to
  distinguish scalars, enums, ordinary messages, `Timestamp`, and `Version`.
- Identifier behavior supports JVM-compatible primitive and message ID
  classification, validation, packing, unpacking, and provider conversion.
- Default message stringification is reversible compact Proto JSON and permits
  explicit schema-bound custom stringifiers without global object-shape
  inference.
- Provider column-mapping ports require the same conversion for stored values,
  equality/range operands, ordering, and continuations.
- Golden vectors cover MessageId, BoardId, UserId, string, integral, boolean,
  bytes, enum, ordinary message, `Timestamp`, `Version`, and null behavior,
  and identify the exact JVM-compatible MySQL and Datastore provider values.
- Focused common-contract tests are RED before production implementation and
  GREEN afterward.
- Provider/runtime cutover failures handed to T-0148 through T-0150 are exact
  and documented; no compatibility alias is introduced to hide them.

## Exclusions

- No MySQL pool routing, table DDL, `_scope`/`_revision` deletion, or provider
  preflight in this checkpoint.
- No Datastore namespace/key/property cutover or namespace discovery in this
  checkpoint.
- No memory/EventStore/server tenant-discovery cutover in this checkpoint.
- No example or broad beginner-documentation migration yet.
- No JVM build or JVM source modification.
- No old-layout migration implementation.

## Verification Profile

Focused contract tests and changed-package typechecks during T-0147. This
checkpoint records expected downstream provider/runtime compile failures
instead of adding aliases. The complete stacked train runs changed-source
coverage, specialist/security review, and one final `verify:release` under
T-0150.

## Review Dispositions

- Style/maintainability: pending final stacked-train review; common contract
  structure is in scope.
- Documentation: pending final stacked-train review; public beginner guidance
  changes only after provider behavior stabilizes.
- TypeScript/API docs: pending final stacked-train review; public types and
  declarations are in scope.
- Performance/reliability: pending final stacked-train review; identity,
  conversion, and tenant-catalog correctness are in scope.
- Security: deferred to T-0150's mandatory final tenant-boundary review.
