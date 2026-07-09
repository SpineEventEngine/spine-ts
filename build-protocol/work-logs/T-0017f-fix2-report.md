# T-0017f Second-Fix Report

Status: `DONE`
Date: `2026-07-09`
Worktree:
`.worktrees/T-0017f-process-manager-runtime`

## Findings Addressed

- API docs: clarified the Repository/RepositoryOptions boundary for
  process-manager runtime execution. The section now names command assignees,
  event reactors, event-commanding handlers, tenant-scoped `Stand` storage with
  numeric versions, and process-manager-emitted event schemas.
- Reliability regression: added a focused process-manager event-handler test in
  `packages/server/test/repository/repository-routing.test.ts` for one source
  event flush producing both an event and a command. The test locks the current
  policy: process-manager state is stored, the produced event is appended and
  dispatched as follow-up work, the produced command is attempted afterward, and
  the command dispatch failure rejects the source event post.

## Files Changed

- `build-protocol/work-logs/T-0017f.md`
- `build-protocol/work-logs/T-0017f-fix2-report.md`
- `docs/api/README.md`
- `packages/server/test/repository/repository-routing.test.ts`

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with 1 test file and 97 tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed with the
  existing invalid-origin source-link warning from TypeDoc.
- `pnpm --config.verify-deps-before-run=false format:check` initially found
  formatting in `packages/server/test/repository/repository-routing.test.ts`;
  Prettier was run on the second-fix touched files and the focused routing test
  passed again.
- Final `pnpm --config.verify-deps-before-run=false format:check` passed.
- Final `git diff --check` passed.

## Concerns

- Durable inbox handoff, scheduler/retry loops, retained attempt history, and
  durable cross-process recovery remain deferred by the task boundary.
