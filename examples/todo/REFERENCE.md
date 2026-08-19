# To-Do example reference

This reference is for coding agents and maintainers. Beginners should start
with the [To-Do README](README.md) and [walkthrough](USER_GUIDE.md).

## Responsibilities

The package contains the To-Do Proto model, generated model module, Aggregate and
Projection handlers, generated handler registry, local server entry point, and
smoke client. Generated Proto and registry output is ignored build output;
regenerate it through package/workspace scripts rather than editing it.

The example covers `CreateTask`, `AssignTask`, `ReassignTask`, `UnassignTask`,
`RenameTask`, `CompleteTask`, and `ReopenTask`.
Validation failures produce non-OK responses. Domain rejections remain
OK-acknowledged command admission results and are published separately as typed
rejection events. Client-visible rejection updates redact rejected-command
payload forms and throwable stacks.

## Commands

```bash
pnpm --filter @spine-event-engine/example-todo start
pnpm --filter @spine-event-engine/example-todo smoke
pnpm vitest run examples/todo/test/black-box.test.ts
```

Set `SPINE_TODO_BASE_URL` when the smoke client must use another local address.
The server reports readiness only after binding and closes on `SIGINT` or
`SIGTERM`.

## Limits

The black-box suite covers command, query, and subscription behavior through a
real loopback client. Development starts one application process. A deployment
may instead configure a managed process count: every child is a complete
application replica, the Coordinator forwards front-facing requests, and every
child observes Delivery directly. Managed sandboxes may deny listener binding
with `EPERM`.

## Interface-routing contract

`task_events.proto` declares `(every_is).ts_type = "TaskEvent"` with
`generate = true`; its generated interface/token is at
`generated/interfaces/task-event.ts`. `TaskAssigned` and `TaskUnassigned`
declare `(is).ts_type = "TaskAssignmentEvent"`; their authored interface is in
`src/index.ts`, and its generated token is at
`generated/interfaces/task-assignment-event.ts`. The authored declaration must
stay in that model module; its property types may come from other modules.

Event routing chooses an exact schema route, then the first registered matching
interface token, then the replacement/default route. At accepted admission it
calculates and stores typed targets once; retries reuse them. Catch-up rebuilds
the read side deliberately. `TaskReassigned` has an exact two-assignee route;
the assignment token covers assign and unassign. TypeScript consumes `ts_type`,
ignores Java-only options, and creates no semantic tags or topics.

Generated TypeScript carries generation provenance and no copyright header.
Do not edit it. Regenerate with `pnpm proto:generate`.

| Attempt                                      | Rejection             |
| -------------------------------------------- | --------------------- |
| Any assignment operation on a completed task | `TaskAlreadyDone`     |
| Assign when already assigned                 | `TaskAlreadyAssigned` |
| Reassign or unassign with no assignee        | `TaskNotAssigned`     |
| Reassign to the current assignee             | `TaskAlreadyAssigned` |

`TaskList.id` moved to field 4 and field 1 is reserved. Snapshots reset; there
is no automatic migration or ID inference.
