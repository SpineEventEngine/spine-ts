# C3 implementation report

## Slice 1: finite OIDC construction and authorization start

### Scope

Implemented only the behavior-first first slice from `C3_TASK_BRIEF.md`:
finite construction and `OidcFlow.start()` authorization-code transaction
creation. Callback consumption, provider exchange, identity mapping,
application-session grants, HTTP integration, exports, README, and provider
adapters remain out of scope for this slice.

### RED evidence

`pnpm --config.verify-deps-before-run=false exec vitest run
packages/auth/test/oidc/index.test.ts` initially failed because
`packages/auth/src/oidc/index.ts` did not exist. The test runner reported
`Cannot find module '../../src/oidc/index.js'`; no test was collected.

### GREEN behavior

- `OidcFlow` validates a finite HTTPS authorization endpoint and callback URI,
  non-empty client ID, unique `openid` scopes, exact HTTPS allowed redirects,
  finite positive limits, and the provider/mapping/session seams.
- `start()` accepts only a 43-character base64url browser S256 challenge and an
  exact configured redirect. It forms an authorization-code URL with fixed
  `response_type=code`, configured client/callback/scopes, random state and
  nonce, and a separately random provider PKCE verifier whose S256 challenge
  is sent to the provider.
- It retains the browser challenge only for the later distinct application
  grant, never serializing it into the provider authorization URL.
- Stores are bounded and sweep expired transactions before capacity decisions;
  state collisions retry within the finite attempt limit. Random material is
  requested in exact 32-byte chunks and zeroed after conversion.
- Clock failures fail closed, and idempotent terminal `close()` clears all
  currently retained transaction material.

### Focused evidence

- RED: missing module error above.
- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/auth/test/oidc/index.test.ts` — 1 file, 5 tests passed.
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p
packages/auth/tsconfig.json` — passed.
- `pnpm --config.verify-deps-before-run=false exec prettier --check
packages/auth/src/oidc/index.ts packages/auth/test/oidc/index.test.ts` —
  passed.

### Changed files

- `packages/auth/src/oidc/index.ts`
- `packages/auth/test/oidc/index.test.ts`
- this report

### Uncertainty and follow-up

The internal transaction structure deliberately retains state, nonce, provider
verifier, browser challenge, redirect, and expiry only until Slice 2 consumes
it atomically. It is not exported yet. Slice 2 must detach state before any
provider call, enforce callback/error/mix-up behavior and deadlines, then
create the separate one-time application grant. No Spine JVM command was run.

## Slice 2: atomic callback consumption and grant creation

### RED evidence

After callback tests were added,
`pnpm --config.verify-deps-before-run=false exec vitest run
packages/auth/test/oidc/index.test.ts` failed with `TypeError:
oidc.callback is not a function`. Four callback behavior tests failed while
the five completed Slice 1 tests continued to pass.

### GREEN behavior

- `callback()` finds and synchronously detaches a bounded transaction before
  checking any callback payload or calling a provider. Provider error,
  malformed, expired, mix-up, and replay cases never restore it and never call
  mapping or session issuance.
- The provider/mapping seams execute with a dedicated abort controller and the
  configured finite deadline. Terminal `close()` aborts in-flight callbacks and
  wins the result race.
- Verified external identities must match the exact configured issuer and have
  a bounded subject plus at most 32 bounded string claims totaling at most
  4,096 characters. The mapping receives an immutable defensive copy; no
  provider token contract exists.
- Mapping must preserve the verified external identity and provide a bounded
  principal. Success creates only a finite, collision-resistant, one-time grant
  record containing defensive identity data, browser challenge, validated
  redirect, and expiry. It returns no provider or application credential.
- Provider PKCE verifier bytes are retained only until provider exchange and
  zeroed after conversion; expired/closed records are zeroed before removal.

### Focused evidence

- RED: missing `callback()` failure above.
- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/auth/test/oidc/index.test.ts` — 1 file, 9 tests passed (run twice
  after formatting).
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p
packages/auth/tsconfig.json` — passed (run twice after formatting).
- All C3 source/test/brief/report and task review/work-log files pass the
  changed-file Prettier check.

### Slice 2 follow-up

Slice 3 must consume the grant before browser-verifier validation and use the
already-validated session issuer seam. HTTP no-store/POST facts, public exports
and documentation remain outside this implementation slice. No Spine JVM
command was run.

## Slice 3: browser PKCE grant exchange and session issuance

### RED evidence

The added exchange suite initially failed with `TypeError: oidc.exchange is
not a function`. The three new exchange tests failed while all nine prior start
and callback tests continued to pass.

### GREEN behavior

- `exchange()` accepts only a bounded one-time grant and an RFC 7636
  43–128-character verifier. It detaches the grant synchronously before
  validating the verifier, expiry, proof, or session issuer outcome; every
  exchange failure has the same enumeration-safe `{ kind: "rejected" }`
  result and the grant cannot be restored.
- Browser proof uses an S256 base64url challenge and a constant-time
  equal-length comparison. Temporary comparison buffers are zeroed.
- A successful proof invokes the application-owned `ApplicationSessionIssuer`
  under the same finite abort/deadline discipline as provider and mapping
  calls. Issuer failure, malformed issue data, expiry, replay, or terminal
  close all fail closed without revealing grant state. The close-race test uses
  an issuer promise which never resolves, proving an abort alone is sufficient
  for the OIDC operation to finish rather than waiting for a cooperative issuer.
- Successful credentials and sessions are copied before being returned; session
  expiry is copied through the Protobuf `Timestamp` schema. C3 adds no HTTP
  endpoint, cookie policy, or opaque/signed adapter: applications choose their
  existing session strategy behind the generic seam.

### Focused evidence

- RED: missing `exchange()` failure above.
- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/auth/test/oidc/index.test.ts` — 1 file, 12 tests passed (twice,
  including after formatting).
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p
packages/auth/tsconfig.json` — passed after the implementation and again
  after formatting.
- All C3 source/test/brief/report and task review/work-log files pass the
  changed-file Prettier check.

### Slice 3 completion and next work

The complete runtime C3 flow is now implemented but intentionally not exported
from the package root. Slice 4 owns public exports, TSDoc/API inventory,
README flow/extension/limitation guidance, focused mechanics, and the required
review/verification cycle. No Spine JVM command was run.

## Slice 4: public API, documentation, and maintainability closure

### Cohesive layout and public surface

The prior single OIDC source is split into a shallow pair: `contracts.ts`
holds the provider-neutral public contracts and TypeDoc, while `index.ts` owns
the finite runtime flow and its private validation/retention helpers. The
runtime behavior and focused tests are unchanged by the split. `OidcFlow` and
16 OIDC contract types are now explicit package-root exports, taking the auth
root inventory from 76 to 93 names.

### Documentation

`packages/auth/README.md` now covers the authorization-code sequence, a
compile-valid construction and browser-S256 snippet, exact defaults and
configuration rules, provider/mapping/session extension responsibilities,
required POST and `Cache-Control: no-store` adapter behavior, and explicit
process-local, reconnect, delivery, authorization, refresh, and
identity-provider limitations.

### Verification evidence

- Focused public-root OIDC tests: 1 file, 12 tests passed.
- Full auth suite: 8 files, 145 tests passed on the confirming run. The first
  run had one signed-session tamper assertion fail without any OIDC stack frame;
  the identical full-suite rerun passed 145/145, so it is recorded as an
  unrelated flaky test observation rather than a C3 behavioral regression.
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p
packages/auth/tsconfig.json` passed.
- `pnpm --config.verify-deps-before-run=false docs:check:generated` passed:
  TypeDoc rendered the new `OidcFlow` and contract pages and the repository API
  inventory check completed. The exact auth root inventory is 93 exports.
- Changed OIDC, auth-root, README, C3 brief/report, and task review/work-log
  files pass Prettier.

No HTTP server, provider networking, Google/GitHub/custom adapters, browser
client integration, or Spine JVM command was introduced. C3 is ready for the
required review/verification cycle.

## Review correction batch

- Callback is now an exact code-or-error TypeScript union; runtime validation
  still burns malformed callback state safely.
- Malformed session issuer output, negative Timestamp nanos, and token-like
  identity claim names reject without throwing or retaining credentials.
- Re-entrant close now takes precedence over clock/random failures in start,
  callback, and grant creation. The OIDC inventory is frozen at 93 auth root
  exports in `scripts/check-api-docs.mjs`.
- README documents safe no-store response-body or one-time HttpOnly
  cookie/server-side grant handoff before the required POST exchange, plus the
  exact 4,096 input and 32-claim/4,096-character identity limits.
- Focused OIDC tests passed 14/14; full auth tests passed 147/147; auth
  typecheck and `docs:check:generated` passed. No Spine JVM command ran.

### Remaining review-matrix regression evidence

- Two concurrent starts now assert distinct state, nonce, and provider S256
  challenge values. Mapping and session issuer non-cooperative promises each
  settle through the configured deadline, and the focused suite covers the
  resulting safe rejections.
- Focused OIDC verification passed 17/17; the full auth suite passed 150/150;
  auth typecheck, TypeDoc/API inventory, and changed-file formatting passed.

### Grant lifecycle correction evidence

- With `maxGrants: 1`, a second callback rejects at capacity; advancing exactly
  to expiry lets the next callback sweep and admit a new grant.
- A deterministic random source repeats the live grant ID through all collision
  attempts. The second callback rejects `entropy-exhausted`, creates no extra
  grant, and the original grant still burns on first exchange.
- Focused OIDC verification passed 19/19; auth typecheck and changed-file
  Prettier passed. No runtime correction was needed.

### Re-entrant close matrix

- Table-driven start tests cover clock and random callbacks which close then
  return valid data, invalid data, or throw; every start returns `closed`.
- Callback lookup-clock close is directly covered. Exchange has an
  enumeration-safe terminal rejection rather than a reason discriminator, so a
  distinct `closed` observation is structurally impossible; its existing
  close-race test proves the same terminal result.
- Focused OIDC tests passed 23/23; full auth tests passed 156/156; auth
  typecheck, TypeDoc/API inventory, and changed-file Prettier passed.

### Signed-session canonical ES256 correction

- RED deterministically changed only unused final base64url bits of a 64-byte
  ES256 signature. Node decoded that spelling to the same bytes, so the old
  parser accepted a token that must reject.
- GREEN requires decoded signatures to encode back to the exact supplied
  segment before verification; this narrows canonical encoding only.
- Signed suite passed 18/18; full auth passed 157/157; focused OIDC passed
  23/23; auth typecheck, TypeDoc/API inventory, and formatting passed.

### Final hostile-boundary and uniqueness correction

- Claims now require a plain own-property record; null, arrays, primitives, and
  throwing Proxy records reject as verification failures. Session issue facts
  are read once inside a guarded snapshot before validation/copying, so hostile
  getters and Proxies return the enumeration-safe exchange rejection.
- Active transactions now reject repeated nonce or provider verifier/challenge
  material and retry within the finite entropy budget. The grant collision test
  uses a real S256 browser proof and proves the original grant issues exactly
  once before replay rejection.
- Focused OIDC passed 26/26; signed+OIDC passed 44/44; full auth passed
  160/160; auth typecheck, TypeDoc/API inventory, and formatting passed.

### Final acceptance evidence

- Provider claims are compared exactly with the frozen verified snapshot.
  Dropped or altered claims reject, and an own enumerable `__proto__` claim is
  preserved as an own data property through mapping and one-time grant
  issuance without prototype mutation.
- Focused OIDC verification passes 90/90 at 90.50% branch coverage (324/358);
  the full auth package passes 224/224.
- TypeScript, generated TypeDoc/API inventory at 93 auth exports, C3-scoped
  Prettier, and diff hygiene pass.
- The first permission-enabled canonical repository gate encountered one
  timing-dependent delivery-server signal-test failure outside C3. The
  unchanged focused lifecycle suite then passed 4/4, and the identical
  canonical rerun passed 149 files / 2,858 tests with 3 files / 25 tests
  skipped and 90.08% branches (9,532/10,581).
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability concerns have clean recorded dispositions. Runtime
  self-introspection was unavailable; every child dispatch explicitly used
  its required immutable role/profile. Final Wave 4 security review remains
  deferred to the Wave boundary. No Spine JVM command ran.
