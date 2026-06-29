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

- `build-protocol/DEVELOPER_API.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/package.json`
- `packages/server/src/entity-transition-validation.test.ts`
- `packages/server/src/entity-transition-validation.ts`
- `packages/server/src/index.test.ts`
- `packages/server/src/index.ts`
- `pnpm-lock.yaml`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/work-logs/T-0009d1.md`

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
