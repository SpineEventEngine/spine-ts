# T-0017h Security Re-Review

Reviewer: T-0017h security re-reviewer
Date: 2026-07-09
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Review basis: working-tree changes from base commit `35134c3`, including
untracked T-0017h task/review files and the new delivery-loop source/test.
Status: CLEAN

## Canonical Skill Applicability Check

- Protocol sources checked before substantive security findings were recorded:
  `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`,
  `build-protocol/CONTRIBUTOR_WORKFLOW.md#review-loop`,
  `build-protocol/CODE_QUALITY.md#security-standards`, and
  `build-protocol/templates/REVIEW_LOG_TEMPLATE.md`.
- Session skill inventory evidence: task-relevant available skills included
  `security-best-practices`, `code-review-excellence`, `review`,
  `verification-before-completion`, `requesting-code-review`,
  `typescript-advanced-types`, `nodejs-backend-patterns`,
  `javascript-testing-patterns`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`.
- Task-provided skill cues: the assignment explicitly requested the
  T-0017h security re-reviewer role and focused security checks; it did not
  request threat modeling or code changes.
- Repo-local expected-skill manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed skill entrypoints enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
  this was a bounded full-directory entrypoint check.
- Installed-skill lock checked at `/Users/armiol/.agents/.skill-lock.json`;
  relevant entries included `review`, `requesting-code-review`,
  `subagent-driven-development`, `using-git-worktrees`,
  `verification-before-completion`, `typescript-advanced-types`,
  `nodejs-backend-patterns`, `javascript-testing-patterns`,
  `code-review-excellence`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`.
- Selected skill read fully before governed review work:
  `/Users/armiol/.codex/skills/security-best-practices/SKILL.md`.
- Security reference triage: the selected skill's references directory contains
  JavaScript/TypeScript guidance for Express, Next.js, React, Vue, jQuery, and
  general frontend security. The reviewed package is a TypeScript/Node
  framework library using `@connectrpc/connect`/`connect-node`, with no
  Express/Next/frontend surface in this diff, so no framework reference file was
  directly applicable.
- Skipped relevant-looking skills: `review` is a broader standards/spec lane,
  while this assignment is the security re-review lane; `stride-analysis-patterns`
  and `threat-mitigation-mapping` are threat-model helpers and were not needed
  for the requested fix verification; `nodejs-backend-patterns`,
  `typescript-advanced-types`, and `javascript-testing-patterns` were not
  selected because this pass did not implement backend architecture, advanced
  type design, or new tests.
- Governing rule: installed skills are advisory only. `BUILD_PROTOCOL.md`,
  `CODE_QUALITY.md`, the T-0017h task/review records, sandbox rules, and this
  security re-review assignment govern conflicts.

## Scope Reviewed

- Round-one security review:
  `build-protocol/reviews/T-0017h-security-round1.md`.
- Consolidated fix response:
  `build-protocol/reviews/T-0017h-delivery-scheduler-retry.md` and
  `build-protocol/work-logs/T-0017h.md`.
- Current changed/untracked surfaces reviewed:
  `packages/server/src/delivery/delivery-loop.ts`,
  `packages/server/src/delivery/delivery.ts`,
  `packages/server/src/delivery/inbox.ts`,
  `packages/server/src/delivery/inbox-storage.ts`,
  `packages/server/src/delivery/sharded-work-registry.ts`,
  `packages/server/src/context/process-manager-handoff.ts`,
  `packages/server/src/index.ts`,
  `packages/server/test/delivery/delivery-loop.test.ts`,
  `packages/server/test/delivery/delivery-worker.test.ts`,
  `packages/server/test/context/process-manager-handoff.test.ts`,
  `packages/server/test/index.test.ts`,
  `scripts/check-api-docs.mjs`,
  `docs/api/README.md`, `docs/USER_GUIDE.md`,
  `docs/architecture/README.md`, and `packages/server/README.md`.
- Dirty status reviewed with `git status --short --branch`. The only file
  modified by this re-reviewer is this report.

## Re-Review Findings

CLEAN. The round-one security finding is resolved and no new security findings
were found.

| Check | Result | Evidence |
| --- | --- | --- |
| Stale scheduler-loop docs boundary | Clean | `docs/api/README.md:289-303` now describes the supported local one-shard `DeliveryLoop` and narrows the deferred claim to process-wide transport-backed scheduler workers, retry monitors, conveyor/stations, transport retries, retained attempt history, example app work, and production read-side catch-up workers. |
| Limit validation boundary | Clean | `DeliveryLoopOptions.limit` is validated at construction through `requirePositiveSafeInteger()` in `packages/server/src/delivery/delivery-loop.ts:22-27` and `172-176`; invalid-limit coverage is in `packages/server/test/delivery/delivery-loop.test.ts:270-284`. Underlying record queries still validate positive limits before execution in `packages/storage/src/record/record-storage.ts:94-97` and `packages/storage/src/record/record-query.ts:17-23`. |
| Active-run ordering | Clean | `DeliveryLoop.run()` checks `#running` before the stopped fast path in `packages/server/src/delivery/delivery-loop.ts:33-45`; regression coverage for `run(); stop(); run()` while active is in `packages/server/test/delivery/delivery-loop.test.ts:152-176`. |
| Dedup guard bypass | Clean | `DeliveryLoop` only delegates to `Delivery.drain()` (`packages/server/src/delivery/delivery-loop.ts:79-84`), which marks successes through `Inbox.markDelivered()` (`packages/server/src/delivery/delivery.ts:58-68`). Exact-message and dedup synchronization remain in `packages/server/src/delivery/inbox-storage.ts:101-164` and `166-209`. |
| Shard-lock bypass | Clean | Each drain still claims with `ShardedWorkRegistry.pickUp()` and releases in `finally` (`packages/server/src/delivery/delivery.ts:44-74`); pickup/release remain storage-backed CAS operations in `packages/server/src/delivery/sharded-work-registry.ts:41-75` and `79-103`. Skipped claims do not invoke endpoints (`packages/server/test/delivery/delivery-loop.test.ts:92-119`). |
| Tenant/process-manager guard bypass | Clean | The local process-manager path still drains through `Delivery.drain()` and validates delivery label plus registered target before replay in `packages/server/src/context/process-manager-handoff.ts:57-93` and `95-109`. No new tenant-routing path is introduced by `DeliveryLoop`. |
| Unsafe endpoint error swallowing | Clean | Endpoint and mark-delivered failures stay in per-message `DeliveryFailure` results (`packages/server/src/delivery/delivery.ts:58-71`) and are aggregated into `DeliveryLoopRun.failures` (`packages/server/src/delivery/delivery-loop.ts:134-150`); failed rows remain `TO_DELIVER` for later retry, covered by `packages/server/test/delivery/delivery-loop.test.ts:47-90`. |
| Network/listener regression | Clean | The new public surface is a local loop export (`packages/server/src/index.ts:47-52`) around `Delivery.drain()`; no new listener, socket, endpoint, or transport owner is introduced. |
| Secret/logging/filesystem regression | Clean | No new secret handling, logging sink, filesystem access, path loading, or environment-variable access appears in the reviewed runtime diff. |
| Generated-code/proto regression | Clean | No generated/proto source is modified by the task diff; API export allowlists were updated only for the new public `DeliveryLoop` types (`scripts/check-api-docs.mjs:213-221`). |

## Verification Notes

I did not run a new test command during this re-review to avoid changing files
outside the allowed report path. I reviewed the fix response verification
instead: focused delivery/process-manager tests, docs check, format check, diff
check, and an escalated full `verify` were reported passing in
`build-protocol/reviews/T-0017h-delivery-scheduler-retry.md`.

## Outcome

CLEAN. All security findings from round one are resolved, and the fix does not
introduce dedup, shard-lock, tenant, process-manager, endpoint-error,
network/listener, secret, filesystem, or generated-code regressions.
