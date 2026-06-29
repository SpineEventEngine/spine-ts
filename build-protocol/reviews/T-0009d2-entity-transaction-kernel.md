# Review Log: T-0009d.2 Entity Transaction Draft/Result Kernel

Task log:
`build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
Work log: `build-protocol/work-logs/T-0009d2.md`
Branch: `task/T-0009d2-entity-transaction-kernel`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2-entity-transaction-kernel`
Baseline commit: `3d08195`

## Review Requirements

Every review round must include separate sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewers must inspect the committed range for this task, report findings with
file/line references when possible, and explicitly state whether their role is
clean. The orchestrator must close every reviewer after result capture.

## Round 1

Review of committed `T-0009d.2a` implementation produced accepted P1/P2
findings. Required review roles:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewer risk focus from the splitter:

- reject speculative storage, repositories, handler invocation, dispatcher
  phases, buses, gRPC, or ZeroMQ;
- confirm `commit()` uses `validateEntityStateTransition()` before accepted
  results;
- confirm ordinary validation failure returns structured data and does not
  encourage mutation bypasses;
- keep generics useful but simple; and
- ensure docs say this is a buffered transaction boundary, not a complete
  runtime.

Implementation evidence available to reviewers:

- RED focused Vitest failed before implementation because transaction runtime
  exports were missing.
- GREEN focused Vitest passed after implementation: 2 files / 16 tests.
- Full `CI=true corepack pnpm verify` passed after implementation: 14 test
  files / 118 tests; coverage statements 97.51%, branches 90.28%, functions
  100%, lines 97.46%.
- D-0041 records the minimal status policy: validation-rejected commit results
  leave the transaction active; accepted commit and rollback close it.

Round 1 reviewer outcomes captured for fix round 1:

| Reviewer                | Finding                                                                                                                                           | Disposition                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Documentation           | P2: `docs/USER_GUIDE.md` does not mention the now-available buffered entity transaction boundary or its exclusions.                               | Accepted. Add a short user guide update with a minimal `createEntityTransaction()` example and explicit non-goals.     |
| Performance/reliability | P2: add focused assertions for rollback-after-commit, rollback-after-rollback, rejected-commit-then-rollback, and throwing `update()` invariants. | Accepted. Add focused Vitest coverage; preserve D-0041 rejected-commit active behavior.                                |
| TypeScript/API docs     | P1: `scripts/check-api-docs.mjs` `expectedServerExports` omits intended transaction exports.                                                      | Accepted. Add all intended transaction exports from `packages/server/src/index.ts`.                                    |
| TypeScript/API docs     | P2: `docs/api/README.md` server overview should mention the transaction kernel and commit/rollback behavior.                                      | Accepted. Update API docs overview.                                                                                    |
| TypeScript/API docs     | P2: version metadata should be generic so draft metadata flows to accepted committed metadata with caller type preserved.                         | Accepted. Parameterize transaction metadata/options/results with simple `Version = unknown` generics and add coverage. |

Round 1 fix plan:

- Record this review-fix worker's canonical skill applicability check in the
  task/report/work logs before implementation edits.
- Add focused assertions first. If they pass against existing behavior, record
  the finding as assertion-only coverage rather than a production RED.
- Update the transaction type surface with generic version metadata while
  keeping runtime behavior unchanged and small.
- Update API docs, user guide, and TypeDoc export expectations.
- Run targeted Vitest, typecheck, docs check, format check, lint, and full
  `CI=true corepack pnpm verify` if feasible before committing.

Round 1 fix evidence:

| Finding                    | Fix Evidence                                                                                                                                                                                             | Verification                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation P2           | `docs/USER_GUIDE.md` now lists the buffered entity transaction boundary, includes a minimal `createEntityTransaction()` example, and names the excluded runtime/storage/transport/global-state behavior. | `corepack pnpm docs:check` passed on `2026-06-29 20:33 WEST` with the known TypeDoc invalid-origin warning.                                                                                                  |
| Performance/reliability P2 | `packages/server/src/entity-transaction.test.ts` now asserts rollback-after-commit, rollback-after-rollback, rejected-commit-then-rollback, and throwing `update()` invariants.                          | Focused Vitest passed before production changes on `2026-06-29 20:31 WEST`, so this was assertion-only coverage for existing behavior; focused Vitest passed again after changes on `2026-06-29 20:33 WEST`. |
| TypeScript/API P1          | `scripts/check-api-docs.mjs` `expectedServerExports` now includes all intended transaction exports from `packages/server/src/index.ts`.                                                                  | `corepack pnpm docs:check` passed and reported 56 expected `@spine-ts/server` exports.                                                                                                                       |
| TypeScript/API docs P2     | `docs/api/README.md` now mentions the transaction kernel and accepted/rejected commit plus rollback behavior.                                                                                            | `corepack pnpm docs:check` passed on `2026-06-29 20:33 WEST`.                                                                                                                                                |
| TypeScript/API P2          | Transaction options, metadata, class, commit, rollback, and factory APIs now carry `Version = unknown`; accepted commit metadata preserves the caller version type.                                      | Type-level RED `corepack pnpm typecheck` failed on `unknown` committed metadata at `20:31 WEST`; GREEN `corepack pnpm typecheck` passed at `20:33 WEST`.                                                     |

All assigned findings were accepted. No reviewer comment was rejected. No
sub-agents were spawned for the fix.
