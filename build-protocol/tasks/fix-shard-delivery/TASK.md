# Shard delivery continuation

Status: implementation, independent review, and local release verification complete.
GitHub CI awaits a human-created pull request.
Branch: `shard-delivery-continuation`, fresh official `origin/master`.

## Scope and acceptance

High-risk: delivery concurrency and shard-session lifecycle. Fix the publication
verification failure in `LocalEntityInbox` without weakening its assertions.
Reproduce the underlying failure deterministically, ensure same-shard follow-up
signals progress immediately, preserve cancellation and release semantics, expose
original test cleanup failures, and pass focused checks plus `verify:release`.
No new public abstraction, persistence format, or dependency is intended.

## Human-Imposed Requirements Ledger

- Fresh master, separate branch/worktree; protect master.
- Branch has no slash or generic feature/codex/fix/chore/task prefix.
- No artificial limits or migrations; execution/review logs remain outside Git.
- Small semantic commits, push each immediately to official origin.
- Do not create or modify GitHub PRs or Issues without explicit approval.
- Delivery is asynchronous. A -> B -> X on one shard must not wait for watchdog.
- No transactions across Entity writes and resulting signal delivery.
- No replay terminology for ordinary Inbox delivery.
- Domain-correct Protobuf fixtures. Timestamp fields use when_ names.
- Mermaid literal semicolons in labels must be escaped or avoided.
- Keep the correction bounded; preserve the required tests and reviews.

## Acceptance checks

Deterministic tests cover overlapping manual/local delivery, synchronous pickup
re-entry, an explicit wake during an empty read, and cancellation before a joined
message is processed. Existing tests retain pickup/release counts, ordering,
no-overlap, close, and late-message behavior.

Required checks: focused delivery tests, test and production typechecking,
formatting/lint, documentation checks, and the full release profile with the
repository coverage thresholds. GitHub CI requires a human-created pull request.

## Questions

None. User authorized the fix, commits and pushes under build protocol.

## Delivery coordination decision

An explicit DeliveryLoop and ordinary local Inbox reception must use the same
per-shard admission check. New local messages join and wake the active run,
retaining their exact message callbacks. A competing explicit drain is skipped.
The initiating run retains its cancellation signal and fallback callback.
Shard-session snapshot validation stays strict: tolerating stale release would
hide overlapping delivery rather than prevent it.

This follows the exclusive pickup, repeated scans, and late-message notification
in Spine JVM `server/delivery/Delivery.java` and `AbstractWorkRegistry.java`.
The regression must report cleanup failures instead of hiding them behind a
completion flag. Promise barriers and pickup counts prove the behavior without
wall-clock sleeps or dependence on watchdog cadence.

## Verification and remaining work

The full `verify:release` profile passed with `VITEST_MAX_WORKERS=2`: 7,160
Vitest tests and 44 Node tests passed. Global coverage exceeded 90% for statements,
branches, functions, and lines. All four relevant review concerns are resolved.

Two earlier full runs exposed unchanged timing-sensitive tests in
`NodeCoordinator` and the release-notes Git fixture. Both passed in focused runs
and in the final full run. Reducing local worker concurrency avoided contention;
no test, timeout, coverage threshold, or committed runner setting was changed.

The branch requires a human-created pull request for GitHub CI. Local checks do
not establish npm availability or trusted-publisher configuration.
