# T-0215 — Public subscription lifecycle and cleanup contention

**Status:** Active; root causes and architecture fixed, RED/implementation in progress

**Baseline:** `origin/main@fb79e3a4b637b44bc7ec7a5c03fb8dde1c19e102`

**Classification:** High-risk public-contract, persistence, concurrency, and
browser-lifecycle correction.

## Objective

Remove the Message Board's fabricated five-minute session, model public browser
access without an arbitrary lifetime, preserve real authenticated-session
expiry, and prevent overlapping durable maintenance from surfacing as HTTP 500.

## Binding human decisions

- Do not replace the five-minute expiry with another hard-coded duration,
  maximum timestamp, frozen clock, or infinity sentinel.
- Public Message Board access has no browser credential or login session.
- Explicit cancellation remains part of normal browser unmount, replacement,
  and shutdown behavior; periodic fake-session cancellation does not.
- Fix ownership and concurrency at their framework boundaries, not with an
  example-only retry or error suppression.
- Finish with a detailed file-by-file and behavior-by-behavior report.

## Acceptance

- Public access is represented separately from `ResolvedSession`.
- Public logical subscriptions have an explicit non-time-based lifecycle and
  do not create durable authenticated-subscription records. A separate public
  cleanup ledger retains only enough information to cancel orphans after an
  abrupt Gateway replacement.
- Authenticated applications retain exact session-expiry behavior.
- Overlapping expiry purges coalesce or defer safely; ordinary per-ID request
  queue bounds remain enforced.
- Known cleanup contention maps to an intentional protocol status and never an
  unhandled Connect HTTP 500.
- Two Message Board tabs remain connected beyond the former five-minute
  boundary, with no periodic Subscribe/Read/Activate/Cancel churn.

## Non-goals

- No arbitrary retained-binding population quota.
- No Gateway rollout, Kubernetes, autoscaling, or deployment strategy change.
- No removal of authenticated sessions, signed sessions, or OIDC support.

## Implementation ownership

- Existing role: `implementer`.
- Explicit configured profile: `gpt-5.6-terra` / `medium`; runtime telemetry is
  recorded if exposed, otherwise the immutable configured profile and limitation
  are evidence.
- Owned scope: the public Gateway access contract, subscription binding
  lifecycle, durable authenticated purge coordination, public orphan-cleanup
  ledger and approved Proto, Message Board composition, focused tests, and
  affected task/API/example documentation.
- The owner must not spawn subagents and must preserve unrelated work.
