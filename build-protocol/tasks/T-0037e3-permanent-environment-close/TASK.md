# T-0037e3: Permanent Environment Close

Status: Architecture fix re-review assigned

Started: `2026-07-13T12:48:44Z`

Baseline commit: `2f2ae456`

Branch: `task/T-0037e3-permanent-environment-close`

Worktree: `.worktrees/T-0037e3-permanent-environment-close`

Dependency: T-0037e2 complete and integrated.

This `Status` header is canonical for T-0037e3. Its work/review logs are
derived mirrors and must agree before review.

## Architecture Assignment And Skill Applicability

- Existing role: requirements splitter. Documentation-only ownership is limited
  to this task, its architecture resolution, work log, and review log. Expected
  dispatch was explicit `gpt-5.6-sol` / `high`; no subagents are permitted.
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
  existing-seam depth, and precise lifecycle vocabulary. Accepted D-0085/D-0086
  remain authoritative, so no decision-log or glossary file is created or
  changed.
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

Because permanent close changes the public `ServerEnvironment.close()`
contract, close/attach serialization, retained-generation ownership boundary,
and facility teardown ordering, one existing requirements splitter is assigned a
single architecture pass at explicit expected `gpt-5.6-sol` / `high`, with no
subagents and documentation-only ownership. It must inspect the relevant Spine
JVM server evidence, preserve D-0085 and accepted T-0037d/e1/e2 behavior, and
produce the smallest implementation-ready slices without reopening exclusions.

## Objective

Implement serialized live-registration close refusal and owner-free,
zero-registration permanent environment close with ordered owned-facility
teardown.

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
  behavior at this merge point. T-0037f owns caller-owned reuse after server
  detach and full server lifecycle docs. Never name internal explicit stop.
- Do not touch examples or `human-review-1-jul.md`.

## Exact Ownership

This child owns the lifecycle-gated `ServerEnvironment.close()` decision. With
any live registration it refuses before changing admission, stopping work,
consuming records, clearing a slot, or closing facilities. With zero
registrations it first proves that no current generation or retained lifecycle
owner exists, then permanently closes attachment and explicit-stop admission
and closes each owned facility. At the integrated T-0037d/e1/e2 boundary, the
only legal zero-registration/current-generation state is retained failed-start
rollback; close returns that operation's existing explicit-retry-required error
without mutation. Unsafe last detach and incomplete reusable stop retain live
registrations, so close returns the in-use error without mutation.

A close that precedes eager provisional `stopDelivery()` allocation marks that
unadmitted stop cancelled, rejects and clears its attachment waiters, and clears
`#stop` without awaiting the stop promise queued behind close. Its queued turn
later rejects through the existing stop promise and performs no lifecycle work.
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
- T-0037d/e1/e2 package-internal lifecycle and facility ownership modules
- `packages/server/src/server/retryable-close.ts` only if existing aggregation
  cannot express the required order without widening semantics
- Focused environment close/refusal, facility, retry, and close/attach race tests
- This child's future task/work/review records and narrow public docs if needed

## Focused Deterministic TDD

- Close with any live registration refuses before admission or lifecycle state
  changes; all registrations and the environment remain usable.
- A close/attach race has one serialized winner: attach first causes refusal;
  zero-registration close first permanently rejects the attach.
- A deterministic close-first/stop-second race includes an attach waiter:
  close commits without awaiting the behind-it stop promise; the unadmitted stop
  and waiter reject with the closed error; the queued stop turn performs no
  lifecycle work; `#stop` stays clear; a later attach rejects from permanent
  state.
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
  that the environment is “permanently closed,” states only observable close
  behavior, and tracks no generated output.

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

The resolution keeps one private permanent-close operation in the existing
`EnvironmentAttachments` serial owner, requires an owner-free no-generation
state before permanent admission, and consumes the existing
`RetryableCloseGroup` for ordered exact-once facility success/retry. It adds no
T-0037b caller and does not take over retained failed-start, detach, or reusable
stop. No new public API, option, export, error type, decision, or speculative
production module is planned. Architecture review-fix handback is requested;
implementation has not started.

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
  unadmitted stop with a closed error, rejects and clears all waiters, clears
  identity-matching `#stop`, and does not await its behind-close promise. The
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
