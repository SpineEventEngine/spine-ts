# Implementation Report: T-0009e.2 TransactionalEntity Scoped Draft Helpers

Status: Implementation Complete; Round 9 Docs Follow-Up In Progress
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
- Round 4 docs-only cleanup verification `CI=true corepack pnpm verify` passed
  on `2026-06-30 01:16 WEST`: 15 test files / 152 tests; coverage statements
  97.23%, branches 91.41%, functions 99.15%, lines 97.17%; TypeDoc/API/proto
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
- Round 3 reviewed committed range `4246385..bd4052a`; result: documentation
  cleanup requested. TypeScript/API docs and security returned clean; the
  accepted findings are stale live-state/risk-routing text after Round 2 had
  completed.
- Round 3 docs-only cleanup verification passed on `2026-06-30 01:07 WEST`:
  full `CI=true corepack pnpm verify` passed with 15 test files / 152 tests,
  coverage 97.23% statements / 91.41% branches / 99.15% functions / 97.17%
  lines, TypeDoc/API/proto gates passed with 68 expected server exports, and
  generated proto output clean.
- Round 4 reviewed the Round 3 docs-only cleanup; result: documentation cleanup
  requested. Maintainability
  `019f15dc-24cf-78a1-ac58-d4e5881b6c14`, documentation
  `019f15dc-2559-7c01-b77c-2927c0f0b10b`, and performance/reliability
  `019f15dc-26d2-7f70-980d-b80982201e4b` returned P3 findings and were closed.
  TypeScript/API `019f15dc-25c8-7532-98e8-9d5183d81e03` and security
  `019f15dc-2662-7933-93ca-0d5915a64995` returned clean and were closed.
- Round 4 docs-only follow-up updates stale live reviewer status, marks the
  rejected-result risk as completed with no current follow-up, restores
  chronological review-log ordering, and records the Round 4 result in durable
  logs.
- Round 4 docs-only cleanup verification passed on `2026-06-30 01:16 WEST`:
  full `CI=true corepack pnpm verify` passed with 15 test files / 152 tests,
  coverage 97.23% statements / 91.41% branches / 99.15% functions / 97.17%
  lines, TypeDoc/API/proto gates passed with 68 expected server exports, and
  generated proto output clean.
- Round 5 reviewed committed range `23b757f..f97701a`; all five lanes returned
  clean and were closed. The review confirmed the Round 4 accepted findings are
  fixed, the review log is chronological, the rejected-result risk routing is
  completed with no current follow-up, no API/runtime files changed in the
  reviewed range, and no secrets or sensitive payloads were added.
- Round 6 reviewed committed range `f97701a..623f0d7`; documentation and
  maintainability requested stale status/table cleanup, while TypeScript/API,
  security, and performance/reliability returned clean. The docs-only fix was
  verified on `2026-06-30 01:28 WEST` with full
  `CI=true corepack pnpm verify`: 15 test files / 152 tests, coverage 97.23%
  statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.
- Round 7 reviewed committed range `623f0d7..b9456dc`; documentation and
  maintainability requested timestamp/current-state cleanup, while
  TypeScript/API, security, and performance/reliability returned clean. Round 7
  docs-only cleanup was verified on `2026-06-30 01:31 WEST`.
- Round 8 reviewed committed range `b9456dc..f3a067d`; maintainability and
  documentation requested chronology/fix-evidence cleanup, while
  TypeScript/API, security, and performance/reliability returned clean. The
  accepted docs-only cleanup is implemented and awaiting verification.
