# T-0017a Implementation Report

Status: implemented
Date: `2026-07-08`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017a-read-side-catch-up`
Branch: `task/T-0017a-read-side-catch-up`
Base commit: `5b14845`

## Summary

Implemented the first local read-side catch-up slice in the framework:

- added `BoundedContext.catchUpReadSide(options?)` as the framework-owned entry
  point;
- added `Stand.clear()` so projection state can be reset before replay;
- replay now reads already-stored events from `EventStore`, sorts them for
  stable historical order, and dispatches only registered projection repository
  handlers;
- no events are re-appended during catch-up;
- multitenant catch-up is tenant-scoped and requires `tenantId`;
- docs and API export expectations were updated;
- focused tests cover rebuild, tenant scoping, no re-append behavior, and small
  replay diagnostics.

## Design Decisions

1. Public catch-up API stays on `BoundedContext`.
   This keeps catch-up framework-owned and avoids pushing replay materialization
   into app code.

2. Replay reads from `EventStore`, but dispatch bypasses `EventBus.post()`.
   Stored events are read from the bounded-context event log, then delivered only
   to registered projection repository dispatchers so catch-up does not
   re-append events or fan back out through unrelated custom event handlers.

3. Projection state is cleared per registered projection state type.
   `Stand.clear()` removes stored rows plus in-memory version metadata before
   replay, matching the local JVM-style rebuild boundary without adding Delivery
   catch-up infrastructure.

4. Multitenant catch-up is explicit.
   `catchUpReadSide({ tenantId })` is required for multitenant contexts because
   the event-store and stand slices are tenant-scoped. Single-tenant contexts
   reject `tenantId`.

5. Replay order is explicit.
   Catch-up sorts stored events by timestamp, producer ID, version, then event
   ID so aggregate-produced histories rebuild deterministically.

## Files Changed

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `packages/server/test/stand/stand.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/test/index.test.ts`
- `examples/todo/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `build-protocol/work-logs/T-0017a.md`

## Verification

Passed:

- `pnpm exec vitest run packages/server/test/stand/stand.test.ts packages/server/test/repository/repository-routing.test.ts`
- `pnpm exec vitest run examples/todo/src/index.test.ts -t "rebuilds the task list from stored events during read-side catch-up"`
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `pnpm exec vitest run --coverage --coverage.thresholds.lines 0 --coverage.thresholds.functions 0 --coverage.thresholds.statements 0 --coverage.thresholds.branches 0 packages/server/test/stand/stand.test.ts packages/server/test/repository/repository-routing.test.ts`

Not run:

- full `pnpm test:coverage`

Reason not run:

- the full example suite contains a standalone server test that binds
  `127.0.0.1`; in this sandbox that test fails with
  `listen EPERM: operation not permitted 127.0.0.1`, so verification used
  focused coverage/tests for the touched areas instead.

## Notes

- No app-side handler materialization, schema-bearing decorator changes,
  `@Apply` additions, manual app transactions, Delivery catch-up storage, retry
  loops, schedulers, inbox lifecycle, or topology work were introduced.
- No event-store mutation occurs during catch-up beyond ordinary read access.

## Fix Round 1

Date: `2026-07-08`
Status: implemented in code/docs; awaiting re-review

### Trigger

Round-1 reviewers reported six follow-up findings against the first catch-up
slice:

1. catch-up replay sent every stored event to every projection dispatcher;
2. catch-up used a second unsynchronized execution path relative to context
   close and concurrent catch-up;
3. multitenant catch-up trimmed `tenantId` instead of preserving the exact
   non-blank string;
4. catch-up replay failures exposed raw `Error.cause` details;
5. public docs/TSDoc/API docs under-described the supported catch-up boundary;
6. durable logs needed the fix-round hand-off and verification trail.

The controller recorded all five round-1 reviewer IDs in the durable work and
review logs after the fix report was written by the fix worker.

### Changes

- `packages/server/src/context/bounded-context.ts`
  - stored each projection dispatcher's declared event type URLs and filtered
    replay by `event.message.typeUrl`;
  - preserved exact non-blank multitenant `tenantId` values in
    `catchUpStorageContext()`;
  - serialized `catchUpReadSide()` through a bounded-context local runtime queue
    so concurrent catch-up calls queue and `close()` waits for accepted catch-up
    work;
  - replaced raw replay `Error.cause` exposure with a bounded deterministic
    `ReadCatchUpReplayError` shape (`code`, `eventId`, bounded `detail`);
  - expanded TSDoc for `ReadCatchUpOptions`, `ReadCatchUpResult`, and
    `catchUpReadSide()` to document the current boundary.
- `packages/server/src/stand/stand.ts`
  - documented `Stand.clear()` as the framework-owned projection reset step used
    by catch-up.
- `packages/server/test/repository/repository-routing.test.ts`
  - added regressions proving replay filters by dispatcher schema, exact tenant
    IDs are preserved, concurrent catch-up calls serialize, close waits for an
    active catch-up run, and replay errors expose bounded diagnostics without
    raw `cause`.
- `packages/server/README.md`
  - documented `ReadCatchUpOptions`, `ReadCatchUpResult`,
    `BoundedContext.catchUpReadSide()`, `Stand.clear()`, the single-tenant vs
    multitenant contract, projection-only replay scope, and excluded delivery /
    scheduler / inbox / retry / transport concerns.
- `docs/api/README.md`
  - updated the exported API narrative so it no longer contradicts catch-up
    support and now names the public catch-up and `Stand.clear()` surfaces.
- Durable logs
  - updated the work log and review log with the fix-round hand-off, round-1
    findings, fix status, and verification.

### Verification

Passed:

- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts packages/server/test/stand/stand.test.ts packages/server/test/index.test.ts examples/todo/src/index.test.ts -t "repository signal routing|Stand|@spine-ts/server|rebuilds the task list from stored events during read-side catch-up"`
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `git diff --check`

Attempted but sandbox-blocked:

- `pnpm --config.verify-deps-before-run=false verify`

Exact blocking output:

- `Error: listen EPERM: operation not permitted 127.0.0.1` in
  `examples/todo/src/index.test.ts`,
  `packages/server/test/services/spine-services.test.ts`, and
  `packages/server/test/server/server.test.ts`
- `Error: Operation not permitted` in
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts`

Verify totals at failure:

- test files: `49` passed, `4` failed
- tests: `861` passed, `30` failed

## Controller Verification Follow-Up

After the fix worker finished, the controller corrected durable logs with the
actual first-round reviewer IDs and added focused branch coverage for:

- single-tenant catch-up rejecting `tenantId`;
- multitenant catch-up rejecting missing or blank `tenantId`;
- malformed stored events producing bounded catch-up replay diagnostics.

The first escalated full verify run reached coverage and failed only because
branch coverage was `89.89%`, below the `90%` threshold. After the added focused
coverage, the escalated command passed:

- `pnpm --config.verify-deps-before-run=false verify`

Final verify evidence:

- test files: `53` passed
- tests: `893` passed
- coverage: `94.93%` statements, `90.02%` branches, `97.76%` functions,
  `94.92%` lines
- TypeDoc completed with the known invalid-origin warning
- proto lint and generated-clean checks passed

## Fix Round 2

Date: `2026-07-08`
Status: implemented in code/docs; awaiting re-review

### Trigger

Second re-review after the round-1 fixes reported six remaining issues:

1. `catchUpReadSide()` still runs on a separate bounded-context runtime and can
   interleave with normal `EventBus.post()` / stored redispatch work.
2. `ReadCatchUpResult.replayedEventCount` still counts all stored events rather
   than only those dispatched to at least one matching projection subscriber.
3. Catch-up replay diagnostics still expose the generic dispatch snapshot shape,
   including stack when present, instead of a catch-up-specific bounded detail.
4. Projection state clearing still iterates per repository rather than per
   unique projection state type.
5. `docs/architecture/README.md` and `docs/USER_GUIDE.md` still describe
   catch-up as deferred/outside the current slice.
6. Durable logs and this implementation report need the second fix trail and
   verification evidence.

### Planned Changes

- add a framework-internal EventBus queue helper so catch-up shares the same
  serialized runtime as normal live event intake and stored redispatch;
- remove the extra bounded-context read-side runtime if the EventBus queue fully
  covers the lifecycle requirements;
- count only events that actually match at least one projection subscriber
  during replay;
- change catch-up replay detail to a bounded name/message shape with no stack;
- clear projection state once per unique projection state schema/type URL;
- refresh public docs and durable logs for the supported local catch-up
  boundary.

### Changes

- `packages/server/src/bus/event-bus.ts`
  - added framework-internal `eventBusAccess.runExclusive(eventBus, work)` so
    framework-owned work can run on the same serialized runtime queue as
    `EventBus.post()` and stored redispatch;
  - refactored `post()` and stored redispatch to use the shared exclusive queue
    helper.
- `packages/server/src/context/bounded-context.ts`
  - removed the extra bounded-context read-side runtime and moved
    `catchUpReadSide()` onto the EventBus runtime queue through
    `eventBusAccess.runExclusive(...)`;
  - counted only replayed events that matched at least one projection
    subscriber;
  - cleared projection state once per unique projection state type URL;
  - replaced catch-up replay `detail` with a bounded name/message-only shape
    that omits stack;
  - updated catch-up TSDoc to describe the shared EventBus queue and the
    matched-event replay count.
- `packages/server/test/repository/repository-routing.test.ts`
  - added regression coverage proving catch-up does not interleave with live
    event intake on the EventBus queue;
  - added replay-count coverage proving unmatched stored events do not inflate
    `replayedEventCount`;
  - tightened replay-error assertions so catch-up diagnostics do not expose a
    stack;
  - added coverage for non-`Error` catch-up replay failures after the controller
    full verify exposed a branch-coverage gap.
- `packages/server/test/bus/event-bus.test.ts`
  - added coverage for the framework-internal EventBus exclusive-work access
    guard.
- `docs/architecture/README.md`
  - replaced the stale deferred-only wording with the implemented limited local
    catch-up boundary and its explicit exclusions.
- `docs/USER_GUIDE.md`
  - updated the repository/read-side/runtime sections so they describe
    `BoundedContext.catchUpReadSide(options?)` as the supported local projection
    replay entry point and keep broader delivery/scheduler/cross-process
    recovery exclusions explicit.
- Durable logs/reporting
  - updated the task work log, review log, and this implementation report with
    the second re-review findings, applied fixes, and verification evidence.
- Controller coverage fix
  - simplified `EventBus.#runExclusive()` by removing an impossible defensive
    branch and relying on the `SingleProcessServerRuntime.enqueue()` completion
    contract.

### Verification

Passed:

- `pnpm exec vitest run packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `git diff --check`
- `pnpm --config.verify-deps-before-run=false verify`

Notes:

- `pnpm format:check` initially failed on
  `packages/server/src/context/bounded-context.ts` and
  `packages/server/test/repository/repository-routing.test.ts`; running
  `pnpm exec prettier --write packages/server/src/context/bounded-context.ts packages/server/test/repository/repository-routing.test.ts`
  fixed the formatting gate before the final passing rerun.
- The first full verify after the round-2 fix pass failed only at branch
  coverage: `53` test files and `895` tests passed, but branch coverage was
  `89.89%`, below the required `90%`.
- The focused coverage-fix test command passed with `2` test files and `98`
  tests.
- The final escalated native full verify passed with `53` test files and `897`
  tests. Coverage summary was `94.97%` statements, `90.01%` branches, `97.76%`
  functions, and `94.95%` lines.
- `pnpm docs:check` completed with the same known TypeDoc invalid-origin
  warning already present elsewhere in task verification.

## Post-Coverage-Fix Review Pass

Date: `2026-07-08`
Status: implemented in code/docs; awaiting reviewer rerun

### Trigger

The latest post-coverage-fix review produced documentation/code-style/security
findings:

1. multitenant catch-up could read events from a selected tenant storage slice
   while replaying an event whose envelope named a different tenant, allowing
   projection Stand writes to update that other tenant during catch-up;
2. `packages/server/README.md` still said projection catch-up remained outside
   this slice instead of narrowing the exclusion to durable cross-process
   Delivery/subscription recovery catch-up;
3. `build-protocol/reviews/T-0017a-read-side-catch-up.md` had a stale lane
   table and needed the latest review-round status.

The TypeScript/API docs and performance/reliability lanes reported no latest
findings. Reviewers have not rerun after this fix pass yet.

### Changes

- `packages/server/src/context/bounded-context.ts`
  - added framework catch-up validation before projection dispatch for
    multitenant replay;
  - rejected stored events whose envelope tenant is absent or does not exactly
    match the selected catch-up storage tenant;
  - kept replay tenant diagnostics generic so selected/envelope tenant values do
    not leak through bounded catch-up errors;
  - kept exact tenant IDs with no trimming beyond the existing blank-value
    validation.
- `packages/server/test/repository/repository-routing.test.ts`
  - added a regression that manually appends an event under tenant A with an
    envelope naming tenant B, runs `catchUpReadSide({ tenantId: "tenant-a" })`,
    expects a bounded `ReadCatchUpReplayError`, and verifies tenant B projection
    state is not updated;
  - added controller follow-up coverage for absent envelope tenants,
    `importContext` domain tenant IDs, and `pastMessage` email tenant IDs in
    multitenant catch-up replay;
  - asserted that tenant mismatch diagnostics do not contain either tenant
    string.
- `packages/server/README.md`
  - narrowed the exclusion to durable cross-process Delivery/subscription
    recovery catch-up.
- Durable logs/reporting
  - updated the review log lane table, work log, and this report with the latest
    findings, fix pass, files changed, and verification trail.

### Verification

Passed:

- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts`
- `pnpm format:check`
- `pnpm lint`
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `git diff --check`

Red check before implementation:

- the new regression initially failed because tenant-a catch-up resolved with
  `replayedEventCount: 1` instead of rejecting.

Notes:

- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with `1` test file and `79` tests after the fix worker pass, then with
  `1` test file and `82` tests after controller-added tenant-form coverage.
- `pnpm docs:check` completed with the known invalid-origin TypeDoc warning.
- `pnpm lint` initially failed on helper names over the four-component semantic
  name limit. Renaming them to `validateReplayTenant` and `readReplayTenant`
  fixed the lint gate.
- The first full verify after the tenant-integrity fix failed only at branch
  coverage: `53` test files and `899` tests passed, but branch coverage was
  `89.86%`, below the required `90%`.
- The final escalated native full verify passed with `53` test files and `901`
  tests. Coverage summary was `95.01%` statements, `90.12%` branches, `97.77%`
  functions, and `95%` lines.
- Security re-review then found that the tenant mismatch diagnostic still
  leaked the selected and envelope tenant strings. After changing the diagnostic
  to a generic message, focused verification passed again with `1` repository
  routing test file and `82` tests, plus `pnpm format:check` and
  `git diff --check`.
- The final escalated native full verify after the security diagnostic leak fix
  passed with `53` test files and `901` tests. Coverage summary was `95.01%`
  statements, `90.12%` branches, `97.77%` functions, and `95%` lines.
- Final re-review completed clean across all required lanes.
