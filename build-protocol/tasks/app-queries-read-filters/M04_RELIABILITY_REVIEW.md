# M04 performance/reliability review

Existing performance_reliability_reviewer app_query_m03_reliability, explicitly
configured gpt-6-sol / medium. Runtime self-introspection unavailable; no visible
mismatch. Main transcribed the read-only review. Base 54520ee63, frozen M04.

Clean: no actionable finding. Absent records and registry missing/expired
activation return NOT_FOUND with enum-qualified UNKNOWN_SUBSCRIPTION and native
spine-error-bin. Duplicate-active and closed delivery remain distinct, with
per-ID activation serialization unchanged. Coordinator forwarding preserves
the structured child error.

Client NotFound recovery requires the exact error type and numeric reason.
Unrelated/tenant/auth/invalid statuses terminate; transient statuses retain
bounded handling. Existing recovery increments attempts and generation, cancels
the prior wire, waits with abort, subscribes for a fresh ID, then resynchronizes
Entity state or reports an Event gap. Exhaustion and cancellation remain bounded.
Focused tests cover each behavior, including native details and duplicate races.

The supplied 291/291 tests, affected build/cheap checks and 93.8%/94.7% changed
coverage align with inspected code. No tests were repeated or source files changed.
