# To-Do Example User Guide

Current status: the in-process create-task, task-operation,
live-subscription, validation-failure, and business-refusal flows are runnable
in tests.

Run the focused example test after generated code and build output exist:

```bash
pnpm typecheck:build
pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests
```

The test builds a `Tasks` bounded context with `createTodoContext()`, posts
`CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask` commands through
`BoundedContextFixture.post()`, waits for `TaskListProjection` rows, and reads
the resulting task-list rows through the real `QueryService` seam.

Subscriptions are exercised through `BoundedContextFixture.subscribe()` with a
`Topic` targeting `TaskListSchema` and `includeAll`. After each command, the
test reads the next `SubscriptionUpdate`, unpacks the projected `TaskList`, and
asserts that the update came from the real projection change path rather than a
hand-built test update. Cancellation is covered by canceling the fixture
subscription and verifying later `next()` calls resolve `undefined`.

Validation is exercised by sending an invalid `RenameTask` payload through
`CommandService.Post`. The Ack returns `COMMAND_VALIDATION_ERROR` with packed
`spine.validation.ValidationError` details, and the existing task-list row is
unchanged.

Business refusal is exercised by completing an already completed task and
reopening an open task. The commands reach `TaskAggregate`, return stable Ack
errors (`TASK_ALREADY_DONE` and `TASK_NOT_DONE`), and do not write events or
projection updates.

This slice does not start a standalone server or provide client commands yet.
The final walkthrough remains deferred to later to-do example tasks.
