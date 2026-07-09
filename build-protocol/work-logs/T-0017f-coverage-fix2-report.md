# T-0017f Coverage Fix 2 Report

Status: `DONE`
Date: `2026-07-09`

## Root Cause

The first coverage fix lifted branch coverage from `89.30%` to `89.41%`, but
the full native verification still failed the required `90%` branch threshold.
The remaining uncovered branches were mostly defensive public-contract paths.

## Changes

- Added bounded-context generated registry root tests for:
  - file URL roots passed as strings;
  - malformed URL-like roots;
  - non-file URL schemes;
  - file URL query/hash aliases.
- Added bounded-context access tests for:
  - filtering internal event schemas from accepted event type URLs;
  - rejecting package-local subscription access for non-context values.
- Added repository dispatcher tests for direct dispatch without a bound
  runtime, covering the route-only fallback used before context assembly.
- Added repository runtime tests for:
  - multitenant process-manager command state storage.
- Extended the existing subscription update ID packing test to cover boolean,
  number, and bigint entity IDs.
- Added an unsupported object-ID subscription update case to cover the default
  `packEntityId()` branch.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/bounded-context.test.ts`
  passed with 1 test file and 36 tests.
- Native `pnpm --config.verify-deps-before-run=false verify` reached coverage
  with all 53 files and 986 tests passing, then failed branch coverage at
  `89.62%`.
- The first focused run after adding direct dispatcher tests failed because the
  test asserted `ExecutingTaskAggregate.commandCalls`, but the fixture exposes
  `assigneeCalls`. The assertion was corrected; focused verification is
  pending.
- The second focused run failed because the test asserted
  `ExecutingTaskProjection.calls`, but the fixture exposes `subscriberCalls`.
  The assertion was corrected; focused verification is pending.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/bounded-context.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 test files and 137 tests.
- Native `pnpm --config.verify-deps-before-run=false verify` reached coverage
  with all 53 files and 989 tests passing, then failed branch coverage at
  `89.76%`.
- Native `pnpm --config.verify-deps-before-run=false verify` reached coverage
  with all 53 files and 990 tests passing, then failed branch coverage at
  `89.98%` (`2542/2825` branches).
- The aggregate missing-version test was removed after focused verification
  showed the fixture does not route aggregate-state events through that
  execution path.
- Sandbox focused services/repository/context tests failed on listener
  restrictions (`listen EPERM: operation not permitted 127.0.0.1`).
- Native
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/services/spine-services.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/context/bounded-context.test.ts`
  passed with 3 test files and 227 tests.
- Native
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/services/spine-services.test.ts`
  passed with 1 test file and 89 tests after adding the unsupported object-ID
  case.
- Full native `pnpm --config.verify-deps-before-run=false verify` passed:
  - 53 test files and 990 tests passed in the normal test run;
  - 53 test files and 990 tests passed in the coverage run;
  - branch coverage passed at `90.01%` (`2543/2825` branches);
  - docs check passed with the existing invalid-origin TypeDoc warning;
  - proto lint and generated-clean checks passed.
