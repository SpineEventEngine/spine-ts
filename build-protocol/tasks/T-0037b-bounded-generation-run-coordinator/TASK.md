# T-0037b: Bounded Generation Run Coordinator

Status: Candidate; not started

Dependency: T-0037a complete and integrated; T-0036 package-internal evidence
is the worker interface consumed by this child.

## Objective

Implement one package-internal generation run coordinator that serializes and
observes finite T-0036 worker starts, coalesces readiness, and interprets
per-shard dispositions without assigning registration ownership yet.

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
- Consume, do not reopen or duplicate, T-0036 loop/worker progress semantics.
- Keep the coordinator package-internal. Commit no generated artifacts and make
  no root/public export or API change; emitted internal declarations may change.
  Add no environment option, example, or public API docs.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns one generation's worker construction input, one active start,
one idempotently merged pending admission, immediate rejection observation,
per-shard transition rules, and the reusable authoritative coordinator-instance
stop/await/retire primitive. The pending admission contains every eligible
notified canonical tenant/configured scope, deduplicates by that scope, and is
bounded by the current canonical tenant and configured descriptor/shard domain
rather than trigger or repeated-notification count. Legitimate growth tracks
current tenants/configuration and preserves tenant identity; notifications do
not create unbounded duplicate scope state. It never retains only the first or
last trigger. The coordinator creates a finite
admitted obligation, invokes `deliveryWorkerAccess.start(...)`, continues only
`PAUSED` shards within that obligation, and stops between one-shot runs. It
returns or publishes bounded internal settlement evidence for later ownership
layers.

The retirement primitive closes coordinator admission, calls stop, awaits and
classifies active settlement, awaits one caller-supplied operational-record
consumption/reporting step, and permanently retires that coordinator's
worker/loops in D-0085 order through a `finally`-equivalent path. If the supplied
step rejects, the primitive preserves and aggregates that failure with any
other stop/settlement/retirement failures, attempts retirement exactly once,
and settles with the combined result only afterward. It is idempotent and reusable by later lifecycle
owners; it does not own registration removal, record selection, an environment
generation slot, or fresh-generation race policy.

It does not decide which server registration owns an obligation or retain
canonical lifecycle cause records; T-0037c and T-0037d own those concerns.

## Likely Files

- A new package-internal coordinator module under
  `packages/server/src/delivery/`
- `packages/server/src/delivery/delivery-worker.ts` only for a minimal internal
  access extension proven necessary by the coordinator
- Focused coordinator tests under `packages/server/test/delivery/`
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Concurrent readiness never invokes concurrent worker starts. During an active
  run, notifications for disjoint configured scopes merge into one later
  bounded admission containing all eligible scopes.
- Repeated notifications for the same canonical configured scope are
  idempotent; the pending set preserves tenant identity and is bounded by the
  current canonical tenant/configured descriptor/shard domain. It may grow with
  legitimate current tenant/configuration cardinality, but not trigger count or
  repeated notifications, and cannot collapse to first/last scope.
- `IDLE` completes, `FAILED` and `SKIPPED` park, `STOPPED` does not continue,
  and only `PAUSED` continues the current finite obligation.
- Mixed `FAILED`/`PAUSED` evidence continues only the paused shard regardless
  of aggregate status.
- Every started promise is observed immediately. Rejection preserves T-0036
  shard/cause/obligation/progress evidence, clears the active slot, and does not
  self-restart.
- A later external readiness request may explicitly reconsider rejected work;
  normal fulfillment honors every eligible scope in the merged pending
  admission.
- Mixed fulfilled/rejected partitions park only rejected and overlapping
  pending scopes; every disjoint eligible notified scope survives and receives
  its one later bounded admission without restarting rejected scope.
- The authoritative retirement primitive closes admission before the next
  one-shot start, calls stop, awaits active work without interruption, awaits
  boundary record consumption, and retires the worker/loops exactly once.
- When boundary record consumption/reporting rejects, retirement is still
  attempted exactly once, the old worker/loops cannot be reused, and the
  rejection is preserved and aggregated with other failures only after
  retirement settles.
- Existing package-internal/direct `DeliveryWorker.start()` compatibility and
  all T-0036 tests remain unchanged.

## D-0085 Invariants

- One admitted request and every worker call are finite; useful work cannot
  extend the epoch and no recursive/background repeat loop is allowed.
- Scheduling uses per-shard evidence, never aggregate worker status alone.
- `FAILED`, `SKIPPED`, and rejection do not create readiness or spin.
- Retry readiness may call this seam later, but delay/backoff/timing is absent.
- No singleton, threads, repeat callbacks, public monitor, or catch-up station.

## Explicit Exclusions

No parked-record table, cause ownership/reporting policy, registration removal,
environment generation-slot clearing/replacement, fresh-generation race policy,
context startup enumeration, server network ordering, public API, retry timing,
or T-0036 epoch redesign belongs here. Later children invoke but do not reopen
this coordinator-instance retirement primitive.
