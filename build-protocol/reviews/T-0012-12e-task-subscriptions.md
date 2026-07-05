# Review Log: T-0012.12e Task Subscriptions

Task log: `build-protocol/tasks/T-0012-12e-task-subscriptions/TASK.md`
Branch: `task/T-0012-12e-task-subscriptions`
Baseline commit: `4bebdeb`
Reviewed commit/diff basis: pending
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12e-task-subscriptions`
Status: review-fix complete; verification passed; committed; ready for re-review

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Rounds

Round 1 findings:

- Documentation: `build-protocol/work-logs/T-0012-12.md` still described the
  slice as in progress and pointed the next step at verification even though
  local verification had already passed.
- Documentation: `examples/todo/README.md` still summarized the example
  without mentioning live subscriptions.
- Maintainability: `examples/todo/README.md` and
  `examples/todo/USER_GUIDE.md` still contained stale wording that subscriptions
  were deferred.
- Reliability: the new live-subscription test in
  `examples/todo/src/index.test.ts` should close the fixture subscription in
  `try/finally` so failures do not leak background delivery.
- Reliability: each `subscription.next()` await in the live-subscription test
  should be bounded by a short timeout helper to avoid hanging until Vitest's
  global timeout.
- Out of scope: `expectTaskListEventuallyUnchanged` already existed before this
  slice and is not touched here, even though it has a wait-then-assert shape.

Planned fixes:

- refresh the stale documentation wording to reflect runnable subscriptions;
- add `try/finally` cleanup around the live subscription fixture;
- add a small local timeout helper around each `subscription.next()` await;
- record the out-of-scope helper note in the task/report logs.

Outcome:

- The live-subscription test now uses a local timeout wrapper for each
  `subscription.next()` await and closes the fixture subscription in
  `try/finally`.
- The example README and user guide now describe runnable live subscriptions
  instead of deferred subscription coverage.
- The review-fix logs note that `expectTaskListEventuallyUnchanged` was left
  untouched because it predates this slice.
