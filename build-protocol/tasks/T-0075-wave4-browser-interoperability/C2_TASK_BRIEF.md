# C2: ES256 Signed Application Sessions

Status: Frozen for implementation

## Boundary

C2 adds one Node-only `SignedSessions` strategy to
`@spine-event-engine/auth`. It issues and locally verifies self-contained
bearer application sessions and implements the existing `SessionResolver`.

C2 does not add OIDC/provider transactions, browser storage or reconnect
integration, framework adapters, remote key discovery, a persistent
revocation store, request authorization, or any Spine JVM action.

## Public contract

- `BearerCredential` narrows `RequestCredential` to `kind: "bearer"`.
- `SignedSessionSigningKey` supplies a bounded `kid` and a P-256 private
  `KeyObject`. The strategy derives and owns its verification key.
- `SignedSessionVerificationKey` supplies a bounded `kid` and P-256 public
  `KeyObject` for an initially retired key.
- `SignedSessionClock` returns Unix epoch milliseconds and fails closed on
  throws, unsafe integers, or values outside the Protobuf Timestamp range.
- `SignedSessionRandom` receives exactly 16 and returns exactly 16 bytes for
  `jti`; returned mutable buffers are zeroed.
- `SignedTokenRevocation` has `kind: "supported"` and two bounded async
  operations: `isRevoked(jti)` and `revoke(jti, expiresAt)`. Applications own
  persistence, cleanup, and availability.
- `SignedSessionsOptions` requires `issuer`, `audience`, and `activeKey`.
  It may supply initially retired verification keys, revocation, clock/random
  callbacks, and the finite options below.
- `SignedSessionIssueResult` is either `issued` with a `BearerCredential` and
  defensive `ResolvedSession`, or `rejected` with one of `closed`,
  `clock-failure`, `entropy-failure`, `principal-invalid`, or
  `signing-failure`.
- `SignedSessionRotationResult` is `rotated` or a deterministic rejection:
  `closed`, `clock-failure`, `invalid-key`, `duplicate-key`, or
  `key-capacity-exceeded`.
- `SignedSessionLogoutResult` is `revoked`, `expiryOnly`, or `unavailable`.
  It does not disclose whether malformed, unknown-key, invalid-signature,
  expired, or already-revoked input was presented.
- `SignedSessions` exposes `issue(principal)`, `resolve(credential)`,
  `rotate(nextKey)`, `logout(credential)`, and terminal idempotent `close()`.

## Token contract

- Compact JWS/JWT only: exactly three non-empty unpadded base64url segments.
- Header is framework-issued `{ alg: "ES256", typ: "JWT", kid }`.
- Payload has mandatory `iss`, `aud`, `sub`, `iat`, `nbf`, `exp`, and `jti`;
  optional copied principal attributes use one framework-owned claim.
- `alg` is configured by the implementation, never selected by the token.
  Reject `none`, every non-ES256 algorithm, symmetric fallbacks, embedded keys,
  and token-directed key URLs.
- Sign and verify SHA-256 ECDSA with the 64-byte IEEE-P1363 signature form and
  P-256 keys only.
- `iss` and `aud` match the configured canonical strings exactly. Audience is
  one string in C2, not an array.
- Numeric time claims are integer seconds. Issuance sets `iat` and `nbf` to the
  current second and `exp = iat + ttlSeconds`.
- Verification accepts future `iat`/`nbf` and past `exp` only within configured
  clock skew. It requires `exp > nbf`, `nbf >= iat`, and a lifetime no longer
  than `ttlSeconds`.
- Subject and every attribute are defensively copied into a frozen principal.
  No Actor, tenant, provider token, refresh token, or authorization decision is
  encoded.

## Finite defaults and validation

- `ttlSeconds`: 28,800 (eight hours), positive safe integer.
- `clockSkewSeconds`: 60, non-negative safe integer.
- `maxTokenCharacters`: 8,192, positive safe integer.
- `maxKeys`: 16, positive safe integer.
- `maxPrincipalIdCharacters`: 256, positive safe integer.
- `maxAttributes`: 32, non-negative safe integer.
- `maxAttributeCharacters`: 4,096 total name/value characters, non-negative
  safe integer.
- Issuer, audience, and key IDs are non-empty with at most 256 characters.
- Token parsing checks total size and segment/base64/decoded JSON bounds before
  signature verification. Parsed values must be plain JSON values of the exact
  expected kinds; unexpected security-relevant header/claim shapes reject.

## Key lifecycle

- Construction validates and copies key material into owned Node `KeyObject`s.
  Duplicate `kid` values reject.
- One active signing key and a bounded verification ring exist. `rotate()`
  atomically installs the next active key and retains the prior active public
  key through `ttlSeconds + clockSkewSeconds` after rotation.
- Expired retired keys are swept from the bounded ring on issue, resolve, and
  rotate. A rotation that still exceeds `maxKeys` rejects without changing the
  active key.
- Verification selects only a locally configured exact `kid`; unknown keys
  fail closed. Tokens never select a URL, algorithm, or key material.
- `close()` terminally clears key-ring/revocation references. Node `KeyObject`
  internals cannot be explicitly zeroed; documentation must state that
  limitation. Caller-owned keys remain caller-owned.

## Revocation and lifecycle semantics

- Without a revocation capability, valid logout returns `expiryOnly`; the
  bearer remains usable until expiry or key retirement.
- With revocation, valid logout stores `jti` through expiry and returns
  `revoked`; store failure returns `unavailable`. Invalid/unsupported input is
  acknowledged without a token-validity oracle.
- Verification with revocation fails closed when `isRevoked()` throws or
  reports true.
- Re-check terminal state after injected clock, randomness, and revocation
  callbacks. Close wins over an in-flight result. No callback may reintroduce
  key or session state after close.
- Request authorization remains separate and still executes for every gateway
  request after session resolution.

## Behavior-first implementation order

1. RED/GREEN strict construction, P-256 key validation, exact ES256 compact
   issuance, mandatory claims, bearer result type, defensive principal copies,
   entropy zeroing, and terminal close.
2. RED/GREEN finite parsing and fail-closed resolution across malformed
   segments/JSON, size bounds, algorithm/header confusion, unknown `kid`,
   invalid signature, issuer/audience/time/lifetime/subject/attribute failures,
   and valid exact-boundary skew.
3. RED/GREEN atomic rotation, retained-key deadline, capacity rejection,
   duplicate/invalid keys, expiry sweeping, and rotation/close or callback
   reentrancy.
4. RED/GREEN optional revocation, `expiryOnly` versus `revoked`/`unavailable`,
   revoked-token rejection, store failure, logout/resolve/close races, and
   enumeration-safe invalid logout.
5. Export inventory, complete TSDoc, README decision table/limitations, focused
   verification, one complete relevant review wave, corrections, and the full
   coverage gate.

## Review

- TypeScript/API: public result narrowing, Node type exposure, exact claims,
  export inventory, and `SessionResolver` compatibility.
- Performance/reliability: finite parsing/key ring, callback races, retention,
  fail-closed errors, and atomic rotation/revocation.
- Documentation: availability, options/defaults, bearer use, key rotation,
  revocation trade-off, extension seam, and limitations.
- Style/maintainability: module depth and avoidance of speculative JOSE/OIDC
  abstractions.
- Dedicated security remains the mandatory final Wave 4 release gate; C2
  security-sensitive observations are retained for that complete-system review.
