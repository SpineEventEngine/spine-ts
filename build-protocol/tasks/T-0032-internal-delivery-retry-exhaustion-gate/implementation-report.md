# T-0032 Implementation Report

Status: Round 5 documentation fix applied; fresh four-lane re-review pending

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
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `docs/api/README.md`
- `build-protocol/DEVELOPER_API.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/delivery-attempts.ts`
- `packages/server/src/delivery/delivery-retry-decision.ts`
- `packages/server/src/delivery/delivery-loop.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `packages/server/test/delivery/delivery-loop.test.ts`

## Concerns

- No implementation concerns are currently known. The current formal review
  status and any future findings are maintained in the T-0032 review log; this
  report does not duplicate round-specific lane state.

## Round 1 Fix Scope

- `packages/server/src/delivery/delivery-retry-decision.ts` is included beyond
  the initially assigned source-file list because its validation cap repeated
  the retained-attempt `100` independently. It imports the package-internal
  retained-attempt capacity so the retry gate and ring storage share one source
  without a public entry-point export or TypeDoc surface.
- After `docs:check`, the coordinator-named temporary generated directories
  `examples/todo/.generated-hEUHML/` and
  `packages/proto/.generated-BQMVG1/` were verified absent. No cleanup command
  was needed and neither directory can enter VCS from this worktree.

## Round 1 Fix Report

### Findings Resolved

- Replaced the exhausted-row `Error` subclass with a frozen plain object of
  bounded facts. The focused regression proves it is not an `Error`, has no
  `.stack`, has the ordinary object prototype, is frozen, and serializes the
  complete bounded exhaustion facts.
- Kept exhaustion at the pre-callback retry-decision boundary and narrowed
  `DeliveryMessageResult` to only `SKIPPED`, `DELIVERED`, and `FAILED`.
- Shared `deliveryAttemptCapacity` from retained attempt storage with retry
  validation and the delivery gate. It is not exported through
  `@spine-ts/server` and does not enter TypeDoc.
- Updated the package README, runtime architecture, and API overview with only
  the internal 100-attempt gate semantics and its explicit exclusions.

### Commands And Results

- RED, expected exit 1:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "does not invoke exhausted supported rows or record another attempt"`.
  The assertion failed because `DeliveryRetryExhaustedError` was an `Error`.
- GREEN, exit 0:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "does not invoke exhausted supported rows or record another attempt"`.
  One focused test passed.
- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-retry-decision.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/delivery-loop.test.ts`.
  Four files and 234 tests passed.
- Initial typecheck exit 2:
  `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
  It reported `TS2339` on the impossible post-narrowing exact-message guard;
  removing that dead branch resolved the type error.
- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false docs:check`.
  TypeDoc reported zero errors; its invalid-local-remote source-link warning is
  pre-existing environment noise.
- Initial formatter exit 1:
  `pnpm --config.verify-deps-before-run=false format:check`.
  It requested reformatting `build-protocol/work-logs/T-0032.md` and
  `packages/server/src/delivery/delivery.ts`.
- PASS, exit 0 after
  `pnpm exec prettier --write build-protocol/work-logs/T-0032.md packages/server/src/delivery/delivery.ts`:
  `pnpm --config.verify-deps-before-run=false format:check`.
- PASS, exit 0: `git diff --check`.
- PASS, exit 0 with no output: `git ls-files --others --exclude-standard`.

## Round 2 Fix Report

### Findings Resolved

- Updated public `DeliveryRun`, `DeliveryFailure`, `DeliveryLoopOptions`, and
  `DeliveryLoopRun` TypeDocs so bounded retry exhaustion is a failed
  observation, counts against loop failure budgeting, and exposes only
  stack-free bounded facts before callback invocation. No public retry-policy
  type was added.
- Qualified the architecture's missing attempt-counter wording as the still
  absent public or production policy, preserving the existing internal
  retained-attempt gate description.
- Marked the Round 1 findings as historical and resolved, made Round 2 the
  unambiguous current status, and completed every T-0032 changed-file
  inventory.
- Added the narrow internal exhaustion-gate semantics to the detailed durable
  delivery API section without broad policy claims.
- Added `counts an exhausted head against the failure bound before retryable
tail callbacks` in `delivery-loop.test.ts`. It proves an exhausted head
  consumes the configured failure budget, invokes no endpoint, and leaves a
  retryable tail pending. The current implementation already satisfied this
  behavior, so no runtime behavior change was made.

### Commands And Results

- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "counts an exhausted head"`.
  One focused regression test passed.
- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts`.
  Two files and 105 tests passed.
- PASS, exit 0: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- PASS, exit 0: `pnpm --config.verify-deps-before-run=false docs:check`.
  TypeDoc reported zero errors; its invalid-local-remote source-link warning
  is pre-existing environment noise.
- PASS, exit 0:
  `pnpm --config.verify-deps-before-run=false format:check`.
- PASS, exit 0: `git diff --check`.
- PASS, exit 0 with no output: `git ls-files --others --exclude-standard`.
- PASS, exit 0, final repeat:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts`.
  Two files and 105 tests passed.

## Round 5 Documentation Fix

- Technical adjudication: both `docs/USER_GUIDE.md` and
  `build-protocol/DEVELOPER_API.md` required edits. Each previously described
  retained-attempt preparation or later replay without stating the implemented
  100-attempt pre-callback exhaustion gate, exhausted-row `TO_DELIVER`
  retention, callback and retained-attempt suppression, bounded stack-free
  failure facts, and failed-work/failure-budget accounting. The edits preserve
  retryable failures as available for later replay and keep public monitor,
  scheduler/backoff, dead-letter, topology, catch-up, and production-adapter
  policy out of scope.
- The Round 5 documentation fix worker performed the canonical skill
  applicability check before edits. Session inventory evidence exposed the
  task-relevant installed skills `receiving-code-review`, `doc-coauthoring`,
  `implement`, and `verification-before-completion`; the task-provided skill
  paths named those same four skills. The worker checked
  `build-protocol/skills/EXPECTED_SKILLS.md`, enumerated the full readable
  `/Users/armiol/.agents/skills` entrypoint set with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`,
  and inspected `/Users/armiol/.agents/.skill-lock.json` for the selected
  entries. The selected skills were fully read and apply to review reception,
  documentation refinement, bounded implementation, and evidence-before-
  completion verification. Other expected skills were skipped as irrelevant to
  this documentation-only fix; no source was unreachable and no subagents were
  spawned.

### Commands And Results

- PASS, exit 0: `pnpm --config.verify-deps-before-run=false docs:check`.
  TypeDoc reported zero errors and the known invalid-local-remote source-link
  warning.
- PASS, exit 0: `pnpm --config.verify-deps-before-run=false format:check`.
  All matched files use Prettier code style.
- PASS, exit 0: `git diff --check` with no output.
- PASS, exit 0: `git ls-files --others --exclude-standard` with no output.
- No full `pnpm verify` was run.
- Resumed final verification at `2026-07-11T17:04:22Z`: PASS, exit 0,
  `pnpm --config.verify-deps-before-run=false format:check`; PASS, exit 0,
  `git diff --check` with no output; and PASS, exit 0,
  `git ls-files --others --exclude-standard` with no output.
- Post-format verification at `2026-07-11T17:05:45Z`: PASS, exit 0,
  `pnpm --config.verify-deps-before-run=false format:check`; PASS, exit 0,
  `git diff --check` with no output; and PASS, exit 0,
  `git ls-files --others --exclude-standard` with no output.
