# To-Do Example User Guide

Current status: the in-process create-task and task-operation flows are
runnable in tests.

Run the focused example test after generated code and build output exist:

```bash
pnpm typecheck:build
pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests
```

The test builds a `Tasks` bounded context with `createTodoContext()`, posts
`CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask` commands through
`BoundedContextFixture.post()`, waits for `TaskListProjection` rows, and reads
the resulting task-list rows through the real `QueryService` seam.

This slice does not start a standalone server or provide client commands yet.
Validation/refusal, subscriptions, and the final walkthrough remain deferred to
later to-do example tasks.
