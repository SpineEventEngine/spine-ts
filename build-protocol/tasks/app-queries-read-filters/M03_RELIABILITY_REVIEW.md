# M03 performance/reliability review

Existing performance_reliability_reviewer, app_query_m03_reliability, explicitly
dispatched gpt-6-sol / medium. Runtime self-introspection unavailable; no visible
profile mismatch. Reviewer returned read-only findings; main transcribed them.
Final frozen tree against cc19b416d, including new read-request-status.ts.

## Findings

- P2: Lifecycle semantic admission accepts a Subscription whose Topic criterion
  is includeAll=false. SpineServices validates declared constraints but its
  lifecycle helper checks only empty filters, then reaches activation lookup or
  cancellation. NodeCoordinator likewise clears pending activation before an
  equivalent semantic check. This target-independent malformed shape already
  fails Subscribe. Reject before lookup/mutation, with structured
  INVALID_SUBSCRIPTION. Test a known valid ID for Activate and Cancel, including
  pending timer preservation. This does not request comparing supplied Topic
  identity against the canonical stored Topic or routing unknown IDs by it.
- P2: SpineServices read catch rethrows every ConnectError from the Stand read
  path. A storage adapter can thereby expose a private message/details and
  arbitrary status instead of sanitized INTERNAL. Preserve explicit framework
  tenant statuses; add a storage ConnectError regression and sanitize unexpected
  read failures regardless of their exception wrapper.

No other confirmed issue in changed execution paths. Full review wave must be
collected before a single correction batch.

## Targeted correction confirmation

Both P2 findings are resolved. Shared checkLifecycleCriterion runs before
SpineServices record access and Coordinator pending cleanup. Regressions retain
a known definition and pending expiry after malformed Activate/Cancel, and
preserve valid unknown cancellation. The read catch now converts the explicit
TenantUnknownError and sanitizes all other storage faults. A regression proves
private ConnectError status/message/metadata/details do not escape. Existing
Sol/medium reviewer inspected the correction and tests without repeating broad
checks. No unresolved finding remains from this targeted review.
