# To-Do Example

Standalone server-side to-do example for Spine TS.

The example defines generated Protobuf-ES messages, a decorated `TaskAggregate`,
`TaskListProjection` read-side rows, and a single-tenant `Tasks` bounded
context. It can run in-process for tests or as a real Connect/Node
gRPC-compatible HTTP/2 server backed by the framework's default in-memory
storage.

## Run

Generate protobuf output and build the workspace first:

```bash
pnpm typecheck:build
```

Start the standalone server:

```bash
pnpm --filter @spine-ts/example-todo start
```

The server listens on `http://127.0.0.1:8080` and exposes the copied Spine
`CommandService`, `QueryService`, and `SubscriptionService` contracts through
existing `SpineServices` adapters. Each process keeps its own in-memory state;
restart the process to clear tasks.

## What It Demonstrates

- `CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask` commands posted
  through `CommandService.Post`.
- Aggregate command handlers that update state and return domain events.
- Projection subscribers that update `TaskList` rows from delivered events.
- `QueryService.Read` for all task-list rows or a task-list row by projection
  ID.
- `SubscriptionService.Subscribe` and `Activate` for live `TaskList` projection
  updates.
- Validation failure acknowledgements with packed Spine validation details.
- Business refusal acknowledgements for completing an already completed task or
  reopening an open task.

See [USER_GUIDE.md](USER_GUIDE.md) for client snippets and the full workflow.
