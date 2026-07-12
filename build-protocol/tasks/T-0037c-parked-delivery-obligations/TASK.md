# T-0037c: Parked Delivery Obligations

Status: Round 2 targeted re-review assigned

Started: `2026-07-12T17:05:11Z`

Baseline commit: `c65f2c23`

Branch: `task/T-0037c-parked-delivery-obligations`

This `Status` header is canonical for T-0037c. Its work and review logs are
derived mirrors and must match it before review.

Dependency: T-0037b complete and integrated.

## Objective

Add the finite package-internal operational-obligation and cause-reporting
model required to retain rejected generation work without unbounded history,
duplicate reporting, or premature lifecycle ownership decisions.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep the implementation/review package small and limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using TDD.
- Do not assign duplicate authors or reviewers for the same role, and close
  every participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before its work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions instead of preserving them, and invent
  no abstraction without corresponding Spine JVM evidence.
- Before server-module implementation, inspect and record the relevant Spine
  JVM `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review.
- Run all four independent review lanes until clean; defer security review to
  final project readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final child
  acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Preserve D-0085's distinction between unresolved operational work and
  one-time cause reporting.
- Keep every record/key/helper package-internal. Commit no generated artifacts
  and make no root/public export or API change; emitted internal declarations
  may change. Add no example, environment option, or public API docs.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns the canonical finite record table and pure/internal operations
to park, coalesce, supersede, reclassify, select, report, and consume rejected
obligations. Truthful keys are limited to registration plus configured
shard/obligation scope, generation plus configured shard, and at most one
generation-spanning shared record. The table retains one representative cause,
report state, one bounded reported-since-resolution flag, and a saturating
occurrence count per canonical record.

T-0037c may use synthetic owner tokens in tests. It does not create or remove
real environment registrations. T-0037d, T-0037e1, T-0037e2, and T-0037e3
consume parked obligations; T-0037f integrates their outputs where server
lifecycle ordering requires them.

## Planning Assignment

This milestone changes bounded operational ownership, failure cardinality, and
one-time reporting semantics, so the existing requirements-splitter role is
assigned once at the milestone boundary. Expected explicit profile is
`gpt-5.6-sol` / `high`. It must not edit files or spawn subagents. Its output
must narrow this task without adding public policy or work owned by T-0037d and
later children.

Both explicit Sol High planning dispatches were rejected because the execution
surface did not expose actual child model/reasoning metadata. Their substantive
outputs are not accepted task authority. The existing accepted task and
completion-plan TDD contracts are already implementation-ready, so no third
planning pass is justified.

## Implementation Assignment

One existing implementer owns the bounded table, focused tests, narrow current
architecture wording, and durable records under explicit expected
`gpt-5.6-terra` / `medium`. It must use TDD, keep T-0037b coordinator production
code unchanged unless a proved acceptance blocker requires otherwise, and add
no public export or later-lifecycle ownership.

## Pre-implementation Record

- `2026-07-12T17:40:00Z`: Replacement sole implementation owner began
  independent verification of the preserved unaccepted patch before accepting
  or editing runtime code. Canonical skill-applicability evidence: the session
  inventory and user-provided Skills list, repository manifest
  `build-protocol/skills/EXPECTED_SKILLS.md`, full bounded command
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`,
  and readable `/Users/armiol/.agents/.skill-lock.json` were inspected.
  Fully read selected skills are `test-driven-development`,
  `verification-before-completion`, `javascript-testing-patterns`,
  `domain-modeling`, and `codebase-design`. They apply respectively to any
  correction's RED/GREEN evidence and final claims; focused Vitest behavior
  tests; D-0085's distinct obligation and reportable-cause terms; and this
  table's small package-internal seam. `planning-with-files` is N/A because
  its root plan files exceed exact ownership while these canonical records are
  durable; `tdd` duplicates the selected TDD workflow; `typescript-advanced-types`
  and `nodejs-backend-patterns` are N/A to this finite, non-public in-memory
  table; and worktree/review/subagent skills are N/A because the task already
  assigns this worktree and prohibits the implementer from spawning subagents. No skill
  source was unreachable and no library is needed. Project protocol and task
  scope override skills where they differ. Expected explicit dispatch is
  `gpt-5.6-terra` / `medium`. The coordinator's runtime role metadata fixes the
  implementer role to that actual profile; the child could not self-report it.
- `2026-07-12T17:42:51Z`: Independent focused RED added two behavior tests to
  the preserved test file. The parked-obligations suite failed as expected:
  report order followed rejection arrival rather than configured order, and
  colon-containing registration/obligation values collided in the old encoded
  key. The minimal correction now orders report selection through configured
  records (then the one shared record) and uses an unambiguous structured key.
- `2026-07-12T17:43:46Z`: A second independent RED proved that reclassifying a
  removed registration left its configuration live, allowing new work for a
  non-live owner. The correction deletes only that registration's configured
  obligations after reclassifying any retained record; generation and shared
  domains remain unchanged.
- `2026-07-12T17:45:30Z`: Replacement-owner focused gate is GREEN after the
  two independently observed RED/GREEN corrections. The five parked-table,
  coordinator, worker, worker-runtime, and loop suites passed 192 tests.
  `pnpm typecheck` regenerated ignored protobuf output, verified 25 copied
  proto checksums, and passed generated/build/tooling typechecks. Changed-file
  ESLint passed; Prettier initially reported the new runtime file and was run
  to format it, then its changed-file check passed; `git diff --check` and
  untracked-file whitespace checks passed. Status mirrors agree; scans found
  no root/package/README reference to the internal module and no generated
  file in status. No coordinator production source, root/package export,
  lifecycle/wiring/timing/monitor policy, generated artifact, or human-review
  file changed. The runtime source inspection command found
  `/private/tmp/spine-research/core-jvm` but no `Delivery.java` or
  `DeliveryMonitor.java` below it, so only the local task-relevant JVM notes
  informed scope. `pnpm verify` was intentionally not run.

- `2026-07-12T17:29:00Z`: Canonical skill-applicability check completed before
  production work. `test-driven-development` applies to every runtime slice;
  `javascript-testing-patterns` applies to focused Vitest behavior tests;
  `domain-modeling` applies to retaining the D-0085 distinction between an
  operational obligation and its reportable cause; and `codebase-design`
  applies to a single package-internal deep module. `planning-with-files` was
  considered but is not applied because its project-root plan files are outside
  this child's exact assigned files; the canonical task, work, and review logs
  are the durable planning records. No library is needed: this is a finite
  in-memory table, not common external infrastructure.
- Spine JVM guardrail: inspected
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` sections “Delivery”,
  “Delivery Run”, and “Failures and Retries”, which identify the corresponding
  `core-jvm/server` `Delivery.java`, `DeliveryMonitor.java`, and delivery
  package paths. The documented `/private/tmp/spine-research/core-jvm` source
  path is unavailable in this worktree environment, so source inspection could
  not supplement the local notes. Impact: preserve familiar configured-shard
  delivery concepts while adding no monitor, automatic retry, or policy API.
- The current execution surface provides no authoritative actual runtime
  model/reasoning metadata. The required explicit expected profile remains
  `gpt-5.6-terra` / `medium`; this record does not claim unavailable metadata.
- TDD evidence: the first focused RED run was
  `pnpm exec vitest run packages/server/test/delivery/parked-delivery-obligations.test.ts`;
  it failed because `parked-delivery-obligations.js` did not exist. The initial
  seven behavior tests are GREEN after adding only
  `packages/server/src/delivery/parked-delivery-obligations.ts`; they cover
  canonical coalescing/count saturation, independent one-time reporting,
  representative replacement, exact partial consumption, owner-removal
  reclassification, one shared record, and cause-less fulfilled `FAILED`.
  T-0037b coordinator production remains unchanged because this pure internal
  module provides the accepted seam without lifecycle integration.
- `2026-07-12T17:37:13Z`: Focused gate GREEN: parked-obligation, T-0037b
  coordinator, and delivery-worker suites passed 135 tests; `pnpm typecheck`
  completed generated, build, and tooling typechecks; changed-file ESLint and
  Prettier checks and `git diff --check` passed. Root export/package/README
  public-leak scans found no reference to the module. `pnpm verify` was not run
  under the explicit focused-gate instruction. Independent review is pending
  because the current sole-owner instruction prohibits spawning reviewers.
- `2026-07-12T17:38:52Z`: The implementation result is not accepted because
  actual child model/reasoning metadata was unavailable. Its uncommitted patch
  is preserved for one replacement explicit Terra Medium implementer to verify
  independently against this canonical task and correct as needed.
- `2026-07-12T17:49:11Z`: The coordinator accepted replacement implementer
  `019f576a-bcb4-7873-a350-1bed1f247810` with actual
  `gpt-5.6-terra` / `medium` from authoritative fixed-role runtime metadata;
  both explicit dispatch fields matched. Independent verification repeated five
  delivery suites and 192 tests, all typechecks, changed-file lint/format, and
  diff hygiene. Independent review remains required.

## Round 1 Findings

One Terra Medium fix owner must prove and resolve this complete deduplicated
batch before a fresh relevant review wave:

1. Select the representative for repeated same-record rejection by configured
   unit order, not arrival order, for normal and shared records.
2. When exact successful re-evaluation consumes the representative's unit,
   discard that cause rather than later reporting a cause for resolved work.
3. Reclassify owner removal atomically across plural canonical generation
   destinations; failure must lose neither records nor owner configuration.
4. Validate caller-supplied occurrence increments as positive safe integers
   before any mutation, so saturation never produces `NaN` or fractions.
5. Preserve and report `undefined` as a legitimate rejected cause using cause
   presence separate from the cause value, for normal and shared records.
6. Implement the accepted exact selected-reporting/consumption contract rather
   than reporting every record unconditionally; unselected unresolved records
   and causes must remain untouched.
7. A fulfilled `FAILED` re-evaluation must consume prior rejected state for the
   exact units before retaining cause-less operational work.

Findings 1-5 were independently confirmed across the four specialist lanes;
6-7 are coordinator task-contract findings from the accepted Exact Ownership
and TDD Acceptance text. No public or later-lifecycle expansion is authorized.

- `2026-07-12T17:58:00Z`: The sole Round 1 fix owner read the complete
  authoritative seven-finding batch and matching work/review records before
  edits. `receiving-code-review` applies to technical verification of the
  fixed batch; `test-driven-development` applies to seven focused RED cases
  before production correction; and `verification-before-completion` applies
  to the focused gate. Each finding is technically reproducible from the
  current table: arrival wins within one record; partial fulfillment retains
  its representative; owner removal mutates before destination failure and
  selects only one destination; occurrence input is not validated; cause
  value doubles as presence; `report()` cannot select; and fulfilled `FAILED`
  does not supersede rejected state. No coordinator production edit or public
  interface is justified. Expected fixed runtime role remains
  `gpt-5.6-terra` / `medium`.
- `2026-07-12T18:00:40Z`: Complete-batch RED evidence: the parked-obligations
  suite ran 23 tests with 13 expected failures spanning every accepted finding.
  Failures showed arrival-selected normal/shared causes, reporting after exact
  representative consumption, non-atomic/single-destination reclassification,
  six invalid occurrence values accepted, absent explicit presence for two
  `undefined` causes, unconditional reporting of an unselected record, and
  fulfilled `FAILED` retaining the prior cause/count. Only after this RED was
  observed was the bounded table implementation changed.
- `2026-07-12T18:04:19Z`: Complete-batch GREEN and focused regression evidence:
  the parked table plus coordinator, worker, worker-runtime, and loop suites
  passed 5 files / 205 tests. `pnpm typecheck` regenerated ignored protobuf
  output, verified all 25 copied proto checksums, and passed generated/build
  plus tooling typechecks. The fix remains package-internal and limited to the
  parked table/test and T-0037c records: no coordinator production edit,
  lifecycle wiring/policy, public export, generated artifact, or human-review
  edit. Full `pnpm verify` remains reserved for final acceptance. Expected fixed
  runtime role remains `gpt-5.6-terra` / `medium`.
- `2026-07-12T18:06:28Z`: Independent coordinator verification repeated the
  five delivery suites and 205 tests, generated/build/tooling typechecks,
  changed-file ESLint/Prettier, and `git diff --check`. The complete fix batch
  is accepted for a fresh targeted review package.

## Likely Files

- A new package-internal parked-obligation module under
  `packages/server/src/delivery/`
- T-0037b coordinator integration only where settled/rejected evidence enters
  or resolves the table
- Focused parked-obligation and coordinator tests
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Repeated rejection cardinality cannot grow record keys, scope arrays, or
  retained causes beyond D-0085's configured owner/shard bound and one shared
  record.
- Occurrence counts saturate at `Number.MAX_SAFE_INTEGER`; deterministic
  configured-shard and settled-cause order selects one representative.
- Reporting marks exactly selected unreported representatives atomically;
  reported causes never surface twice, while unresolved obligations remain.
- A later rejection after reporting installs at most one new representative in
  the same record without retaining error history.
- Matching successful re-evaluation consumes only actually re-evaluated units;
  omitted, stopped, unrelated, and partially covered broader scopes remain.
- Reclassification after owner removal coalesces into canonical destinations
  without arbitrary subset keys or duplicate causes.
- Fulfilled `FAILED` creates disposition/readiness obligation only and retains
  no cause record.

## D-0085 Invariants

- Rejection is parked until later external readiness; no immediate restart.
- Operational resolution and cause reporting are independent.
- Memory is bounded by live registrations/configured shards plus one shared
  record, not rejection count.
- Durable rows and retained delivery attempts remain diagnostics; no public
  monitor, health, dead-letter, or error-history surface is introduced.

## Explicit Exclusions

No real registration cardinality, startup recovery/rollback, environment
attachment, generation retirement, close ordering, server integration, retry
timing, public API, or T-0036 loop/worker change belongs here.

## Focused Gate

Parked-obligation tests, T-0037b coordinator tests, delivery worker regressions,
generated and tooling typechecks, changed-file lint/format, diff hygiene,
public-leak scan, relevant four-concern review dispositions, then final full
`pnpm verify` and post-merge verification.
