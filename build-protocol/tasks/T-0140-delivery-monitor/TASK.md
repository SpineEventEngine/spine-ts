# T-0140: Controlling DeliveryMonitor

Status: In progress on stacked integration train.

## Objective

Replace the removed attempt/exhaustion orchestration with a customizable,
JVM-style `DeliveryMonitor` whose explicit asynchronous actions contain
delivery failures without inventing retry, quarantine, dead-letter, receipt,
marker, or failure persistence.

## Classification

High-risk. This task changes a public TypeScript contract and the concurrency,
failure-containment, acknowledgement, and graceful-stop lifecycle of shard
delivery.

## Baseline And Ownership

- Baseline: pushed T-0139 closure commit `6f7a1593`.
- Branch: `task/T-0140-delivery-monitor`.
- Worktree: `.worktrees/T-0139-inbox-shards`.
- Ownership: remaining `packages/server/src/delivery/**`, delivery builder and
  root exports, focused delivery tests, affected Server API documentation, and
  T-0140 protocol records.
- Do not change storage record architecture, add compatibility aliases, add
  timers/backoff/scheduler policy, implement T-0141 validation changes, migrate
  examples owned by T-0142, or add attempts, quarantine, dead-letter storage,
  receipts, markers, claims, fingerprints, or dedup records.

## Frozen Human Requirements

- One failed signal must never terminate the framework or reject its scheduler
  loop.
- Export an instantiable `DeliveryMonitor` class with continuation,
  start/completion, reception-failure, pickup-failure, and already-picked
  hooks; accept direct or promised callback results.
- Export `FailedReception` with readonly message/error and asynchronous
  mark-delivered and repeat-dispatch actions.
- Integrate the complete `WorkerId` shard API and direct Inbox persistence.
- Default reception failure marks the Inbox row delivered and continues.
- Hook/action failures follow the deterministic fallbacks frozen in the Wave 8
  plan; no path creates an unhandled rejection.
- A durable acknowledgement failure leaves the row pending, blocks later rows
  for that target, permits independent targets to continue, and releases the
  shard for a later run.
- Graceful stop waits for in-flight dispatch/actions, prevents later work,
  releases ownership, and permits replacement-worker acquisition without
  concurrent duplicate delivery.
- Delete old observer callback names and removed attempt/retry-decision
  exports without aliases.

## JVM Evidence

The orchestrator inspected the current JVM reference before TypeScript edits:

- `DeliveryMonitor.java` supplies the controlling hook vocabulary and default
  mark-delivered reception action.
- `FailedReception.java` exposes the failed message/error and explicit
  mark-delivered/repeat actions.
- `FailedPickUp.java`, `AlreadyPickedUp.java`, and `RuntimeFailure.java` supply
  caller-selected pickup outcomes.
- `DeliveryBuilderSpec.kt`, `MemoizingDeliveryMonitor.java`, and
  `ReceptionFailureTestEnv.java` confirm builder customization, instantiability,
  hook observation, and user-selected failure actions.

TypeScript deliberately adapts these synchronous JVM callbacks to the frozen
`void | Promise<void>` and direct-or-promised action contract. The approved TS
default differs for genuine pickup failure by returning a non-throwing failed
result, as required by the Wave 8 plan.

## Ordered TDD Slices

1. Public monitor, failure evidence, action, result/statistics, builder, and
   root-export contract tests.
2. Complete `WorkerId` pickup and direct Inbox orchestration cutover; restore
   the Server package compile boundary removed by T-0139.
3. Default and repeat reception actions, acknowledgement behavior, and
   independent-target continuation.
4. Start, continuation, pickup-failure, already-picked, and completion hook
   observation plus hook/action fallback containment.
5. Graceful-stop/in-flight settlement, release, takeover, and lost-renewal
   adversarial sequences.
6. Delete stale exports/names, document guarantees, run prohibited-symbol
   scans, focused coverage, deterministic checks, specialist review, and one
   final `verify:task` after convergence.

## Implementation Assignment

- Existing role: `implementer`.
- Expected and explicitly dispatched profile: `gpt-5.6-terra` / `medium`.
- One production-code owner for the complete T-0140 scope above.
- Work RED/GREEN in focused slices, preserve unrelated changes, do not spawn
  subagents, commit meaningful checkpoints, and push only to `origin`
  immediately.

## Verification And Review

- Focused delivery tests, relevant package typechecks, changed TypeScript
  ESLint, TSDoc, documentation audience/snippet checks, Prettier,
  `git diff --check`, and prohibited-symbol scans.
- Changed-source/package-scoped coverage must reach at least 90% in statements,
  branches, functions, and lines.
- Required review lanes: TypeScript/API docs, performance/reliability,
  style/maintainability, and documentation.
- Security is N/A unless implementation changes authentication,
  authorization, credentials, or a trust boundary.
- Collect one complete review wave, aggregate one correction batch, re-review
  only substantively affected lanes, then run `verify:task` once.

