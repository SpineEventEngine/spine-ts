# T-0192: Shard-Fenced Bounded Delivered Inbox Cleanup

Status: IN PROGRESS — PROVIDER HANDOFF PENDING
Baseline: `e2ab42d2`
Branch: `codex/wave-12-inbox-cleanup`
Worktree: `.worktrees/wave-12-inbox-cleanup`
Classification: High-risk lifecycle and persistence correction

Implementation owner: existing `implementer`, explicitly configured as
`gpt-5.6-terra` with `medium` reasoning. Runtime telemetry is unavailable on
this surface; the immutable configured role/profile and explicit dispatch are
the available evidence.

The initial owner became inactive after durable checkpoint `a39d0e3b`. A
replacement existing `implementer` continues changed-branch lifecycle tests
under the same explicit profile and no-subagent rule. It has no provider file
ownership until the orchestrator completes T-0190 review and records handoff.

## Objective

Within an acquired shard session, consume bounded pages of delivered Inbox
rows and call T-0191's provider-atomic exact removal for each eligible row.

## Acceptance

- Run one cleanup page per processed delivery page and one maintenance page on
  an empty owned drain; never introduce an independent scheduler or cleanup
  owner.
- Stop on cancellation, deadline, ownership loss, or page bound. Failures and
  restarts leave undeleted eligible rows durable and retryable.
- Preserve pending, claimed, retryable, and protected delivered rows; exact
  expiry (`keepUntil === now`) and absent `keepUntil` are eligible.
- Cover crash before/after deletion, restart, retry, duplicate, replacement
  fence, two-owner race, pages larger than one batch, and steady-state physical
  row counts. Live providers use independently opened handles serially.
- Focused changed executable line and branch coverage is at least 90%; live
  provider and row-count evidence is recorded separately.

## Coverage convergence evidence

- The direct worker suite covers cancellation before deletion, bounded
  multi-row maintenance, custom-port omission, deadline forwarding,
  ownership loss before maintenance, and existing release-failure behavior.
- Focused V8 LCOV records 11/11 changed executable lines and 16/16 changed
  branch outcomes in `delivery.ts` (100%/100%) for the Wave 12 additions
  relative to `e2ab42d2`. The repository-global threshold from the one-file
  command is intentionally not a scoped changed-code measure.
