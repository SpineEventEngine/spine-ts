# T-0026 Round 28 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before edits:

| Source                                     | Scope                          | Evidence                                                                                                      |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset           | Delivery/runtime, testing, verification, TypeScript, and review skills were available in-session.           |
| Task-provided requirements                 | Full Round 28 batch            | The assignment explicitly required red evidence, doc/log updates, verification, and no commit.              |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Full file                      | Expected workflow/testing/type skills remain installed locally.                                              |
| Installed skill manifest                   | Existing local manifest        | Earlier T-0026 rounds already verified the readable installed-skill manifest and user skill directories.     |

Selected skills applied for this round:

| Skill                            | Round 28 use                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `test-driven-development`        | Added focused failing regressions for worker status precedence, paused resume drift, and access fallthrough before production edits. |
| `implement`                      | Applied the narrowest delivery/runtime/doc/test changes needed for the full Round 28 batch.    |
| `javascript-testing-patterns`    | Kept delivery coverage behavior-focused with real delivery instances and dedicated fixtures.    |
| `typescript-advanced-types`      | Added package-root type coverage for `DeliveryWorkerRun.status` / `DeliveryLoopStatus`.        |
| `verification-before-completion` | Reran focused Vitest, generated build typecheck, docs check, format check, and `git diff --check`. |

Relevant-looking but skipped: `nodejs-backend-patterns`, `projection-patterns`, `cqrs-implementation`, `event-store-design`, and `saga-orchestration` because this round did not change those runtime seams.

Project protocol, this task brief, sandbox rules, and the explicit no-commit instruction take precedence over advisory skill guidance.

## Round 28 Scope

Address every finding in the Round 28 batch:

1. Preserve `PAUSED` over `SKIPPED` in `DeliveryWorkerRun.status` and cover mixed loop outcomes plus package-root typing.
2. Make `deliveryAccess.drain()` fail fast for non-owned instances and replace the fake paused-loop seam with real delivery/internal coverage.
3. Make paused-loop resume safe when earlier skipped rows disappear between runs without leaking loop-only controls through public `DeliveryDrainOptions`.
4. Correct docs/logs so only skipped unsupported labels avoid failure-budget consumption; pre-callback failures still count toward `failed` / `DeliveryLoop.maxFailures`.
5. Correct docs/logs so malformed/deprecated stored rows such as legacy `IMPORT_EVENT` abort read/drain with `DeliveryStorageCorruptionError` instead of surfacing in `DeliveryRun.failures`.
6. Split the delivery-worker storage fault harness by concern.
7. Remove the duplicated loop read-cap source of truth.
8. Adjudicate the same-event-loop timer-renewal limitation for CPU-bound synchronous callbacks.

## Red/Green Evidence

- Red: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts`
  failed before production edits.
- Red failure 1: the new paused-resume regression returned `IDLE` with `delivered: 0` after earlier skipped rows were removed, proving the saved absolute paused offset could skip a now-reachable supported row.
- Red failure 2: the new internal-access regression called the fake public `drain()` instead of failing fast, proving `deliveryAccess.drain()` still fell back when no owned drainer was registered.
- Red failure 3: the mixed loop outcome regression showed worker aggregation hiding `PAUSED` behind `SKIPPED`, overlapping the TypeScript/API and security findings.
- Green: the same focused command passed after the runtime fixes with 2 files and 27 tests.
- Green: the required wider focused command passed after all runtime/test/doc edits:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
  - 6 files passed, 229 tests passed.

## Implementation Summary

- `DeliveryWorker` now preserves `PAUSED` over `SKIPPED`, and package-local worker access exposes the aggregation helper for focused runtime coverage.
- `Delivery` now records an internal pending-boundary resume cursor on each `DeliveryRun` and validates that boundary against the current pending set before reusing it. When earlier skipped rows disappeared, paused loops now reset safely instead of skipping shifted supported rows.
- `DeliveryLoop` now consumes the internal resume cursor rather than a raw public-facing offset, while still resetting retry position for failed undelivered rows so `maxFailures` retries behave the same as before.
- `deliveryAccess.drain()` now throws immediately for non-owned instances. Package-local tests that need synthetic drains now override the owned drainer on a real `Delivery` instance instead of bypassing the internal contract.
- The overgrown delivery-worker storage fault harness moved into dedicated `delivery-storage-fault-fixture.ts` helpers, and the duplicate loop read-cap constant was removed in favor of `inboxStorageAccess.maxReadLimit`.
- Broader docs and durable task logs now say the correct accounting contract and legacy corruption contract, and they explicitly record the same-event-loop renewal limitation.

## Adjudications

- Same-event-loop callback renewal: adjudicated as a trust-boundary limitation, not a fixable timer guarantee in this slice.
  - Code evidence: shard renewal still runs from `keepShardLease()` timer callbacks, and endpoint callbacks still execute inline in `Delivery.#invokeEndpoint()` on the same JavaScript event loop.
  - Consequence: a CPU-bound or otherwise synchronous callback can block renewal long enough to lose the lease because JavaScript cannot preempt the callback in-process.
  - Response in this round: document the limitation plainly in API/architecture/task/work/review durable docs instead of implying `setInterval` renewal can protect a blocked callback.

## Verification Commands and Results

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
  - 6 files passed, 229 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API-doc expectation checks completed with exit code 0.
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format`
  - Rewrote the touched files into repository formatting before the final `format:check`.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace or conflict-marker errors.

## Concerns

- `docs:check` still reports the pre-existing invalid `origin` TypeDoc source-link warning.
- `.codex-review-packages/` remains an existing untracked scratch directory and was left untouched.
- No commit was created.
