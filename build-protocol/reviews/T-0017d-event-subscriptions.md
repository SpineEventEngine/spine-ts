# T-0017d Review Log

Status: round 1 re-review clean; full verify passed

Scope: event subscription targets, activation/cancellation behavior,
`event_updates`, docs/API boundary, security, reliability, and verification
evidence.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f4458-a900-7fe0-a4a1-84afeb19a744` | Closed | FINDINGS |
| Documentation completeness | `019f4458-c55f-78f2-ba82-e5d28401e916` | Closed | FINDINGS |
| TypeScript/API docs        | `019f4458-e6ce-7453-8aeb-55eb983cd643` | Closed | CLEAN    |
| Security                   | `019f4459-0064-77e2-8795-9d69d6458dc2` | Closed | CLEAN    |
| Performance/reliability    | `019f4459-1af5-7130-9b72-3cca379726aa` | Closed | FINDINGS |

## Implementation Self-Review Concerns

- Code style/maintainability: fixed by replacing the fake
  `subscribeEvent`/`eventBus().subscribe` hook-counter test with a real
  built-context service-boundary rejection test for unsupported event filters.
- Documentation completeness: fixed in `docs/USER_GUIDE.md`; endpoint text now
  distinguishes command `post()` from event `acceptedEventTypes()` plus
  `post()` and describes event subscription targets.
- TypeScript/API boundary: fixed by removing public `EventBus.eventTypes()` and
  `EventBus.eventSchemas()`. Event target discovery remains on built-context
  `EventEndpoint.acceptedEventTypes()`, backed by internal `eventBusAccess`.
- Performance/reliability: fixed by having `EventBus.close()` mark direct
  subscriptions closed, clear subscriber records, and drop callback references.
- Performance/reliability: synchronous subscriber fan-out remains accepted for
  this slice because it runs inside the single serialized event-bus runtime
  queue, snapshots subscribers, clones per callback, and isolates callback
  exceptions. No scheduler was added.
- Security re-review was reported clean by the implementation sub-agent.

## Round 1 Findings

- Code style/maintainability: `EventBusAccess.eventTypes` and
  `EventDispatcherRegistry.typeUrls()` are unused after public discovery moved
  to `EventEndpoint.acceptedEventTypes()`.
- Code style/maintainability: event subscriptions reuse `SubscriptionMatcher`
  with a fake `"event"` result even though event subscriptions do not match
  `StandUpdate`s.
- Documentation completeness: review lanes and reviewer participation were
  still recorded as pending.
- Documentation completeness: JVM research did not name the concrete docs and
  `core-jvm/server` sources inspected.
- Documentation completeness: logs did not record full
  `pnpm --config.verify-deps-before-run=false verify` evidence.
- Performance/reliability: direct event subscribers can still attach after
  `EventBus.close()` has begun or completed, leaving activated event
  subscriptions waiting on a closed bus.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.

## Focused Fix Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/bus/event-bus.test.ts`:
  passed with 23 tests after fixing subscriber snapshot behavior.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/services/spine-services.test.ts`:
  sandbox run failed with `listen EPERM 127.0.0.1`; local-port escalated reruns
  passed with 89 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/index.test.ts packages/server/test/bus/index.test.ts packages/server/test/context/bounded-context.test.ts`:
  passed with 43 tests.
- `pnpm --config.verify-deps-before-run=false lint`: passed after fixing the
  temporary void-expression lint error.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing TypeDoc invalid-origin source-link warning.
- `pnpm --config.verify-deps-before-run=false format:check`: still failed only
  on inherited T-0017c markdown files.
- Targeted Prettier check for focused-fix files: passed.
- `git diff --check`: passed.

## Round 1 Review-Fix Worker

- Worker: `019f445c-3503-77e2-b5dd-631e0df173d8`.
- Status: assigned fixes complete; worker closed by the coordinator; pending
  re-review/full verify.
- Scope: remove unused event type listing APIs, remove fake event
  `SubscriptionMatcher` state plumbing, reject direct event-bus subscription
  after close begins/completes, and update durable evidence.
- Closure: coordinator closed the worker after receiving its result.
- Verification:
  - Red bus test failed as expected before the close guard:
    `rejects direct event subscribers after close begins`.
  - Final focused bus test:
    `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/bus/event-bus.test.ts`
    passed with 24 tests.
  - Final focused service test:
    `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/services/spine-services.test.ts`
    passed with 89 tests when rerun with local-port escalation after the
    sandboxed run failed with `listen EPERM 127.0.0.1`.
  - `pnpm --config.verify-deps-before-run=false lint`: passed after fixing
    TypeScript narrowing errors introduced during the matcher cleanup.
  - Targeted Prettier check for this worker's files: passed.
  - `git diff --check`: passed.
  - Coordinator full `pnpm --config.verify-deps-before-run=false verify`
    remains pending and is not claimed by this worker.

## Round 1 Re-Review

| Lane                       | Reviewer ID                            | Status | Result |
| -------------------------- | -------------------------------------- | ------ | ------ |
| Code style/maintainability | `019f4462-73fd-7393-b667-733c9027a398` | Closed | CLEAN  |
| Documentation completeness | `019f4462-8db0-78d0-82ef-0f26e6ef23b0` | Closed | CLEAN  |
| Performance/reliability    | `019f4462-a9ac-7c20-b417-af672bc474df` | Closed | CLEAN  |
