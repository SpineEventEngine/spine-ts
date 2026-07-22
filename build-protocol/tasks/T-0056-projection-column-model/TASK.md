# T-0056: Projection Column Model

Status: Reviewed and fully verified; ready to commit

## Objective

Introduce the `@spine-ts/client` package boundary and the descriptor-backed,
type-safe Projection column model that later Query DSL work will consume. Make
`packages/storage` the sole owner of the normalized predicate/query-plan and
provider-capability validation contract without implementing public query
execution in this packet.

## Classification

High-risk. This task creates a public package and generic TypeScript contract,
defines descriptor/type semantics for persisted query columns, and establishes
the shared provider-policy boundary used by all storage adapters. T-0052 has
already completed the required architecture/public-contract split and its four
specialist reviews; no additional requirements split is needed unless actual
code reveals a conflict with that accepted design.

## Human-Imposed Requirements Ledger

- Provide behavioral and conceptual JVM feature parity using idiomatic,
  minimal TypeScript; do not copy JVM internals or invent an over-engineered
  abstraction.
- There is no deprecation cycle because Spine TS has no real-world consumers.
- Entity `(column)` annotations and the corresponding Query DSL must ultimately
  reach JVM feature parity.
- Wave 1 exposes high-level columns and queries only for Projections. Aggregate
  and Process Manager high-level query APIs wait for Wave 2 after recent
  state/event history.
- T-0056 establishes the typed column model and one canonical normalized
  query/capability policy. T-0057 owns public Query DSL compilation and adapter
  execution.
- Node.js is the only supported runtime for this program.
- Preserve all unrelated files and accepted initial-release behavior.

## Ownership

- the new `@spine-ts/client` package skeleton and typed Projection-column API;
- descriptor-backed Projection column metadata and registration validation;
- the `packages/storage` normalized predicate/query-plan and provider
  capability-validation contract that T-0057 will execute;
- compile-time fixtures, descriptor tests, package checks, and the current
  Projection-column user-guide section;
- T-0056 task, work, and review records.

## Acceptance Criteria

1. Projection schemas expose only declared `(column)` fields plus system
   `version`, `archived`, and `deleted` columns, with runtime metadata and
   TypeScript value types that agree.
2. Public `ProjectionColumn<Schema, Name, Value, Operators>` values can be
   obtained only through generated/descriptor-backed Projection metadata;
   public consumers cannot construct arbitrary string columns.
3. The column value type determines its allowed comparison operators. Scalar,
   enum, and supported message-valued columns receive the documented operator
   sets.
4. Repeated, map, or otherwise unsupported annotated fields fail during
   Projection registration with stable, actionable errors before storage or
   query work.
5. Negative compile fixtures reject unknown and non-column names, unsupported
   field kinds, wrong comparison values/operators, and Aggregate/Process
   Manager high-level column factories.
6. No Aggregate or Process Manager high-level column API is exported. Existing
   low-level record/ID query interfaces remain available only at their existing
   storage boundary.
7. `packages/storage` exports or internally exposes one normalized predicate,
   ordering, mask, limit, and capability-validation policy contract for T-0057;
   providers must not invent validation policy.
8. Descriptor metadata is immutable, cached by schema identity, and returns
   stable column identities without unbounded duplicate work for repeated
   registration/access.
9. The user guide documents declared/system columns and supported
   value/operator combinations with compilable Projection snippets and an
   explicit Wave 2 Aggregate/Process Manager limitation.
10. Package exports, build graph, TypeDoc/API expectations, and release
    readiness include `@spine-ts/client` without leaking internal constructors
    or normalized storage implementation objects into the public DSL.

## TDD And Verification

- Add compile-time and runtime RED fixtures before implementation for package
  imports, declared/system columns, stable identity, field validation, and
  prohibited Aggregate/Process Manager factories.
- Cover scalar, enum, supported message, repeated, map, and unsupported field
  descriptors.
- Run focused package tests, production/tooling typechecks, lint/cleanup,
  formatting, TypeDoc/API, release-readiness, and diff hygiene before review.
- Required review concerns: TypeScript/API, documentation,
  style/maintainability, and performance/reliability for metadata caching.
  Execution performance and security are N/A because this packet adds no query
  executor or external trust boundary.
- After accepted corrections, run full verification, commit and immediately
  push the task branch, merge and immediately push `main`, post-merge verify,
  record closure, push the closure commit, and continue to T-0057.

## Assignment Gate

- Existing role: `implementer`.
- Bounded scope: T-0056 only; one production writer; no child spawning.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both model and reasoning must be explicit in dispatch.
- The implementer may not commit, push, merge, or modify unrelated files.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and metadata limitation are recorded honestly.

## Baseline

- Branch/worktree: `task/T-0056-projection-column-model` /
  `.worktrees/T-0056-projection-column-model`.
- Base: pushed `main` at `55b460b6` after T-0055 durable closure.
- `packages/server/src/entity/entity-metadata.ts` currently notices annotated
  fields for Projection and Process Manager schemas but validates only list/map
  cardinality and returns generic descriptor metadata. `packages/storage`
  currently exposes string-based low-level `RecordQuery`; no `packages/client`
  package exists.

## Implementation Evidence

- `@spine-ts/client` now exposes only the nominal Projection column model at
  the root and a separate generated-code support subpath. Its shipped
  `protoc-gen-spine-projection-columns` bin emits exact descriptor-backed
  definitions beside Protobuf-ES schemas.
- Registration independently validates Projection kind, exact annotated field
  coverage/identity, supported field shape, and descriptor-derived comparison
  family. Metadata and operators are frozen; same schema/definition access is
  cached through weak identities.
- `@spine-ts/storage` owns the normalized predicate/order/mask/limit contracts
  and the single fail-fast provider capability policy. No public query DSL or
  executor was added.
- Compile-negative fixtures cover authored/non-column/unknown metadata, wrong
  values/operators, arbitrary construction, and absent Aggregate/Process
  Manager factories. The real generated to-do `TaskList` companion is imported
  and compiled by `examples/todo/src/projection-columns.ts`.
- Focused coverage after implementation: 97.92% statements, 95.68% branches,
  100% functions, and 99.42% lines. Full build/tooling, lint/cleanup,
  TypeDoc/API, package import/link, staged generation, and generated-drift
  checks passed before specialist review dispatch.
