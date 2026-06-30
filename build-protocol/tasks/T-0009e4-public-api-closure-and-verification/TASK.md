# T-0009e.4: Public API Closure And Verification

Status: Started
Parent task: `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
Task log path:
`build-protocol/tasks/T-0009e4-public-api-closure-and-verification/TASK.md`
Branch: `task/T-0009e4-public-api-closure-and-verification`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e4-public-api-closure-and-verification`
Baseline commit: `94dd6d1`

## Objective

Close the `T-0009e` entity-base task by auditing the public API, docs, tests,
and durable logs after integrating the common entity shell, transactional
entity draft helpers, and family capability marker classes.

This subtask should not add new runtime behavior. It should make only the
minimal API/docs/test/log adjustments needed to ensure the parent T-0009e branch
is coherent, fully documented, verified, and ready for the next roadmap task.

## Required Context

Read before implementation:

- `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
- `build-protocol/tasks/T-0009e-entity-base-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e.md`
- `build-protocol/reviews/T-0009e-entity-base-classes.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`

## In Scope

- Audit and, if needed, update root exports, TypeDoc export checks, and
  `@spine-ts/server` public API tests so the final T-0009e public surface is
  intentional.
- Audit and, if needed, update API docs, architecture notes, package README,
  and user guide so they describe the final T-0009e entity base-class surface.
- Remove or correct stale T-0009e status text in task/report/work/review logs.
- Ensure docs continue to state that repositories, dispatch, storage, handler
  execution, buses, transports, query clients, process workflow, lifecycle
  events, event history/snapshots, Java builders, automatic version increments,
  and global transaction state are out of scope.
- Run focused checks plus full `CI=true corepack pnpm verify`.

## Out Of Scope

- New entity runtime features.
- Repository or bounded-context skeletons.
- Dispatch, transport, storage, process-worker, query, bus, service, or handler
  execution behavior.
- Changing copied Spine Protobuf contracts.

## Required Review

Every review round must use separate reviewer sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

All reviewer comments must be fed back to the authoring sub-agent. Review
rounds continue until all five lanes are clean. Each participating sub-agent
must be closed after its role is complete.

## Blocking Questions

None known.
