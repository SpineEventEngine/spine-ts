# T-0037e3: Permanent Environment Close

Status: Candidate; not started

Dependency: T-0037e2 complete and integrated.

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
