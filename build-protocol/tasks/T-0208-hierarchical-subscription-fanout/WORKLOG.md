# T-0208 work log

## 2026-08-18 — Framing and TDD lock

- Read `AGENTS.md`, `BUILD_PROTOCOL.md`, the accepted T-0203 plan and human
  ledger, and T-0205–T-0207 task/work/review records before editing product
  code. The plan assigns RED 12–21 to this high-risk slice.
- The sole implementation owner is the existing `implementer`, configured
  explicitly `gpt-5.6-terra` / `medium`; runtime telemetry is unavailable and
  no subagents may run.
- Fully read the `test-driven-development` skill. Runtime changes will be made
  only after a focused behavior test is observed failing for the missing
  Coordinator subscription behavior.
- Current T-0207 has truthful-but-unsupported `subscribe`, `activate`, and
  `dispose` member-client callbacks. The T-0205 internal kernel already owns
  bounded creation, retained in-memory definitions, immediate child rewriting,
  awaited update sinks, activation cancellation, compensation, and cleanup.
- Next: add the narrowest real HTTP/2 Coordinator subscription RED and record
  its exact output before replacing the unsupported adapters.

## 2026-08-18 — Authorized membership-admission correction

- The orchestrator supplied a demonstrated T-0205 handoff defect: a connected
  joining member was inserted into the kernel's forwardable set before retained
  child synchronization completed. Ownership was widened only to the internal
  deployment kernel and its focused test, as authorized; no new protocol or
  readiness concept was introduced.
- RED: after a current member retained `logical`, a joining member's delayed
  child `Subscribe` allowed its second unary forward. The exact focused command
  failed: `expected 'joining' to be 'current'` at
  `membership-kernel.test.ts:86` (29 passing, 1 failing).
- GREEN: member records now remain ineligible until the current retained
  definition synchronization succeeds. `forward()` selects eligible members
  only; failed child creation leaves the joining member ineligible. A later
  reconcile retries the existing child synchronization path. Existing members
  retain their unary eligibility, preserving Gateway compatibility.
- Focused kernel proof is green: `pnpm exec vitest run
  packages/deployment/test/membership-kernel.test.ts` — 31/31 tests passed.
- Next: commit and push this green checkpoint, then add the Coordinator
  `SubscriptionService` HTTP/2 RED.
