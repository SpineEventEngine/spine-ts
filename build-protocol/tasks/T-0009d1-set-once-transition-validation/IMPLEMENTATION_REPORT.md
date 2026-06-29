# Implementation Report: T-0009d.1 Built-In Set-Once Transition Validation

Status: Complete
Branch: `task/T-0009d1-set-once-transition-validation`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d1-set-once-transition-validation`
Implementation agent: Codex

## Summary

Implemented the first public `@spine-ts/server` high-level entity state
transition validator:

- `validateEntityStateTransition({ schema, previous, next })`;
- `EntityStateTransitionValidationRequest`;
- `EntityStateTransitionValidationResult`.

The validator derives `(set_once)` fields from `describeEntityMetadata()` and
keeps the low-level rule private. Creation transitions where
`previous === undefined` may initialize supported set-once fields.
Existing-state transitions fail when a supported set-once field changes and
pass when supported set-once values remain equal. Unsupported repeated,
map-valued, and explicit optional set-once declarations fail closed even on
creation. Violations are returned through `@spine-ts/core`
`validateTransition()`, include `fieldPath`, and do not include raw previous or
next values.

D-0038 records the baseline supported-field semantics. D-0039 records the later
JVM-aligned boundary that repeated, map-valued, and explicit optional
`(set_once)` declarations are unsupported in this slice and fail closed even on
creation.

## TDD Evidence

- RED: `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with four behavior failures because
  `validateEntityStateTransition` was not a function.
- GREEN: `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 14 tests after implementation.

An earlier RED attempt failed before test discovery because the test file had
landed in the parent workspace instead of the isolated task worktree; that
untracked file was deleted and the test was reapplied inside the task worktree
before counting RED.

## Files Changed

- `README.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/reviews/T-0009d1-set-once-transition-validation.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/work-logs/T-0009d1.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/package.json`
- `packages/server/src/entity-transition-validation.test.ts`
- `packages/server/src/entity-transition-validation.ts`
- `packages/server/src/index.test.ts`
- `packages/server/src/index.ts`
- `packages/server/test-fixtures/entity-metadata-fixtures.ts`
- `packages/server/test-fixtures/proto/entity-metadata/main.proto`
- `pnpm-lock.yaml`
- `scripts/check-api-docs.mjs`

## Verification

Completed before full final verification:

- `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 15 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and confirmed 43 expected `@spine-ts/server` exports.
- `corepack pnpm format:check` passed.
- `corepack pnpm test:coverage` passed after adding coverage for byte, array,
  and nested object set-once equality paths: 13 test files / 89 tests; coverage
  statements 98.79%, branches 92.34%, functions 100%, lines 98.76%.

Superseded early full verification:

- `CI=true corepack pnpm verify` passed on `2026-06-29 15:15 WEST`: 13 test
  files / 89 tests passed; coverage statements 98.79%, branches 92.34%,
  functions 100%, lines 98.76%; docs/API and proto checks passed with the
  known TypeDoc invalid-origin warning.

One full verification run failed before the final pass because the edited task
and work logs needed Prettier formatting. A later full verification run reached
coverage and failed because the new equality helper lowered global branch
coverage below 90%; focused set-once equality coverage was added and the final
early full verification passed. This evidence was later superseded by the
fix-round 7 full verification at `2026-06-29 17:29 WEST` after additional
review fixes and coverage.

## Dependency Notes

Added `@spine-ts/core` as a workspace dependency of `@spine-ts/server` so the
server validator can delegate transition result shaping and sanitization to the
core facade.

`corepack pnpm install --offline` was interrupted after it attempted network
registry/attestation lookups and had recreated `node_modules`; rerunning
`corepack pnpm install` with network approval completed successfully and
hydrated the worktree dependency state.

## Concerns

- No implementation concerns at this point.
- Review rounds have not been run by this implementation sub-agent because the
  user explicitly instructed not to spawn sub-agents.

## Fix Round 1

Addressed first-round reviewer findings from
`.superpowers/sdd/review-cd98ca3..e32f906.diff`:

- Security inherited/accessor field reads: `readFieldValue()` now accepts only
  own enumerable data properties for descriptor fields. Missing, inherited, and
  accessor-backed forged set-once fields fail closed with a field-specific
  set-once violation and no raw value leakage.
- Security non-plain nested values: recursive equality now compares only
  plain/protobuf-shaped records with matching prototypes. Dates, custom
  prototypes, and other unsupported object shapes fail closed.
- Reliability recursion safety: recursive comparison now has an active-pair
  cycle guard and a deterministic depth limit, preserving set-once field paths
  instead of allowing unbounded recursion or core error fallback.
- Documentation: root `README.md` now states that core validation facades and
  server-owned set-once transition validation exist, while transaction/runtime,
  repository, transport, and production storage behavior remain deferred.
- Minor fixture cleanup: descriptor-valid bytes, repeated string, and nested
  message set-once fields were added to the server metadata fixture. The
  schema-invalid equality tests were replaced by real descriptor-backed
  coverage, with casts limited to explicit forged-state hardening tests.
- Minor TypeDoc coverage: public request/function comments now mention set-once
  semantics, `previous === undefined` creation behavior, side-effect-free
  validation, and `DescriptorMetadataError` behavior for non-entity schemas.
- Minor default coverage: added a focused existing-state default-to-non-default
  set-once change test.

Fix-round commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 3 of 10 tests failing.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 19 tests.
- Required verification:
  `corepack pnpm typecheck` passed, and `corepack pnpm docs:check` passed with
  the known TypeDoc invalid-origin warning.
- Full verification:
  `CI=true corepack pnpm verify` passed after lint and formatting cleanup with
  13 test files / 93 tests; coverage statements 98.48%, branches 92.34%,
  functions 100%, lines 98.44%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.

Full fix-round verification passed.

## Fix Round 2

Addressed round-2 findings from review package
`.superpowers/sdd/review-cd98ca3..70c0052.diff` and the fix-agent handoff:

- Code semantics: set-once field reads now distinguish truly absent descriptor
  fields from inherited or accessor-backed forged values. Absent-on-both sides
  compares equal, absent-to-present or present-to-absent fails, and unsafe
  inherited/accessor-backed fields still fail closed without raw value leakage.
- Regression coverage: added a descriptor-valid test using
  `RichSetOnceState.details` absent from both previous and next states.
- Durable docs/logs: replaced stale placeholders in `TASK.md`, updated the work
  log current state after `70c0052`, replaced the round-1 fix commit placeholder
  with `70c0052`, and recorded round-2 reviewer findings/fix activity.
- API docs: updated `docs/api/README.md` current status to mention server
  set-once transition validation without claiming runtime maturity.

Fix-round 2 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 1 of 11 tests failing because absent
  `RichSetOnceState.details` was rejected.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 20 tests.
- Required verification:
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed.
- Full verification:
  `CI=true corepack pnpm verify` first failed on Prettier formatting for
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md build-protocol/reviews/T-0009d1-set-once-transition-validation.md build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md docs/api/README.md`,
  `CI=true corepack pnpm verify` passed with 13 test files / 94 tests; coverage
  statements 98.48%, branches 92.46%, functions 100%, lines 98.45%; docs/API
  and proto checks passed with the known TypeDoc invalid-origin warning.

## Fix Round 3

Addressed round-3 findings from review package
`.superpowers/sdd/review-cd98ca3..01cfb47.diff` and the fix-agent handoff:

- Security collection comparison: bytes comparison now copies real
  `Uint8Array` values through the intrinsic typed-array slice path and rejects
  forged/proxied/extra-property byte collections. Repeated-field comparison now
  requires descriptor-valid dense own data properties, rejects extra own
  methods, inherited indexes, accessor indexes, sparse arrays, symbol keys, and
  changed prototypes, and uses explicit loops rather than user-controlled array
  methods or indexed reads.
- Regression coverage: added forged bytes and repeated set-once tests for
  overridden `every`, typed-array and repeated proxy reads, inherited repeated
  indexes, and accessor-backed repeated indexes. The assertions verify
  sanitized set-once violations and no previous/next value leakage.
- Durable docs/logs: refreshed task, work-log, review-log, implementation
  report, and root README wording after committed fix-round 2 commit
  `01cfb47` and this fix round.
- Documentation inventory: `Files Changed` now includes all files changed
  across the task, including root `README.md`, the review log, and server
  fixture/proto files.

Fix-round 3 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 2 of 13 tests failing for forged bytes and repeated
  collections that were incorrectly accepted.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 22 tests.
- Required verification:
  `corepack pnpm docs:check` first failed on the new typed-array helper type,
  then passed with the known TypeDoc invalid-origin warning and expected API
  export counts; `corepack pnpm typecheck` first failed on the same helper and
  test-helper types, then passed.
- Full verification:
  `CI=true corepack pnpm verify` first failed on lint for the new proxy/helper
  code, then on Prettier formatting for
  `packages/server/src/entity-transition-validation.test.ts`; after cleanup and
  `corepack pnpm exec prettier --write packages/server/src/entity-transition-validation.test.ts packages/server/src/entity-transition-validation.ts`,
  `CI=true corepack pnpm verify` passed with 13 test files / 96 tests; coverage
  statements 97.34%, branches 90.72%, functions 100%, lines 97.26%; docs/API
  and proto checks passed with the known TypeDoc invalid-origin warning.

## Fix Round 4

Addressed round-4 findings from review package
`.superpowers/sdd/review-cd98ca3..3ccca04.diff` and the fix-agent handoff:

- Security proxy/reflection bypass: set-once field comparison now uses the
  Protobuf-ES field read path and canonicalizes each set-once field through a
  binary round-trip before comparison. Top-level descriptors still gate unsafe
  inherited/accessor shapes, but descriptor values no longer decide equality.
- Security nested message proxy bypass: nested message set-once values are
  compared after per-field Protobuf canonicalization, so forged nested
  descriptors cannot hide values that Protobuf serialization reads.
- Reliability same-reference validation: object and collection values no longer
  return equal solely because they are the same reference; unsupported objects
  and forged/sparse collections still pass through shape validation.
- Performance: bytes comparison now compares safe `Uint8Array` copies directly
  and avoids materializing JS `number[]` arrays.
- Coverage: added direct absent-to-present and present-to-absent singular
  message set-once transition tests, plus proxy-forged top-level/nested and
  same-reference unsupported-shape regression tests.
- Durable docs/logs: recorded `3ccca04` as the committed fix-round 3 commit in
  `TASK.md`, added round-4 review/fix notes to the review log, updated the work
  log current state, and kept `TASK.md` in the task file inventory.

Fix-round 4 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected with 3 failing tests for top-level proxy, nested proxy, and
  same-reference unsupported values.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 28 tests after adding coverage for throwing nested
  proxies and subclassed bytes.
- Required verification:
  `corepack pnpm typecheck` passed; `corepack pnpm docs:check` passed with the
  known TypeDoc invalid-origin warning and expected API export counts.
- Cleanup verification:
  `corepack pnpm lint` and `corepack pnpm format:check` initially failed on a
  validator type assertion and Prettier formatting; after cleanup, focused
  tests, lint, and format check passed.
- Coverage recovery:
  `CI=true corepack pnpm verify` first failed on global branch coverage after
  the canonicalization helpers were added; after focused coverage for
  symbol-keyed repeated collections, throwing nested proxies, and subclassed
  bytes, `corepack pnpm test:coverage` passed with 13 test files / 102 tests and
  coverage statements 96.79%, branches 90.09%, functions 100%, lines 96.71%.
- Full verification:
  `CI=true corepack pnpm verify` passed with 13 test files / 102 tests; coverage
  statements 96.79%, branches 90.09%, functions 100%, lines 96.71%; docs/API
  and proto checks passed with the known TypeDoc invalid-origin warning.

## Fix Round 5

Addressed round-5 findings from review package
`.superpowers/sdd/review-cd98ca3..e2369cc.diff` and the fix-agent handoff:

- Reliability/security top-level proxy reflection: `readFieldValue()` now
  catches `Object.getOwnPropertyDescriptor()` failures and treats that field as
  unsafe, preserving a field-specific set-once violation and avoiding raw value
  or proxy error leakage through the core generic rule-failed path.
- Map-valued set-once contract: map-valued `(set_once)` fields remain
  unsupported in this slice and now fail closed with an explicit
  field-specific unsupported-map violation. Public docs and TypeDoc comments
  state this limitation.
- Coverage: added descriptor-valid map set-once coverage, descriptor-backed
  recursive `RichSetOnceState.details` cycle/depth coverage, and
  descriptor-backed same-reference unsupported message coverage.
- Durable docs/logs: refreshed task, work-log, review-log, implementation
  report, API docs, architecture notes, user guide, server README, and
  developer API notes after committed fix-round 4 commit `e2369cc`.
- JVM reference check: after human steering, inspected
  `spine-jvm-docs/README.md`,
  `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  `spine-jvm-docs/spine-domain-model-and-signals.md`, and
  `spine-jvm-docs/spine-entities-repositories-and-state.md`. These notes place
  set-once enforcement at generated builder/factory or state-update validation
  boundaries over normal Protobuf state and state that repeated/map/explicit
  optional `(set_once)` fields are unsupported at JVM build time. This confirmed
  the conservative fix: keep map-valued set-once unsupported with a
  field-specific violation and avoid adding a broader adversarial object
  comparison abstraction.

Fix-round 5 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected with 2 failing tests for throwing top-level proxy
  reflection and unsupported-map violation wording after the cyclic forged-state
  test setup was corrected to enter the validator.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 31 tests.

## Fix Round 6

Addressed human pre-review steering after D-0039: descriptor-level repeated/list
`(set_once)` fields were still treated as supported by unchanged list equality,
even though the local JVM notes and D-0039 say repeated/map/explicit optional
set-once fields are unsupported in the JVM generation contract.

- Repeated set-once contract: descriptor-level repeated/list `(set_once)` fields
  now fail closed with a field-specific unsupported-repeated violation, matching
  the unsupported map-valued set-once boundary.
- Test fixture split: `RichSetOnceState.tags` is now the unsupported repeated
  set-once fixture. A new `SingularSetOnceState` fixture preserves bytes and
  singular-message set-once coverage without routing through a top-level
  repeated set-once field.
- Scope cleanup: removed top-level repeated set-once equality/collection
  hardening tests from the supported path. Array comparison helpers remain only
  for nested singular message comparison and internal key comparison behavior.
- Documentation: public docs, architecture notes, TypeDoc comments, and D-0039
  now say repeated and map-valued set-once fields are unsupported in this slice
  and fail closed with field-specific violations.

Fix-round 6 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 1 of 22 tests failing because unchanged
  `RichSetOnceState.tags` was accepted.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 31 tests.
- Coverage recovery:
  `CI=true corepack pnpm verify` first failed on global branch coverage after
  top-level repeated/list equality support and tests were removed. After
  narrowing obsolete array/cycle-pair helper behavior and adding focused
  supported bytes/singular-message coverage, `corepack pnpm test:coverage`
  passed with 13 test files / 105 tests; coverage statements 97.47%, branches
  90.63%, functions 100%, lines 97.40%.
- Required verification:
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed.
- Full verification:
  `CI=true corepack pnpm verify` passed with 13 test files / 105 tests;
  coverage statements 97.47%, branches 90.63%, functions 100%, lines 97.40%;
  docs/API and proto checks passed with the known TypeDoc invalid-origin
  warning.

## Fix Round 7

Addressed review package `.superpowers/sdd/review-cd98ca3..d61874b.diff` and
the fix-round 7 handoff:

- Unsupported creation path: unsupported repeated/list and map-valued
  `(set_once)` fields now fail closed before the creation-transition shortcut,
  so creation transitions report field-specific unsupported violations instead
  of accepting unsupported declarations.
- Explicit optional contract: Protobuf-ES exposes proto3 explicit optional
  fields through `field.descriptor.proto.proto3Optional`. The validator now
  treats that narrow descriptor flag as unsupported for `(set_once)` and reports
  a field-specific unsupported-explicit-optional violation. This avoids adding a
  broader optional/presence subsystem.
- Guarded shape checks: bytes/message shape guards and equality helpers now
  catch proxy/reflection failures and return unsafe/unequal so violations remain
  field-specific and sanitized instead of falling through to core's generic
  rule-failed violation.
- Fixture coverage: added `OptionalSetOnceState.optional string explicit_id`
  to the descriptor-backed fixture and regenerated the server descriptor
  fixture.
- Documentation/log cleanup: refreshed public docs, D-0039, task log, review
  log, work log, and this implementation report to name repeated, map-valued,
  and explicit optional set-once fields as unsupported in this slice.

Fix-round 7 commands run:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 4 of 26 tests failing for creation-time
  repeated/map acceptance and generic rule failures from throwing bytes/message
  shape proxies.
- RED explicit optional:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 1 of 27 tests failing because unchanged
  `OptionalSetOnceState.explicit_id` was accepted.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 36 tests.
- Required verification:
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed.
- Full verification:
  `CI=true corepack pnpm verify` first failed on lint for an unnecessary
  previous-state type assertion, then on Prettier formatting for
  `packages/server/src/entity-transition-validation.ts`. After cleanup,
  `CI=true corepack pnpm verify` passed with 13 test files / 110 tests;
  coverage statements 97.35%, branches 90.72%, functions 100%, lines 97.28%;
  docs/API and proto checks passed with the known TypeDoc invalid-origin
  warning.

## Fix Round 8

Addressed round-7 docs/log findings from
`.superpowers/sdd/review-cd98ca3..3d2cb06.diff` without changing runtime/source
code beyond TypeDoc wording:

- Work log current state now records committed fix-round 7 commit `3d2cb06` and
  points the next step to clean re-review/integration.
- Task status/end evidence now describes the branch as complete through this
  docs/log cleanup and pending clean re-review/integration.
- Fix round 6 now precedes fix round 7 in this report; stale duplicate 105-test
  verification bullets were removed from fix round 7.
- Developer API, architecture notes, task scope/compatibility notes, and
  TypeDoc request wording now qualify creation transitions as supported
  set-once initialization only; unsupported repeated, map-valued, and explicit
  optional declarations fail closed even on creation.
- Architecture wording now says `Repeated, map-valued`.

Fix-round 8 files changed:

- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0009d1-set-once-transition-validation.md`
- `build-protocol/work-logs/T-0009d1.md`
- `build-protocol/DEVELOPER_API.md`
- `docs/architecture/README.md`
- `packages/server/src/entity-transition-validation.ts`

Fix-round 8 verification:

- `corepack pnpm format:check` initially failed on `TASK.md` and
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.

## Fix Round 9

Addressed round-8 follow-up findings and the human server-module steering note
without changing runtime/source behavior:

- `BUILD_PROTOCOL.md` now requires `@spine-ts/server` work to take a close look
  at corresponding Spine `core-jvm` `server` module code when available, using
  `spine-jvm-docs/` to locate task-relevant source paths and recording any
  fallback to summarized notes.
- D-0038 and this report now state that creation transitions pass only for
  supported `(set_once)` field shapes; unsupported repeated, map-valued, and
  explicit optional field shapes remain governed by D-0039 and fail closed.
- Work-log current state, task reviewer metadata, architecture wording, and
  duplicate round-5 verification evidence were cleaned up for a clean re-review
  baseline.

Fix-round 9 files changed:

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0009d1-set-once-transition-validation.md`
- `build-protocol/work-logs/T-0009d1.md`
- `docs/architecture/README.md`

Fix-round 9 verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Round 20 Clean Re-review

All five required reviewer roles reported CLEAN on review package
`.superpowers/sdd/review-cd98ca3..e4c763f.diff`:

- Code style/maintainability.
- Documentation.
- TypeScript/API docs.
- Security.
- Performance/reliability.

All reviewer agents were closed after report capture. No further T-0009d.1 fix
comments remain before integration.

## Main Integration

Merged `task/T-0009d1-set-once-transition-validation` into `main` and ran full
main verification.

Verification:

- Initial `CI=true corepack pnpm verify` stopped because `node_modules` was not
  up to date with the merged lockfile.
- Sandboxed `corepack pnpm install` failed on registry DNS after recreating
  `node_modules`; escalated `corepack pnpm install` restored dependencies.
- `CI=true corepack pnpm verify` passed on `main`: typecheck, lint, format,
  tests, coverage, docs/API, proto lint, proto generate, and generated
  cleanliness checks passed. Coverage statements 97.38%, branches 90.78%,
  functions 100%, lines 97.31%.

## Fix Round 10

Addressed round-9 maintainability/reliability review findings without changing
runtime/source behavior:

- Inspected actual Spine `core-jvm` `server` source because the checkout is
  present locally:
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`,
  and
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`.
- The source confirms that JVM state mutation is transaction-buffered through a
  validating builder, then replacement state is validated during
  transaction commit/update. The implementation impact remains narrow:
  T-0009d.1 provides transition validation for the future transaction/runtime
  boundary, without adding a TypeScript transaction stack in this slice.
- Updated the task end timestamp and canonical Tests Run section to include
  fix-round 9 verification evidence.
- Updated D-0039 and durable review/work logs to record the source inspection
  and round-9 reviewer findings.

Fix-round 10 files changed:

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0009d1-set-once-transition-validation.md`
- `build-protocol/work-logs/T-0009d1.md`

Fix-round 10 verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 11

Addressed round-10 re-review log-coherence findings without changing runtime
behavior:

- Added fix-round 10 verification evidence to the canonical `TASK.md` Tests Run
  section.
- Added fix-round 10 verification commands and outcomes to the work-log
  chronological row and Current State summary.
- Recorded round-10 re-review outcomes in the review log.

Verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 12

Addressed round-11/final re-review durable metadata findings without changing
runtime behavior:

- Updated `TASK.md` status and reviewer metadata through round 12.
- Added fix-round 11/12 task narrative entries.
- Updated work-log Current State to describe the latest review state.
- Recorded round-12 review outcomes in the review log.

Verification:

- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 13

Addressed round-12/final re-review chronology and implementation-report
coherence findings without changing runtime behavior:

- Rewrote the review-log tail so Rounds 9-13 physically appear in chronological
  order.
- Updated `TASK.md` status and reviewer metadata through round 13.
- Updated work-log Current State to name the round-12 package
  `.superpowers/sdd/review-cd98ca3..dc7867f.diff` as the source of this
  follow-up.
- Added this implementation-report evidence for fix rounds 11-13.

Verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 14

Addressed round-13/final re-review verification-summary findings without
changing runtime behavior:

- Added fix-round 11-13 verification evidence to canonical `TASK.md` Tests Run.
- Updated work-log Current State to name the round-13 review package and
  summarize fix-round 11-13 verification evidence.
- Recorded round-14 review outcomes in the review log.

Verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 15

Addressed round-14/final re-review verification-summary findings without
changing runtime behavior:

- Added fix-round 14 verification evidence to canonical `TASK.md` Tests Run.
- Updated work-log Current State to summarize fix-round 14 verification
  evidence.
- Recorded round-15 review outcomes in the review log.

Verification:

- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 16

Addressed round-16/final re-review verification-summary findings without
changing runtime behavior:

- Added missing fix-round 15 verification evidence to canonical `TASK.md` Tests
  Run.
- Updated work-log Current State to name the round-16 review package, correct
  the round-15 package label, and summarize fix-round 15 verification evidence.
- Recorded round-16 review outcomes in the review log.

Verification:

- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `git diff --check` passed.

## Fix Round 17

Addressed the latest performance/reliability and durable-doc findings:

- Cached descriptor-derived set-once transition rules in a module-level
  `WeakMap` keyed by schema, so `validateEntityStateTransition()` no longer
  calls `describeEntityMetadata()` or recreates the set-once rule on every
  validation for the same schema. Behavior and fail-closed validation semantics
  remain unchanged.
- Added a focused regression test proving descriptor/rule derivation is cached
  per schema. The test observes descriptor `fields` traversal through a schema
  proxy instead of monkey-patching the ESM `describeEntityMetadata()` import,
  keeping the assertion tied to the public schema object while still catching
  repeated metadata traversal on same-schema validation.
- Added the missing fix-round-16 Review Rounds bullet to `TASK.md`.
- Updated top-level `TASK.md` reviewer metadata through round 17.
- Renamed the early `15:15 WEST` "Full final verification" section to
  "Superseded early full verification" so the later `17:29 WEST` full
  verification remains the durable latest full-verification evidence.
- Recorded round-17 reviewer findings, fix response, and verification plan in
  the task, work, review, and implementation logs.

Verification:

- RED:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 1 of 28 tests failing because same-schema validation
  traversed descriptor `fields` again.
- GREEN:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 37 tests.
- Final verification:
  `corepack pnpm format:check` first failed on
  `packages/server/src/entity-transition-validation.ts` and
  `build-protocol/work-logs/T-0009d1.md`, then needed one additional work-log
  wrap after final evidence text was added; after Prettier rewrote touched
  owned files, `corepack pnpm format:check` passed.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.

## Fix Round 18

Addressing the post-round-17 full-verification lint failure without changing
runtime behavior or public API:

- Removed an unnecessary cached-rule type assertion in
  `packages/server/src/entity-transition-validation.ts`; the frozen
  descriptor-derived rule array already satisfies the `WeakMap` value type.
- Removed unnecessary assertions from the schema traversal proxy helper in
  `packages/server/src/entity-transition-validation.test.ts`; the proxy keeps
  the target schema type by inference and `Reflect.get()` can be returned
  directly from the trap.
- Recorded the failed pre-fix `CI=true corepack pnpm verify` lint result and
  updated the work-log Current State next-step wording so it routes to clean
  re-review/integration after fresh full verification, not another stale commit
  instruction.
- Updated top-level `TASK.md` reviewer metadata through round 18.

Verification:

- `corepack pnpm lint` passed.
- `CI=true corepack pnpm verify` first failed on Prettier formatting for
  `build-protocol/work-logs/T-0009d1.md`.
- After
  `corepack pnpm exec prettier --write packages/server/src/entity-transition-validation.ts packages/server/src/entity-transition-validation.test.ts build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0009d1.md build-protocol/reviews/T-0009d1-set-once-transition-validation.md`,
  `CI=true corepack pnpm verify` passed with 13 test files / 111 tests;
  coverage statements 97.38%, branches 90.78%, functions 100%, lines 97.31%;
  docs/API and proto checks passed with the known TypeDoc invalid-origin
  warning.
- `git diff --check` passed.
- `corepack pnpm format:check` passed.

## Fix Round 19

Addressing round-18 re-review task-header metadata findings without changing
runtime behavior, tests, or public API:

- Updated top-level `TASK.md` status/end timestamp/reviewer metadata through fix
  round 19.
- Updated work-log Current State to route to clean re-review of this
  metadata-only cleanup, then integration.
- Recorded this metadata-only follow-up in task, work, review, and
  implementation logs.

Verification:

- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm format:check` initially failed on
  `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `git diff --check` passed.

## Fix Round 20

Addressing round-19 re-review reviewer-metadata findings without changing
runtime behavior, tests, or public API:

- Kept top-level `TASK.md` reviewer metadata at the latest completed reviewer
  round and changed the task status/end metadata to fix round 20 pending clean
  re-review.
- Updated work-log Current State to record the round-19 finding and this
  metadata-only fix.
- Recorded this follow-up in task, work, review, and implementation logs.

Verification:

- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm format:check` initially failed on the review log and work log;
  after
  `corepack pnpm exec prettier --write build-protocol/reviews/T-0009d1-set-once-transition-validation.md build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed.
- `git diff --check` passed.
