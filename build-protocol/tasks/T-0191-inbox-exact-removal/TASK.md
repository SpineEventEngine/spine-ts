# T-0191: Exact Delivered Inbox Removal

Status: IN PROGRESS
Start: `2026-08-15 WEST`
Baseline: `e2ab42d2`
Branch: `codex/wave-12-inbox-cleanup`
Worktree: `.worktrees/wave-12-inbox-cleanup`
Classification: High-risk persistence and fencing correction

Implementation owner: existing `implementer`, explicitly configured as
`gpt-5.6-terra` with `medium` reasoning. Runtime telemetry is unavailable on
this surface; the immutable configured role/profile and explicit dispatch are
the available evidence.

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
