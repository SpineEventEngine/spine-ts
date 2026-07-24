# T-0072: Generic Entity Query DSL and Wave 2 Closure

Status: Complete

Implementation status: implemented, reviewed, committed, merged into `main`,
post-merge verified, and remotely synchronized.

## Objective

Replace Projection-specific query and column APIs with generic Entity
terminology, generate declared columns for every queryable entity kind, execute
all queries through durable shared current records, and close JVM-parity Wave 2
with current documentation, upstream-delta evidence, specialist review,
security review, integration, post-merge verification, and remote
synchronization.

## Classification

High-risk. This task atomically changes public TypeScript names and package
entrypoints, generated source and executable names, query execution authority,
Aggregate/Projection/Process Manager behavior, examples and guide snippets,
and the final Wave 2 release surface.

## Human-Imposed Requirements Ledger

- Preserve behavioral and conceptual Spine JVM parity with idiomatic,
  non-over-engineered TypeScript.
- Remove replaced names without aliases or a deprecation cycle.
- Use only the `@spine-event-engine/*` npm scope.
- Replace every live `ProjectionQuery` / `ProjectionColumn` API with
  `EntityQuery` / `EntityColumn`.
- Rename the public root/codegen exports, declaration files,
  `defineGeneratedEntityColumns`, generator/template imports, and executable
  `protoc-gen-spine-entity-columns`.
- Generate declared columns for Aggregate, Projection, and Process Manager
  state schemas.
- Execute every entity query through the shared durable current-record
  contract. Version, archived, and deleted values come from durable records.
- Preserve the existing `spine.client.Query` wire contract and current-state-
  only remote behavior. Add no remote history API.
- Remove residual Aggregate snapshot/replay/persistence-applier accommodation.
- Update end-user guide, package/API docs, executable snippets, examples, API
  inventory, and frozen-JVM delta audit.
- Packaging/deployment and live TS/JVM compatibility remain Wave 3.
- Human-facing administration remains Wave 4.
- Preserve unrelated files and never modify `human-review-1-jul.md`.
- Push `origin` immediately after every commit.

## Ownership and Implementation Slices

One bounded existing implementer owns overlapping client/codegen/query,
storage query seam, server execution, examples, and documentation paths. It
may not spawn children, commit, push, or merge.

1. Public/codegen atomic rename and executable replacement, with negative
   residual-symbol/entrypoint fixtures and deterministic generation.
2. Generic declared-column generation for Aggregate, Projection, and Process
   Manager schemas.
3. Shared durable current-record query execution for all three entity kinds,
   including version/lifecycle columns and unchanged wire semantics.
4. Guide/package/API/example migration, executable snippets, frozen-JVM delta
   audit, and Wave 2 status reconciliation.

## Acceptance Criteria

- No live public Projection-query/column symbol, helper, declaration,
  executable, import, template, example, or guide claim remains.
- `EntityQuery`, `EntityColumn`, `defineGeneratedEntityColumns`, and
  `protoc-gen-spine-entity-columns` are the only supported public names.
- Positive/negative declaration fixtures prove root and `./codegen` exports
  and removed entrypoints.
- Generated columns compile and execute for Aggregate, Projection, and Process
  Manager state schemas.
- All operators, ordering, limits, masks, lifecycle filters, and durable
  versions execute through shared current records for every entity kind.
- The Query Proto contract is byte-for-byte unchanged and no history route is
  exposed.
- User guide and package/API docs contain current compilable snippets for
  generic queries and the completed current/history storage model.
- Every relevant frozen JVM delta is dispositioned; Wave 2 deferrals remain
  explicit.
- Focused generation/declaration/client/storage/server/example tests, full
  native verification with at least 90% branches, all four specialist lanes,
  and final security review are clean.

## Planning Gate

- Existing role: `requirements_splitter`.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields must be explicit in dispatch. The role is read-only and must
  return the smallest dependency-ordered implementation split, exact public
  rename inventory, durable query seam, behavior tests, reviewer relevance,
  and any real blocker without editing or spawning children.

## Implementation Assignment

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit before dispatch. The owner works only in the
  isolated T-0072 worktree and may not spawn children, commit, push, or merge.

## Review and Verification

Mechanical scans, deterministic generation, declaration checks, focused tests,
typecheck, lint, formatting, docs/API checks, and provider-backed query
integration run before review.

All canonical specialist concerns apply:

- style/maintainability: naming atomicity, module depth, generator cohesion,
  shared execution structure, and removal of temporary paths;
- documentation: guide/package/API/example accuracy and executable snippets;
- TypeScript/API: root/subpath declarations, generic types, removed symbols,
  generated declarations, and compatibility surface;
- performance/reliability: durable authority, provider pushdown, finite
  materialization, ordering/limits, lifecycle/version correctness, restart and
  concurrency behavior.

The final Wave 2 security reviewer must explicitly disposition generated-code
trust, query validation/resource bounds, provider parameterization, lifecycle
data exposure, and the unchanged remote boundary.

## Accepted Evidence

- All four specialist lanes are CLEAN after correction and bounded re-review.
- Final security review is CLEAN.
- Definitive native verification passed: 130 files / 2,466 tests; 3 files / 25
  opt-in tests skipped.
- Coverage passed: statements 94.08%, branches 90.02% (8,018/8,906),
  functions 94.47%, and lines 94.76%.
- Typecheck, lint/cleanup, format, TypeDoc/API inventory, Proto
  source/descriptors/generated cleanliness, and release readiness passed.
- Task commit: `608fb80a`.
- Merge commit: `69d43c0a`.
- Post-merge deterministic formatting correction: `74d0192a`.
- Post-merge cancellation reliability correction: `bfa2418f`.
- Definitive post-merge verification on `bfa2418f`: 130 files / 2,466 tests
  passed; 3 files / 25 opt-in tests skipped; statements 94.08%, branches
  90.02% (8,018/8,906), functions 94.47%, lines 94.76%.
- Typecheck, lint/cleanup, format, TypeDoc/API inventory, Proto integrity and
  generated cleanliness, and release readiness passed.
- `task/T-0072-generic-entity-query` and the verified `main` endpoint are
  pushed to `origin`. T-0072 and Wave 2 are durably closed.
