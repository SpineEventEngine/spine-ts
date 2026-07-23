# T-0062: Public Delivery Client And Remote Adapters

Status: Complete; reviewed and fully verified before integration

Branch: `task/T-0062-delivery-client`

Worktree: `.worktrees/T-0062-delivery-client`

Baseline: pushed `main` at `dee92556`

## Objective

Add the public Node-only `@spine-ts/delivery-client` package and the remote
Inbox, work-registry, and Admin-observation ports required by the accepted
`DeliveryBuilder` and the later T-0063 production supervisor. Keep generated
Connect transport types behind a stable, bounded facade.

## Classification

High-risk. This packet introduces a public package and RPC facade, represents
ambiguous mutation outcomes, controls retry eligibility and channel ownership,
and supplies distributed-concurrency dependencies used by T-0063.

## Acceptance Criteria

- Cover single and batch Inbox writes/removes, find, bounded paged reads,
  newest pending, shard pickup, release, and release-expired.
- Supply Inbox/work-registry adapters usable by `DeliveryBuilder` and a bounded
  Admin shard-update observation port usable by T-0063.
- Make deadlines, cancellation, and owned versus supplied channel lifecycle
  explicit.
- Keep server validation, transport failure, and an outcome that became unknown
  after mutation admission distinguishable.
- Automatically retry only side-effect-free reads, health checks, and
  reconnecting Admin observation. Do not automatically retry mutable RPCs.
- After mutation deadline/cancellation or a dropped post-admission response,
  throw a sanitized `DeliveryOperationOutcomeUnknownError` that identifies the
  safe read/session reconciliation operation required before another mutation.
- Bound page sizes and decoded `Any` bytes; decode only through an explicit
  registered-schema allowlist.
- Do not leak generated transport details, payloads, actor metadata, or raw
  server diagnostics through the stable facade or errors.
- Preserve all Wave 2/3/4 deferrals and do not implement T-0063 scheduling or
  T-0064/T-0065 server behavior in this packet.

## Test-First Evidence Required

- Record RED then GREEN evidence for each new public behavior family.
- Cover mock RPC behavior, retry eligibility, timeout before admission,
  timeout-after-commit/dropped-response reconciliation for every mutation
  family, cancellation, declaration shape, fake-server integration, bounded
  pages/decoding, and channel close ownership.
- Run the full canonical repository verification before acceptance.

## Accepted Port Resolution

- Add server-owned `DeliveryInbox`, `DeliveryInboxWork`, and
  `DeliveryWorkRegistry` seams; do not add an aggregate backend abstraction.
- `DeliveryBuilder.withInbox()` and widened `withWorkRegistry()` must pass the
  supplied ports through every drain scope. Local defaults remain unchanged.
- Local inbox work hides the existing exact-row claim, synchronized claim
  renewal, fenced delivered transition, and claim clearing behind
  `begin()` / `synchronize()` / `complete()` / `abandon()`.
- Remote inbox work begins with `FindOne` plus exact-snapshot validation,
  relies on exclusive remote shard ownership, makes no fictional row claim,
  maps successful completion to exactly one `RemoveOne`, and treats absence as
  the terminal delivered state.
- Represent local leased and remote exclusive sessions honestly. Remote work
  registry pickup/release has no renewal RPC or synthetic expiry timer.
- An unknown inbox removal quarantines the row from endpoint redispatch until
  `FindOne` reconciliation proves absence. Unknown shard mutation blocks another
  mutation until Admin snapshot/observation reconciles it.
- Frozen timestamp-only paging must fail closed at an ambiguous full-timestamp
  boundary rather than silently skip rows. Do not invent a cursor wire format.
- The absence of renewable remote fencing, lossless arbitrary-tie paging, and
  worker-conditional release are documented frozen-protocol limitations, not
  reasons to weaken the existing local behavior or expand the wire contract.

## Assignment Gate

- Existing role: `implementer`.
- Ownership: `packages/delivery-client`, only the minimum server/proto/package
  graph seams needed for adapters, focused tests, package README, API inventory,
  and this task's implementation report/work records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Dispatch requirement: both fields are explicit; the child must not spawn
  children, commit, push, merge, or modify protected/unrelated files.
- Runtime acceptance: record actual runtime metadata when exposed. Otherwise
  record the immutable configured role/profile and the surface limitation;
  redispatch only for an omitted field, wrong role, visible mismatch, or actual
  inherited fallback.

## Remaining Implementation Slices

The initially assigned client owner stopped after the page-bound shell and did
not establish a protocol blocker. Complete the remaining work sequentially with
one writer at a time:

1. Unary facade and lifecycle: generated conversions, every Inbox/Shard unary
   operation, deadlines/cancellation, error taxonomy, safe read retries,
   single-shot mutations, owned/supplied transport lifecycle.
2. Delivery adapters and reconciliation: `DeliveryInbox` /
   `DeliveryWorkRegistry`, mutation-unknown quarantine, read/Admin
   reconciliation, builder execution, bounded allowlisted payload conversion,
   and timestamp-boundary failure.
3. Admin observation and package completion: bounded/reconnecting update stream,
   handshake/cancellation/overflow, fake-server integration, declarations,
   README/TSDoc, API inventory, and focused/full mechanical preparation.

## Required Review Dispositions

- Style/maintainability: required.
- Documentation completeness: required.
- TypeScript/API compatibility: required.
- Performance/reliability: required.
- Final security: N/A until the Wave 1 T-0067 security gate unless a specialist
  identifies a security-critical blocker requiring earlier escalation.
