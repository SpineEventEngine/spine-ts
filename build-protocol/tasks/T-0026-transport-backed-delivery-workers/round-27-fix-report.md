# T-0026 Round 27 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before code changes:

| Source                                     | Scope                          | Evidence                                                                                                              |
| ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset           | Workflow, implementation, testing, verification, security, review, and TypeScript skills were present in the session. |
| Task-provided skills                       | Explicit Round 27 requirements | The assignment explicitly required TDD-style red evidence, implementation, and fresh verification before return.      |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Full file                      | Read; expected workflow, testing, and TypeScript skills are installed locally.                                        |
| User-installed entrypoints                 | Full directory listing         | The installed skill entrypoints under `/Users/armiol/.agents/skills` remain readable from earlier T-0026 rounds.      |
| Installed-skill lock                       | Manifest opened                | `/Users/armiol/.agents/.skill-lock.json` remained readable and sufficient for applicability confirmation.             |

Selected skills applied for this round:

| Skill                            | Round 27 use                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `test-driven-development`        | Add focused failing regressions for the tenant-context split and the unbounded loop invocation before edits. |
| `implement`                      | Apply the smallest runtime and doc/API changes needed for the full Round 27 batch without committing.        |
| `javascript-testing-patterns`    | Keep Vitest coverage behavior-focused with shared in-memory storage seams and targeted fake-delivery tests.  |
| `typescript-advanced-types`      | Keep the public `DeliveryEndpointMessage.label` union explicit and small.                                    |
| `verification-before-completion` | Rerun the required focused tests and repository checks on the final state before reporting completion.       |

Relevant-looking but skipped: `nodejs-backend-patterns` (no new Node lifecycle work), `projection-patterns`, `cqrs-implementation`, `event-store-design`, and `saga-orchestration` (no design changes in those seams), plus `security-best-practices` (the security findings are fully covered by the task-specific runtime regressions and fixes here).

Project protocol, this task brief, sandbox rules, and the explicit no-commit instruction take precedence over advisory skill guidance.

## Round 27 Scope

Address every Round 27 finding batch item:

1. Snapshot and validate tenant context for one drain, then use that immutable context for shard-registry, inbox, and dedup work throughout the drain.
2. Add a bounded/resumable `DeliveryLoop.run()` behavior so one invocation cannot scan skipped-only rows forever under continuous unsupported writes.
3. Tighten the broader direct-drain documentation to match the API wording for accepted-work and scan accounting.
4. Fix the public TypeDoc visibility issue for `DeliveryEndpointMessage.label`.
5. Reconcile historical Round 24 notes with the later `OnDeliveryMessage` rename.

The existing non-blocking note about `FaultyDeliveryRecordStorage.compareAndSetRecord()` remains untouched.

## Red/Green Evidence

- Red: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts -t "keeps one drain on its original tenant when the caller-owned context mutates mid-callback|returns a resumable status instead of scanning skipped-only drains forever"` failed before production edits.
- Red failure 1: the new multitenant drain regression observed `delivered: 0` and `failed: 1` after flipping `tenantId` during an awaited callback, proving renew/mark/cleanup/release had followed the mutated tenant instead of the original pickup tenant.
- Red failure 2: the new loop regression threw `DeliveryLoop kept starting skipped-only drains without stopping.`, proving one `run()` invocation had no aggregate stop point when every drain saw a saturated skipped-only page.
- Green: the same focused Vitest command passed after the fix with 2 passing tests and 67 skipped tests.

## Implementation Summary

- `Delivery` now snapshots and validates one immutable `StorageContext` at drain start, then builds drain-scoped inbox and shard-registry facades from that snapshot so pickup, renewal, cleanup, dedup, delivery marking, and release all stay on the original tenant even if the caller-owned context object changes later.
- `DeliveryEndpointMessage.label` now inlines its three supported public labels, leaving TypeDoc with a navigable public union instead of a private alias reference.
- `DeliveryLoop` now returns `PAUSED` after two saturated skipped-only drains in one invocation and preserves `scanOffset` for the next `run()`, bounding one invocation while keeping resumable forward progress.
- `DeliveryWorker` now propagates `PAUSED` as a worker-level stop reason when any owned loop pauses.
- `packages/server/README.md`, `docs/architecture/README.md`, `docs/USER_GUIDE.md`, and `docs/api/README.md` now explicitly state that direct-drain `limit` caps endpoint callbacks actually invoked, scanning is bounded by `maxReadLimit + limit`, and skipped/unsupported rows plus pre-callback failures do not consume accepted work or loop failure budget.
- Historical Round 24 durable notes now mention that `DeliveryEndpoint` was renamed to `OnDeliveryMessage` in Round 25.

## Verification Commands and Results

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
  - 5 files passed, 222 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API-doc expectation checks completed with exit code 0.
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - Initially failed on 4 touched files; after formatting those files with Prettier, the rerun passed.
- PASS: `git diff --check`
  - No whitespace errors.

## Concerns

- `docs:check` still reports the pre-existing invalid `origin` TypeDoc source-link warning.
- `.codex-review-packages/` remains an existing untracked scratch directory and was left untouched.
- No commit was created.
