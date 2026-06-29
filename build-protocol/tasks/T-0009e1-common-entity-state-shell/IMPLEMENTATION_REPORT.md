# Implementation Report: T-0009e.1 Common Entity State Shell

Status: Review Fix Required
Task log: `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
Work log: `build-protocol/work-logs/T-0009e1.md`
Review log: `build-protocol/reviews/T-0009e1-common-entity-state-shell.md`
Branch: `task/T-0009e1-common-entity-state-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e1-common-entity-state-shell`

## Summary

Implemented the first common abstract `Entity` OOP state shell for
`@spine-ts/server`. The class exposes stable identity, generated schema,
descriptor-derived `EntityMetadata`, cloned Protobuf-ES state snapshots,
caller-owned version metadata snapshots, lifecycle flags, `isActive`,
`isArchived`, `isDeleted`, and sticky lifecycle-change tracking. Protected
hooks allow future framework-owned subclasses to replace accepted state, version
metadata, or lifecycle flags without adding public state setters.

The implementation intentionally does not add `TransactionalEntity`,
`Aggregate`, `Projection`, `ProcessManager`, repositories, handler invocation,
dispatch, storage, lifecycle events, automatic version increments, ID routing,
query support, buses, gRPC, ZeroMQ, or global runtime state.

## JVM Research Used

The subtask starts from the parent `T-0009e` JVM inspection of `Entity`,
`AbstractEntity`, `TransactionalEntity`, `Aggregate`, `Projection`, and
`ProcessManager`. During implementation, the authoring agent re-inspected:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Entity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/WithLifecycle.java`.

Implementation impact:

- expose ID, state, version metadata, lifecycle flags, active/archived/deleted
  accessors, and descriptor/model metadata equivalents;
- clone state snapshots instead of exposing stored mutable state;
- clone structured-clone-compatible object version metadata at constructor,
  accessor, and protected replacement boundaries;
- keep `lifecycleFlagsChanged` sticky after a lifecycle replacement changes
  flags, matching JVM `AbstractEntity#setLifecycleFlags`;
- defer repositories, dispatch, storage, lifecycle system events, and automatic
  version increments.

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
- `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
- `build-protocol/tasks/T-0009e1-common-entity-state-shell/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e1.md`
- `build-protocol/reviews/T-0009e1-common-entity-state-shell.md`

## Verification

- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:12 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- RED focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  failed on `2026-06-29 22:18 WEST` because `Entity` was not exported and the
  new entity test could not subclass it.
- GREEN focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:19 WEST`: 2 test files / 14 tests.
- Initial final verification attempt `CI=true corepack pnpm verify` failed on
  `2026-06-29 22:25 WEST` at the coverage threshold: branch coverage was
  89.73% against the 90% global threshold.
- Coverage follow-up focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:25 WEST`: 2 test files / 15 tests.
- `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed on
  `2026-06-29 22:26 WEST`; TypeDoc reported 62 expected server exports.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 22:27 WEST`: 15
  test files / 135 tests; coverage statements 97.69%, branches 90.9%,
  functions 100%, lines 97.64%; TypeDoc/API reported 100 proto, 28 core, 62
  server, and 26 storage expected exports; proto lint/generate/check passed
  with generated output clean.
- Review-fix RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:35 WEST` as expected: 1 test file / 8 tests, with 2 failures
  covering constructor/getter and protected replacement version metadata
  aliasing.
- Review-fix GREEN focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` passed on
  `2026-06-29 22:36 WEST`: 1 test file / 8 tests.
- Review-fix focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:37 WEST`: 2 test files / 17 tests.
- Targeted stale-marker search for live implementation-precommit wording in
  T-0009e.1 task/report/work/review logs found no matches on
  `2026-06-29 22:37 WEST`.
- Review-fix `corepack pnpm typecheck` first failed on `2026-06-29 22:37 WEST`
  because the regression tests intentionally mutated readonly metadata through
  casts; after making the casts explicit through `unknown`, rerun passed.
- Review-fix `corepack pnpm lint` passed on `2026-06-29 22:38 WEST`.
- Review-fix `corepack pnpm format:check` first found the edited work log on
  `2026-06-29 22:38 WEST`; after formatting that file, rerun passed.
- Review-fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:38 WEST`: 15 test files / 137 tests; coverage statements
  97.7%, branches 90.72%, functions 100%, lines 97.65%; TypeDoc/API reported
  100 proto, 28 core, 62 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.

## Review

- Round 1 reviewed implementation commit `4ade81d`; result: changes requested
  and captured in commit `bff6e5e`.
- Accepted P2 finding: object-shaped `Version` metadata was stored and returned
  by reference, allowing mutation outside `replaceVersionMetadata()`.
- Accepted P2 finding: durable logs retained stale pre-commit wording after
  implementation commit `4ade81d`.
- Fix route: add RED regression tests for constructor/getter and protected
  replacement version snapshot isolation, then clone structured-clone-compatible
  object version metadata at constructor, accessor, and protected replacement
  boundaries.
- Review-fix verification passed on `2026-06-29 22:38 WEST`, including focused
  entity/root tests, typecheck, lint, format check, full verify, and stale-marker
  search.
- Round 2 reviewed review-fix commit `aef6297`; result: changes requested.
- Accepted P2 finding: the broad `structuredClone()` contract keeps a
  shared-memory mutation path for `SharedArrayBuffer`-backed typed arrays.
- Accepted P2 finding: the broad `structuredClone()` contract is fragile for
  generic `Version` metadata because it throws for functions and changes
  prototype-bearing objects.
- Follow-up route: make version metadata an explicit plain snapshot data
  contract, reject non-plain object graphs, add focused regressions, and rerun
  the required review loop.
