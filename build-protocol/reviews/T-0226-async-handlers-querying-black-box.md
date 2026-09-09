# T-0226 Async Handlers, Process Manager Queries, And BlackBox Signals Review

Task: `build-protocol/tasks/T-0226-async-handlers-querying-black-box/TASK.md`
Branch: `feature/async-handlers-querying-black-box`
Baseline: `437cafcf380da33222d852f86a802200ef5ddc41`
Implementation checkpoint: `b3f56720e`
Diff basis: `git diff origin/master...b3f56720e`
Worktree: `.worktrees/t-0226`

## Pre-review state

- Worktree is clean after restoring baseline-only generated IDs.
- `git diff --check origin/master...HEAD` passes.
- Focused implementation evidence is recorded in the task work log.
- The human-imposed requirements ledger is frozen in the task brief.
- The complete affected-scope preflight passed: generated builds, strict
  TypeScript, repository policy, TSDoc, copyright, formatting, docs/TypeDoc,
  Proto, dependency/readiness checks, and 490 focused tests.

## Review assignments

| Concern                        | Existing role                      | Explicit profile        | Status                                    |
| ------------------------------ | ---------------------------------- | ----------------------- | ----------------------------------------- |
| Code style and maintainability | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high  | `/root/t0226_style_review` complete       |
| TypeScript/API documentation   | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high  | `/root/t0226_api_review` complete         |
| Performance and reliability    | `performance_reliability_reviewer` | `gpt-5.6-terra` / high  | `/root/t0226_reliability_review` complete |
| Reader documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium | `/root/t0226_docs_review` complete        |
| Security and tenant boundary   | `security_reviewer`                | `gpt-5.6-terra` / high  | `/root/t0226_security_review` complete    |

Every reviewer is read-only, may not spawn subagents, and must inspect the
human-imposed requirements ledger. The Desktop surface does not expose separate
live self-introspection; the immutable role profile and explicit dispatch are
the available runtime metadata.

## Canonical dispositions

- Code style/maintainability: findings; two P1 and one P2.
- Documentation completeness: findings; two P1 and two P2.
- TypeScript/API docs: findings; one P1 and two P2, with documentation overlap.
- Performance/reliability: findings; three P1.
- Security: findings; one P1 duplicated with reliability. Tenant,
  external-event, deserialization, logging, dependency, and secret checks are
  otherwise clean.

## Findings and author response

The complete five-lane wave is accepted as one deduplicated correction batch:

- P1: restore BlackBox lifecycle-test construction after observation became
  mandatory.
- P1: verify Promise symbol provenance so shadowed/imported arbitrary types are
  not treated as the built-in Promise.
- P1: exclude rollback-path rejection Events from committed BlackBox history.
- P1: preserve core query predicate, mask, ordering, and registered-column type
  constraints through the Process Manager facade.
- P1: share cycle, depth, and node-count guards with query plan compilation.
- P2: keep the generator-only columns helper out of the core root API.
- P2: add beginner package documentation for the new APIs.
- P2: move canonical query behavior tests to the core package, leaving
  client-node compatibility tests in client-node.
- P1: add beginner async-handler and Process Manager query workflows to the
  main user guide and server README, including transaction duration/rejection,
  eventual consistency, Aggregate exclusion, and the 1,000-result bound.
- P1: add the BlackBox external-event and produced-snapshot workflow to the
  testing README, including included/excluded signals and call-time timing.
- P2: add the typed query example, result ceiling, and `all()` cost warning to
  the server reference; update the core entrypoint inventory and compatibility
  forwarding explanation after the generator-only export is corrected.

All findings are task-scope and accepted. No P0 was reported. The duplicated
typed-query and shadowed-Promise findings are fixed once each. The existing
implementation owner receives this whole batch; re-review is limited to
substantively affected concerns after focused mechanical evidence is clean.

The first correction checkpoint `45b57685f` closes the BlackBox lifecycle-test
P1 with a testing-only no-op observation handle and 3/3 focused tests. The
owner's execution window then ended cleanly. A fresh existing `implementer`
continues the remaining frozen batch with explicit `gpt-5.6-terra` / medium
profile, no subagents, and no overlapping production writer.

## Author correction response

- Promise provenance: resolved by checking the TypeScript type symbol's
  standard-library declaration, preserving aliases while rejecting local and
  imported lookalikes; focused analyzer regression passed.
- Query bounds and facade types: resolved by making `buildPlan()` validate via
  the existing iterative traversal and forwarding builder argument constraints
  without `as never`; focused query regression and affected builds passed.
- Produced-event capture: rejection dispatch now has an explicit publisher
  path that bypasses produced-event observers; focused publisher regression
  passed. A test-owned Project BlackBox fixture now proves its asynchronous
  `@Assign` rejection reaches a typed test dispatcher but leaves `assertEvents()`
  unchanged; public examples remain synchronous and cleanup-compliant.
- Generator containment, canonical core-test relocation, and reference/prose
  corrections are implemented; client-node retains compatibility/export tests.
- Process Manager facade predicates now preserve the builder's method-level
  generic inference through `EntityQueryPredicateFor`; the actual Projection
  and Process Manager registered-column predicates compile under strict tooling
  checks without weakening the existing negative cases.

The correction tree converges through `31df88c1a`. The expanded preflight
passes every generated/strict build and deterministic policy, documentation,
Proto, and readiness gate plus 442 focused tests across 10 files. A second and
final targeted review wave rechecks every substantively affected concern.

## Targeted review round 2

Frozen implementation: `31df88c1a`

| Concern                 | Reviewer                     | Explicit profile        | Status   |
| ----------------------- | ---------------------------- | ----------------------- | -------- |
| Style/maintainability   | `/root/t0226_style_r2`       | `gpt-5.6-terra` / high  | Complete |
| TypeScript/API docs     | `/root/t0226_api_r2`         | `gpt-5.6-terra` / high  | Complete |
| Performance/reliability | `/root/t0226_reliability_r2` | `gpt-5.6-terra` / high  | Complete |
| Reader documentation    | `/root/t0226_docs_r2`        | `gpt-5.6-luna` / medium | Complete |
| Security                | `/root/t0226_security_r2`    | `gpt-5.6-terra` / high  | Complete |

All round-two reviewers are read-only, cannot spawn subagents, and recheck only
their accepted findings plus P0-P2 regressions introduced by the corrections.
The explicit role profiles are the available immutable runtime metadata.

Round two reports no P0. Security is clean; Promise provenance, rollback
capture, lifecycle implementation, query-plan implementation, test ownership,
generator containment, and the original documentation content findings close.
One P1 and the accepted P2 evidence/usability findings form the final targeted
correction batch:

- P1: replace `Parameters<EntityQueryBuilder["orderBy"]>` with an explicit
  generic forwarding signature so equality-only columns remain compile-time
  errors while valid orderable columns infer correctly.
- P2: exercise the node-count limit through `buildPlan()` and add Process
  Manager-path cycle, depth, and node-count rejection proofs before Stand read.
- P2: make the lifecycle seam expose a close spy and prove the real observation
  handle closes once even when other cleanup fails.
- P2: remove the duplicated 285-line client-node fixture; use a small
  compatibility-only fixture or one canonical source.
- P2: make the server/testing README examples standalone snippet-checkable and
  add the requested typed code example to the server reference.
- P2: add TypeDoc/API-inventory coverage for the new `core/codegen` subpath and
  the preserved `client-node/codegen` compatibility subpath.

This is the second complete wave. After the batch, only the remaining P1's API
concern is re-reviewed; deterministic checks close the accepted P2 findings.

The round-two owner pushed the `orderBy()` P1 fix, direct `buildPlan()` node
test, observer-close proof, fixture deduplication, and runnable README snippets.
Its execution window ended while validating an uncommitted TypeDoc entrypoint
and server-reference example draft. A fresh existing `implementer` with explicit
`gpt-5.6-terra` / medium profile receives the intact draft and the remaining
Process Manager guard-path tests; it may not spawn subagents.

The final correction tree is pushed through `6f01138b5`. All accepted P2 items
have focused deterministic evidence. `/root/t0226_api_final`, the existing
`typescript_api_docs_reviewer` role with explicit `gpt-5.6-terra` / high
profile, performs the sole focused re-review of the remaining `orderBy()` P1.
It is read-only and may not spawn subagents.

The focused review closes valid inference, equality-only rejection,
foreign-schema rejection, TypeDoc inventory, and TSDoc, but keeps the P1 open:
a separately registered same-schema column outside the selected `Columns`
collection still compiles and fails only at runtime. Both the canonical builder
and Process Manager facade must constrain `Column` to `Columns[keyof Columns]`
while retaining the orderable-column conditional. A public consumer
`@ts-expect-error` pins the non-selected same-schema case before the same API
concern is checked again. No complete review wave reopens.

Correction `9284db9cd` constrains both canonical and Process Manager ordering
generics to `Columns[keyof Columns]` while retaining the orderability
conditional and runtime ownership check. RED observed unused negative
directives for the omitted same-schema column; GREEN proves selected orderable
acceptance and rejection of equality-only, foreign-schema, and unselected
same-schema columns. `/root/t0226_api_final` rechecks this P1 only under its
previously explicit `gpt-5.6-terra` / high role profile.

The focused closure review reports no P0-P2 and closes the last P1. Both source
and emitted declarations enforce selected-column membership and orderability;
all four public compile cases pass, the runtime ownership guard remains, and 38
focused tests plus TSDoc/API inventory are clean. Review is converged: all P1
and accepted P2 findings are resolved, security is clean, and no third complete
wave was run.

## Human-Requested Independent Review Reset

The human requested two additional consecutive review rounds with no reviewer
memory. Each assignment uses `fork_turns: none` and receives only repository
paths, the fixed comparison `origin/master...HEAD`, and the task contract. Every
confirmed finding is fixed and verified after round one before round two starts.

Estimated remaining effort: 3-6 active agent-hours, plus approximately 20-45
minutes of elapsed verification time per correction cycle. This includes five
specialist lanes per round, aggregation, all confirmed fixes, focused and
release-proportionate verification, pushes, and final records.

Round one assignments at endpoint `5e51662b4`:

| Concern                        | Existing role                      | Explicit profile        | Memory |
| ------------------------------ | ---------------------------------- | ----------------------- | ------ |
| Style and maintainability      | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high  | None   |
| TypeScript and public API      | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high  | None   |
| Performance and reliability    | `performance_reliability_reviewer` | `gpt-5.6-terra` / high  | None   |
| Reader documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium | None   |
| Security and tenant boundaries | `security_reviewer`                | `gpt-5.6-terra` / high  | None   |

All reviewers are read-only senior specialists and may not spawn subagents.
Desktop exposes the immutable configured role/profile and explicit dispatch
fields, but no additional live self-introspection metadata.

### Independent round one result

All five independent reviewers completed without prior-turn memory. Security
reported no P0-P2 findings. The other four lanes reported the following single
deduplicated correction batch; every item is accepted:

- P1: carry the selected Entity's identifier type through the Process Manager
  query facade and canonical builder so wrong primitive and message identifier
  shapes fail at compile time.
- P1: enforce the documented deterministic maximum of 1,000 returned Entities
  for Process Manager reads instead of relying on the storage candidate-budget
  error.
- P2: reject an identifier list larger than the same 1,000-item budget before
  cloning or serializing its values, with a Process Manager-path regression.
- P2: clear captured Commands and Events when a BlackBox closes, including
  cleanup paths where another close operation fails.
- P2: replace repository tests that post an Entity state as a Command with a
  domain-correct generated Command fixture.
- P2: make the compile-time Process Manager query example select a Projection
  state rather than selecting another Process Manager state.
- P2: document the canonical query builder and generated-column API in the core
  README, including the generator-only import path.
- P2: document that async handlers accept exactly one built-in `Promise<T>`
  layer and reject nested Promises and thenable lookalikes.
- P2: replace the server README's standalone query-shaped object with a minimal
  Process Manager handler example that demonstrates the protected workflow.

The round-one correction owner is the existing `implementer` role, dispatched
explicitly with `gpt-5.6-terra` / medium reasoning and no inherited turn memory.
It is the sole production-code writer, may not spawn subagents, and owns this
entire batch. The immutable role profile and explicit dispatch fields are the
available runtime metadata.

### Independent round-one correction work log

- Typed query ID filters now derive their accepted identifier from the selected Entity state
  schema. Core and Process Manager public compile fixtures reject a wrong primitive; core also
  rejects a generated-message shape for a string ID.
- `byId()` rejects more than 1,000 values before it appends, clones, or serializes them. Process
  Manager reads cap their returned immutable snapshots at 1,000, while the repository raises its
  candidate scan budget so a 1,001-result read resolves with the documented deterministic cap.
- BlackBox cleanup clears captured command and event arrays in a `finally` after observation close,
  so cleanup failures cannot retain captured signals.
- Core, server, and user/reference documentation now describe the canonical query builder and
  generator-only `/codegen` subpath, exactly one built-in Promise layer, and a real protected
  Process Manager query handler workflow.
- Evidence: `pnpm typecheck:build` passed; `pnpm docs:snippets:check` passed; focused Vitest
  coverage across core query, server repository/routing, and BlackBox lifecycle tests passed
  312/312; Prettier and `git diff --check` passed.

### Mandatory fixture correction

- The previously open state-as-command finding is closed. The idless command, context-routing,
  Process Manager, projection-routing, and inbox-negative fixtures now post generated
  `TaskCommand` messages. Dedicated repositories intentionally register `TaskCommand` handlers so
  the tests still prove missing command-envelope IDs reject before routing, handler invocation,
  and state writes. The generic inbox ID reader accepts its existing Aggregate-state fixtures and
  the new generated command fixture without conflating their domain message types.

### Strict task-gate correction

- The typed-ID invalid-input runtime regression now uses `undefined as never` only at the single
  intentional invalid call; the public `byId()` signature remains identifier-typed.
- The Process Manager cap fixture selects `ProjectionStateSchema` and its registered projection
  columns. Its generic executor rejects a non-projection schema before returning the typed
  projection snapshots.
- Exact evidence: `pnpm verify:task -- --no-coverage packages/core/test/query/entity-query.test.ts
packages/server/test/repository/repository-routing.test.ts
packages/server/test/repository/repository.test.ts packages/testing/test/black-box.lifecycle.test.ts`
  passed every deterministic gate and 312/312 focused tests. One prior unchanged-tree attempt had
  a single unrelated default-timeout routing test; the permitted one-time rerun passed unchanged.

### Independent round two assignments

Frozen endpoint: `99f327726`

Round two starts only after every round-one finding is closed and the exact
task gate passes. These are new reviewer contexts with no inherited turns or
round-one finding list:

| Concern                        | Existing role                      | Explicit profile        | Memory |
| ------------------------------ | ---------------------------------- | ----------------------- | ------ |
| Style and maintainability      | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high  | None   |
| TypeScript and public API      | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high  | None   |
| Performance and reliability    | `performance_reliability_reviewer` | `gpt-5.6-terra` / high  | None   |
| Reader documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium | None   |
| Security and tenant boundaries | `security_reviewer`                | `gpt-5.6-terra` / high  | None   |

All round-two reviewers are read-only senior specialists, may not spawn
subagents, and receive only the task contract, repository rules, fixed
`origin/master...99f327726` diff, and their concern. Desktop exposes the
immutable role profile and explicit dispatch fields, but no additional live
self-introspection metadata.

### Independent round two result

All five fresh reviewer contexts completed. Security reported no P0-P2
findings. The complete accepted correction batch is:

- P1: include committed Events produced by Aggregate event-reactor handlers in
  `BlackBox.assertEvents()` exactly once and in production order, while keeping
  ordinary stored-event replay excluded.
- P2: stop exporting the raw storage-neutral `EntityQueryPlan`, predicate, and
  `buildPlan()` execution bridge from the public core root. Move it behind a
  deliberate internal/server-facing subpath while keeping the typed query DSL
  and wire-query construction public.
- P2: make both accepted `Promise<void>` `@Subscribe` analyzer fixtures valid
  asynchronous TypeScript implementations, not syntax-only false positives.
- P2: update public `ProcessManager` TSDoc that incorrectly says the class adds
  no query client; describe the restricted handler-scoped read-only capability.
- P2: document the `EntityQuery.all(...)` and `EntityQuery.either(...)`
  predicate combinators in the Process Manager query workflow.
- P2: document that Process Manager queries are bound to the active handler's
  actor and tenant and offer no tenant override.

The round-two correction owner is the existing `implementer` role, dispatched
explicitly with `gpt-5.6-terra` / medium reasoning and no inherited turn
memory. It is the sole production-code writer, may not spawn subagents, and
owns this entire batch. The immutable role profile and explicit dispatch
fields are the available runtime metadata.

### Independent round-two correction work log

- Aggregate reactor follow-up Events now use a dedicated committed stored-follow-up publisher path:
  it retains stored follow-up dispatch while notifying BlackBox produced-signal observers exactly
  once. Repository reactor regression coverage was RED under ordinary committed-event dispatch and
  GREEN after the dedicated path.
- Raw query-plan types no longer export from the core root. A deliberate
  `@spine-event-engine/core/internal/entity-query-plan` subpath supplies the server-facing bridge.
- Both accepted Promise<void> Subscribe analyzer fixtures are real async implementations. Process
  Manager TSDoc and reader docs now describe protected handler-scoped reads, actor/tenant binding,
  no override, and `all`/`either` combinators.
- Evidence so far: repository routing 269/269, analyzer suite 52/52, generated strict build, and
  tooling typecheck pass.

## Final P2 correction response

- The final implementer used the explicitly dispatched existing `implementer`
  profile, `gpt-5.6-terra` / medium reasoning. Desktop does not expose further
  live model metadata.
- The direct Process Manager tests are complete. Cyclic, 66-level, and
  10,001-node predicate graphs pass through a real handler's
  `select().where().read()` path. The fixture records the compiler rejection,
  while `QueryReader.observe` records zero reads in every case. Command intake
  deliberately resolves after rejection dispatch, so the fixture captures the
  internal handler error rather than asserting an incorrect rejected bus
  promise. No production runtime change was needed.
- TypeDoc entrypoints and deterministic inventories now cover exact exports of
  `@spine-event-engine/core/codegen` and
  `@spine-event-engine/client-node/codegen`. The preserved client value uses a
  typed core identity export so TypeDoc includes it.
- The server reference includes a standalone strict TypeScript Process Manager
  query example and its focused snippet check passes. It describes the 1,000
  ceiling and `all()` projection cost.
- Mechanical evidence: focused repository/core query tests pass 283/283;
  affected strict and generated builds, TypeDoc inventory, focused snippet,
  lint, cleanup, copyright, formatting, production-dependency, and diff checks
  pass. Repository-wide snippets still fail on unrelated unresolved package and
  example imports. The task-scope `ProcessManagerQuery.orderBy` TSDoc now
  documents its explicit `column` and `direction` parameters, and `pnpm
lint:tsdoc` passes. The snippet limitation does not alter the final P2
  correction behavior.

The focused API P1 re-review is still required and is intentionally not run in
this correction context.

## Final API P1 correction response

The explicit generic forwarding signatures for canonical
`EntityQueryBuilder.orderBy()` and `ProcessManagerQuery.orderBy()` now bind
`Column` to `Columns[keyof Columns]` and retain the conditional that excludes
equality-only columns. Existing runtime `requireOwnedColumn()` validation is
unchanged. Compile-only public consumers prove valid selected ordering and
rejection of selected equality-only, foreign-schema, and same-schema omitted
columns; the Process Manager facade has its corresponding selected/omitted
proof. Strict tooling, core/server builds, 283 focused query/repository tests,
TSDoc, and API inventory checks pass. Focused API P1 re-review remains the next
step and is intentionally not run in this correction context.
