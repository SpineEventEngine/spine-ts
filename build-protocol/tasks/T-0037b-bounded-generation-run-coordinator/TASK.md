# T-0037b: Bounded Generation Run Coordinator

Status: Candidate; not started

Dependency: T-0037a complete and integrated; T-0036 package-internal evidence
is the worker interface consumed by this child.

## Objective

Implement one package-internal generation run coordinator that serializes and
observes finite T-0036 worker starts, coalesces readiness, and interprets
per-shard dispositions without assigning registration ownership yet.

## Human-Imposed Requirements Ledger

- Implement only this child in its future isolated branch/worktree with one
  author, TDD, focused checks, and all four required review lanes.
- Consume, do not reopen or duplicate, T-0036 loop/worker progress semantics.
- Keep the coordinator package-internal and absent from environment options,
  root exports, generated declarations, examples, and public API docs.
- Keep generated Protobuf output out of VCS and do not touch
  `human-review-1-jul.md`.

## Exact Ownership

This child owns one generation's worker construction input, one active start,
at most one coalesced external readiness request, immediate rejection
observation, and per-shard transition rules. It creates a finite admitted
obligation, invokes `deliveryWorkerAccess.start(...)`, continues only `PAUSED`
shards within that obligation, and stops between one-shot runs. It returns or
publishes bounded internal settlement evidence for later ownership layers.

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

- Concurrent readiness never invokes concurrent worker starts; readiness during
  an active run admits at most one later bounded request.
- `IDLE` completes, `FAILED` and `SKIPPED` park, `STOPPED` does not continue,
  and only `PAUSED` continues the current finite obligation.
- Mixed `FAILED`/`PAUSED` evidence continues only the paused shard regardless
  of aggregate status.
- Every started promise is observed immediately. Rejection preserves T-0036
  shard/cause/obligation/progress evidence, clears the active slot, and does not
  self-restart.
- A later external readiness request may explicitly reconsider rejected work;
  normal fulfillment honors an already-coalesced request.
- Stop closes admission before the next one-shot start and awaits the active
  start without interrupting its drain.
- Existing public `DeliveryWorker.start()` compatibility and all T-0036 tests
  remain unchanged.

## D-0085 Invariants

- One admitted request and every worker call are finite; useful work cannot
  extend the epoch and no recursive/background repeat loop is allowed.
- Scheduling uses per-shard evidence, never aggregate worker status alone.
- `FAILED`, `SKIPPED`, and rejection do not create readiness or spin.
- Retry readiness may call this seam later, but delay/backoff/timing is absent.
- No singleton, threads, repeat callbacks, public monitor, or catch-up station.

## Explicit Exclusions

No parked-record table, cause reporting, registration/generation ownership,
context startup enumeration, environment attachment, detach/close, server
network ordering, public API, retry timing, or T-0036 epoch redesign belongs
here.
