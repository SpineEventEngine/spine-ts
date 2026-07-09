# T-0017f Implementation Report

Status: `DONE_WITH_CONCERNS`
Date: `2026-07-09`
Worktree:
`.worktrees/T-0017f-process-manager-runtime`

## JVM Observations Used

- `ProcessManagerRepository` registers both command and event endpoints.
- Default process-manager command routing reads the first command field.
- Default process-manager event routing reads the first event message field,
  not the aggregate/projection producer-ID fallback.
- Process managers are created on demand and persisted as entity records.
- Process-manager command/event handlers mutate through the existing entity
  transaction boundary, and produced commands/events are posted after successful
  handling rather than by application-owned envelopes.

## Files Changed

- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `build-protocol/work-logs/T-0017f.md`
- `build-protocol/work-logs/T-0017f-implementation-report.md`

## Design Choices

- Reused the existing repository dispatcher adapters and added process-manager
  branches beside the aggregate/projection runtime branches.
- Reused `transactionalEntityAccess.start/commit/rollback`; no
  process-manager-specific transaction abstraction was introduced.
- Reused `Stand` for process-manager state load/create/store, including tenant
  options derived from command/event envelope context.
- Wrapped returned domain event/command messages inside framework `Event` and
  `Command` envelopes only after commit and changed-state storage.
- Allowed command handlers with no produced result; produced events are optional
  for process-manager command handlers.
- Kept durable inbox, delivery scheduler, durable subscription recovery,
  public schema-bearing decorators, `@Apply`, and end-user framework envelopes
  out of scope.

## Tests Run

- `pnpm --config.verify-deps-before-run=false install`
- `pnpm --config.verify-deps-before-run=false proto:generate`
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`
- `git diff --check`

## Concerns

- Full `verify` was not run.
- `format:check` currently fails on unrelated pre-existing
  `build-protocol/reviews/T-0017e-reactor-commanders.md`; touched files were
  formatted directly and `git diff --check` passed.
- Process-manager produced events use the current local event redispatch path;
  durable inbox/outbox semantics remain deferred to later delivery work.
