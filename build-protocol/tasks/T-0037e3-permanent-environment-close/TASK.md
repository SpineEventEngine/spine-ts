# T-0037e3: Permanent Environment Close

Status: Architecture review assigned

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

Because permanent close changes the public `ServerEnvironment.close()`
contract, close/attach serialization, generation retirement ownership, and
facility teardown ordering, one existing requirements splitter is assigned a
single architecture pass at explicit expected `gpt-5.6-sol` / `high`, with no
subagents and documentation-only ownership. It must inspect the relevant Spine
JVM server evidence, preserve D-0085 and accepted T-0037d/e1/e2 behavior, and
produce the smallest implementation-ready slices without reopening exclusions.

## Objective

Implement serialized live-registration close refusal and zero-registration
permanent environment close through safe generation retirement and owned-
facility teardown.

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
registrations it permanently closes attachment/trigger admission, invokes
T-0037b's existing primitive for any current generation in D-0085 order, safely
clears the proven-quiescent retired slot, and closes each owned facility.

If quiescence fails, permanent close remains in progress, attach/replacement is
prohibited, and the unsafe slot, endpoint dependencies, and facilities remain
owned for explicit retry of the same close. Reporting or inert cleanup failure
after proven quiescence does not skip safe slot clearing or later facility
close attempts. This child does not own detach, reusable stop, or server cleanup.

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
- Zero-registration close permanently rejects later attachments/triggers,
  retires any generation in D-0085 order, safely clears its slot, then attempts
  every owned delivery/tracing/transport/storage facility close exactly once.
- Quiescence failure after admission closure/stop performs no classification,
  consumption/reporting, retirement, slot clear, endpoint teardown, or facility
  close. Retry resumes the same close without duplicating completed phases,
  proves quiescence, completes remaining phases and safe slot clearing exactly
  once, then closes every owned facility exactly once and remains closed.
- Reporting or inert retirement-cleanup errors after quiescence are preserved
  and aggregated while slot clearing and all later facility close attempts still
  occur; no failure can reactivate delivery.
- Eligible unreported causes surface once; reported unresolved causes are
  consumed without resurfacing.
- Focused public-leak/API checks remain green; any README/TypeDoc update states
  only observable permanent-close behavior and no generated output is tracked.

## D-0085 Invariants

- Live-registration refusal is pre-transition and non-destructive.
- Stop precedes await; proven quiescence precedes classification, reporting,
  retirement, slot clearing, endpoint teardown, and facility close.
- Quiescence failure retains unsafe ownership for external same-operation retry.
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
`EnvironmentAttachments` serial owner, invokes T-0037b only through
`DeliveryGeneration.retire()`, clears only a proven-quiescent matching slot,
and consumes the existing `RetryableCloseGroup` for ordered exact-once facility
success/retry. No new public API, option, export, error type, decision, or
speculative production module is planned. Architecture handback is requested;
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
