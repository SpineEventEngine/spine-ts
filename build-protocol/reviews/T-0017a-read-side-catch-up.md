# T-0017a Review Log

Status: clean; ready for integration

Scope: read-side catch-up implementation, projection subscriber replay,
tenant-scoped `Stand` updates, docs/API boundary, and verification evidence.

## Required Lanes

| Lane                       | Latest Review     | Result                                                                 |
| -------------------------- | ----------------- | ---------------------------------------------------------------------- |
| Code style/maintainability | Final re-review   | Clean.                                                                 |
| Documentation completeness | Final re-review   | Clean.                                                                 |
| TypeScript/API docs        | Final re-review   | Clean.                                                                 |
| Security                   | Targeted rerun    | Clean.                                                                 |
| Performance/reliability    | Final re-review   | Clean.                                                                 |

## Findings

- Round 1 code style/maintainability reviewer
  `019f432f-e202-7523-8313-173034fed251`: catch-up replays outside the
  existing serialized stored-event path and task logs were stale.
- Round 1 documentation reviewer `019f4330-45d2-7871-8a18-535e44982412`:
  durable logs were incomplete and public docs did not describe the supported
  catch-up boundary.
- Round 1 TypeScript/API docs reviewer
  `019f4330-7289-7a71-a7d5-6cc9baee74b7`: `docs/api/README.md` was stale,
  TSDoc was too thin, and `Stand.clear()` / catch-up option/result docs were
  incomplete.
- Round 1 security reviewer `019f4330-c0ba-7893-9cc8-c5408e999810`:
  `catchUpStorageContext()` trimmed multitenant `tenantId`, replay lacked
  event-type filtering, and replay errors exposed raw causes.
- Round 1 performance/reliability reviewer
  `019f4330-eda4-7c40-8a9e-c41db097ee82`: replay lacked event-type filtering,
  catch-up was unsynchronized with live intake/close, and the full coverage
  gate had not run.
- Round 2 re-review: catch-up still uses a separate runtime instead of the
  EventBus queue, so replay can interleave with normal live event intake.
- Round 2 re-review: `ReadCatchUpResult.replayedEventCount` still counts all
  stored events instead of only those dispatched to at least one matching
  projection subscriber.
- Round 2 re-review: catch-up replay diagnostics should omit stack and keep
  only bounded name/message detail.
- Round 2 re-review: `clearedStateTypes` should be unique and each projection
  state type should be cleared once.
- Round 2 re-review: `docs/architecture/README.md` and `docs/USER_GUIDE.md`
  still describe read-side catch-up as deferred or outside the implemented
  slice.
- Round 2 re-review: durable logs and implementation report need the second
  fix pass and verification trail.

## Fix Status

- Fix pass started on `2026-07-08`.
- Fix pass completed on `2026-07-08`.
- Focused regression tests passed for dispatcher filtering, exact tenant ID
  preservation, bounded replay diagnostics, concurrent catch-up serialization,
  and catch-up-versus-close behavior.
- `pnpm format:check`, `pnpm lint`, `pnpm docs:check`,
  `pnpm proto:check-generated`, and `git diff --check` passed.
- `pnpm --config.verify-deps-before-run=false verify` hit sandbox-sensitive
  listener/IPC failures (`listen EPERM: operation not permitted 127.0.0.1` and
  `Error: Operation not permitted`) in the known server/gRPC/ZeroMQ suites; the
  fix-specific regressions passed before that broader run.
- First escalated `pnpm --config.verify-deps-before-run=false verify` reached
  coverage and failed only because branch coverage was `89.89%`, below the
  `90%` threshold.
- Added focused catch-up branch coverage for tenant-mode rejection and malformed
  stored-event replay diagnostics.
- Second escalated `pnpm --config.verify-deps-before-run=false verify` passed
  with `53` test files and `893` tests passing. Coverage summary was `94.93%`
  statements, `90.02%` branches, `97.76%` functions, and `94.92%` lines.
- Round-2 fix pass started on `2026-07-08`.
- Round-2 fix pass completed on `2026-07-08`.
- Round-2 focused regression tests passed:
  `pnpm exec vitest run packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
  with `2` passing test files and `96` passing tests.
- Round-2 `pnpm format:check` passed after formatting the two touched source/test files with
  `pnpm exec prettier --write packages/server/src/context/bounded-context.ts packages/server/test/repository/repository-routing.test.ts`.
- Round-2 `pnpm lint` passed.
- Round-2 `pnpm docs:check` passed with the known TypeDoc invalid-origin warning only.
- Round-2 `pnpm proto:check-generated` passed.
- Round-2 `git diff --check` passed.
- Controller full verify after the round-2 fix pass initially failed only at
  the global branch coverage gate: `53` test files and `895` tests passed, but
  branch coverage was `89.89%`, below the required `90%`.
- Added focused branch coverage for the EventBus exclusive-work access guard and
  catch-up replay diagnostics for non-`Error` throws. The controller also
  simplified `EventBus.#runExclusive()` by removing an impossible defensive
  branch and relying on `SingleProcessServerRuntime.enqueue()` completion.
- Coverage-fix focused tests passed:
  `pnpm exec vitest run packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
  with `2` passing test files and `98` passing tests.
- Coverage-fix `pnpm format:check` and `git diff --check` passed.
- Escalated native `pnpm --config.verify-deps-before-run=false verify` passed
  after the coverage fix with `53` passing test files and `897` passing tests.
  Coverage summary was `94.97%` statements, `90.01%` branches, `97.76%`
  functions, and `94.95%` lines. TypeDoc completed with the known invalid-origin
  warning; proto lint and generated-clean checks passed.
- Post-coverage-fix review produced documentation/code-style/security findings.
  The TypeScript/API docs and performance/reliability lanes reported no latest
  findings. Reviewers have not rerun after this fix pass yet.
- Post-coverage-fix security finding: multitenant catch-up could read the
  selected tenant storage slice but replay an event whose envelope named a
  different tenant, allowing projection Stand writes to update that other
  tenant during replay.
- Post-coverage-fix documentation/code-style finding: `packages/server/README.md`
  still said projection catch-up is outside this slice, rather than narrowing
  the exclusion to durable Delivery/subscription recovery catch-up.
- Post-coverage-fix documentation finding: this review log's lane table was
  stale and did not reflect the latest post-coverage-fix round.
- Post-coverage-fix fix pass completed on `2026-07-08`:
  `BoundedContext.catchUpReadSide()` now rejects multitenant stored events whose
  envelope tenant is absent or mismatched for the selected catch-up storage
  slice before projection dispatch; README wording and durable logs were
  refreshed.
- Post-coverage-fix verification passed on `2026-07-08`:
  `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts`
  (`1` file, `79` tests), `pnpm format:check`, `pnpm lint`,
  `pnpm docs:check`, `pnpm proto:check-generated`, and `git diff --check`.
  `pnpm docs:check` completed with the known invalid-origin TypeDoc warning.
- Controller added follow-up coverage for multitenant catch-up stored events
  with absent envelope tenants, `importContext` domain tenants, and
  `pastMessage` email tenants.
- Focused controller verification passed after the tenant-form coverage
  additions:
  `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts`
  (`1` file, `82` tests), `pnpm format:check`, and `git diff --check`.
- Escalated native `pnpm --config.verify-deps-before-run=false verify` passed
  after the final tenant coverage additions with `53` passing test files and
  `901` passing tests. Coverage summary was `95.01%` statements, `90.12%`
  branches, `97.77%` functions, and `95%` lines. TypeDoc completed with the
  known invalid-origin warning; proto lint and generated-clean checks passed.
- Latest security re-review found one remaining blocker: catch-up tenant
  mismatch diagnostics exposed tenant values in the bounded detail message.
- Security-leak fix completed on `2026-07-08`: absent/mismatch replay tenant
  diagnostics now avoid tenant value leakage, and the mismatch regression asserts
  that the detail message does not contain either tenant string.
- Focused security-leak verification passed:
  `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts`
  (`1` file, `82` tests), `pnpm format:check`, and `git diff --check`.
- Escalated native `pnpm --config.verify-deps-before-run=false verify` passed
  after the security diagnostic leak fix with `53` passing test files and `901`
  passing tests. Coverage summary was `95.01%` statements, `90.12%` branches,
  `97.77%` functions, and `95%` lines. TypeDoc completed with the known
  invalid-origin warning; proto lint and generated-clean checks passed.
- Final re-review results:
  - code style/maintainability: clean;
  - documentation completeness: clean;
  - TypeScript/API docs: clean;
  - performance/reliability: clean;
  - security targeted rerun: clean.
- Residual non-blocking risks recorded by reviewers: repository-routing tests
  are large enough that future catch-up coverage may deserve a dedicated test
  file; catch-up remains process-local and non-transactional across the clear
  plus replay sequence; replay errors expose stored event IDs and bounded
  application error messages, so applications should not put secrets in those
  values.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
