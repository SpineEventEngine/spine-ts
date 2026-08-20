# T-0215 work log

## 2026-08-20 — diagnosis

- Traced the repeated five-minute browser cancellation to Message Board's
  `PublicBoardAdmission`, which fabricated a five-minute `ResolvedSession`.
- Traced the HTTP 500 independently: overlapping durable authenticated-expiry
  purges competed through the per-ID queue until pre-operation maintenance
  raised `binding-busy` outside request-specific mapping.
- Recorded the human invariants: public access has no login session or expiry;
  no replacement TTL, infinity sentinel, quota, rollout change, or example-only
  retry is permitted.

## 2026-08-20 — public access and purge ownership

- Added mutually exclusive `sessions` and `publicAccess: true` modes to Unary
  and Subscription Gateways and Browser Server. Missing browser authorization
  is represented as credential absence, not an empty bearer value.
- Deleted Message Board's example admission/session fixture. Its policy and
  context resolver now authorize the framework public principal and rebuild the
  actor from request context.
- Added one store-wide durable purge owner. Concurrent callers share the active
  purge; a later greater horizon is drained in the same owner. Authenticated
  expiry stops active work, joins serialized operations, cancels the backend
  once, and deletes the durable record only after successful cleanup. Failures
  remain retryable.
- Mapped known pre-operation maintenance contention to the existing intentional
  Gateway rejection instead of allowing a raw HTTP 500.

## 2026-08-20 — rejected durable-public experiment

- An intermediate design added a durable public orphan-cleanup Proto and ledger.
  Further lifecycle analysis proved it could not safely rehydrate native
  subscriptions and contradicted the approved process-local public model.
- Reverted the implementation in forward commits, removed the Proto source,
  facade, manifests, ledger, and startup recovery, and restored generated
  metadata to the baseline. No serialized public record remains.
- Final public Gateway bindings are process-local. Gateway restart is handled by
  browser reconnect, authoritative query, and a fresh subscription.

## 2026-08-20 — activation lifecycle

- Added internal-only `SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS` in Core and reused
  it in Auth, Stand, and NodeCoordinator. It bounds only the incomplete interval
  after `Subscribe` and before `Activate`; it is not an active-stream lifetime.
- Public pending cleanup retries after failure, is cancelled by Activate,
  Cancel, or shutdown, and aggregates activation and cleanup failures.
- NodeCoordinator removes pending definitions on failed setup and removes active
  definitions when activation ends. Deterministic fake-timer, cancellation,
  malformed-error, and retry tests cover the boundaries.

## 2026-08-20 — Message Board convergence

- Browser Server now owns correctly wired process-local public bindings. Message
  Board no longer supplies durable bindings, namespace settings, fake sessions,
  browser credentials, or public-binding deployment environment variables.
- Beginner docs explain that Gateway restart drops live definitions and the UI
  recovers by authoritative query followed by resubscription.
- A repository audit found no other active-subscription TTL. Remaining timers
  bound requests, cleanup, reconciliation, retries, or incomplete activation.

## 2026-08-20 — live acceptance and protocol correction

- Ran the documented two-replica local launcher with shared Delivery and the
  Datastore emulator.
- Two Chromium tabs exchanged eight alternating posts, remained connected for
  310 seconds, then both received a post after the former boundary. The test
  recorded no healthy-period Cancel response, HTTP 500/401/404, or console
  error.
- Sent real Ctrl-C to the launcher. Its Coordinator, two replicas, Gateway,
  Vite process, Datastore container, Delivery container, and listeners on
  5173/8081/8090/8091/8484 were all gone afterward.
- Added a governing protocol rule requiring an hours estimate, included work,
  and duration explanation before every future task, wave, or correction unless
  the human explicitly waives it.

## Provenance

- Requirements/public-contract analysis: existing requirements-splitting role,
  explicit `gpt-5.6-sol` / `high`.
- Normal implementation: existing implementer role, explicit
  `gpt-5.6-terra` / `medium`.
- Repository and documentation audits: read-only functions, explicit
  `gpt-5.6-luna` / `low` or `medium`.
- Runtime telemetry was unavailable on these surfaces; immutable configured
  profiles are the recorded evidence.
