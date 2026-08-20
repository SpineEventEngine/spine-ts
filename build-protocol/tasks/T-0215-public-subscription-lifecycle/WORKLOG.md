# T-0215 work log

## 2026-08-20 — diagnosis and architecture dispatch

- Confirmed the live Message Board's repeated cancellation is driven by
  `PublicBoardAdmission` fabricating a five-minute `ResolvedSession`.
- Traced expiry through Gateway activation abort, browser recovery, old-wire
  Cancel, Subscribe, authoritative Read, and Activate.
- Proved the HTTP 500 separately: three overlapping durable expiry purges for
  one record exhaust the per-ID queue and the pre-operation purge throws
  `binding-busy` outside request-specific mapping.
- Retained a focused failing test with the exact third-purge rejection.
- Dispatched the existing `requirements_splitter` role read-only for the public
  contract and purge-ownership design. The dispatch explicitly selected
  `gpt-5.6-sol` / `high`; runtime telemetry is not exposed, so the immutable
  configured role/profile is the available provenance. The agent was forbidden
  from editing or spawning subagents.
- No production code has been changed at this checkpoint.

## 2026-08-20 — architecture result and bounded follow-up

- Accepted the requirements splitter's principal recommendations: mutually
  exclusive `sessions` / `publicAccess`, no fake session, no public durable
  authenticated record, and a store-wide purge single-flight owner.
- Rejected its suggested new 30-second pending-public activation lifetime. The
  human explicitly prohibited replacing one arbitrary lifetime with another.
- Reused the same read-only requirements-splitter context, again under its
  immutable `gpt-5.6-sol` / `high` profile, to verify abrupt Gateway-loss
  cleanup of native definitions and identify a non-time-based pending owner.

## 2026-08-20 — implementation dispatch

- Follow-up source audit proved active child definitions are removed when their
  activation stream terminates, but a Gateway crash after Subscribe and before
  Activate has no stream owner; Coordinator state can also outlive the lost
  Gateway definition.
- Selected a separate durable public orphan-cleanup ledger with no expiry. A
  normal Cancel removes it; startup cancels and deletes any surviving row before
  public intake. It is not rehydrated and does not represent a session.
- Explicitly rejected both a new pending-public TTL and the splitter's optional
  capacity suggestion. The former violates the human lifetime invariant; the
  latter is a separately rejected quota feature.
- Dispatched the existing `implementer` role with explicit
  `gpt-5.6-terra` / `medium`, no subagents, and sole production ownership of the
  affected Gateway/subscription/Message Board paths. Runtime telemetry will be
  recorded if the surface exposes it.

## 2026-08-20 — durable maintenance correction checkpoint

- Preserved and ran the supplied RED tests. The durable test failed with the
  expected third `binding-busy`; the Gateway test failed by leaking that error
  before operation-specific rejection mapping.
- Added one store-wide coalesced purge owner. Concurrent callers share an
  active purge, while a later caller's greater horizon is retained for a
  following bounded pass. Per-ID external-operation queue limits are unchanged.
- Mapped only the known pre-operation `binding-busy` error to the existing
  Gateway rejection. Other maintenance failures still propagate.
- Focused tests are green. Public-access mode, durable public orphan cleanup,
  Proto output, Message Board migration, broader coverage, and preflight remain.
- Extended the focused behavior proof: a higher overlapping purge horizon is
  processed after the active bounded pass, and close joins coalesced purge work
  before storage close. The single-flight observer handles both settlement
  paths so it does not introduce an unhandled rejected observer promise.

## 2026-08-20 — public subscription admission RED/GREEN checkpoint

- Added and observed a RED test for a Subscription Gateway constructed with
  `publicAccess` and no `sessions`; it failed at the previous unconditional
  session resolver call.
- Public mode is now explicitly exclusive with sessions, resolves a frozen
  framework-owned principal, and has no binding or activation expiry. The
  authenticated mode retains its exact timestamp and timer behavior.
- This is only the auth subscription layer. Unary Gateway, Browser Server,
  durable public orphan cleanup, Proto, and Message Board composition remain.

## 2026-08-20 — unary public admission checkpoint

- Added and observed a RED `ResolveContext` public-mode test, which failed at
  the unconditional session resolver access.
- Unary Gateway now accepts an absent transport credential in public mode,
  uses the frozen framework principal, and omits `expiresAt` from its public
  response. Authenticated session resolution remains source-compatible.

## 2026-08-20 — browser and Message Board composition checkpoint

- Browser request extraction now represents a missing Authorization header as
  actual credential absence and passes `publicAccess` through to both Gateway
  layers. Its standalone validation requires exactly public access or sessions.
- Deleted Message Board's `PublicBoardAdmission`; both entrypoints now select
  `publicAccess` and use a wall-clock adapter instead of an invented expiry.
- Server and Message Board package typechecks passed. Durable public orphan
  cleanup remains required before standalone public mode is complete.
