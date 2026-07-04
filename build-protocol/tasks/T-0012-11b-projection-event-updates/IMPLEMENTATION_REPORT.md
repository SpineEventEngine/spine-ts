# Implementation Report: T-0012.11b Projection Event Updates

Status: started; no behavior changes yet
Branch: `task/T-0012-11b-projection-event-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11b-projection-event-updates`
Baseline commit: `f38fcac`

## Summary

This slice follows the merged aggregate command-execution path. The target is
the smallest read-side event path:

- delivered events reach repository event dispatchers through the event bus;
- projection repositories invoke one matching event subscriber;
- projection state is updated and written through `Stand`; and
- stand subscriptions and gRPC subscriptions can observe those real projection
  updates.

## Initial Evidence

- `EventBus` already dispatches delivered events asynchronously in registration
  order.
- `Repository` already owns event handler metadata and route calculation, but
  event dispatch currently only calls `routeEvent()`.
- `Stand` already owns storage-backed state updates, version metadata, and
  in-process subscriptions.
- The to-do example needs task-list projection state updated by domain events
  before the example can use query/subscription behavior as a real app.

## Open Design Point

The implementation must decide the smallest way for context-built projection
repositories to reach `Stand` without making `Stand` a write-side API for
application code. The preferred shape is an internal repository runtime binding
that updates `Stand` after a projection subscriber mutates projection state.

## Verification

No behavior verification has run yet for this slice.
