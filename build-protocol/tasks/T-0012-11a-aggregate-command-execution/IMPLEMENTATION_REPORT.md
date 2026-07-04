# Implementation Report: T-0012.11a Aggregate Command Execution

Status: in progress
Branch: `task/T-0012-11a-aggregate-command-execution`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`
Baseline commit: `8804e93`

## Summary

This slice starts from the reviewed `T-0012.11` split where repository command
dispatch still ends at route calculation. The implementation target is the
smallest real aggregate write path:

- async `CommandBus.post()` acceptance;
- repository command execution for one aggregate route;
- command assignee invocation through registered handler metadata;
- aggregate event application before snapshot persistence;
- aggregate history persistence through `AggregateStorage`; and
- async handoff of already-stored events to the existing event-bus dispatcher
  path without a second append.

## Initial Evidence

- `CommandBus` already provides async intake through
  `SingleProcessServerRuntime.enqueue()`.
- `Repository` already owns handler metadata, default routing, and internal
  command/event dispatcher adapters, but command dispatch currently calls only
  `routeCommand()`.
- `AggregateStorage` already persists aggregate event streams plus snapshots
  through `EventStore` and `RecordStorage`.
- `EventBus.post()` currently appends before dispatch, so aggregate-produced
  events cannot simply be reposted after `AggregateStorage.appendEvents()`
  without double-writing them.
- The curated JVM docs keep aggregate command execution on the write side:
  command handlers emit events, appliers mutate state, event history is the
  source of truth, and latest state is stored as a side channel.

## Open Design Point

The only real design tension in this slice is event-bus reuse after aggregate
storage:

- `EventBus.post()` appends and then dispatches.
- `AggregateStorage.appendEvents()` already appends aggregate events.

The implementation will choose the smallest correct path and record it here once
the red tests pin down the exact seam. The preferred direction is to keep
aggregate append/version validation in `AggregateStorage` and add the smallest
internal already-stored event dispatch path, because that avoids a second write
while preserving the current write-side storage seam.

## TDD Record

Pending. The next entry will capture the first focused red test command and its
expected failure reason before production code changes begin.
