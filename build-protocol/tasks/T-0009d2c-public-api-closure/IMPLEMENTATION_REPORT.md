# Implementation Report: T-0009d.2c Public API Polish, Compatibility Notes, Verification Closure

Status: Complete; Integration Pending
Task log: `build-protocol/tasks/T-0009d2c-public-api-closure/TASK.md`
Work log: `build-protocol/work-logs/T-0009d2c.md`
Review log: `build-protocol/reviews/T-0009d2c-public-api-closure.md`
Branch: `task/T-0009d2c-public-api-closure`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2c-public-api-closure`

## Summary

Polished the public `EntityTransaction` compatibility notes and parent
roadmap/evidence logs without changing runtime behavior. The docs now describe
`EntityTransaction` as a framework-owned, in-memory draft/result boundary and
explicitly exclude storage-backed transactions, repository units of work,
dispatch phases, lifecycle event emission, and async-local/global transaction
state.

## JVM Research Used

The closure starts from the JVM research used by `T-0009d.2a` and
`T-0009d.2b`: Spine JVM `Transaction` buffers state/lifecycle/version metadata
inside an active transaction, `TransactionalEntity` delegates lifecycle changes
to the transaction, and `VersionIncrement` remains phase/runtime-owned.

No new runtime behavior should be added in this closure slice without recording
additional task-relevant JVM source inspection first.

No additional JVM source inspection was needed during implementation because no
new runtime behavior was added or considered.

## Files Changed

- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
- `build-protocol/tasks/T-0009d2c-public-api-closure/TASK.md`
- `build-protocol/tasks/T-0009d2c-public-api-closure/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009d2.md`
- `build-protocol/work-logs/T-0009d2c.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`

## Verification

- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:25 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- `corepack pnpm format:check` passed on `2026-06-29 21:35 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 21:35 WEST` with the known
  invalid-origin TypeDoc warning; API export counts remained 100 proto, 28
  core, 59 server, and 26 storage.
- Final `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:35 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- Round 1 fix stale-marker search passed on `2026-06-29 21:43 WEST`: the
  required `rg -n` search returned no matches.
- Round 1 fix `corepack pnpm format:check` passed on
  `2026-06-29 21:43 WEST`.
- Round 1 fix `git diff --check` passed on `2026-06-29 21:43 WEST`.
- Round 2 TypeScript/API review ran `node scripts/check-api-docs.mjs`, which
  passed with 100 proto, 28 core, 59 server, and 26 storage expected exports.
- Round 2 TypeScript/API and performance/reliability reviews ran
  `git diff --check 4807f6f..b6abcd6`, which passed.
- Final branch `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:50 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.

## Skills And Scope Notes

- `test-driven-development`: read and applied as a guard. No production
  behavior or API assertion tests changed, so no RED/GREEN cycle was required.
- `typescript-advanced-types`: read and applied by preserving the existing
  simple generic public API shape.
- `verification-before-completion`: read and applied; fresh verification is
  required before completion claims and commit.
- `subagent-driven-development`: read and applied only for durable-log
  discipline. No sub-agents were spawned, matching the task prompt.

No new decision was needed; D-0043 already governs this closure boundary.

## Review

- Round 1 reviewed implementation commit `e606cff`; all five reviewers were
  closed.
- Accepted P2: the review log still described the implementation commit as
  pending after `e606cff` existed, creating an interruption risk for resumed
  workers.
- Fix route: updated only durable task/review/work/report logs so the current
  state, accepted finding, and verification evidence are unambiguous. No
  runtime/source behavior or public docs are in scope for this fix.
- The review-fix implementation sub-agent spawned no sub-agents.
- Round 2 reviewed fix commit `b6abcd6`; all five required roles reported
  clean and every reviewer sub-agent was closed after result capture.
