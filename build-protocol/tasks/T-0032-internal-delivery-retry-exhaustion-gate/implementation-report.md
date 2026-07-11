# T-0032 Implementation Report

Status: Complete; review pending

Branch: `task/T-0032-internal-delivery-retry-exhaustion-gate`

Worktree: `.worktrees/T-0032-internal-delivery-retry-exhaustion-gate`

## Scope

- Add focused TDD coverage for internal retry exhaustion gating in shard and
  exact-message delivery drains.
- Implement the minimal package-internal gate using retained attempt summaries
  and `DeliveryRetryDecisions` with `maxAttempts: 100`.
- Keep exhausted rows pending and observable only through sanitized
  `DeliveryRun.failures`.

## TDD Evidence

- Red setup:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "exhausted|retryable"`
  first failed before collection because local workspace build/generated outputs
  were absent.
- Prerequisite repair:
  `pnpm --config.verify-deps-before-run=false proto:generate` passed and
  `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  passed.
- Red evidence:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "exhausted|retryable"`
  failed as expected. Exhausted shard rows invoked callbacks
  (`seen` contained `signal-exhausted`) and an exhausted head row consumed the
  accepted-work limit (`seen` contained `signal-exhausted-head` instead of
  `signal-limit-tail`). The retryable row case passed.
- Exact-message red evidence:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "retry exhaustion before exact-message"`
  failed as expected because `seen` contained `signal-exact-exhausted`.

## Implementation Notes

- `Delivery` now summarizes retained attempts before invoking supported
  endpoint callbacks.
- The internal retry budget is `100`, applied through
  `DeliveryRetryDecisions`.
- Exhausted rows produce a returned `DeliveryRun` failure with internal
  bounded facts, do not invoke callbacks, do not record another retained
  attempt, do not consume accepted-work limit, and remain pending
  `TO_DELIVER`.
- Retryable rows continue through the existing claim, callback, mark-delivered,
  and retained-failure path.
- Existing live-delivery retention-ring coverage was adjusted to write retained
  attempts directly because live drains now correctly stop at exhaustion.

## Verification

- PASS:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "exhausted|retryable"`
  after implementation, 3 tests passed.
- PASS:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "retry exhaustion before exact-message"`
  after implementation, 1 test passed.
- PASS:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-retry-decision.test.ts packages/server/test/delivery/inbox.test.ts`,
  202 tests passed.
- PASS:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts`,
  32 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  after an explicit union-narrowing fix.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`.
- PASS: `git diff --check`.
- PASS: `git status --short` showed the intended tracked edits plus this new
  implementation report.
- PASS: `git ls-files --others --exclude-standard` showed only this
  implementation report; generated Protobuf output remained ignored.

## Changed Files

- `build-protocol/reviews/T-0032-internal-delivery-retry-exhaustion-gate.md`
- `build-protocol/tasks/T-0032-internal-delivery-retry-exhaustion-gate/TASK.md`
- `build-protocol/tasks/T-0032-internal-delivery-retry-exhaustion-gate/implementation-report.md`
- `build-protocol/work-logs/T-0032.md`
- `packages/server/src/delivery/delivery.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`

## Concerns

- No residual implementation concerns known. Formal multi-lane reviewer
  subagents are pending; the coordinator instructed this implementation worker
  not to spawn its own subagents.
