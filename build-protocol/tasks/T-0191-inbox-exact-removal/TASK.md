# T-0191: Exact Delivered Inbox Removal

Status: ACCEPTED
Start: `2026-08-15 WEST`
Baseline: `e2ab42d2`
Branch: `codex/wave-12-inbox-cleanup`
Worktree: `.worktrees/wave-12-inbox-cleanup`
Classification: High-risk persistence and fencing correction

Implementation owner: existing `implementer`, explicitly configured as
`gpt-5.6-terra` with `medium` reasoning. Runtime telemetry is unavailable on
this surface; the immutable configured role/profile and explicit dispatch are
the available evidence.

The initial owner became inactive after durable checkpoint `a39d0e3b`. A
replacement existing `implementer` continues the same non-provider coverage
scope with explicit `gpt-5.6-terra` / medium dispatch and no subagents. Existing
MySQL/Datastore provider ownership still waits for the orchestrator's recorded
T-0190 handoff, so no overlapping writer is introduced.

## Objective

Add the optional source-compatible `DeliveryInbox.removeDelivered(message,
session, options?)` persistence contract for built-in direct Inbox storage.
It returns `true` only when a still-current session atomically removes the
exact matching delivered snapshot, and `false` for stale ownership, absence,
non-delivered, or changed snapshots.

## Acceptance

- The public method is optional and frozen by a consumer type test; structural
  custom ports that omit it remain compatible.
- Ownership verification plus exact compare-and-delete is one provider-owned
  atomic operation: memory critical section, Datastore transaction, and MySQL
  transaction or shared ownership fence.
- `keepUntil` absent or `<= now` is eligible. Pending, scheduled, catch-up,
  retryable, protected, malformed, changed, and replaced rows remain.
- An interleaving that transfers ownership between old validate/delete steps
  proves stale deletion is impossible under the new operation.
- Persisted bytes, columns, and Protobuf are unchanged. RemoteInbox remains
  unchanged because acknowledgement removes its pending row.
- Focused changed executable line and branch coverage is at least 90%; live
  MySQL/Datastore evidence is recorded separately and run serially.

## Constraints

- T-0190 exclusively owns existing MySQL and Datastore `record-storage.ts`.
  Any required edits await an explicit recorded handoff.
- No retention duration, scheduler, serialized field, or Wave 13+ API.
- Relevant review lanes: TypeScript/API, style/maintainability,
  performance/reliability, and documentation. Security is retained for Wave
  convergence, with tenancy/group containment and destructive fencing noted.

## Human-Imposed Requirements Ledger

- Preserve source compatibility and exact provider-owned atomic fencing.
- Use behavior-focused TDD: establish and observe RED before each runtime fix.
- Keep cleanup bounded; do not add an unbounded scan, timer, scheduler, or
  retention configuration.
- Propagate cancellation/deadline controls through direct removal and provider
  cleanup seams; cancellation must prevent a successful deletion result.
- Do not add Wave 13+ APIs, serialized fields, or generated-contract changes.
- Run live MySQL and Datastore evidence serially only after the orchestrator
  grants each exclusive provider window; use independently opened handles and
  record physical row counts separately from coverage.
- Update task, work, and review records with each correction and preserve the
  existing implementer profile (`gpt-5.6-terra` / medium) with no subagents.

## Mechanical Convergence Evidence

- `node scripts/check-tsdoc.mjs` clears the complete 42-finding cleanup batch.
  The affected public port, direct storage/facade, internal capability, and
  memory/MySQL/Datastore coordinators now state their current behavior and
  parameter/return contracts without expanding the API.
- The six focused paths completed with 40 passing deterministic tests:
  `packages/server/test/delivery/inbox.test.ts`,
  `packages/server/test/delivery/delivery-worker.test.ts`,
  `packages/server/test/delivery/inbox-provider-cleanup.test.ts`,
  `packages/storage/test/memory-delivery-cleanup.test.ts`,
  `packages/storage-rdbms/test/mysql-delivery-cleanup.test.ts`, and
  `packages/storage-datastore/test/datastore-delivery-cleanup.test.ts`.
  The two conditional live cases in `inbox-provider-cleanup.test.ts` were
  skipped because neither `SPINE_TS_MYSQL_URL` nor `DATASTORE_EMULATOR_HOST`
  was configured in this worktree; this is an explicit live-provider evidence
  limitation, not a claim of MySQL or Datastore execution.
- Separate serialized direct-source provider runs subsequently passed the
  exact-removal matrix on MySQL 8.4.10 and the Datastore emulator. Those live
  results are recorded independently from the service-gated non-live profile
  and from V8 coverage accounting.
- Current-source coverage from the provider implementation checkpoint is
  112/115 changed executable lines (97.39%) and 69/75 changed branch outcomes
  (92.00%). Runtime model telemetry remains unavailable; the explicit existing
  `implementer` profile is `gpt-5.6-terra` / medium.
- The selected final profile is `pnpm verify:task -- --no-coverage` with the
  same six focused paths. No-coverage is appropriate because current-source
  coverage is already recorded separately; the profile reruns the shared task
  gates and focused behavioral selection without replacing that measurement.
- Final profile result: the exact six-path no-coverage command passed every
  shared gate, TypeDoc/API check, generated-output check, and focused test.
  Vitest reported 40 passes and two expected service-gated skips. The seven
  owned headers now match `copyrightHeader(2026)`, and the changed shard
  registry has only the required Prettier comma normalization.

## Final Deadline And Provider-Evidence Correction

- The earlier 40-test and coverage figures above are historical checkpoints.
  The final six-path deterministic selection passes 58 tests with four
  expected service-gated skips.
- Current exact diff-scoped LCOV against `3081dcc0` is 114/121 changed
  executable lines (94.21%) and 107/116 changed branches (92.24%).
- Serialized live MySQL 8.4.10 and Datastore-emulator runs use independent
  handles and provider-native counts: one durable row after stale-owner refusal
  and zero after current-owner deletion. Provider execution is separate from
  V8 accounting.
- `timeoutMs` is captured as an admission-relative budget and rechecked through
  the internal provider activity predicate before destructive safe points.
- Final correction evidence supersedes those figures: 59 focused tests pass
  with four expected service-gated skips; exact current diff coverage is
  120/128 lines (93.75%) and 109/119 branches (91.60%). Invalid timeout values
  are rejected, MySQL rolls back expiry during delete, and live MySQL plus
  fallback-project Datastore retain native one-to-zero row-count proof.
