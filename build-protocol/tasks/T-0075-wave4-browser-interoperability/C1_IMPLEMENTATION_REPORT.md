# C1 Implementation Report — Opaque sessions and cookie security

Status: Ready for review

## Scope delivered

- Added `OpaqueSessions`, the bounded in-memory implementation of the existing
  `SessionResolver` seam. It uses 32 random bytes encoded as unpadded base64url,
  retains sessions for eight hours by default, limits retention to 10,000,
  lazily removes expiry, and has no timer or persistence dependency.
- Creation, resolution, rotation, and logout use synchronous map transitions
  inside their method calls. Rotation obtains a non-colliding replacement before
  deleting and inserting, so a failed entropy attempt leaves the old session
  usable. Logout is idempotent and does not disclose record existence.
- Session principal data and attributes are copied/frozen on admission and
  copied again on resolution. Temporary generated ID byte arrays are zeroed;
  terminal close clears all owned session references.
- Added `OpaqueSessionCookies`, a framework-neutral strict extractor and cookie
  serializer. It validates copied HMAC secrets, canonical allowlisted Origins,
  distinct `__Host-` names, bearer precedence, cookie/header duplicates,
  base64url syntax, fixed-length HMAC-SHA-256 CSRF values, and terminal close.
  It zeroes its owned mutable CSRF secret at close.
- Exported the C1 contract from the auth root, froze its API inventory, and
  documented its scope and limits in the auth package README.

## TDD evidence

- RED: `packages/auth/test/sessions/opaque.test.ts` initially ran six tests and
  all failed because neither C1 constructor nor export existed.
- GREEN: the minimal implementation made those six tests pass, including
  opaque credential shape, copied identity, expiry/capacity/collision/close,
  rotation replay safety, host-cookie strings, bearer precedence, and CSRF.
- RED: the next behavior slice failed because an empty credential input was
  reported as `malformed-cookie` instead of the frozen `missing-credential`.
- GREEN: parsing now distinguishes absent credentials while retaining strict
  malformed-cookie treatment. The completed focused suite has eight tests and
  also proves generated-byte zeroing, expired/unsupported rotation,
  invalid-session encoding, duplicate Origin, CSRF mismatch, and close.
- Pre-review RED: 12 focused tests exposed mutable issuance/clear arrays,
  acceptance of wrong-length session IDs by CSRF derivation and issuance, and
  terminal methods deriving from a zeroed secret.
- GREEN: cookie helper public ID operations now require exactly 43 unpadded
  base64url characters, issuance and clearing arrays are frozen, and all
  terminal helper methods fail deterministically. The same suite now covers
  configuration/default validation, wrong-length randomness, collision-safe
  rotation preservation, post-close outcomes, copied-secret mutation,
  canonical Origins/custom names, duplicate/malformed browser facts, and
  terminal behavior.

## Mechanical evidence

- Historical initial checkpoint: `node_modules/.bin/vitest run packages/auth/test
--passWithNoTests` passed 6 files / 109 tests. Current C1 auth evidence is
  6 files / 116 tests; this historical checkpoint is retained only to preserve
  chronology.
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p
packages/auth/tsconfig.json` — passed.
- `pnpm --config.verify-deps-before-run=false docs:check:generated` — passed;
  TypeDoc/API inventory accepts 65 auth exports.
- Repository-wide Prettier and targeted ESLint over C1-owned source/test/API
  files passed. Canonical cleanup enforcement currently reports unrelated
  baseline findings in earlier subscription/native/client files; the explicit
  120-column scan of every C1-owned file passed.
- `git diff --check` — passed.
- The canonical cleanup baseline limitation did not identify a C1 violation.

## Complete-review correction evidence

- RED: forced C1 regressions exposed clock failure escaping the result contract,
  re-entrant randomness admitting beyond capacity, and unbounded parser input.
- GREEN: clock failure clears the terminal store, entropy failure is bounded,
  create/rotate re-check state after randomness, pre-epoch nanos are normalized,
  and cookie parsing bounds header values, characters, and cookie pairs while
  accepting unrelated cookie values containing `=`. API inventory is 65 exports.

## Lifecycle completion evidence — 2026-07-28

- Test-first completion added forced `create`/`close` and `rotate`/`close`
  random-callback regressions. Both return the exact terminal `closed` result;
  later creation rejects and old credentials cannot resolve, proving terminal
  retention is not revived.
- It also calls the first operation without awaiting its returned Promise in
  each required order: rotate/rotate, logout/rotate, resolve/rotate, and
  resolve/logout. Exact results prove synchronous call-order linearization:
  the first rotation wins and only its new credential stays live; logout then
  rotate rejects `not-found`; resolution captures its live defensive view
  before a subsequent rotation or logout; stale credentials are unavailable
  after the later transition.
- These tests passed immediately against the existing re-entrancy guards, so
  no production correction was warranted. Their earlier focused validation
  passed 17 tests; the then-current full auth suite passed 6 files / 114 tests.

## Final C1 targeted correction evidence — 2026-07-28

- RED: a bounded request with an `undefined` own header field then an accessor
  field failed by inspecting the accessor after the first field exhausted the
  finite header bound.
- GREEN: own header fields now enumerate incrementally without `Object.keys()`;
  each field is counted and charged before its value is read, including
  `undefined`, and array entries consume the same existing value bound.
- The focused suite proves a retained 31-byte random buffer is zeroed after
  bounded entropy rejection. It also advances the injected clock from random
  callbacks to prove post-callback create capacity/expiry cleanup: at a
  one-session limit, nested creation expires before outer admission, the nested
  credential is stale, and only the outer session remains live. The same test
  proves rotation expiry rejection/removal.
- Public option/callback TSDoc and the package README state the copied secret
  lifecycle, exact Origins, `__Host-` name rules/defaults, clock units and
  fail-closed behavior, exact random callback contract/zeroing, bounded entropy
  mapping, option defaults, and the three-attempt collision bound.
- Validation passed: focused opaque sessions (1 file / 19 tests), full auth
  (6 files / 116 tests), auth `tsc --noEmit`, and generated TypeDoc/API
  checking, and `git diff --check`. Targeted Prettier and the explicit
  C1-owned 120-column scan pass; canonical cleanup retains the unrelated
  baseline findings recorded above.

## Assignment metadata

- Existing role: `implementer`.
- Explicit assignment profile: `gpt-5.6-terra` with `medium` reasoning.
- The execution surface does not expose independent runtime model
  self-introspection. The explicit dispatch and immutable configured profile are
  the available evidence; no visible mismatch or inherited-profile fallback was
  observed.

## Boundaries and limitations

- C1 intentionally adds neither signed sessions, OIDC/provider transactions,
  browser reconnect integration, an HTTP framework adapter, remote/persistent
  storage, background cleanup, nor a Spine JVM action.
- JavaScript strings cannot be zeroed. C1 zeroes owned mutable byte arrays and
  removes retained record/secret references at terminal close.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability review concerns are closed. Security remains the
  final Wave 4 release gate.

## Final gate

- Canonical `test:coverage:generated` passed 147 runnable test files and 2,750
  tests, with 3 files and 25 tests skipped.
- Coverage passed at 94.07% statements, 90.04% branches (8,977/9,970), 94.31%
  functions, and 94.85% lines.
- No Spine JVM project command ran.
