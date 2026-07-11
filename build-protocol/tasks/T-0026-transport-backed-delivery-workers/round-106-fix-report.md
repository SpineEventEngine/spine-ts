# T-0026 Round 106 Fix Report

## Scope

Addressed the Round 105 documentation and maintainability findings against
current HEAD `18e45b04` (`Clarify delivery scan rescan budget`).

## Implementation Summary

- Confirmed the Round 104 coordinator breadcrumb is now durable in the task,
  work, and review logs.
- Marked older Round 29 accepted-work wording as superseded where it grouped
  cleanup/status-update failures with pre-callback claim/validation/lease
  failures. The current contract is explicit: pre-callback
  claim/validation/lease failures do not increment `accepted`, while
  post-callback cleanup/status-update failures are accepted work and may appear
  in failed work.
- Split `Delivery.#drainAvailableMessages()` so the main loop now coordinates
  page reads and exits, `#readStablePendingPage()` owns boundary validation and
  stale-offset reset, and `#drainPendingPage()` owns per-row draining and cursor
  accounting. Public types and delivery behavior were left unchanged.

## Verification Commands and Results

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "stale-head rescan|storage read cap|skipped head rows disappear"`
  - 1 file passed, 3 tests passed, 50 skipped.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 4 files passed, 146 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc/API docs completed with exit code 0 and only the known invalid
    `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style after the repo formatter wrapped
    the touched work/review logs.
- PASS: `git diff --check`
- PASS: targeted `rg` guard for stale accepted-work wording returned no
  matches:
  `rg -n 'pre-callback claim/validation/lease/cleanup/status-update failures (leave|do not increment).*accepted|pre-callback cleanup/status-update failures leave \`accepted\` unchanged|cleanup/status-update failures leave \`accepted\` unchanged' ...`
