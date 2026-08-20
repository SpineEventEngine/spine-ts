# T-0215 — Public subscription lifecycle and cleanup contention

**Status:** Implementation and live acceptance green; specialist review in progress

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
- Explicit cancellation remains part of normal browser disconnect, replacement,
  failed setup, and shutdown behavior; periodic fake-session cancellation does
  not.
- Fix ownership and concurrency at their framework boundaries, not with an
  example-only retry or error suppression.
- Public Message Board bindings remain process-local. Do not invent durable
  public recovery or a new serialized record.
- Finish with a detailed file-by-file and behavior-by-behavior report.

## Acceptance

- Public access is represented separately from `ResolvedSession` and is
  mutually exclusive with authenticated sessions.
- A healthy active public subscription has no framework time-to-live.
- Only the incomplete `Subscribe` to `Activate` handshake is bounded. Auth,
  Stand, and NodeCoordinator reuse one internal lifecycle fact.
- Public Message Board bindings are process-local; after Gateway restart the
  browser re-queries authoritative state and subscribes again.
- Authenticated durable definitions retain their real session expiry.
- Overlapping authenticated expiry purges share one maintenance operation;
  active work is stopped and joined before backend cancellation and deletion.
- Known cleanup contention maps to an intentional protocol status and never an
  unhandled Connect HTTP 500.
- Two Message Board tabs remain connected beyond the former five-minute
  boundary, exchange an update afterward, and produce no healthy-period Cancel,
  HTTP 500, authorization error, missing asset, or console error.
- The documented launcher cleans all owned processes, listeners, and containers
  on Ctrl-C.

## Non-goals

- No arbitrary retained-binding population quota.
- No Gateway rollout, Kubernetes, autoscaling, or deployment strategy change.
- No removal of authenticated sessions, signed sessions, or OIDC support.
- No durable public-subscription ledger or Proto message.

## Implementation ownership

- Existing role: `implementer`.
- Explicit configured profile: `gpt-5.6-terra` / `medium`; runtime telemetry was
  unavailable, so the immutable configured profile is the recorded evidence.
- Read-only architecture used the existing requirements-splitting role with
  explicit `gpt-5.6-sol` / `high`.
- Read-only repository and documentation audits used explicit
  `gpt-5.6-luna` / `low` or `medium` according to the assigned function.
- Owned scope: public Gateway admission, subscription lifecycle, authenticated
  durable purge coordination, Browser Server composition, Message Board public
  composition, focused tests, and affected documentation.
