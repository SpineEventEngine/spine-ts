# T-0009e.4: Public API Closure And Verification

Status: Implemented; Round 1 Review Fix Verified; Re-review Pending
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

## Closure Audit

Implementation audit on `2026-06-30 03:03 WEST`, with local audit fixes
applied afterward, found the integrated T-0009e public surface coherent without
runtime source changes:

- `packages/server/src/index.ts` exports the final entity shell,
  transactional-entity, family-marker, transaction, transition-validation,
  entity-metadata, decorator, handler-metadata, and registry surface.
- `packages/server/src/index.test.ts` checks the value exports from the server
  root and the public plain-version metadata type helpers.
- `scripts/check-api-docs.mjs` lists 72 expected `@spine-ts/server` TypeDoc
  exports, including `Entity`, `TransactionalEntity`, `Aggregate`,
  `Projection`, `ProcessManager`, `EntityFamily`,
  `PlainEntityVersionMetadata`, the transaction contracts, and the scope-error
  contracts.
- `docs/api/README.md`, `docs/USER_GUIDE.md`, `docs/architecture/README.md`,
  and `packages/server/README.md` describe the entity base-class surface and
  state that repositories, storage integration, handler invocation, dispatch,
  buses, transports, process workflow, query clients, command posting, lifecycle
  events, event history/snapshots, Java builders, automatic version increments,
  and async-local/global transaction state are deferred.
- No additional runtime behavior, repository seam, dispatch behavior, storage
  integration, lifecycle event behavior, or source-level JVM compatibility
  claim was added by this closure subtask.

## Round 1 Review Fix

Orchestrator-spawned Round 1 review found stale review-status wording only
across maintainability, documentation, security, TypeScript/API docs, and
performance/reliability lanes. No runtime, root export, TypeDoc export-check,
API-doc, public-doc content, security, performance, or reliability issue was
reported beyond the false protocol-review status wording.

Review-fix verification passed on `2026-06-30 03:40 WEST`:

- `corepack pnpm vitest run packages/server/src/entity.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 38 tests.
- `node scripts/check-api-docs.mjs` passed with 100 expected proto exports, 28
  core exports, 72 server exports, and 26 storage exports.
- `CI=true corepack pnpm verify` passed: node check, typecheck, lint, format
  check, 15 test files / 158 tests, coverage statements 97.25%, branches
  91.41%, functions 99.16%, lines 97.19%, TypeDoc/API checks, proto
  lint/generate, and generated-output clean.

Re-review is pending; the protocol review loop is not clean or closed yet.
