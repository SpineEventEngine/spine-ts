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
`previous === undefined` pass the built-in set-once checks. Existing-state
transitions fail when a set-once field changes and pass when set-once values
remain equal. Violations are returned through `@spine-ts/core`
`validateTransition()`, include `fieldPath`, and do not include raw previous or
next values.

D-0038 already matched the implemented semantics, so no ADR update was needed.

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

Full final verification:

- `CI=true corepack pnpm verify` passed on `2026-06-29 15:15 WEST`: 13 test
  files / 89 tests passed; coverage statements 98.79%, branches 92.34%,
  functions 100%, lines 98.76%; docs/API and proto checks passed with the
  known TypeDoc invalid-origin warning.

One full verification run failed before the final pass because the edited task
and work logs needed Prettier formatting. A later full verification run reached
coverage and failed because the new equality helper lowered global branch
coverage below 90%; focused set-once equality coverage was added and the final
full verification passed.

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
