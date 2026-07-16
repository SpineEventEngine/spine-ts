# To-Do Example

A runnable local Spine TS application: generated Protobuf messages, bare-decorated
task handlers, a generated handler registry, a task-list projection, and real
Connect/Node `CommandService`, `QueryService`, and `SubscriptionService` routes.

## Run it

Prerequisites: Node 24 or newer and pnpm. From the repository root, install
workspace dependencies once with `pnpm install`, then generate and build:

```bash
pnpm typecheck:build
```

The build regenerates the ignored Protobuf and handler-registry artifacts under
`examples/todo/generated/` and compiles the runnable package under
`examples/todo/dist/`.

In terminal one, start the local server:

```bash
pnpm --filter @spine-ts/example-todo start
```

It listens on `http://127.0.0.1:8080`. In terminal two, post one generated
`CreateTask` command and wait for its projected `TaskList` row:

```bash
pnpm --filter @spine-ts/example-todo smoke
```

Set `SPINE_TODO_BASE_URL` when the server uses another local address. Stop the
server with `Ctrl-C` when finished.

## Focused tests

```bash
pnpm typecheck:build
pnpm vitest run examples/todo/test/black-box.test.ts
pnpm vitest run examples/todo/test/local-multi-process.test.ts
```

The black-box suite covers real loopback command, query, and subscription
behavior. The local multi-process suite proves a bounded same-host fixture;
it is not an application CLI. Managed sandboxes can reject loopback or local
IPC binding with `EPERM`; rerun those native tests where those permissions are
available.

## What it demonstrates

- `CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask` command paths.
- Asynchronous projection reads and live `TaskList` subscriptions.
- Non-OK validation errors and OK-acknowledged domain rejections whose
  best-effort follow-up posts may reach active, non-saturated subscriptions.
- Rejection subscription updates retain the typed payload but redact the
  rejected command and throwable stack at the client boundary.
- Generated `TaskAlreadyDone` and `TaskNotDone` throwable companions with
  ordinary bare `@Subscribe` consumers.
- Generated registry loading for bare `@Assign` and `@Subscribe` handlers.

Read the detailed [user guide](USER_GUIDE.md), the framework
[user guide](../../docs/USER_GUIDE.md), and the [server package README](../../packages/server/README.md).

## Limits

This is a local development and test example. Storage is in memory and belongs
to one server process; restart clears it. It does not provide production
persistence, authentication, deployment automation, tracing, health checks,
process supervision, or remote/multi-host transport.
