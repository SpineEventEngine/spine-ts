# C1 — Opaque sessions and cookie security

## Classification

High-risk. C1 introduces public session and credential contracts, secret
material, session fixation/rotation behavior, browser cookie parsing, CSRF and
Origin enforcement, expiry, capacity, logout, and retention semantics.

## Frozen product decisions

- Implement opaque in-memory application sessions in
  `@spine-event-engine/auth`.
- The gateway, not a Spine TS or JVM application, owns authentication,
  application sessions, Actor/tenant resolution, and credential verification.
- Session cookies use a `__Host-` name, `Secure`, `HttpOnly`, `Path=/`,
  `SameSite=Lax`, and no `Domain`.
- Cookie-authenticated API requests require an exactly allowlisted `Origin` and
  `X-Spine-CSRF`.
- The CSRF value is HMAC-derived from the opaque session ID and is
  constant-time checked against a `__Host-` CSRF cookie.
- Opaque logout deletes the server-side session. Rotation, expiry, and logout
  must not leave reusable stale credentials.
- Provider/OIDC transactions belong to C3, ES256 signed sessions to C2, and
  browser reconnect integration to C5.
- Node runtime only. Do not build or execute Spine JVM.

## Required architecture answer

Define the smallest idiomatic TypeScript contract and ordered TDD slices for:

1. public opaque-session configuration, returned credentials, verified session
   view, rotation/logout results, clock/randomness/secret injection, and error
   taxonomy;
2. an in-memory bounded session store with atomic create/verify/rotate/delete,
   finite capacity, expiry cleanup, copied secret/identity data, and terminal
   close/zero-retention behavior;
3. session-ID entropy/encoding and HMAC-SHA-256 CSRF derivation without leaking
   IDs or secret material;
4. strict cookie/header extraction and serialization for the frozen
   `__Host-` attributes, exact Origin allowlisting, bearer-versus-cookie
   precedence, and constant-time CSRF comparison;
5. fixation, replay, rotation races, concurrent verify/logout, expiry boundary,
   capacity, malformed/duplicate cookie/header, Origin/CSRF, mutation,
   redaction, and cleanup tests;
6. the exact boundary with existing B1 `SessionAuthenticator`,
   `RequestCredential`, gateway transport facts, and future C2/C3/C5 seams.

Do not invent a generic web framework, persistence API, remote session store,
browser UI, OIDC behavior, signed tokens, Redis/Hazelcast, or deployment
topology.

## Verification and review

- Behavior-first focused tests, auth typecheck, generated API inventory,
  formatting, cleanup rules, and diff hygiene precede specialist review.
- Style, TypeScript/API docs, performance/reliability, documentation, and
  security concerns apply. Security observations are retained for the final
  Wave 4 security gate unless the protocol requires an earlier architecture
  correction.
- Full repository coverage runs only after review-converged C1 behavior.

## Frozen implementation contract

### Module shape and defaults

- Add `src/sessions/opaque.ts` with one `OpaqueSessions` class implementing the
  existing `SessionResolver`; do not rename that B1 seam.
- Add `src/sessions/cookies.ts` with one `OpaqueSessionCookies` helper. It owns
  only strict header/cookie extraction, exact Origin/CSRF checks, and frozen
  Set-Cookie serialization; it is not an HTTP-framework adapter.
- Defaults are 32 random session-ID bytes encoded as 43-character unpadded
  base64url, an 8-hour TTL, 10,000 retained sessions, and three ID-collision
  attempts. All finite numeric inputs are positive safe integers.
- The cookie helper requires a copied CSRF HMAC secret of at least 32 bytes,
  one or more exact valid Origin values, distinct valid `__Host-` cookie names,
  and defaults to `__Host-spine-session` and `__Host-spine-csrf`.

### Opaque session results

- `create(principal)` returns either
  `{kind: "created", credential: {kind: "cookie", value}, session}` or
  `{kind: "rejected", reason: "capacity-exceeded" | "entropy-exhausted" |
"closed"}`.
- `rotate(credential)` returns the same created material under `kind:
"rotated"` or rejects with `"not-found" | "expired" |
"unsupported-credential" | "entropy-exhausted" | "closed"`.
- `logout(credential)` is enumeration-safe and idempotent:
  `{kind: "logged-out"}` whether or not a matching session existed.
- `resolve(credential)` returns a defensively copied `ResolvedSession` only for
  a live opaque cookie credential; bearer, malformed, expired, stale, and
  post-close inputs return `undefined`.
- `close()` is terminal and idempotent. It removes every owned record and
  reference. JavaScript strings cannot be zeroed; temporary random byte arrays
  are zeroed after encoding, and copied mutable secret bytes are zeroed by
  their owning helper on close.

### Atomic transitions

- All map mutation is synchronous and linearized within the method call; no
  global promise queue or background expiry timer is introduced.
- Every operation lazily removes the addressed expired record; `create`
  additionally sweeps expired entries before its capacity check.
- Rotation generates a non-colliding replacement before one atomic
  old-delete/new-insert transition. Failure leaves the old session unchanged.
- In rotate/rotate, rotate/logout, resolve/rotate, and resolve/logout races,
  call linearization order wins. An old credential is unusable immediately
  after rotation. A logout that linearizes after rotation against the old
  credential does not delete the new credential.
- The principal and attribute map are copied/frozen on admission and copied
  again on resolution; caller mutation never changes retained identity.

### Cookie and CSRF rules

- Header inputs permit a string or string array so duplicates are observable.
  A present Authorization header has precedence. It must contain exactly one
  case-insensitive `Bearer` scheme plus one non-empty visible-ASCII token;
  malformed or duplicate Authorization rejects without cookie fallback.
- Cookie authentication requires exactly one session cookie and exactly one
  CSRF cookie. Duplicate target cookies, malformed cookie pairs, control
  characters, commas, invalid base64url lengths, or duplicate relevant headers
  reject deterministically.
- Cookie requests require exactly one syntactically canonical Origin which
  byte-for-byte equals a configured allowlist entry. `null`, paths, credentials,
  query, fragments, trailing slash variants, and missing/duplicate Origin
  reject.
- `X-Spine-CSRF`, the CSRF cookie, and the expected unpadded base64url
  HMAC-SHA-256 of the session ID are fixed-length checked with
  `timingSafeEqual`; malformed lengths reject before comparison.
- A successful extraction returns only `RequestCredential`. Rejection reasons
  are `"missing-credential" | "duplicate-authorization" |
"malformed-authorization" | "malformed-cookie" | "ambiguous-cookie" |
"missing-origin" | "duplicate-origin" | "forbidden-origin" |
"missing-csrf" | "duplicate-csrf" | "csrf-mismatch" | "closed"`.
- Issuance serializes:
  `__Host-spine-session=<id>; Path=/; Secure; HttpOnly; SameSite=Lax` and
  `__Host-spine-csrf=<hmac>; Path=/; Secure; SameSite=Lax`, with no Domain.
  Clearing emits the same attributes plus `Max-Age=0`. The CSRF cookie is not
  HttpOnly because browser code must echo it in `X-Spine-CSRF`.

### Boundaries and TDD order

1. Session construction/config validation, ID shape, create/resolve defensive
   copies, expiry, capacity, entropy collision, and terminal close.
2. Atomic rotate/logout and forced race/linearization tests, including replay
   of the old credential.
3. Cookie-name/origin/secret validation, frozen issuance/clearing strings, and
   bearer precedence.
4. Strict duplicate/malformed cookie/header matrix and Origin/CSRF
   constant-time behavior.
5. Root exports, README/TSDoc, API inventory, redaction/mutation/cleanup
   evidence, and existing B1 gateway integration through `SessionResolver`.

C2 may add a different `SessionResolver`; C3 may consume issuance primitives
after its OIDC exchange; C5 owns browser transport/reconnect wiring. C1 adds no
signed token, OIDC transaction, provider, or web-framework API.
