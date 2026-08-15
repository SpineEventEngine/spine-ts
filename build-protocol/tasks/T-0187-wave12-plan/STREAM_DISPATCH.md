# Wave 12 Accelerated Stream Dispatch

Status: Approved for dispatch after T-0187 closure

Baseline before dispatch: `origin/main@7e818a5b8a81f700c06503641777b1acd90e57ac`.

The Desktop surface accepts the existing `implementer` role with explicit
model/reasoning dispatch. It does not expose runtime model, token, or latency
telemetry; the immutable configured role/profile is the acceptance evidence
unless a visible mismatch or fallback occurs. Every owner is forbidden to spawn
subagents and is told that other writers are active in separate worktrees.

## Browser Stream

- Existing role: `implementer`.
- Bounded function: execute T-0188 real-browser/direct-native RED and boundary
  isolation, then T-0189 only at the single proven production owner.
- Explicit profile: `gpt-5.6-terra`, reasoning `medium`.
- Worktree/branch: `.worktrees/wave-12-browser` /
  `codex/wave-12-browser`.
- Exclusive initial files: Message Board browser interop entry/spec/harness/
  topology. Production ownership is assigned only after durable isolation.
- Must preserve cookie/CSRF, best-effort recovery, bounded cancellation, and
  real browser/Envoy evidence. No query/Inbox/provider cleanup files.

## Query-Provider Stream

- Existing role: `implementer`.
- Bounded function: execute T-0190 production normalized-plan RED, finite
  default policy, base fail-closed seam, MySQL SQL pushdown, genuine Datastore
  capability overlap, conformance, live-provider proof, and provider docs.
- Explicit profile: `gpt-5.6-terra`, reasoning `medium`.
- Worktree/branch: `.worktrees/wave-12-query-plans` /
  `codex/wave-12-query-plans`.
- Exclusive files: normalized query policy/execution, existing MySQL/Datastore
  `record-storage.ts` query sections, query conformance/tests/provider docs.
- It owns existing provider record-storage files until its reviewed endpoint or
  a recorded handoff. No browser or delivery lifecycle files.

## Inbox Stream

- Existing role: `implementer`.
- Bounded function: execute T-0191 exact provider-atomic
  ownership-plus-delivered-delete contract, then T-0192 bounded cleanup
  lifecycle, steady-state/failover/provider evidence, and TSDoc.
- Explicit profile: `gpt-5.6-terra`, reasoning `medium`.
- Worktree/branch: `.worktrees/wave-12-inbox-cleanup` /
  `codex/wave-12-inbox-cleanup`.
- Exclusive initial files: delivery ports/Inbox/lifecycle, new adjacent
  provider cleanup seams, memory cleanup, fencing/retention tests.
- It must not edit the Query stream's existing MySQL/Datastore
  `record-storage.ts` files. If atomic provider access truly requires them, it
  records the need and continues independent work until the orchestrator
  performs ownership handoff after T-0190.

## Shared Rules

- One production writer per owned file; never revert another stream.
- Create canonical task/work/review logs before product changes and record RED
  evidence before GREEN implementation.
- Push every checkpoint commit immediately; never rewrite published history.
- Run mechanical checks before review and the task's selected profile after
  convergence. Record changed-source >=90% line/branch coverage and live
  provider/runtime evidence separately.
- Shared generation, coverage, Envoy/browser, MySQL, Datastore, integration,
  and remote-cleanup resources are orchestrator-serialized.
- No stream is declared durably closed while another unique remote branch
  exists. Final task/Wave closure waits until all branches are reviewed,
  integrated, contained in `origin/main`, deleted, and the remote again exposes
  exactly `main` with no tags.

## Live Coordination Record

- The Inbox T-0191 RED checkpoint proved that exact removal spans the Inbox and
  shard-ownership record families. Provider-atomic ownership validation plus
  deletion therefore needs either the existing MySQL and Datastore
  `record-storage.ts` implementations or owner-selected adjacent transaction
  adapters that share their transaction/fencing boundary.
- Query retains exclusive ownership of those existing provider files through
  the reviewed T-0190 endpoint. Inbox continues its real RED, memory, port, and
  lifecycle work without editing them.
- After T-0190 review and focused verification, the orchestrator records an
  explicit ownership handoff, advances Inbox onto that durable endpoint, and
  only then permits the provider-atomic T-0191 implementation. A sequential
  validate-then-delete fallback is not acceptable.
