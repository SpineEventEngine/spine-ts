# T-0205 Work Log

## 2026-08-18 — Framing

- Task classified high-risk for concurrent membership, fan-out, backpressure,
  cancellation, and lifecycle behavior.
- Ownership, human requirements, TDD order, verification, and reviewer concerns
  were frozen before the implementation dispatch.
- No product code changed at this checkpoint.
- Skill inventory/lock and expected-skill manifest were checked. Selected
  workflow skills were fully read by the orchestrator; the implementation
  owner must read `test-driven-development` before changing product code.
- Explicit dispatch profile: existing `implementer` role,
  `gpt-5.6-terra`/`medium`; subagent spawning prohibited. The Desktop surface
  supports explicit model/reasoning dispatch. Runtime self-telemetry may be
  unavailable and must be recorded if so.
- Fresh isolated setup passed with `pnpm install --offline --frozen-lockfile`.
  `pnpm proto:generate && pnpm typecheck:build:generated` passed; known volatile
  Proto generation stamps were restored, leaving a clean worktree.
- Clean baseline passed the dynamic unary/native/unary Gateway suites (3 files,
  66 tests) and the dedicated dynamic subscription suite (1 file, 44 tests).

## 2026-08-18 — RED checkpoint

- Characterized `DynamicUnaryForwarder` as the current single owner of node
  reconciliation, unary selection, retained logical definitions, native-child
  creation/activation, update relay, retry cleanup, and close. Its subscription
  adapter delegates without another algorithm.
- Added the first deployment-kernel behavior test before product code:
  `pnpm exec vitest run packages/deployment/test/membership-kernel.test.ts`.
  It failed as expected with `TypeError: BackendMembershipKernel is not a
constructor`, proving the neutral composition surface is absent rather than
  passing against existing Gateway behavior.
- Next: add the smallest deployment-internal kernel and migrate the auth owner
  through its narrow adapter while retaining the existing Gateway tests.

## 2026-08-18 — Extraction parity checkpoint (not accepted)

- The first kernel RED is GREEN, and `pnpm typecheck:build:generated` passes.
- The first focused integration command ran the kernel test and both dynamic
  Gateway suites. It passed 51/59 tests. The eight failures establish that the
  initial generic kernel has not yet retained retry/ordering parity for failed
  client close, failed native cleanup, unexpected activation completion, and
  concurrent remove/dispose ordering; one delayed-start close path timed out.
- No commit, coverage claim, review, or push is authorized from this state.
  Continue by porting the established cleanup/retry coordination into the
  deployment kernel, then rerun affected tests before broader preflight.

## 2026-08-18 — Systematic-debugging Phase 1/2 resume

- Read the complete baseline owner from `e41e92d86` and the full extracted
  kernel after reading the systematic-debugging and TDD skill instructions.
  Reproduced the focused suite exactly: 52/59 pass; failures are unexpected
  activation replacement, failed client close retry, delayed child-start close,
  failed child cleanup retry, two dispose-before-close ordering tests, and
  close retry/idempotence.
- Responsibility mapping: `#failedDisposals` + `#dispose/#retryDisposals`
  retain failed client closes; `#failedChildCleanup` + `#retryChildCleanup`
  retain failed child dispose calls; `#childCleanup` makes `#dispose` wait for
  every child cleanup for that client; definition `starts` and generation/
  incarnation checks cancel and join cross-generation child starts;
  `#completeChild` removes unexpectedly completed children so the next
  reconciliation replaces them; `#closing` memoizes a close attempt and clears
  only after a rejected incomplete-cleanup attempt so retry is idempotent.
- Root-cause hypothesis 1: the initial generic extraction collapsed those three
  cleanup ownership structures into best-effort catches and direct `close()`;
  that permits client close to race child disposal and loses retry obligations.
  The next minimal correction ports only those generic structures and call
  ordering, before changing unrelated activation logic.

## 2026-08-18 — Hypothesis 1 result

- After rebuilding project references (the auth package imports deployment's
  built artifact), the targeted failed-client retry, failed-child retry, and
  both dispose-before-close ordering tests pass. Hypothesis 1 is confirmed.
- The full focused suite then reached 58/59 but exposed a new timeout in
  `DynamicUnaryForwarder > keeps newer membership routable after an older
removal waits for disposal`. This is a cross-generation disposal/coalescing
  regression introduced by the correction, not a reason to layer another fix
  without a new Phase 1 trace. No preflight, coverage, commit, or push has run.

## 2026-08-18 — Hypothesis 2 result

- Root cause was an extra await on empty child removal in generic `#replace`.
  Skipping it when there are no definitions restores the baseline's scheduling
  turn. After rebuilding references, the exact coalesced-removal test passes.
- The full focused kernel/Gateway suite now passes: 3 files, 59 tests.
- Two correction hypotheses were used; no architecture blocker was reached.
  The remaining task preflight, coverage, documentation checks, commit, push,
  and review preparation have not yet run.

## 2026-08-18 — Coverage regression and convergence handoff

- The first coverage attempt exposed a close-cancellation result regression not
  reached by the 59-test parity selection. The original implementer added a
  focused regression, corrected the kernel, and pushed `c9d5dd5c2`; that direct
  test passed. The owner then returned BLOCKED before the complete post-fix
  coverage/preflight and durable report correction, so the task remains open.
- This is not an architectural or external blocker. A fresh existing
  `implementer` role owns only bounded convergence in the same worktree:
  explicit `gpt-5.6-terra` / `medium`, subagent spawning prohibited. It must
  reproduce the close regression evidence, rerun the complete focused suite,
  establish changed executable line/branch coverage, run deterministic gates,
  and replace stale report/status claims before review.
- No further product change is authorized unless a reproduced gate exposes a
  concrete defect and a failing test is retained first.
