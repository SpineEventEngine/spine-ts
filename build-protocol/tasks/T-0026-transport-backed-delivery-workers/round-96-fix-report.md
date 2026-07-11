# Round 96 Final-Verification Fix

Timestamp: `2026-07-11T00:34:13Z`

## Root Cause

`ProjectionInbox.receive()` correctly accepts only pending
`UPDATE_SUBSCRIBER` rows. The failing negative runtime test intentionally
passes a `HANDLE_COMMAND` row to prove `LocalProjectionInbox` rejects
unsupported labels at runtime, but the test did not mark that invalid input as
intentional.

## Fix

Added a narrow test-only helper in
`packages/server/test/context/projection-handoff.test.ts` to cast only the
intentional invalid runtime input. Production source and public types remain
unchanged.

## Verification

Verified at `2026-07-11T00:36:18Z`:

- `pnpm --config.verify-deps-before-run=false typecheck:tooling` passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/projection-handoff.test.ts`
  passed with 1 file and 8 tests.
- `pnpm --config.verify-deps-before-run=false format:check` initially found
  formatting in the touched test and review log; after formatting those files,
  the final run passed.
- Targeted protocol `rg` guard returned no matches.
- `git diff --check` passed.
- `git diff --name-only -- ':(glob)**/generated/**' docs/api/reference`
  returned no changed files.
