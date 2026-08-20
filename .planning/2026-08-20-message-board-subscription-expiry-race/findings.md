# Findings & Decisions

## Requirements
- Remove every arbitrary hard-coded lifetime introduced for public Message Board admission.
- Do not replace five minutes with a larger magic duration or an infinity sentinel.
- Preserve legitimate explicit Cancel behavior for unmount, page close, replacement, and shutdown.
- Concurrent expiry/cancellation must be bounded, idempotent, and must not return HTTP 500.
- Preserve real authenticated-session expiry behavior for applications that use it.
- Finish with a detailed file-by-file, behavior-by-behavior report and fresh evidence.

## Research Findings
- `PublicBoardAdmission` manufactures a `ResolvedSession` expiring in five minutes for every request.
- The Gateway binds each subscription to that expiry and aborts activation at the deadline.
- The browser treats the natural stream end as retryable, Cancels the old wire, then performs
  Subscribe -> authoritative Read -> Activate.
- Two tabs therefore produce two synchronized recovery sequences every five minutes.
- Every subscription request calls `bindings.purgeExpired()` before request-specific error mapping.
- Each retained definition also schedules an independent expiry-timer purge.
- Durable per-ID coordination permits one running and one queued operation; a third throws
  `binding-busy`.
- Deterministic direct reproduction returned `{"thirdOutcome":"binding-busy"}` for three
  overlapping purges of one expired durable definition.
- Because the purge throws before `#cancel()` maps `binding-busy`, Connect returns a generic
  Internal response (the screenshot's 46-byte HTTP 500 body).
- The live Datastore, Gateway, Coordinator, Delivery, and both replicas remained healthy; no
  Datastore error or backend crash accompanied the 500.
- Authentication is currently baked into both Gateway option types: `UnaryGatewayOptions` and
  `SubscriptionGatewayOptions` require a `SessionResolver`, and `BrowserServerOptions` forwards
  the same resolver to both.
- `ResolvedSession.expiresAt` is required. Making it optional would blur the real authenticated
  session contract and is therefore not an acceptable shortcut for public access.
- Durable subscription records currently require `when_expires` in Protobuf and index it for
  expiry cleanup. Connection-scoped public definitions therefore need an explicit lifecycle
  design; omitting the timestamp from the existing authenticated record is not a local change.
- Browser startup rehydrates every unexpired durable definition before listening and reschedules
  its expiry. Any public-mode design must say what happens to a definition left behind by Gateway
  process loss rather than silently retaining it forever.
- Browser transport currently represents a missing Authorization header as an empty bearer
  credential. `PublicBoardAdmission` ignores that sentinel; this is another sign that public access
  is being forced through the authenticated-session path.
- `Authenticator` exists as a public principal-only boundary but is not used by either Gateway.
  It may be reusable for non-expiring admission, but subscription persistence still needs an
  explicit authenticated-versus-connection-scoped retention decision.
- The durable Protobuf is named `GatewayAuthenticatedSubscription`. Reusing it for public
  connection-scoped state would make both the serialized name and required expiry field false.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Model public access separately from resolved authenticated sessions | The public demo has no browser credential or session and should not fabricate one. |
| Fix purge coordination at the durable binding owner | Request-level error mapping alone would hide the race while duplicate cleanup remained. |
| Do not make `ResolvedSession.expiresAt` optional | A public request is not an authenticated session; weakening that type would conceal the distinction. |
| Prefer an explicit `publicAccess` Gateway mode over a generalized resolver | It keeps the trust choice visible and prevents applications from rebuilding the same fake-session shape behind a new interface. |
| Keep public definitions out of `GatewayAuthenticatedSubscription` | The record name and required expiry describe authenticated sessions; changing it would require a new serialized domain contract and migration. |
| Do not add a pending-public activation TTL | The human explicitly rejected invented hard-coded lifetimes; resource ownership must be event/process based or an existing configurable capacity, not another timer. |

## Architecture check

- The read-only requirements splitter ran with explicit `gpt-5.6-sol` / `high`.
  Runtime telemetry was unavailable; the immutable configured role/profile is the evidence.
- It recommended mutually exclusive `sessions` and `publicAccess` Gateway modes, optional
  credentials at the transport-neutral boundary, omission of `ResolveContext.expiresAt` for
  public access, and in-memory rather than authenticated-durable public bindings.
- It recommended a store-wide single-flight durable purge owner while retaining the existing
  bounded external per-ID queue.
- Its proposed new 30-second pending-public deadline is rejected pending follow-up because it
  would recreate the exact category of arbitrary lifetime the human prohibited.
- One follow-up remains: prove what happens to native child definitions on abrupt Gateway process
  loss before accepting process-scoped public binding ownership.

## Subscription timing audit

- **Invalid active lifetime:** the Message Board's five-minute fake session. It terminates a
  healthy active subscription and is being removed.
- **Valid authenticated lifetime:** `ResolvedSession.expiresAt`, opaque-session TTL, and signed
  token TTL. These are application authentication semantics and remain configurable/unchanged.
- **Finite operation bound:** Gateway `operationTimeoutMs` limits Subscribe setup and Cancel
  cleanup, but acknowledged Activate callbacks explicitly bypass it. This does not limit stream
  lifetime.
- **Finite shutdown bound:** Gateway, durable bindings, and browser-client cleanup use bounded
  waits so non-cooperative resources cannot hang shutdown. These do not terminate healthy streams.
- **Finite retry episode:** browser `SubscriptionRetryPolicy` defaults to five attempts / 30 seconds
  and is configurable. It limits reconnection work after failure, not a connected stream.
- **Native activation handshake:** Stand retains an unactivated definition for 30 seconds and
  reconciles cleanup every 10 seconds. This is an existing resource-safety contract for the gap
  between Subscribe and Activate, not an active lifetime; it is not reused as public Gateway
  ownership in this correction.
- **Public active lifetime after correction:** no timer. Ownership ends only on explicit Cancel,
  Activate transport termination, graceful Gateway close, or startup orphan cleanup after a prior
  process loss.

## Process-loss correction

- Active child `SpineServices` definitions are deleted in the Activate iterator `finally` path when
  their transport terminates.
- Coordinator logical definitions and Subscribe-before-Activate rows can survive an abrupt Gateway
  loss, so a merely in-memory public binding is insufficient.
- A separate durable public cleanup ledger is required. It has no expiry and is never rehydrated;
  startup cancels any retained orphan before listener admission, then deletes its row.

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Existing `BrowserServerOptions` requires `sessions` and expiring `ResolvedSession` | Public-contract design remains under discovery; no production code changed yet. |

## Resources
- `examples/message-board/app/src/public-board-admission.ts`
- `packages/auth/src/subscriptions/index.ts`
- `packages/server/src/server/durable-subscription-bindings.ts`
- `packages/client-web/src/client/client.ts`
- User screenshots captured on 2026-08-20 from the live two-tab application.
