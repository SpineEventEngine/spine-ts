# T-0017n: Verification Gate Fix

Status: complete, pending integration
Started: `2026-07-09`
Branch: `task/T-0017n-verification-typecheck-fix`
Worktree:
`.worktrees/T-0017n-verification-typecheck-fix`
Base commit: `f72daaa`

## Objective

Make full `pnpm --config.verify-deps-before-run=false verify` pass after
T-0017 closure.

## Scope

- Fix the initial TypeScript error in
  `packages/server/test/services/spine-services.test.ts` around the
  durable-subscription seeded test storage helper.
- Keep production storage typings intact.
- Treat later failures from the same full verification gate as part of this
  task until `verify` passes end-to-end.
- Fix lint and cleanup-rule failures without overengineering runtime code.
- Update user-facing docs when public API names change.
- Add focused runtime tests when verification exposes real behavior or coverage
  gaps.
- Update durable logs and run the required review loop.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for this task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back and repeat until all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.

## Acceptance Criteria

- `pnpm --config.verify-deps-before-run=false typecheck:generated` passes.
- Focused `spine-services` subscription tests still pass.
- The fix does not weaken production storage typings.
- Local transport registration keeps synchronous readiness timing while
  returning rejected promises for validation failures.
- Full `pnpm --config.verify-deps-before-run=false verify` passes before
  integration.

## Verification Plan

- `pnpm --config.verify-deps-before-run=false typecheck:generated`.
- Focused `spine-services` subscription tests.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- Full `pnpm --config.verify-deps-before-run=false verify`.
