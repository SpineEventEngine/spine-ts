# Implementation Report: T-0009e.1 Common Entity State Shell

Status: Round 4 Review Fix Required
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
caller-owned plain version metadata snapshots, lifecycle flags, `isActive`,
`isArchived`, `isDeleted`, and sticky lifecycle-change tracking. Protected
hooks allow future framework-owned subclasses to replace accepted state, plain
version metadata, or lifecycle flags without adding public state setters.

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
- clone plain object/array version metadata at constructor, accessor, and
  protected replacement boundaries while rejecting non-plain metadata;
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
- Round 2 fix RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:52 WEST` as expected: 1 test file / 10 tests, with 1 failure
  because non-plain version metadata was still accepted.
- Round 2 fix GREEN focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:56 WEST`: 2 test files / 19 tests.
- Round 2 fix `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed on
  `2026-06-29 22:56 WEST`; TypeDoc/API reported 63 expected server exports.
- Round 2 fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 23:03 WEST`: 15 test files / 139 tests; coverage statements
  97.69%, branches 91.24%, functions 100%, lines 97.64%; TypeDoc/API reported
  100 proto, 28 core, 63 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- Round 3 fix RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 23:13 WEST` as expected: 1 test file / 15 tests, with 4 failures
  covering array descriptor hazards, JSON `__proto__`, constructor getter label
  safety, and deep metadata stack overflow.
- Round 3 fix RED `corepack pnpm typecheck` failed on
  `2026-06-29 23:13 WEST` as expected after test-shape cleanup because
  `EntityOptions<..., Date>` and `Entity<..., Date>` were not rejected at
  compile time.
- Round 3 fix GREEN focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` passed on
  `2026-06-29 23:16 WEST`: 1 test file / 15 tests.
- Round 3 fix `corepack pnpm typecheck` passed on
  `2026-06-29 23:16 WEST`.
- Round 3 fix `corepack pnpm lint` first failed on
  `2026-06-29 23:18 WEST` because test metadata aliases violated the repo's
  interface preference; after adding explicit plain-data index signatures to
  interfaces, rerun passed.
- Round 3 fix `corepack pnpm format:check` first found the edited work log on
  `2026-06-29 23:18 WEST`; after formatting that file, rerun passed.
- Round 3 fix `corepack pnpm docs:check` passed on
  `2026-06-29 23:18 WEST` with the expected broken-origin TypeDoc warning and
  63 expected server exports.
- Round 3 fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 23:19 WEST`: 15 test files / 144 tests; coverage statements
  97.3%, branches 91.24%, functions 100%, lines 97.24%; TypeDoc/API reported
  100 proto, 28 core, 63 server, and 26 storage expected exports; proto
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
- Round 2 fix implemented: exported `EntityVersionMetadata`, replaced
  `structuredClone()` with explicit recursive plain-data validation/cloning,
  rejected shared-memory/prototype-bearing metadata, documented the public
  contract, and verified the focused and full gates.
- Round 3 reviewed Round 2 fix commit `50a1802`; result: changes requested.
- Accepted P2/API finding: constrain `Version` generics to
  `EntityVersionMetadata`.
- Accepted security/reliability findings: make array/object cloning
  descriptor-safe without invoking caller accessors/species/prototype behavior,
  preserve or reject array own properties instead of dropping them, reject deep
  metadata with a domain error, and avoid caller-controlled constructor lookups
  while formatting rejection labels.
- Round 3 fix implemented: `Entity` and `EntityOptions` now constrain `Version`
  to `EntityVersionMetadata`; array metadata is cloned from validated
  descriptors without `Array.prototype.map()`; object metadata defines data
  properties so JSON `__proto__` cannot mutate prototypes; error labels avoid
  caller-controlled constructors; and excessive nesting rejects with the domain
  `TypeError`.
- Round 4 reviewed Round 3 fix commit `7bcb7f8`; result: changes requested.
- Accepted P2/API finding: the current generic bound rejects ordinary named
  plain metadata interfaces because it requires an index signature.
- Accepted P2/security finding: proxy metadata can execute traps before
  reflective validation rejects or accepts it.
- Follow-up route: replace the generic bound with a plain-shape type validator,
  reject proxies before reflection, add focused regressions, and rerun the
  required review loop.

## Round 4 Fix

Implemented on `2026-06-29 23:38 WEST`.

- Type contract: `RevisionMetadata` no longer needs a string index signature;
  `Entity`/`EntityOptions` accept named plain interfaces through the recursive
  `PlainEntityVersionMetadata` input validator and keep `Date` rejected at
  compile time.
- Runtime contract: version metadata proxies are rejected with the domain
  plain-snapshot error before prototype, descriptor, array, or other reflective
  inspection can invoke traps.
- RED evidence: `corepack pnpm typecheck` failed on the old index-signature
  bound after removing the test-only index signature from `RevisionMetadata`;
  the focused entity test failed the proxy regression with
  `"proxy trap invoked"`.
- GREEN evidence: typecheck passed; focused entity/root tests passed 2 files /
  25 tests.
- Final verification: root-session focused entity/root tests, typecheck, lint,
  format check, and docs check passed after replacing a non-typechecked
  `node:util` import with the local `process.getBuiltinModule()` declaration and
  adding `PlainEntityVersionMetadata` to the API gate. Docs check reported 64
  expected server exports. Final `CI=true corepack pnpm verify` passed with 15
  test files / 145 tests, coverage 97.31% statements / 91.28% branches / 100%
  functions / 97.25% lines, TypeDoc/API/proto gates passed, and generated proto
  output clean.
