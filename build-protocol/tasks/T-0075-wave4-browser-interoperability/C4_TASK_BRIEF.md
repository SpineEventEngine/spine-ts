# C4: Google, GitHub, and Custom Identity Providers

## Classification and objective

C4 is high-risk because it introduces provider networking, credential handling,
signed identity-token verification, and public adapter contracts.

Add the smallest Node-only provider layer to `@spine-event-engine/auth` that
connects C3's `OidcVerifiedIdentityProvider` seam to:

- a configurable standards-based OpenID Connect provider;
- Google OpenID Connect with fixed official identity endpoints; and
- GitHub's OAuth web flow followed by a fresh authenticated-user lookup.

The adapters return only bounded verified `ExternalIdentity` values. Provider
access tokens, refresh tokens, client secrets, authorization codes, and PKCE
verifiers never enter application sessions, grants, mappings, logs, or public
results.

## Scope boundaries

C4 owns provider token exchange, OIDC discovery/metadata validation, JWKS
signature verification, provider identity lookup, response bounds, and
provider-specific documentation.

C4 does not add an HTTP server, browser client integration, React APIs,
application identity mapping policy, application-session issuance, refresh or
device flows, token persistence/revocation, organization/team policy, GitHub
App installation authentication, JVM execution, or live-provider tests. C5
owns browser/auth HTTP integration.

## Provider model

### Configurable OIDC

Expose an async discovery/configuration entry point and an explicit-metadata
entry point. Both produce a shallow configuration containing the exact
authorization endpoint and an `OidcVerifiedIdentityProvider` for `OidcFlow`.
This avoids a second flow abstraction.

The adapter:

- accepts only exact HTTPS issuer, authorization, token, and JWKS endpoints;
- requires discovery `issuer` to exactly equal the configured issuer;
- accepts only authorization-code exchange and S256 PKCE;
- supports explicitly selected `client_secret_basic`, `client_secret_post`, or
  `none` token-endpoint authentication;
- sends the exact C3 client ID, callback URI, code, and provider verifier;
- verifies the ID-token signature with the configured/discovered JWKS;
- allowlists asymmetric signing algorithms and rejects `none`, symmetric
  algorithms, missing/ambiguous keys, or unsupported critical headers;
- verifies exact issuer, audience containing the client ID, expiry/not-before,
  subject, and exact transaction nonce;
- treats `azp` as required and exact when multiple audiences are present;
- returns bounded string claims only. Boolean or numeric standard claims are
  validation inputs, not stringified application claims;
- never uses a remote token-introspection/debug endpoint as production
  verification.

Discovery and JWKS responses use cache directives where safe but remain
bounded. A cache miss or key rotation may perform one fresh JWKS retrieval; it
must not create an unbounded retry loop.

### Google

Expose a Google factory built on the configurable OIDC adapter. Pin the official
issuer/discovery location and use discovered authorization, token, and JWKS
endpoints. Default scopes are `openid profile email`; applications may narrow
or extend them.

Use `sub` as the external subject. Email is optional metadata and never an
identity key. Preserve `email` only when syntactically bounded and preserve
`email_verified` as a string claim only when it was the boolean `true` or
`false` in the verified ID token. The adapter must not infer Workspace tenancy
from an email domain.

### GitHub

GitHub is OAuth 2.0, not an OIDC provider. Implement a distinct adapter behind
the same verified-identity seam:

1. exchange the code at the exact configured GitHub token endpoint using the
   client secret and C3's provider PKCE verifier;
2. require a bearer token response and any configured required scopes;
3. immediately call the exact authenticated-user endpoint with that token;
4. use the stable numeric GitHub user ID, not mutable login/email, as subject;
5. optionally call the email endpoint and retain only one verified primary
   email when the application requests the required `user:email` scope; and
6. discard the access token after these calls.

The fixed public GitHub factory uses `https://github.com` as issuer,
`https://github.com/login/oauth/authorize` and
`https://github.com/login/oauth/access_token`, plus the versioned
`https://api.github.com/user` APIs. A configurable GitHub-compatible factory
may override all related origins together for GitHub Enterprise; it must not
mix public-GitHub and enterprise endpoints.

GitHub has no ID token or nonce claim. C3 still supplies state and S256 PKCE;
the GitHub adapter documents that its sign-in binding relies on those controls
and a fresh authenticated-user lookup rather than OIDC nonce/signature
verification.

## Public contracts

Prefer a shallow module under `packages/auth/src/providers/` with:

- a named provider HTTP function compatible with Node `fetch`, injected for
  deterministic tests;
- exact explicit OIDC metadata and discovery options;
- a discovered/configured provider result containing `authorizationEndpoint`,
  recommended scopes, and `provider`;
- Google factory options containing client secret/auth method, HTTP seam, and
  finite limits;
- GitHub factory options containing client secret, scopes/email policy, HTTP
  seam, API version, and finite limits; and
- no public raw token/JWK/JWT response types unless an end user must implement
  the seam.

Constructors/factories validate synchronously where possible. Async discovery
returns a deterministic failure rather than a partially usable provider.
Public result unions must not expose provider error descriptions, tokens,
response bodies, or secrets.

## Finite and fail-closed behavior

- Default provider operation timeout: 30,000 ms, bounded to a positive safe
  integer. Combine it with C3's abort signal.
- Default maximum discovery/JWKS/token/user response body: 1 MiB; reject before
  parsing when `Content-Length` exceeds the cap and while streaming when actual
  bytes exceed it.
- Reject redirects for token, JWKS, and identity API calls.
- Require expected JSON media types and successful status before parsing.
- Bound URLs, client identifiers, secrets, codes, verifiers, tokens, headers,
  claim names/values, discovery fields, JWK count, and GitHub email count.
- Read hostile injected HTTP responses and parsed objects through guarded,
  single-read snapshots. Reject malformed JSON, duplicate/ambiguous identity
  fields, unsafe numeric IDs, throwing getters/Proxies, and oversized data.
- Abort/timeout/network/parse/provider errors return `undefined` through the C3
  provider seam; they do not leak provider detail.
- Never retry token exchange. Permit only the finite JWKS key-rotation refresh
  described above.
- JavaScript strings cannot be reliably zeroed. Keep secrets and provider tokens
  in the narrowest lexical scope, retain no copies after completion, and
  document this limitation honestly.

## Behavior-first implementation slices

1. RED/GREEN a bounded provider HTTP reader and explicit-metadata OIDC adapter,
   including locally signed JWT/JWK fixtures and every issuer/audience/nonce/
   time/algorithm failure.
2. Add bounded discovery and one finite JWKS rotation refresh, then the Google
   factory and Google claim behavior.
3. Add GitHub code exchange, fresh `/user` lookup, optional verified-primary
   email lookup, required-scope checks, and enterprise-origin consistency.
4. Export the exact public surface, freeze TypeDoc inventory, and add package
   README examples for custom OIDC, Google, and GitHub. Document GitHub's weaker
   non-OIDC guarantee, provider-token lifetime, scopes, endpoint trust, and all
   extension points.

Use one implementation owner for overlapping auth files. Do not call real
providers in tests.

## Acceptance and review

- Focused provider tests cover success, malformed/oversized/throwing responses,
  wrong metadata/endpoints, token auth methods, JWT algorithms/keys/claims,
  JWKS rotation bounds, timeout/abort, GitHub scope/user/email behavior, and
  proof that no provider credential reaches `ExternalIdentity`.
- Full auth tests, auth TypeScript, generated TypeDoc/API inventory, formatting,
  diff hygiene, and the change-sensitive repository gate pass.
- Relevant canonical concerns: style/maintainability, TypeScript/API,
  documentation, and performance/reliability. Record every disposition.
- Final Wave 4 security review remains deferred until the Wave boundary.
- Do not build, test, generate, resolve dependencies for, launch, or otherwise
  execute Spine JVM. Static read-only source/descriptor evidence remains the
  only permitted JVM interaction.
