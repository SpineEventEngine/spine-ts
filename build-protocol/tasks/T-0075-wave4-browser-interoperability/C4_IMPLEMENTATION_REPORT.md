# C4 implementation report

## Implemented behavior

- Explicit and discovered HTTPS OIDC configuration produces C3-compatible
  `OidcVerifiedIdentityProvider` instances. Token exchange is code/S256-PKCE
  only, rejects redirects and non-JSON/oversized responses, supports the three
  specified client authentication modes, and returns `undefined` on provider,
  parsing, deadline, or verification failure.
- ID tokens use pinned `jose@6.2.4`, accept only RS256 or ES256 keys selected by exact `kid`, require
  exact issuer, client audience, nonce, times, subject, and multi-audience
  `azp`, and perform one JWKS refresh for rotation.
- Google uses its fixed issuer discovery. GitHub exchanges OAuth code then
  performs a fresh `/user` call and exposes only the stable numeric ID. It is
  explicitly documented as weaker than signed OIDC identity binding.

## TDD evidence

The first OIDC test was RED because `src/providers/index.ts` did not exist.
After minimal implementation it passed. The GitHub test was RED because
`createGitHubProvider` did not exist, then GREEN with a fresh numeric user
lookup.

## Focused verification

- Provider tests: 2 passed.
- `tsc --noEmit -p packages/auth/tsconfig.json`: passed.
- C4 source/tests: Prettier applied successfully.

## Limitations

Provider access/refresh tokens remain JavaScript strings and therefore cannot be
reliably zeroed. The adapters retain no provider token beyond the lexical
exchange operation and never return one. GitHub remains an OAuth identity
lookup protected by state and S256 PKCE rather than a signed OIDC nonce.

No provider was called live and no Spine JVM command ran. Browser/HTTP
integration remains C5. The remaining review wave is owned by the coordinator.

## Final correction and acceptance evidence

- The exact `jose@6.2.4` dependency replaces hand-written JWT/JWK verification.
  Both locally signed RS256 and ES256 tokens pass only with the exact issuer,
  audience, nonce, subject, time window, key ID/algorithm, and multi-audience
  authorized presenter.
- Provider response bodies are capped while streaming and cancelled on
  overflow. Discovery, OIDC exchange, and GitHub lookup settle at their
  deadline even when an injected HTTP function ignores `AbortSignal`.
- Google preserves the canonical issuer and recommends `openid profile email`;
  email remains optional metadata. GitHub performs a fresh stable numeric user
  lookup and, when requested, retains exactly one verified primary email under
  `user:email`. Public and enterprise endpoints cannot be mixed.
- The behavior matrix covers malformed/non-canonical JWTs, wrong claims,
  unknown/duplicate/oversized/mismatched keys, finite JWKS refresh/cache,
  provider status/media/size/JSON/body failures, client authentication modes,
  abort/deadline behavior, constructor bounds, GitHub token/scope/user/email
  rejection, and credential exclusion.
- Focused provider verification passes 66/66 at 93.49% branches (230/246) and
  100% lines. The full auth suite passes 290/290; auth TypeScript passes; generated
  TypeDoc/API inventory passes at exactly 102 auth exports; changed-file
  Prettier and diff hygiene pass.

### Review correction

- Provider work checks its abort signal before consuming a late response and
  races every stream read against cancellation. A late response is cancelled
  without body/follow-up work; a non-cooperative stream cannot hold the public
  operation open.
- JWKS publication follows bounded `Cache-Control`/`Age` directives, defaults
  to no caching without safe directives, expires after at most one day, and
  uses one single-flight fetch for concurrent cold/rotation loads.
- GitHub Enterprise web/API bases must share an origin; public GitHub retains
  its official two-origin pair. URLs, API versions, scope strings, and scope
  counts are finite.
- Only boolean `email_verified` values are normalized. README examples and
  public TSDoc now document custom discovery, Google, GitHub, limits, cache/
  rotation, endpoint trust, auth modes, and JavaScript-string retention limits.

### Residual review correction

- Shared JWKS work now has an operation-owned abort controller and independent
  waiter cancellation. Aborting the first exchange cannot poison a concurrent
  valid exchange, while the shared fetch is cancelled once no waiters remain.
- Google forwards only its declared factory options, so a structurally injected
  discovery URL cannot replace the fixed official discovery endpoint. GitHub
  rejects non-array scopes and non-boolean email lookup flags at runtime.
- Token, discovery, and JWKS responses rejected by status, media type, or
  declared size have their bodies cancelled before the adapter fails closed.
- A final lifecycle regression proves that aborting the only JWKS waiter
  cancels the shared fetch and permits a later exchange to start a fresh fetch.
- Every supplied client secret is validated and bounded even in PKCE-only
  mode, and provider closures retain only the validated value.
- GitHub copies the validated email-lookup flag before constructing its
  provider closure, so the raw options object and secret are not retained.
  Missing-secret coverage includes both Basic and POST client authentication.
- The README defines the application-owned identity/session seams and
  constructs flows for explicit custom OIDC, discovered OIDC, Google, and
  GitHub; the auth README is now part of semantic snippet checking.
- Final focused evidence passes 77/77 provider tests at 254/278 branches
  (91.36%) and 248/248 lines (100%). The full auth suite passes 301/301;
  auth TypeScript, generated TypeDoc/API inventory at 102 exports, semantic
  snippets, repository formatting, and diff hygiene pass.
- Canonical `test:coverage:generated` acceptance passes 150 test files and
  2,935 tests, with 3 files / 25 tests skipped and 9,786/10,859 branches
  (90.11%). No Spine JVM command ran.
