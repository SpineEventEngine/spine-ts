# To-Do example reference

This reference is for coding agents and maintainers. Beginners should start
with the [To-Do README](README.md) and [walkthrough](USER_GUIDE.md).

## Responsibilities

The package contains the To-Do Proto model, generated model module, Aggregate and
Projection handlers, generated handler registry, local server entry point, and
smoke client. Generated Proto and registry output is ignored build output;
regenerate it through package/workspace scripts rather than editing it.

The example covers `CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask`.
Validation failures produce non-OK responses. Domain rejections remain
OK-acknowledged command admission results and are published separately as typed
rejection events. Client-visible rejection updates redact rejected-command
payload forms and throwable stacks.

## Commands

```bash
pnpm --filter @spine-event-engine/example-todo start
pnpm --filter @spine-event-engine/example-todo smoke
pnpm vitest run examples/todo/test/black-box.test.ts
pnpm vitest run examples/todo/test/local-multi-process.test.ts
```

Set `SPINE_TODO_BASE_URL` when the smoke client must use another local address.
The server reports readiness only after binding and closes on `SIGINT` or
`SIGTERM`.

## Limits

The black-box suite covers command, query, and subscription behavior through a
real loopback client. The multi-process suite is a same-host test, not an
application CLI or a multi-machine delivery proof. Managed sandboxes may deny
listener or IPC binding with `EPERM`.
