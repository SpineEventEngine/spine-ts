# Wave 4 Execution Split

Status: Active

Parent plan:
`build-protocol/planning/WAVE_4_BROWSER_CLIENT_INTEROPERABILITY_PLAN.md`.

This file is the durable implementation order for T-0075. It refines the
approved plan without reopening product decisions.

## Frozen implementation decisions

- Rename the existing client package/history to `packages/client-node` and
  migrate workspace consumers atomically. Add `client-web` afterward. Do not
  create a speculative `client-core` package.
- The browser-safe common kernel belongs to `client-web`; its transport
  injection contract is public and reusable by `client-node`, which owns
  Node-native transport and Entity-column generation.
- Public Spine verbs are `post`, `send`, `createSubscription`, `activate`, and
  `cancel`. No compatibility aliases are required.
- gRPC-Web and Connect browser transports are separate explicit factories.
  There is no runtime probing or fallback. Browser request IDs use secure Web
  Crypto and fail clearly when secure randomness is unavailable.
- Default reconnect policy is finite: five attempts, exponential 250 ms–5 s
  delay with jitter, and a 30-second total limit. One logical subscription owns
  one generation, activation pipeline, and timer. Commands are never retried.
- Lifecycle notifications and domain updates are separate bounded streams.
  Entity reconnect enters `resynchronizing` and repeats its authoritative
  Query. Event reconnect reports `gapPossible`. Terminal cancellation and close
  are idempotent; losing late generations are disposed immediately.
- Add an auth-owned Protobuf unary `AuthenticationService.ResolveContext`
  contract to shared Proto sources. It returns informational Actor, tenant, and
  expiry data and does not change Spine JVM.
- Gateway order is: bound bytes, decode known envelope, authenticate session,
  construct typed `IncomingRequest`, authorize, resolve Actor/tenant, reject
  stale hints/context, construct a fresh trusted `ActorContext`, then forward.
  Only allowlisted transport facts reach policy or diagnostics.
- Opaque cookie sessions use a `__Host-` cookie with `Secure`, `HttpOnly`,
  `Path=/`, `SameSite=Lax`, and no `Domain`. Cookie-authenticated API calls
  require an exact allowlisted `Origin` and `X-Spine-CSRF`; the value is
  HMAC-derived from the session ID and constant-time checked against a
  `__Host-` CSRF cookie. OAuth callbacks instead atomically consume
  state/nonce/PKCE transactions.
- Signed application sessions use ES256 JWS/JWT only with mandatory `kid`,
  `iss`, `aud`, `iat`, `exp`, `jti`, and subject/principal claims. Algorithms
  are configured, never token-selected; `none`, symmetric fallback, and
  token-directed remote key URLs are forbidden. Retired verification keys stay
  available for maximum token TTL plus clock skew.
- Signed strategies expose a discriminated optional revocation capability.
  Revocation-capable verification checks `jti`; without it logout reports
  `expiryOnly`. Opaque logout always deletes the server session.
- Federated bearer tokens never appear in redirect URLs. A short-lived,
  one-time exchange grant bound to browser PKCE is POSTed with
  `Cache-Control: no-store`; the browser keeps the resulting token in memory by
  default.
- A gateway-generated subscription ID hides the backend ID. An injectable
  atomic binding store owns backend envelope, principal fingerprint, tenant,
  expiry, and `inactive/active/cancelling/closed` state. Activate/Cancel use
  stored backend data, independently reauthorize the same owner, and transition
  atomically. Wave 4 supplies an in-memory reference store.
- Relay message-count and byte bounds are independent. Crossing either aborts
  both sides. Disconnect, expiry, cancellation, or backend error aborts native
  work; cleanup is bounded and idempotent.
- The JVM fixture is not a submodule, vendored tree, or patched source. A lock
  manifest records official repository/full SHA, archive SHA-256, Gradle
  wrapper/toolchain/locks, fixture inputs, capabilities, and launch probe.
  Fetch into ignored cache, verify before extraction, build detached, and
  assert the upstream tree remains clean.

## Dependency-ordered tasks

| ID  | Boundary                                                                                                                       | Prerequisite    | Required focus                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------- |
| P1  | Freeze/fetch/build/checksum the unmodified JVM fixture and capability probe under `interop/jvm/**`.                            | None            | Docs, reliability, supply-chain integrity |
| A1  | Rename existing client to `client-node`, move codegen, migrate all Node consumers without behavior change.                     | P1 recorded     | Style, API, docs                          |
| A2  | Add browser-safe `client-web` kernel/API and make Node reuse its transport seam.                                               | A1              | Style, API, reliability                   |
| A3  | Add explicit gRPC-Web/Connect factories, credential metadata, and secure browser IDs.                                          | A2              | API, reliability, security                |
| A4  | Add subscription lifecycle generations, bounded streams, reconnect/resync/gap behavior, and terminal cancellation.             | A3              | Reliability, API, docs                    |
| B1  | Add auth Proto/contracts, exhaustive `IncomingRequest`, safe transport facts, session/policy/context seams, registry decoding. | A2              | API, style, docs, security                |
| B2  | Add unary Post/Read/ResolveContext gateway pipeline with stale-context rejection and fresh replacement.                        | B1              | API, reliability, security                |
| B3  | Add atomic subscription binding and independently authorized Subscribe/Activate/Cancel.                                        | B2              | Reliability, API, security                |
| B4  | Add native-gRPC forwarding and bounded bidirectional stream relay/cleanup.                                                     | B3              | Reliability, style, docs, security        |
| C1  | Add opaque in-memory sessions, cookie extraction, Origin/CSRF, rotation, expiry, logout.                                       | B1              | API, reliability, docs, security          |
| C2  | Add ES256 signed sessions, key rotation/validation, and explicit revocation capability.                                        | B1              | API, reliability, docs, security          |
| C3  | Add generic OIDC code flow, transaction store, PKCE/state/nonce, mapping, and one-time bearer exchange.                        | C1, C2          | API, reliability, docs, security          |
| C4  | Add Google, GitHub, and custom verified-identity provider adapters.                                                            | C3              | API, docs, reliability, security          |
| C5  | Integrate cookie/bearer credentials and `ResolveContext` into web reconnect/reauthorization.                                   | A4, B4, C1-C4   | API, reliability, docs, security          |
| D1  | Add `client-react`, React peer dependency, stable observers, provider/context, Strict Mode cleanup.                            | A4, C5          | Style, API, reliability, docs             |
| D2  | Complete Chat per-message Projection model and columns; messages remain entities, not events.                                  | A1              | API, docs, style                          |
| D3  | Add Chat Aggregate/Projection/backend, identity mapping, and authorization policy.                                             | B4, C4, D2      | Style, reliability, docs, security        |
| D4  | Add Chat browser/auth UI using `client-react`, authoritative Query, subscription lifecycle, and re-query.                      | D1, D3          | All concerns                              |
| D5  | Run real Strict Mode/race acceptance in Chromium, Firefox, and WebKit.                                                         | D4              | Reliability, docs                         |
| E1  | Add configurable Envoy template/harness exposing only the gateway by default.                                                  | P1, B4, C5      | Reliability, docs, security               |
| E2  | Prove browser → Envoy → gateway → TS Chat for credentials/protocols/denials/lifecycle.                                         | D4, E1          | Reliability, docs, security               |
| E3  | Prove the same contract against the frozen unmodified JVM fixture.                                                             | P1, E1          | Reliability, docs, API, security          |
| E4  | Consolidate browser/runtime resilience matrix and zero-retained-resource checks.                                               | D5, E2, E3      | Reliability, docs, security               |
| F1  | Complete package/API docs, signatures, snippets, and responsibility map.                                                       | A-E APIs frozen | API, docs, style                          |
| F2  | Complete auth/session/provider/security/Envoy extension guide and decision tables.                                             | C-E             | Docs, API, security                       |
| F3  | Complete subscription state machine, React/Chat/interoperability diagrams, and every public limitation.                        | E4              | Docs, API, reliability                    |
| F4  | Run deterministic gates, all reviews, final security, ≥90% branch coverage, merge/post-merge verification, and remote sync.    | F1-F3           | All                                       |

## Acceptance evidence by area

- P1 must fail on checksum mismatch or source mutation and pass native Command,
  Query, Projection-subscription, and exposed-event-subscription probes.
- A slices require compile/package tests, browser dependency scans, explicit
  transport behavior, fake-clock reconnect races, bounded-stream overflow, and
  proof that commands are never retried.
- B slices require exhaustive request-kind tests, safe malformed/unknown `Any`
  handling, no-forward denial tests, byte-equivalent context replacement,
  cross-owner subscription denial, atomic Activate/Cancel races, bounded relay
  tests, and zero retained calls/bindings/timers/payloads.
- C slices require fixation/replay/Origin/CSRF/expiry tests; complete ES256
  algorithm/key/claim/revocation tests; atomic OIDC transaction/grant replay
  tests; fixed/local redirect tests; provider identity/redaction tests; and
  browser credential precedence/exposure tests.
- D slices require one Projection per chat message, trusted author/tenant
  policy, real post/query/subscription/re-query behavior, React Strict Mode
  mount/unmount/remount cleanup, and all three browser engines.
- E slices require validated Envoy routes/CORS/limits/private backends, real TS
  and JVM end-to-end behavior, no direct backend access, and zero retained
  resources across the browser/runtime matrix.
- F slices require compile-checked examples, fresh-reader extension tests,
  exact limitations, full native verification/coverage, complete review
  dispositions, final security acceptance, and durable remote refs.

## Blocker rule

No blocker is established. P1 becomes a human blocker only if no immutable
official Spine JVM revision can be fetched and built with the required native
service capabilities, or if required artifacts are inaccessible under
repository/authentication policy. Ordinary failures and implementation-shape
corrections remain autonomous work.
