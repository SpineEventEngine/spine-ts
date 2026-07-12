# T-0037e2: Reusable Generation Stop

Status: Candidate; not started

Dependency: T-0037e1 complete and integrated.

## Objective

Implement the sole package-internal reusable generation-stop operation and its
exact-once transition to one fresh generation while live registrations survive.

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
- Preserve existing public close surfaces; add no public explicit-stop,
  generation, registration, scheduler, monitor, retry, signature, option, or
  root export. Public docs must not name the internal explicit-stop operation.
- Commit no generated artifact; run focused API/public-leak checks; do not touch
  examples or `human-review-1-jul.md`.

## Exact Ownership

This child alone owns the lifecycle-gated reusable explicit-stop entry point and
is the sole explicit-stop caller of T-0037b's primitive. It closes old readiness
admission, retains live registrations, and creates one transition-owned fresh
candidate even when no attach races.

The fresh transition has four distinct ordered phases with per-unit progress:

1. rebind every surviving registration and readiness route;
2. transfer every configured, startup, buffered, and retained canonical scope
   exactly once into fresh pending admission;
3. publish the sole candidate;
4. reopen later-write admission.

Configured/startup/buffered/retained scopes are never route-rebound. A bounded
canonical transition owner preserves them from old-route closure through fresh
recovery and phase 2. Rebind and transfer retain separate per-unit checkpoints.
An eligible racing attach waits for and joins this transition-owned candidate.

Construction or partial phase failure publishes no candidate and keeps
admission closed. Before candidate construction, retry may construct one. After
construction, retry resumes the same candidate and completed per-unit progress;
it never constructs a second candidate or self-loops. Candidate work admitted
before failure settles before error propagation.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- T-0037b/d/e1 package-internal generation and lifecycle modules
- Focused reusable-stop transition, failure, retry, and racing-attach tests
- This child's future task/work/review records and narrow architecture updates

## Focused Deterministic TDD

- With live registrations and no racing attach, explicit stop itself creates
  the sole fresh candidate and completes rebind, all-scope transfer,
  publication, then admission reopen, leaving every survivor usable.
- A racing eligible attach waits through retirement and joins that same
  candidate; no old/new overlap, owner gap, or second candidate occurs.
- A write after the fresh snapshot but before route rebind enters the bounded
  transition owner. The test completes registration/readiness-route rebind,
  transfers configured/startup/buffered/retained scopes exactly once into fresh
  pending admission, publishes, reopens admission, and admits the write without
  an unrelated trigger.
- Rebind and transfer failure cases use multiple routes/scopes, fail after one
  unit completes while another remains, retain separate per-unit checkpoints,
  settle admitted candidate work, propagate the error once, and prove external
  retry resumes the same candidate without repeating completed units.
- Construction failure proves no candidate exists; external retry may construct
  exactly one. No failure starts recursive/background retry.
- Quiescence failure retains the unsafe old generation, live registrations,
  transition owner, and endpoint dependencies and performs no later phase.
  Retry resumes without repeating admission closure/stop, proves quiescence,
  completes retirement and all four fresh phases exactly once.
- A reporting-failure case and a distinct post-consumption permanent-retirement-
  failure case each require this exact order before the original error propagates
  exactly once: registration/readiness-route rebind -> transfer all configured,
  startup, buffered, and retained scopes -> candidate publication -> admission
  reopen -> original error propagation. The candidate never remains unpublished
  or admission-closed after either replacement-safe result.
- Focused internal-access tests prove this environment entry point is the sole
  explicit-stop caller and server/handoff code cannot call the primitive.
- Focused public-leak/API checks remain green and no generated output is tracked.

## D-0085 Invariants

- The old primitive preserves close-admission/stop, await quiescence, classify,
  consume/report, then permanent-retirement/cleanup order.
- Proven quiescence makes reporting or inert cleanup errors replacement-safe;
  inability to prove quiescence prohibits replacement and endpoint teardown.
- One bounded canonical owner prevents durable readiness loss through transition.
- Transition retry is external, finite, exact-once, and never overlaps generations.

## Explicit Exclusions

No registration detach, ordinary last-detach retirement, permanent environment
close/refusal, facility teardown, failed-start rollback, server/listener close
integration, public explicit-stop API/docs, retry timing, monitor/health/action
surface, topology, adapter, catch-up path, or T-0036 change.
