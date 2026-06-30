# Implementation Report: T-0009e.4 Public API Closure And Verification

Status: Complete; Integrated into parent branch as `f499ca8`; Parent Integration Verified
Task log:
`build-protocol/tasks/T-0009e4-public-api-closure-and-verification/TASK.md`
Work log: `build-protocol/work-logs/T-0009e4.md`
Review log:
`build-protocol/reviews/T-0009e4-public-api-closure-and-verification.md`
Branch: `task/T-0009e4-public-api-closure-and-verification`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e4-public-api-closure-and-verification`
Baseline commit: `94dd6d1`

## Summary

The closure audit found the T-0009e public API, TypeDoc export check, package
README, API guide, user guide, and architecture notes coherent at the parent
surface integrated by T-0009e.1, T-0009e.2, and T-0009e.3. Local audit passes
identified missing explicit public-doc mentions that Java builders remain
deferred, so this subtask updates that wording plus durable task/report/work/
review logs. Local implementation audit passes found parent closure evidence
gaps, which are also corrected. No runtime source, root export, or API-check
changes were needed. Orchestrator-spawned Round 1 review later found stale
review-status wording in durable logs only; Round 2 found stale chronology that
contradicted the public-doc Java-builder deferral updates. Review-fix updates
were applied and Round 2 fix verification passed. Round 4 re-review returned
clean across all five required lanes. Final verification passed, and the
subtask was merged into the parent branch as `f499ca8`, and parent integration
verification passed. Final parent review remains pending after the follow-up
final-parent-review fixes. A later final parent re-review found protected
`withStoredState()` API exposure in the parent runtime source; the superseding
parent fix removes that API and keeps final parent re-review pending.

## Files Changed

- `build-protocol/tasks/T-0009e4-public-api-closure-and-verification/TASK.md`
- `build-protocol/tasks/T-0009e4-public-api-closure-and-verification/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e4.md`
- `build-protocol/reviews/T-0009e4-public-api-closure-and-verification.md`
- `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
- `build-protocol/tasks/T-0009e-entity-base-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `packages/server/README.md`

## Verification

- Dependency hydration `corepack pnpm install` passed on `2026-06-30 02:59 WEST`
  using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on `2026-06-30 03:00 WEST`:
  15 test files / 158 tests; coverage 97.25% statements, 91.41% branches,
  99.16% functions, 97.19% lines; TypeDoc/API/proto gates passed with 72
  expected server exports and generated proto output clean.
- Final focused `corepack pnpm vitest run packages/server/src/entity.test.ts
packages/server/src/index.test.ts` passed on `2026-06-30 03:11 WEST`: 2 test
  files / 38 tests.
- Final `node scripts/check-api-docs.mjs` passed on `2026-06-30 03:11 WEST`:
  TypeDoc JSON included 100 expected proto exports, 28 core exports, 72 server
  exports, and 26 storage exports.
- Final full `CI=true corepack pnpm verify` passed on `2026-06-30 03:11 WEST`:
  node check, typecheck, lint, format check, 15 test files / 158 tests, coverage
  97.25% statements / 91.41% branches / 99.16% functions / 97.19% lines,
  TypeDoc/API checks with 72 expected server exports, proto lint/generate, and
  generated-output clean.
- Round 1 review-fix verification first exposed markdown formatting drift in
  `build-protocol/reviews/T-0009e4-public-api-closure-and-verification.md`,
  `build-protocol/work-logs/T-0009e.md`, and
  `build-protocol/work-logs/T-0009e4.md`; targeted Prettier formatting fixed
  those files.
- Final review-fix focused `corepack pnpm vitest run
packages/server/src/entity.test.ts packages/server/src/index.test.ts` passed on
  `2026-06-30 03:40 WEST`: 2 test files / 38 tests.
- Final review-fix `node scripts/check-api-docs.mjs` passed on
  `2026-06-30 03:40 WEST`: TypeDoc JSON included 100 expected proto exports, 28
  core exports, 72 server exports, and 26 storage exports.
- Final review-fix full `CI=true corepack pnpm verify` passed on
  `2026-06-30 03:40 WEST`: node check, typecheck, lint, format check, 15 test
  files / 158 tests, coverage 97.25% statements / 91.41% branches / 99.16%
  functions / 97.19% lines, TypeDoc/API checks with 72 expected server exports,
  proto lint/generate, and generated-output clean.
- Round 2 review-fix verification passed: the required stale-wording scan
  exited 1 with no matches, `node scripts/check-api-docs.mjs` exited 0 with 100
  expected proto exports, 28 core exports, 72 server exports, and 26 storage
  exports, and `CI=true corepack pnpm verify` exited 0 with 15 test files / 158
  tests plus coverage/API/proto/generated gates clean.
- Final verification `CI=true corepack pnpm verify` passed on
  `2026-06-30 04:13 WEST`: 15 test files / 158 tests, coverage 97.25%
  statements / 91.41% branches / 99.16% functions / 97.19% lines, TypeDoc/API
  checks with 72 expected server exports, proto lint/generate, and
  generated-output clean.
- Final-parent-review fix verification passed on `2026-06-30 04:30 WEST`:
  focused entity/root tests passed with 2 files / 39 tests; API docs check
  passed with 100 proto / 28 core / 72 server / 26 storage expected exports;
  full `CI=true corepack pnpm verify` passed with 15 test files / 159 tests,
  coverage 97.26% statements / 91.41% branches / 99.17% functions / 97.2%
  lines, TypeDoc/API/proto/generated gates clean; and the required
  stale-terminal-wording scan exited 1 with no matches.

## Review

The implementation sub-agent recorded local audit/fix passes.
Orchestrator-spawned Round 1 review found stale review-status wording only,
with no runtime, API, public-doc content, security, or reliability issues
beyond that wording. Round 2 re-review found stale chronology wording that said
the public docs set was unchanged, contradicting the Java-builder deferral
wording that was added to public docs. Review-fix updates corrected that
chronology and Round 2 fix verification passed. Round 4 re-review returned
clean across all five required lanes, and all Round 4 reviewer sub-agents were
closed by the orchestrator. Final verification passed, the subtask was merged
into the parent branch as `f499ca8`, and parent integration verification passed.
Final parent review remains pending after the follow-up final-parent-review
fixes. A later final parent re-review rejected the protected `withStoredState()`
optimization as subclass-facing API that exposed a live stored-state reference;
the parent branch fix removes that API and accepts the public cloned state
snapshot boundary for transaction start. No clean final parent re-review is
claimed here. Final-parent-re-review fix verification passed on
`2026-06-30 04:43 WEST`: API docs check, focused entity/root tests, full verify,
and the required `withStoredState` scan all passed with no generated-doc or
implementation-source matches for the removed API.
