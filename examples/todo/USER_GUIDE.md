# To-Do Example User Guide

This application is a local, runnable specimen of the public Spine TS API. It
uses generated messages and a framework-generated registry for bare-decorated
handlers. Begin with the concise [README](README.md) for prerequisites, build,
server, and smoke commands.

## Build and server lifecycle

From the repository root, run `pnpm typecheck:build`. It generates
`examples/todo/generated/handler/generated-handler-registry.ts` and compiles
the package. Both generated and compiled directories are ignored.

Start the process with:

```bash
pnpm --filter @spine-ts/example-todo start
```

It creates a local `http://127.0.0.1:8080` server over one in-memory bounded
context. For programmatic local tests, the public package exports
`startTodoServer({ host: "127.0.0.1", port: 0 })`; always call the returned
server's `close()` method. The command-line process owns its listener until
`Ctrl-C` stops it. Each start has fresh in-memory state.

`createTodoContext()` adds `TaskAggregate` and `TaskListProjection`, then loads
the compiled registry from the package root before `buildAsync()`. If the
generated registry is missing or unreadable, context creation fails with its
module path; rerun `pnpm typecheck:build` and retry. Application handlers keep
their bare `@Assign` and `@Subscribe` decorators: they do not manually register
handler schemas.

## Post commands and inspect acknowledgements

Use generated schemas and public clients. The checked-in `pnpm --filter
@spine-ts/example-todo smoke` program is the executable CreateTask example: it
owns an `Http2SessionManager`, bounds the command and eventual query, checks an
OK acknowledgement, and aborts its session in `finally`.

`CreateTask` needs a task ID and non-empty title. `RenameTask` changes the title;
`CompleteTask` marks it done; `ReopenTask` marks it open. All use the same
`CommandService.Post` envelope shape as the smoke program, replacing only the
generated command schema/message.

An OK acknowledgement confirms the immediate command path, not that an
asynchronous projection is visible. Query or subscribe for that observable
effect. Invalid accepted payloads return `COMMAND_VALIDATION_ERROR` with packed
`spine.validation.ValidationError` details. Completing an already completed
task returns `TASK_ALREADY_DONE`; reopening an open task returns
`TASK_NOT_DONE`. Those non-OK acknowledgements leave the task-list state
unchanged.

## Query task lists

Every `TaskList` projection row has the task ID as its projection ID. Build a
generated `Query` whose target type is `deriveTypeUrl(TaskListSchema)`, and use
one of these criteria shapes:

```ts
// all task-list rows
criterion: { case: "includeAll", value: true }

// one exact row ID
criterion: {
  case: "filters",
  value: create(TargetFiltersSchema, {
    idFilter: {
      id: [packAny(StringValueSchema, create(StringValueSchema, { value: "task-1" }))],
    },
  }),
}

// rows whose declared proto column open_task_count equals one
criterion: {
  case: "filters",
  value: create(TargetFiltersSchema, {
    filter: [create(CompositeFilterSchema, {
      filter: [create(FilterSchema, {
        fieldPath: { fieldName: ["open_task_count"] },
        value: packAny(Int32ValueSchema, create(Int32ValueSchema, { value: 1 })),
        operator: Filter_Operator.EQUAL,
      })],
      operator: CompositeFilter_CompositeOperator.ALL,
    })],
  }),
}
```

Use `QueryService.Read`, unpack each returned row state with
`unpackAny(row.state, TaskListSchema)`, and poll only to a deadline when waiting
for a projection consequence. See the runnable smoke and
[`black-box.test.ts`](test/black-box.test.ts) for complete imports and requests.

## Subscribe safely

For a live view, create a `Topic` with the same `TaskList` target, call
`SubscriptionService.Subscribe`, and pass the returned subscription to
`activate()`. Start consuming the async iterator before posting the command
whose update you need. Bound activation/next calls with an abort signal or a
deadline. Cleanup has three parts: abort the stream, call `cancel(subscription)`,
then call `iterator.return?.()` (or let `for await` finish). If the client owns
an `Http2SessionManager`, call `session.abort()` in `finally` too.

The smoke deliberately does not subscribe; the black-box suite is the
subscription acceptance proof. Active streams and queued updates are
process-local, and this guide does not promise update replay after disconnect
or restart.

## Test the supported paths

From a clean generated state:

```bash
pnpm typecheck:build
pnpm vitest run examples/todo/test/black-box.test.ts
pnpm vitest run examples/todo/test/local-multi-process.test.ts
```

The black-box test starts a real loopback server and proves public generated
clients, acknowledgement handling, eventual projection reads, subscriptions,
validation/refusals, generated-registry recovery, and listener/session cleanup.

The local multi-process test starts a separate child process and same-host
ZeroMQ IPC fixture, sends one generated command from the parent, and reads the
child-owned projected row. Its cleanup stops the child, closes the parent
listener and transport, and removes the temporary IPC directory on success and
failure paths. It is a focused test fixture—not a public multi-process
supervisor or CLI. Sandboxes that deny loopback/IPC binds can report `EPERM`;
run the native test in an environment that permits those local resources.

## Further reading and limits

- [Framework user guide](../../docs/USER_GUIDE.md)
- [Server package README](../../packages/server/README.md)
- [Testing package README](../../packages/testing/README.md)
- [Transport package README](../../packages/transport/README.md)
- [Example black-box test](test/black-box.test.ts)
- [Example local multi-process test](test/local-multi-process.test.ts)

The example is local-only and process-local: no production persistence,
authentication, deployment, tracing, health checking, process supervision, or
remote/multi-host transport is provided. Restarting the standalone server clears
its tasks.
