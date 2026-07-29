# C3: Generic OIDC Code Flow

Status: Frozen for implementation

## Boundary

C3 adds a framework-neutral Node `OidcFlow` to `@spine-event-engine/auth`.
It owns authorization-code transaction security, identity mapping, and a
short-lived one-time application-session exchange. It does not implement an
HTTP server, browser client, discovery/JWKS/provider networking, Google/GitHub
specialization, or Spine JVM behavior.

Provider code exchange and ID-token verification sit behind an explicit
verified-identity seam. C4 supplies Google, GitHub, and custom adapters. C5
integrates browser credentials/reconnect.

## Standards invariants

- Authorization code flow only; no implicit, password, device, or refresh flow.
- One exact preconfigured HTTPS callback URI and exact HTTPS authorization
  endpoint; no runtime callback override, wildcard, user-info, or fragment.
- Transaction-specific 32-byte random state, nonce, and provider PKCE verifier.
  PKCE is S256 only; the verifier is 43-character unpadded base64url.
- State is atomically consumed before provider exchange, including provider
  error callbacks. A callback is never retryable.
- Provider verification must bind exact issuer, client ID/audience, nonce,
  redirect URI, code, and provider PKCE verifier. Its return type exposes only
  verified external identity, never access/refresh/ID tokens.
- A distinct one-time grant is bound to a browser-supplied S256 challenge. The
  browser POSTs the grant and verifier to the application-session exchange.
  The grant is consumed before verification/issuance and never reused.
- No application bearer token appears in an authorization or redirect URL.
  HTTP adapters apply `Cache-Control: no-store` to callback/exchange responses.

## Public contracts

- `ExternalIdentity`: exact non-empty `issuer` and `subject`, plus optional
  bounded frozen string claims. It never contains provider tokens.
- `ResolvedApplicationIdentity`: frozen `externalIdentity` and
  `AuthenticatedPrincipal`. Actor/tenant remain per-request `ContextResolver`
  responsibilities.
- `IdentityMapping.resolve(identity)`: application-owned provisioning/disabled
  user mapping, returning a resolved identity or `undefined`.
- `OidcVerifiedIdentityProvider`: exact `issuer` and
  `exchangeAuthorizationCode(input)`. The input contains the code, client ID,
  exact callback URI, provider verifier, expected nonce, and `AbortSignal`.
  The provider returns a verified `ExternalIdentity` or `undefined`.
- `ApplicationSessionIssuer.issue(principal)`: application-selected adapter to
  `OpaqueSessions.create()` or `SignedSessions.issue()`, returning an
  application `RequestCredential` plus `ResolvedSession`, or `undefined`.
- `OidcFlowOptions`: authorization endpoint, callback URI, client ID, scopes,
  exact allowed post-login redirects, provider, mapping, session issuer, and
  finite clock/random/lifetime/capacity/size/timeout options.
- `OidcFlow.start(input)` accepts a valid browser S256 challenge and one exact
  allowed post-login redirect. It returns `started` with an immutable
  authorization URL and expiry, or a deterministic rejection.
- `OidcFlow.callback(input)` accepts exactly one state plus either one bounded
  code or one provider error and optional response issuer. Success returns a
  one-time grant and the prevalidated post-login redirect; provider tokens and
  application credentials are never returned.
- `OidcFlow.exchange(input)` accepts a one-time grant and browser PKCE verifier.
  Success returns the application credential and session. Failure is
  enumeration-safe and the grant remains consumed.
- Terminal idempotent `close()` aborts in-flight callbacks and clears/zeroes
  owned transaction/grant material.

## Finite defaults

- transaction TTL: 300,000 ms; grant TTL: 60,000 ms.
- transaction/grant capacity: 1,000 each.
- random collision attempts: 3.
- provider/mapping/session operation timeout: 30,000 ms.
- maximum authorization URL: 4,096 characters.
- maximum callback code/error/state/grant/verifier/redirect input: 4,096
  characters before parsing; PKCE verifier itself remains RFC 7636 43–128.
- maximum external claims: 32 and 4,096 total name/value characters.
- scopes are a non-empty unique bounded list which must contain `openid`.
  Framework-owned security parameters cannot be overridden.

Every numeric limit is a safe integer with the natural positive/non-negative
constraint. Clocks use safe Unix epoch milliseconds in Timestamp range.
Random callbacks receive exactly 32 and must return exactly 32 bytes; returned
mutable buffers are zeroed.

## Atomic lifecycle

- `start()` reserves capacity before randomness and commits one transaction
  only after all callback/state/URL rechecks succeed.
- `callback()` detaches and consumes the transaction synchronously before any
  provider callback. Expired, unknown, replayed, wrong-issuer, error, or
  malformed callbacks produce no provider/mapping/session call.
- Verified identity is exact-issuer checked and bounded before mapping.
  Mapping failure creates no grant. Provider/mapping failure cannot restore the
  transaction.
- A successful callback stores only copied resolved identity, browser
  challenge, redirect, and expiry. Provider verifier bytes are zeroed after
  exchange; provider tokens cannot enter the store.
- `exchange()` detaches the grant before checking the verifier. Wrong,
  malformed, expired, replayed, mapping/session failure, or close cannot
  restore it.
- Each external callback is abortable and deadline-bounded. Close wins every
  callback race and retains no transaction/grant/callback reference.

## Behavior-first slices

1. RED/GREEN finite construction, start URL, exact redirect/scopes, random
   state/nonce/provider verifier, S256 challenge, capacity/collision/expiry,
   defensive copies, and terminal close.
2. RED/GREEN atomic callback consumption, error/mix-up/replay rejection,
   provider deadline/abort, verified identity bounds/redaction, identity
   mapping, and grant creation.
3. RED/GREEN browser PKCE grant exchange, burn-before-check replay safety,
   opaque/signed issuer adapters, session failures, expiry/capacity, close
   races, zeroing, and no-store/POST integration facts.
4. Public exports/TSDoc, README flow/extension/limitations, focused mechanics,
   one complete relevant review wave, corrections, and canonical full coverage.

## Review

- Style: one cohesive transaction module without HTTP/provider overengineering.
- API: provider/mapping/session seams, exact results, exports, TSDoc.
- Reliability: finite stores/parsing, atomic replay prevention, deadlines,
  abort/close races, zeroing, and retention.
- Documentation: standards flow, adapter responsibilities, no-store/POST,
  limitations, configuration, and extension examples.
- Dedicated security remains the final complete Wave 4 release gate.
