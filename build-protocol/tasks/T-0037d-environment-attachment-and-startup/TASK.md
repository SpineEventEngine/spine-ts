# T-0037d: Environment Attachment And Startup

Status: Candidate; not started

Dependency: T-0037c complete and integrated.

## Objective

Make `ServerEnvironment` the sole package-internal delivery owner for
registration attachment and finite startup recovery, including cardinality,
attribution, and registration-scoped failed-start rollback before listener
integration.

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
- Preserve existing public `ServerEnvironment` construction/options and add no
  public attach, detach, generation, scheduler, monitor, or retry surface.
- Use T-0037a descriptors, T-0037b coordination, and T-0037c records; do not
  duplicate their ownership.
- Commit no generated artifacts and make no root/public export or API change;
  emitted internal declarations may change.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns the package-internal lifecycle gate for attach/startup, at most
one current/non-retired delivery generation per environment at a time,
caller-owned shared registration cardinality, registration for a server-owned
environment exclusivity, registration tokens, startup recovery admission,
post-persist readiness routing, the atomic no-overlap ownership switch from
direct immediate exact drain to environment coordination for attached contexts,
the bounded transition readiness buffer used while that route is being
installed, and failed-start rollback. It
assembles startup obligation scopes from T-0037a's built-context descriptors,
including actual storage factories and enumerated tenants, installs readiness,
and awaits one finite recovery result before declaring attachment ready.

When failed-start rollback removes the first or sole registration, this child
invokes T-0037b's existing authoritative coordinator-instance
stop/await/retire primitive, supplies the T-0037c record-consumption step, and
clears the stopped, quiescent, permanently retired empty generation slot through
a finally-equivalent path before propagating any combined reporting or cleanup
error. The primitive preserves close-admission/stop, await, classify, consume/
report, then permanent-retirement/cleanup order. A later attach to an open
caller-owned environment may then install one fresh generation without overlap.
If the primitive cannot establish quiescence, rollback retains the slot and
prohibits replacement instead of claiming endpoint safety. This is failed-start
rollback ownership only.

The child exposes an internal attachment handle for future server integration.
It does not yet change `Server.start()` or listener ordering.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- New package-internal environment lifecycle/generation modules under
  `packages/server/src/server/` or `packages/server/src/delivery/`
- Minimal package-internal access additions to T-0037a/T-0037b/T-0037c modules
- Focused server-environment attachment/startup tests
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Multiple caller-owned registrations share exactly one generation/coordinator;
  a registration for a server-owned environment is exclusive, with conflicts
  rejected before registration or work admission. At most one current/non-
  retired generation exists at a time; retirement permits one later fresh
  generation where the environment remains reusable.
- Attachment installs readiness routing and disables direct immediate exact
  drain as one lifecycle-gated ownership barrier before startup admission. A
  focused concurrency test blocks an already-admitted direct exact drain, begins
  attachment, and proves attachment/startup environment admission remains
  pending until that drain settles. The barrier closes new direct-drain
  admission before it waits. Any row persisted after that close but before the
  readiness route is installed submits readiness to a transition buffer bounded
  by canonical tenant/configured-scope cardinality; it never falls back to
  direct drain. Installing the route transfers each buffered scope exactly once
  into the generation's lossless pending admission before environment/startup
  admission opens. Every subsequent receive settles from durable persistence
  plus non-throwing readiness submission only and neither invokes nor awaits
  exact drain. Before attachment, handoff completion/error behavior still
  follows exact drain. No durable row loses both owners, and no handoff exact
  drain overlaps an environment-owned worker run for the same row or scope.
- A focused race test blocks one already-admitted direct drain and readiness-
  route installation, persists a supported row after direct-drain admission is
  closed, and proves that row is buffered without exact drain. After route
  installation it receives exactly one eventual lifecycle admission, while the
  older direct drain must settle before startup/environment work is admitted.
- Startup installs readiness after context assembly, enumerates pre-existing
  supported tenant work using each built context's actual storage, and awaits
  one finite recovery obligation.
- Fulfilled `FAILED`, `PAUSED`, or `SKIPPED` is observed without claiming all
  pending rows completed; fulfilled `FAILED` alone does not fail startup.
- Rejection overlapping the attaching scope fails startup; wholly disjoint
  sibling rejection allows exactly one unaffected startup admission without
  restarting rejected scope or recursive readmission.
- Failed startup closes only the attaching registration's admission, waits for
  endpoint-dependent active work, consumes/reports only eligible causes, and
  preserves sibling progress/readiness/records.
- An already-reported unresolved overlapping shared cause produces exactly the
  D-0085 plain startup blocker message and no original-cause chain.
- A sole failed attachment quiesces its empty generation internally while a
  caller-owned environment remains reusable: rollback invokes T-0037b's
  primitive in exact close-admission/stop, await, classify, consume/report, then
  permanent-retirement/cleanup order and clears the inert retired empty slot
  through a finally-equivalent path before propagating cleanup errors. Separate
  reporting-failure and permanent-retirement-cleanup-failure tests prove the
  original sole-registration start still rejects once; the old instance cannot
  start, accept notification, or invoke endpoints; the slot is cleared; and the
  caller-owned environment later attaches one fresh generation without reuse or
  old/new overlap. A cleanup error may leak inert resources but cannot reactivate
  the instance. A quiescence failure instead retains the unsafe slot and rejects
  replacement. Permanent close remains T-0037e.

## D-0085 Invariants

- Exactly one environment owner and generation seam exists across attached
  servers.
- Startup recovery completes before network intake, though server listener
  wiring is deferred to T-0037f.
- Notification is readiness-only and follows durable persistence.
- Cleanup never deletes pending rows or closes a shared environment wholesale.
- Rejection attribution uses T-0036 per-shard evidence and T-0037c ownership;
  no unrelated registration is blamed.

## Explicit Exclusions

No public lifecycle option, final `Server.start()` wiring, network intake,
ordinary detach/last-detach invocation, explicit-generation-stop invocation,
permanent-close invocation,
fresh-generation attach/detach/close race policy, environment/facility close,
retry timing, monitor/action API, topology, or T-0036 redesign belongs here.
This child invokes but does not reopen T-0037b's retirement primitive.
