# T-0037e3: Permanent Environment Close

Status: Slice 1 fix re-review assigned

Started: `2026-07-13T12:48:44Z`

Baseline commit: `2f2ae456`

Branch: `task/T-0037e3-permanent-environment-close`

Worktree: `.worktrees/T-0037e3-permanent-environment-close`

Dependency: T-0037e2 complete and integrated.

This `Status` header is canonical for T-0037e3. Its work/review logs are
derived mirrors and must agree before review.

## Architecture Assignment And Skill Applicability

- Existing role: requirements splitter. Initial documentation-only ownership was
  limited to this task, its architecture resolution, work log, and review log;
  the recorded authority turn expands only to the three named active authority
  sections. Expected dispatch was explicit `gpt-5.6-sol` / `high`; no subagents
  are permitted.
- Coordinator runtime evidence: `/Users/armiol/.codex/sessions/2026/07/13/rollout-2026-07-13T13-49-59-019f5b86-f6c1-7962-a2d1-8072e13410fe.jsonl`
  records actual `gpt-5.6-sol / high` at `2026-07-13T12:50:02.268Z`,
  matching explicit dispatch.
- Canonical skill applicability completed at `2026-07-13T12:51:31Z` before
  design evidence inspection. The exposed session inventory, this assignment
  (which supplied no task-specific skill name or path),
  `build-protocol/skills/EXPECTED_SKILLS.md`, the complete readable 47-entry
  listing from
  `find /Users/armiol/.agents/skills -mindepth 2 -maxdepth 2 -name SKILL.md -print | sort`,
  and task-relevant entries in `/Users/armiol/.agents/.skill-lock.json` were
  checked. All eight expected manifest entrypoints are installed; no source was
  unreachable.
- Selected and fully read `architecture-decision-records` from
  `wshobson/agents`, plus `codebase-design` and `domain-modeling` from
  `mattpocock/skills`; the directly relevant `codebase-design/DEEPENING.md` was
  also read. They govern the resolution's decision/consequence structure,
  existing-seam depth, and precise lifecycle vocabulary. During the initial
  pass, accepted D-0085/D-0086 remained authoritative without a decision-log or
  glossary change; the later authority turn adds only their accepted active
  outcome clarification and still creates no new decision or glossary.
- Skipped `planning-with-files` because the protocol's assigned task/work/review
  records are the durable plan and ownership excludes its extra files;
  `epic-breakdown-advisor`, `decision-mapping`, and `user-story` because this is
  one accepted architecture milestone rather than product discovery or backlog
  creation; `architecture-patterns`, `api-design-principles`, and
  `nodejs-backend-patterns` because no bounded-context, transport, endpoint, or
  public-interface redesign is allowed; and implementation, TDD, worktree,
  review, and verification skills because this pass may not edit code/tests,
  spawn reviewers, create a worktree, run tests/full verify, commit, or push.
- Coordinator baseline evidence: fresh-worktree
  `pnpm install --frozen-lockfile` succeeded from locked/reused dependencies.
  The initial exact five-suite lifecycle run failed only because ignored
  generated/build outputs were absent: four suites could not resolve
  `@spine-ts/storage`/`@spine-ts/proto`, while
  `environment-delivery-records` passed 18 tests. After `pnpm proto:generate`
  and `pnpm typecheck:build:generated` both exited 0, the same five suites
  passed 5 files / 190 tests. No tracked file changed.
- Resumed review-fix runtime evidence: the same rollout records actual
  `gpt-5.6-sol / high` at `2026-07-13T13:13:05.956Z`, matching the explicit
  dispatch. The resumed requirements splitter used no subagents.
- Resumed skill applicability: the prior canonical inventory/manifest/lock
  evidence remains controlling. Before record edits, fully read and selected
  `receiving-code-review` to verify the complete finding batch against current
  ownership and `codebase-design` plus `DEEPENING.md` to keep the correction at
  the existing private seam. No new task-provided skill name/path was supplied.
- Authority-turn runtime evidence: the same rollout records actual
  `gpt-5.6-sol / high` at `2026-07-13T13:32:53.484Z`, matching explicit
  dispatch. The resumed existing requirements splitter used no subagents.
- Authority-turn skill applicability: the prior canonical manifest, installed-
  entrypoint, lock, and skipped-disposition evidence remains controlling. Before
  edits, fully read and selected `receiving-code-review` for the complete
  authority/serial-phase batch, `architecture-decision-records` for narrowly
  scoped accepted-outcome clarification, and `codebase-design` plus
  `DEEPENING.md` for the existing serial/facility seam. Expanded ownership
  permits only D-0085/D-0086 active outcome clarification and the named runtime/
  completion-plan sections; no new decision or task-provided skill was added.
- Final-fix runtime evidence: the same rollout records actual
  `gpt-5.6-sol / high` at `2026-07-13T13:49:34.308Z`, matching explicit
  dispatch. The resumed existing requirements splitter used no subagents.
- Final-fix skill applicability: prior canonical manifest, installed-entrypoint,
  lock, task-provided-skill, and skipped-disposition evidence remains
  controlling. Before edits, fully read and selected `receiving-code-review`,
  `architecture-decision-records`, `codebase-design`, and `DEEPENING.md` for the
  exact active-clause, queue-ownership, and public-doc findings. No new skill or
  file ownership was introduced.

Because permanent close changes the public `ServerEnvironment.close()`
contract, close/attach serialization, retained-generation ownership boundary,
and facility teardown ordering, one existing requirements splitter is assigned a
single architecture pass at explicit expected `gpt-5.6-sol` / `high`, with no
subagents and documentation-only ownership. It must inspect the relevant Spine
JVM server evidence, preserve D-0085 and accepted T-0037d/e1/e2 behavior, and
produce the smallest implementation-ready slices without reopening exclusions.

## Slice 1 Implementation Handback

- Existing implementer assignment: explicit expected `gpt-5.6-terra` /
  `medium`, no subagents. Coordinator runtime evidence:
  `/Users/armiol/.codex/sessions/2026/07/13/rollout-2026-07-13T15-04-05-019f5bca-cd6f-7992-ba5a-de38a9a9006f.jsonl`
  records actual `gpt-5.6-terra / medium` at `2026-07-13T14:04:08.210Z`,
  matching dispatch.
- Canonical applicability was recorded before production edits. Selected and
  fully read `test-driven-development` for strict runtime RED/GREEN work and
  `implement` for issue-bounded implementation. The latter's generic full
  suite, review, commit, and push instructions conflict with this assignment,
  so the explicit focused-validation/no-commit/no-push boundary controls.
  `planning-with-files` is satisfied by these canonical durable records;
  subagent, worktree, review, architecture, API, and security skills are N/A
  because this already-assigned worktree has fixed accepted architecture, no
  subagents, no public expansion, and no requested security review.
- RED: the new focused close suite failed 2/2 against the prior runtime: an
  in-use close resolved and closed facilities, and a later attach resolved
  after close. A separate cancellation RED temporarily removed only the
  admission callback's cancellation call and failed exactly because the
  close-first stop resolved rather than rejecting. GREEN: the focused suite
  passes 4/4, including deferred-facility proof that a cancelled queued stop
  and waiter settle before public close completes.
- Slice 1 adds private permanent admission to `EnvironmentAttachments` under
  its existing serial gate. It refuses a nonzero registration count with the
  exact in-use error before mutation; otherwise it cancels only an unadmitted,
  incomplete eager stop, commits permanent admission only with no generation,
  and releases the gate before `ServerEnvironment` invokes its existing
  coalesced `RetryableCloseGroup`. Attach, stop, and retry-stop reject from
  permanent state. No T-0037b caller, API signature/export/options change, or
  retained-owner Slice 2 behavior was added.
- Public docs now state permanent closure and the observable non-destructive
  in-use/no-owned-facility-teardown contract in `ServerEnvironment.close()`
  TSDoc and `packages/server/README.md`.
- Evidence: focused close/attachment/reusable-stop regressions pass 3 files /
  109 tests; `pnpm typecheck:build:generated`, scoped ESLint, cleanup rules,
  scoped Prettier, and `git diff --check` pass. The requested listener/facility
  regression `server.test.ts` cannot run in this managed sandbox: 13 listener
  cases fail only with `listen EPERM: operation not permitted 127.0.0.1`.
  No implementation failure was observed in the non-listener lifecycle suites.
  Generated/public-leak scans show no generated output, package export, or
  signature change. Full `pnpm verify`, commit, and push remain excluded.

## Objective

Implement serialized live-registration close refusal and owner-free,
zero-registration permanent environment close with a short admission phase and
ordered owned-facility teardown outside the lifecycle serial gate.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep its implementation and review package limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using focused deterministic TDD.
- Do not assign duplicate authors or reviewers for one role, and close every
  participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions, and invent none without corresponding
  Spine JVM evidence.
- Before server-module implementation, inspect and record relevant Spine JVM
  `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review. Once this child starts, this
  child `TASK.md` status is canonical for its work/review status mirrors.
- Run code style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability lanes until clean; defer security to final readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final
  child acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Create no child work/review log until this child actually starts.
- Preserve existing public `ServerEnvironment.close()` and rejection channels;
  add no public detach, registration, generation, scheduler, monitor, retry,
  signature, option, or root export.
- Commit no generated artifact and run focused API/public-leak checks. Update
  existing README/TypeDoc only for independently observable environment-close
  behavior at this merge point. Public close TSDoc must explicitly say an in-use
  close rejects non-destructively and performs no owned-facility teardown; if
  that wording ships, `packages/server/README.md` must state the same observable
  contract. T-0037f owns caller-owned reuse after server detach and full server
  lifecycle docs. Never name internal explicit stop.
- Do not touch examples or `human-review-1-jul.md`.

## Exact Ownership

This child owns the lifecycle-gated `ServerEnvironment.close()` decision. With
any live registration it refuses before changing admission, stopping work,
consuming records, clearing a slot, or closing facilities. With zero
registrations it first proves that no current generation or retained lifecycle
owner exists, then permanently closes attachment and explicit-stop admission
and releases `#serial`. The existing coalesced public close attempt then closes
each owned facility outside that gate. At the integrated T-0037d/e1/e2 boundary, the
only legal zero-registration/current-generation state is retained failed-start
rollback; close returns that operation's existing explicit-retry-required error
without mutation. Unsafe last detach and incomplete reusable stop retain live
registrations, so close returns the in-use error without mutation.

A close that precedes eager provisional `stopDelivery()` allocation marks that
stop cancelled only when it is both unadmitted and not completed, rejects and
clears its attachment waiters, and clears `#stop` without awaiting the stop
promise, waiter settlement, or any facility. The admission callback returns and
releases `#serial`; its queued stop turn then rejects through the existing stop
promise and performs no lifecycle work even if facility settlement remains
pending. A completed stop-first no-generation record remains owner of its waiter
settlement and is never cancelled by later close.
An unrecognized zero-registration orphan generation is an invariant error
before permanent admission. Permanent close does not invoke T-0037b or duplicate
failed-start, detach, reusable-stop, generation, parked-record, or readiness
logic. Readiness notification remains synchronous `void`: no live route exists
after owner-free admission and a stale retired-coordinator notification no-ops.
This child does not own server cleanup.

Quiescence, reporting, and inert-cleanup failures stay on the existing
failed-start/detach/stop operation promise. Unsafe ownership retains the slot,
dependencies, and facilities and causes close to refuse without facility work.
Once the predecessor operation is replacement-safe, it clears its matching slot
even if reporting or inert cleanup rejects; a separately queued or later close
then attempts every facility. Permanent close aggregates only facility failures,
so predecessor causes are neither duplicated nor reordered across operations.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/retryable-close.ts` only if existing aggregation
  cannot express the required order without widening semantics
- Focused environment close/refusal, facility, retry, close/attach, and
  close/provisional-stop race tests; existing T-0037d/e1/e2 regressions remain
  behavior authorities rather than production ownership
- Existing public close TSDoc and `packages/server/README.md` together if the
  observable wording ships
- This child's future task/work/review records

## Focused Deterministic TDD

- Close with any live registration refuses before admission or lifecycle state
  changes; all registrations and the environment remain usable.
- A close/attach race has one serialized winner: attach first causes refusal;
  zero-registration close first permanently rejects the attach.
- A deterministic close-first/stop-second race includes an attach waiter:
  admission commits and releases `#serial` without awaiting the behind-it stop,
  waiter settlement, or facility; the unadmitted and not-completed stop plus its
  waiter reject with the closed error; the queued stop turn performs no lifecycle
  work; `#stop` stays clear; a later attach rejects from permanent state.
- Hold the first owned facility close on a deterministic deferred promise. The
  cancelled stop and waiter must settle while the coalesced public close remains
  pending, proving facility work is outside `#serial`; releasing the facility
  then completes close.
- In a no-generation environment, invoke stop first, attach while it waits, and
  invoke close second. The stop turn marks `completed` and releases its waiter
  behind close; close does not cancel the retained stop and commits after its
  turn; the queued attach rejects from permanent state; waiter settlement lets
  the stop promise resolve normally and its existing completion handler clears
  `#stop`.
- Retained failed-start at zero registrations refuses through its existing
  explicit-retry-required channel. Unsafe last detach and incomplete reusable
  stop refuse through the in-use channel. Each refusal performs no permanent
  admission and preserves the exact retained owner, generation/slot,
  dependencies, facilities, and error/reporting state; its existing retry
  remains the sole continuation.
- Owner-free zero-registration/no-generation close permanently rejects later
  attachments, `stopDelivery()`, and `retryDeliveryStop()`, then attempts every
  owned delivery/tracing/transport/storage facility. Synchronous readiness gains
  no rejection channel; stale retired-coordinator notification no-ops.
- Every facility is attempted despite earlier failures. Successful owned
  facilities close exactly once; failed ones retry once per later public close;
  each aggregate is flat and ordered delivery, tracer, transport, storage.
- Existing T-0037d/e1/e2 tests remain the authority for quiescence-failure
  retention, safe slot clearing after reporting/inert cleanup failures, and
  unreported-versus-already-reported cause behavior. Static checks prove
  permanent close adds no T-0037b caller or duplicate retirement logic.
- Focused public-leak/API checks remain green; any README/TypeDoc update states
  that the environment is “permanently closed” and that an in-use close rejects
  non-destructively with no owned-facility teardown. If close TSDoc ships, the
  package README must match it. Public wording states only observable behavior
  and tracks no generated output.

## D-0085 Invariants

- Live-registration refusal is pre-transition and non-destructive.
- Existing predecessor owners preserve stop-before-await, proven-quiescence
  ordering, unsafe ownership retention, safe slot clearing, and cause-once
  behavior; permanent close neither advances nor duplicates those phases.
- Permanent admission requires zero registrations, no current generation, and
  no retained lifecycle owner.
- Permanent close promises no recovery after owned storage closes.

## Explicit Exclusions

No registration detach, ordinary last-detach reuse, reusable explicit stop,
fresh-candidate rebind/transfer/publication, failed-start rollback, server/
listener/context/resource integration, retry timing, public monitor/health/
action surface, topology, adapter, catch-up path, or T-0036 change.

## Architecture Resolution

Implementation-ready ownership, ordering, retry, error, public-boundary, risk,
and three-slice TDD decisions are recorded in
`build-protocol/tasks/T-0037e3-permanent-environment-close/architecture-resolution.md`.

The resolution keeps only a permanent-admission flag in the existing
`EnvironmentAttachments` serial owner, requires an owner-free no-generation
state, and returns from admission/cancellation before the coalesced public close
attempt invokes its existing `RetryableCloseGroup`. It adds no T-0037b caller,
facility ledger, `EnvironmentClose` class, or takeover of retained failed-start,
detach, or reusable stop. No new public API, option, export, error type, decision,
or speculative production module is planned. Architecture authority review-fix
handback is requested; implementation has not started.

Splitter handback checks: Prettier write/check passed for the four owned
Markdown records, `git diff --check` passed, all four status headers agree, and
`git status --short` lists only those three modified records plus the new
architecture resolution. No tests or full verify were run by the splitter.

Coordinator inspection accepts the handback for independent architecture
review: it keeps permanent close in existing owners, preserves the public
signature and exclusions, and splits implementation into three ordered bounded
slices. Lightweight docs/status lint, formatting, exact documentation-only
scope, public/future-policy claim checks, and `git diff --check` pass. All four
canonical concerns are assigned against the committed resolution.

## Architecture Review Findings And Fix Assignment

- Performance/reliability HIGH: current accepted ownership exposes no ordinary
  zero-registration/current-generation state. Safe last detach clears the slot;
  unsafe detach retains its claim; failed-start rollback is explicitly owned
  elsewhere. Define a legal handoff that makes permanent retirement reachable,
  or narrow the state machine and tests without violating the task/exclusions.
- Style/maintainability P1: account for T-0037e2's eager provisional `#stop`
  allocation before serialized admission. Close-first/stop-second must not let
  the later stop block the winning close or leave stale wait state; add the
  deterministic race and later-attach assertion.
- Documentation/API P2: do not claim internal stop/readiness notification
  “rejects” without an actual channel; specify internal checks/no-op semantics
  or narrow the claim to attachment admission. Proposed TSDoc must say
  “permanently closed,” not only “permanently close.”
- Reliability MEDIUM: add close attempts during retained failed-start, unsafe
  last-detach, and incomplete reusable-stop ownership, proving no permanent
  admission/retirement/slot/facility mutation.
- All reviewer profiles matched dispatch; every reviewer used no subagents and
  is closed. The same requirements splitter receives the complete batch at
  explicit `gpt-5.6-sol` / `high`, no subagents, for architecture records only.

## Architecture Review-Fix Resolution And Handback

- HIGH resolved by integrated ownership proof: successful last detach already
  clears its generation; unsafe last detach and incomplete reusable stop retain
  live registrations; retained failed-start is the only legal zero-registration/
  current-generation state and keeps its existing explicit retry owner.
  Permanent close admits only zero registrations plus no generation, treats an
  unowned generation as an invariant violation, and adds no T-0037b caller.
- P1 resolved by exact provisional-stop cancellation. Close marks the eager
  unadmitted and not-completed stop with a closed error, rejects and clears all
  waiters, clears identity-matching `#stop`, and does not await its behind-close promise. The
  queued stop turn rejects through its existing gate without lifecycle work; a
  deterministic later attach observes permanent-close state.
- Both P2 findings resolved: attach/stop/stop-retry use explicit promise
  rejection checks, synchronous readiness remains `void` with stale notification
  no-op semantics, and the proposed TSDoc explicitly says “permanently closed.”
- MEDIUM resolved with deterministic close attempts during retained failed-start,
  unsafe last detach, and incomplete reusable stop. Acceptance requires no
  permanent-admission, retirement, slot, dependency, facility, or error-state
  mutation, followed by the exact predecessor retry remaining usable.
- The three implementation slices, focused tests, ownership, risks, exclusions,
  and public boundary are updated in `architecture-resolution.md`. Status is
  `Architecture review-fix handback requested`; implementation remains
  unauthorized in this documentation-only pass.
- Review-fix handback hygiene passed: Prettier write/check on all four owned
  records, `git diff --check`, synchronized status headers, and exact four-file
  documentation-only short status. No tests or full verify were run.

Coordinator inspection accepts the complete fix batch for re-review. The
resolution now narrows permanent close to owner-free zero-registration/no-
generation state, specifies provisional-stop cancellation without serial
deadlock, preserves exact internal channel semantics, and includes all retained-
owner tests and public wording corrections. Focused docs/status lint and diff
hygiene pass; all four canonical concerns are reassigned.

## Architecture Re-Review Authority Findings

- Documentation and style P1: the refined owner-free/no-generation model
  matches integrated T-0037d/e1/e2 code, but active D-0085,
  `RUNTIME_ARCHITECTURE.md`, and `PROJECT_COMPLETION_PLAN.md` still assign an
  unreachable close-owned generation retirement/quiescence path to T-0037e3.
  Reconcile those active internal ownership records without changing public
  close behavior or predecessor guarantees.
- Style P1: permanent admission/provisional-stop cancellation must be a short
  serialized phase that releases `#serial` before `RetryableCloseGroup` facility
  work. Facility teardown continues under the coalesced public close attempt;
  otherwise the cancelled stop turn can be blocked indefinitely.
- TypeScript/API docs and performance/reliability returned CLEAN. All reviewer
  profiles matched dispatch, no reviewer used a subagent, and all are closed.
- The same Sol High requirements splitter receives this authority/serial-phase
  batch with expanded documentation ownership limited to D-0085/D-0086 active
  outcome text, the T-0037e3 runtime-architecture/completion-plan sections, and
  the four current task records. Implementation remains unauthorized.

## Architecture Authority And Serial-Phase Handback

- D-0085/D-0086 active outcome clarifications now supersede only the unreachable
  former T-0037e3 current-generation retirement assignment. They preserve the
  accepted ordering, unsafe retention, safe clearing, and cause-once rules in
  T-0037d/e1/e2 predecessor owners and preserve public close behavior.
- `RUNTIME_ARCHITECTURE.md` and the completion plan now assign T-0037e3 only
  live/retained-owner refusal, owner-free zero-registration/no-generation
  admission, provisional-stop cancellation, and subsequent facility teardown.
- The implementation design uses one short
  `EnvironmentAttachments.admitPermanentClose()` serial callback. It checks and
  refuses owners, cancels only an eager unadmitted and not-completed stop and its
  waiters, commits permanent admission, then returns without awaiting stop/
  waiter/facility promises. It stores no facility or public-attempt state.
- The existing coalesced `ServerEnvironment.#close` attempt awaits that callback
  and invokes `RetryableCloseGroup.close()` outside `#serial`. A deterministic
  deferred-facility test requires the queued cancelled stop and waiter to settle
  while public close is still pending, then close to finish when the facility is
  released.
- Primary risks are accidentally placing close-group settlement on `#serial`,
  mutating admission before retained-owner refusal, or reintroducing a close-
  owned generation caller. Slice ownership and focused/static tests explicitly
  guard all three.
- Status is `Architecture authority review-fix handback requested`. Exactly the
  seven authorized documentation files are in scope; no implementation/tests,
  full verify, commit, push, new decision, or protected human-review access is
  authorized or performed.
- Authority handback hygiene passed: Prettier write/check over all seven owned
  records, `git diff --check`, synchronized four-record status headers, scoped
  authority-claim scans, and short status containing exactly those seven files.

Coordinator inspection accepts the authority/serial-phase batch for final
architecture re-review. D-0085 ordering remains active in reachable predecessor
owners, the former unreachable T-0037e3 assignment is explicitly superseded,
and facility teardown begins only after the bounded admission callback releases
`#serial`. All four canonical concerns are assigned against the seven-file
documentation endpoint.

## Architecture Authority Re-Review Findings

- Documentation P1: appended outcome wording is insufficient while active
  D-0085/D-0086 body clauses still assign generation retirement/quiescence to
  T-0037e3. Narrow or explicitly supersede those exact active clauses.
- Reliability P1: `admitted === false` alone does not identify a stop queued
  behind close; a stop-first no-generation operation may be completed but still
  retained until waiter settlement. Cancel only an unadmitted, not-completed
  provisional stop or record explicit queue ownership; add stop-first/waiter/
  close-second acceptance.
- TypeScript/API P2: proposed public docs must state that close rejects
  non-destructively while in use with no teardown, and mirror that observable
  contract in the package README if public wording changes. Style returned
  CLEAN. All reviewers used no subagents and are closed.
- The same Sol High requirements splitter receives the three-finding
  documentation batch; implementation remains unauthorized.

## Architecture Final-Fix Handback

- Documentation P1 resolved in place: D-0085's active permanent-close and
  authoritative-order clauses and D-0086's active T-0037e3/retry-owner clauses
  now explicitly supersede close-owned generation retirement. Appended outcome
  notes remain corroborating context rather than the sole override.
- Reliability P1 resolved with the exact cancellation predicate
  `!stop.admitted && !stop.completed`. Deterministic acceptance now covers stop
  first with no generation and one waiter, close second, completed stop state
  retained without cancellation, close admission after the stop turn, queued-
  attach permanent-state rejection, normal stop promise settlement, and existing
  `#stop` cleanup.
- TypeScript/API P2 resolved: proposed close TSDoc explicitly states that in-use
  close rejects non-destructively and performs no owned-facility teardown. If
  that public wording ships, the same implementation slice must add matching
  `packages/server/README.md` wording.
- All seven authorized records and the four status headers are aligned at
  `Architecture final-fix handback requested`. Implementation/tests remain
  unauthorized; no full verify, commit, push, new decision, README edit, or
  protected human-review access occurred.
- Final-fix hygiene passed: Prettier write/check over all seven records,
  `git diff --check`, exact seven-file status, synchronized headers, and scoped
  active-clause/stop-ownership/public-wording scans.

Coordinator inspection accepts the final three-finding docs correction for
re-review: operative D-0085/D-0086 clauses are explicit, cancellation requires
`!admitted && !completed`, stop-first waiter acceptance is present, and public
wording requires non-destructive in-use rejection/no teardown plus README
consistency. All four canonical concerns are reassigned.

## Architecture Acceptance And Slice 1 Assignment

- Final architecture re-review is CLEAN in all four concerns. Active authority,
  `!admitted && !completed` cancellation, stop-first FIFO behavior, serial
  release before facilities, and public docs/README requirements are consistent.
  Every reviewer profile matched dispatch; no reviewer used subagents and all
  are closed.
- The architecture resolution is accepted. One fresh existing implementer is
  assigned Slice 1 at explicit `gpt-5.6-terra` / `medium`, no subagents, owning
  permanent admission/refusal/races, no-generation close, provisional stop/
  waiter handling, facility phase separation, focused tests, public TSDoc and
  matching server README wording, plus current records. Slices 2-3 remain
  unauthorized until Slice 1 review is clean.

## Slice 1 Coordinator Gate And Review Assignment

- Coordinator native verification passes 4 files / 130 tests, including the
  listener-oriented server suite that was sandbox-blocked for the implementer.
  Generated build typecheck, scoped ESLint, cleanup enforcement, docs/API
  checks, server export tests, Prettier, exact scope/public/generated scans, and
  `git diff --check` pass.
- Slice 1 is assigned to all four canonical reviewer concerns at their explicit
  profiles, read-only and no subagents. Slices 2-3 remain unauthorized.

## Slice 1 Review Findings And Fix Assignment

- Style/reliability P2: replace the sequential attach-first test with a truly
  queued attach-first/close-second race proving close refusal leaves permanent
  admission and facilities untouched. Add close-first/direct-attach-second
  inner-guard coverage and prove new stop/retry-stop calls reject immediately
  while a deferred facility keeps public close pending.
- TypeScript/API P2: add the explicit public TSDoc sentence that after close
  admission the environment is permanently closed and cannot be reused.
- Documentation returned CLEAN. All reviewers matched explicit profiles, used
  no subagents, and are closed. One fresh implementer receives the complete
  test/TSDoc/record batch at explicit `gpt-5.6-terra` / `medium`, no subagents.

## Slice 1 Review-Fix Handback

- Existing implementer runtime acceptance: coordinator evidence at
  `/Users/armiol/.codex/sessions/2026/07/13/rollout-2026-07-13T15-17-20-019f5bd6-eea0-7fa0-a9a9-90515561b218.jsonl`
  records actual `gpt-5.6-terra` / `medium` at `2026-07-13T14:17:22.873Z`,
  matching the explicit assignment; no subagents were used.
- Freshly read/applied: `receiving-code-review`, `test-driven-development`, and
  `verification-before-completion`. The direct-attach RED exposed descriptor
  enumeration before the inner closed-state guard, so the narrow production
  correction is authorized by the demonstrated defect.
- Deterministic gated attach-first/close-second proves serial attach admission
  wins and close refuses without permanent admission or facility teardown.
  Close-first/direct-attach-second proves rejection before descriptor enumeration,
  claim, or worker work. Deferred facility close keeps public close pending while
  fresh stop/retry-stop calls reject. `close()` TSDoc now states permanent,
  non-reusable admission.
- Evidence: RED 4/5 then GREEN 5/5 in `environment-close.test.ts`; focused
  lifecycle regression 3 files / 110 tests; native `server.test.ts` 21/21;
  generated build typecheck, scoped ESLint, API docs, scoped Prettier, and
  `git diff --check` pass. Full verify, commit, push, generated output, exports,
  options, later slices, and protected human review remain excluded.
- Complete Slice 1 review-fix handback requested. Documentation remains clean;
  security stays deferred to T-0041.

## Slice 1 Fix Coordinator Acceptance

- `2026-07-13T14:27:18Z`: Coordinator verification accepts the complete fix
  batch for independent re-review. The three non-network lifecycle files pass
  110/110 tests. The combined four-file run was sandbox-limited only by
  loopback `EPERM`; native `server.test.ts` passes 21/21.
- Generated build typecheck, scoped ESLint, cleanup enforcement, API docs,
  scoped Prettier, and `git diff --check` all pass.
- Lightweight pre-review lint finds synchronized current status, one shared
  closed-error source, no package/root export or TypeDoc leak for internal
  admission state, and no active future scheduler, backoff, monitor, topology,
  catch-up, or adapter overclaim. Historical superseded text remains outside
  the active review state unless a current record claims it.
- Slice 1 fix re-review is assigned. Later slices, full `pnpm verify`, and final
  security review remain deferred to their accepted gates.
