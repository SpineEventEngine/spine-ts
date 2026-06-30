# Implementation Report: T-0009e.2 TransactionalEntity Scoped Draft Helpers

Status: Implementation Complete; Review Pending
Task log:
`build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/TASK.md`
Work log: `build-protocol/work-logs/T-0009e2.md`
Review log:
`build-protocol/reviews/T-0009e2-transactional-entity-draft-helpers.md`
Branch: `task/T-0009e2-transactional-entity-draft-helpers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e2-transactional-entity-draft-helpers`

## Summary

Authoring sub-agent `019f15ba-f2f2-7f21-a244-bd61564e0eb6` (Aquinas the 3rd)
implemented the scoped `TransactionalEntity` base over the existing
`EntityTransaction` kernel. The new base exposes protected helpers for one
active draft transaction, draft state/version/lifecycle updates,
accepted-commit application, rollback, missing/duplicate scope errors, and a
small `changed` signal for accepted state changes or committed lifecycle flag
changes. Rejected commits intentionally keep the transaction active for
correction or explicit rollback and do not apply state, version, or lifecycle to
the entity.

## JVM Research Used

Setup inspected Spine JVM transaction/entity code listed in the task log. The
implementation must stay close to the JVM concept that state, version, and
lifecycle changes are buffered inside an active transaction and applied to the
entity only on commit, while keeping this TypeScript slice smaller than
repositories, handlers, phase propagation, storage, and lifecycle events.

## Files Changed

- `packages/server/src/entity.ts`
- `packages/server/src/entity.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/TASK.md`
- `build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e2.md`
- `build-protocol/reviews/T-0009e2-transactional-entity-draft-helpers.md`

## Verification

- Baseline `CI=true corepack pnpm verify` passed on `2026-06-30 00:31 WEST`:
  15 test files / 145 tests; coverage statements 97.31%, branches 91.28%,
  functions 100%, lines 97.25%; TypeDoc/API reported 100 proto, 28 core, 64
  server, and 26 storage expected exports; proto lint/generate/check passed with
  generated output clean.
- RED focused test run on `2026-06-30 00:36 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  failed because `TransactionalEntity` was undefined and root exports were
  missing, as expected before production implementation.
- GREEN focused test run on `2026-06-30 00:37 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 31 tests.
- `corepack pnpm typecheck` passed on `2026-06-30 00:38 WEST`.
- `corepack pnpm lint` passed on `2026-06-30 00:40 WEST`.
- `corepack pnpm format:check` passed on `2026-06-30 00:40 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-30 00:41 WEST`: TypeDoc/API
  reported 100 proto, 28 core, 68 server, and 26 storage expected exports.
- Final `CI=true corepack pnpm verify` passed on `2026-06-30 00:41 WEST`: 15
  test files / 151 tests; coverage statements 97.22%, branches 91.37%,
  functions 99.14%, lines 97.16%; TypeDoc/API/proto gates passed and generated
  proto output was clean.
- Root-session verification `CI=true corepack pnpm verify` passed on
  `2026-06-30 00:44 WEST`: 15 test files / 151 tests; coverage statements
  97.22%, branches 91.37%, functions 99.14%, lines 97.16%; TypeDoc/API/proto
  gates passed with 68 expected server exports and generated proto output clean.

## Review

- Round 1 reviewed committed range `4e250b2..a7acaca`; result: changes
  requested.
- Accepted P2 security/reliability finding: `commitTransaction()` returned raw
  rejected commit results whose `version.draft` still aliased the active
  transaction's draft version metadata.
- Accepted P2/P3 documentation/maintainability finding: live durable logs still
  described implementation commit/reviewer dispatch as pending or pointed at the
  implementation-only commit instead of the reviewed range.
- Fix route: add a RED regression for rejected commit result version aliasing,
  return cloned version evidence from `commitTransaction()` for accepted and
  rejected outcomes, update stale live status wording, and rerun the review
  loop.
- Round 1 fix implemented and verified on `2026-06-30 00:53 WEST`: focused
  RED/GREEN showed the rejected-result aliasing regression fail and then pass;
  typecheck, lint, format check, docs check, and full
  `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.
- Round 2 reviewed committed range `a7acaca..4246385`; result: documentation
  cleanup requested. Maintainability, TypeScript/API docs, security, and
  performance/reliability returned clean. The accepted docs-only finding is the
  stale top-level reviewer status line in `TASK.md`.
- Round 2 docs-only cleanup verification passed on `2026-06-30 00:59 WEST`:
  full `CI=true corepack pnpm verify` passed with 15 test files / 152 tests,
  coverage 97.23% statements / 91.41% branches / 99.15% functions / 97.17%
  lines, TypeDoc/API/proto gates passed with 68 expected server exports, and
  generated proto output clean.
