# T-0068: JVM Feature Parity — Wave 2 Planning

Status: Complete

## Objective

Produce the execution-ready Wave 2 parity matrix and four-milestone plan for
recent state/event history, high-level Aggregate and Process Manager queries,
and the workspace-wide `@spine-event-engine/*` package-scope migration. Once
accepted, autonomous implementation continues through review, integration,
verification, and remote synchronization.

## Classification

High-risk. Wave 2 changes public TypeScript APIs, package identities, persisted
storage contracts and layouts, repository dispatch semantics, event-history
idempotency behavior, generated column code, query execution, and all supported
storage adapters.

## Human-Imposed Requirements Ledger

- Target behavioral and conceptual Spine JVM parity with idiomatic TypeScript;
  do not copy JVM internals blindly or invent over-engineered abstractions.
- There are no real-world consumers. Remove replaced names and layouts without
  deprecation aliases or migration compatibility.
- Node.js remains the only supported environment.
- Recent state history applies to Projections, Aggregates, and Process
  Managers. It is opt-in and off by default.
- Recent event history applies to Aggregates and Process Managers. Aggregate
  history is always recorded; Process Manager history is opt-in and off by
  default. Rejection events are excluded.
- History is an entity/repository facility, not a remote client history API.
- TypeScript history reads are asynchronous, immutable, and newest first.
- Match JVM same-batch visibility and runtime recording-switch behavior.
  Document that runtime switching is not designed for routine use.
- Retain history until explicit `trim(entityId, keepMostRecent)` or
  `truncate(olderThan)` maintenance.
- Include the opt-in double-dispatch guard and configurable inspection depth.
- Generalize Projection Query/column APIs for every queryable entity kind.
- Rename every live workspace package to `@spine-event-engine/*`, with no
  `@spine-ts/*` compatibility packages or aliases. Keep pnpm as package manager.
- Apply the namespace migration first.
- After the common history storage contract is frozen, Datastore and RDBMS
  adapter implementation may proceed in parallel with isolated, non-overlapping
  ownership.
- Planning review is limited to public API/contract and
  persistence/reliability concerns. Style and documentation are N/A until
  implementation creates reviewable material.
- Push every commit to `origin` immediately after it is created.
- Preserve unrelated dirty files and never modify `human-review-1-jul.md`.
- Wave 3 retains packaging/deployment and live TS/JVM compatibility tests.
- Wave 4 retains human-facing delivery administration.

## Approved Execution Shape

1. Package namespace migration.
2. Shared latest-state and recent-history storage foundation, followed by
   parallel Datastore and RDBMS adapter slices.
3. Repository cutover: remove Aggregate snapshot/event reconstruction, converge
   every entity kind on latest-state records, then add histories and the
   double-dispatch guard.
4. Generalized Entity Query DSL, documentation, upstream audit, and Wave 2
   closure.

Each milestone uses one stable implementation owner for its overlapping files,
test-first behavior slices, focused mechanical checks before review, one
complete relevant review wave, one aggregated correction batch, affected-lane
re-review only, one final full gate, immediate push after every commit, and
tree-equality plus focused post-merge checks unless integration risk requires a
second full gate.

## Planning Deliverables

1. A current authoritative JVM-source parity matrix with TypeScript
   adaptations and explicit deferrals.
2. Exact public and storage seams, configuration semantics, maintenance
   operations, and query terminology.
3. Dependency-ordered task briefs with behavior-focused acceptance criteria,
   TDD slices, ownership, reviewer relevance, and verification cadence.
4. A strategy for parallel adapters that freezes their shared contract first
   and prevents overlapping writes.
5. Updated completion-plan frontier, work/review records, and unresolved
   questions, if any.

The execution-ready deliverable is
`build-protocol/planning/WAVE_2_JVM_PARITY_PLAN.md`.

## Requirements-Splitter Assignment Gate

- Existing role: `requirements_splitter`.
- Scope: read-only analysis of current Spine TS and authoritative current
  `core-java`; produce the planning recommendations and exact task split. Do
  not edit files, implement code, commit, push, or spawn children.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields must be explicit in dispatch. Actual runtime metadata is recorded
  when exposed; otherwise the immutable configured role/profile and limitation
  are recorded honestly.

## Skill Applicability

- Selected by the orchestrator: `using-git-worktrees`,
  `subagent-driven-development`, `test-driven-development`,
  `requesting-code-review`, and `verification-before-completion`.
- The subagent-driven-development skill's blanket prohibition on parallel
  implementers is superseded by the repository protocol and the human's
  explicit approval for isolated, non-overlapping Datastore and RDBMS slices.
- No production implementation begins before the plan is reconciled and its
  required planning concerns are reviewed.
