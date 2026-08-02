# T-0093 Standalone Gateway Split

Status: Accepted

## Public contract

Deepen the existing `Server` to internal `BrowserServer` assembly. Supplying
`browser.backend.baseUrl` selects standalone mode; omitting it preserves
combined mode and its owned loopback native server. Add no gateway class,
runner, router, duplicate namespace option, health API, or second pipeline.

The backend URL is one canonical HTTP(S) origin without credentials, query,
fragment, or a path beyond `/`. It may name a load-balanced service containing
multiple Spine TS application replicas. Production standalone mode requires a
type registry and durable bindings whose constructor-validated namespace is
nonblank. Local/test mode may explicitly use in-memory bindings.

Application auth registrations use one bounded contract:

```ts
interface BrowserAuthRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly origins: readonly string[];
  readonly allowMissingOrigin?: boolean;
  readonly maxRequestBytes: number;
  readonly timeoutMs: number;
  readonly onRequest: OnBrowserAuthRequest;
}
```

The handler receives a Fetch `Request` and `AbortSignal` and returns a Fetch
`Response`, synchronously or asynchronously.

## Checkpoint 1: Configuration and mode freeze

RED tests prove standalone production rejects missing/invalid backend,
registry, auth/session/context/clock/fingerprint collaborators, volatile or
unnamed bindings, invalid routes, and combined/standalone ambiguity before
listener or backend work. Existing combined/local behavior remains compatible.

Centralize validation in `BrowserServer`. Expose only the minimum durable
namespace capability already owned by `DurableSubscriptionBindings`.

## Checkpoint 2: One backend-neutral Spine pipeline

RED tests prove standalone Post, Read, Subscribe, Activate, and Cancel reach a
supplied TS backend. ResolveContext remains local. Both modes reuse the same
`UnaryGateway`, `SubscriptionGateway`, native services, descriptors, policy,
context replacement, relay bounds, and credential stripping.

`BrowserServer.open()` accepts either the combined owned `RunningServer` or a
standalone canonical base URL. Standalone never owns or shuts down the external
backend.

## Checkpoint 3: Exact bounded auth dispatch

- Auth paths are canonical absolute non-root paths: no query, fragment,
  trailing slash, wildcard, parameter syntax, dot segment, encoded slash or
  backslash, or normalization alias.
- Each normalized path has exactly one method. Duplicate/conflicting paths and
  reserved Spine service prefixes fail startup.
- Reserved exact RPC paths always dispatch before auth lookup.
- Limits are finite: positive safe request bytes within transport bounds and
  timeout `1..2_147_483_647` ms.
- Framework OPTIONS applies only to a known exact route/method and never calls
  application code.
- Present Origin byte-matches that route's unique canonical allowlist. Missing
  Origin is rejected unless explicitly allowed for an OAuth callback; apps
  still verify OAuth state.
- Content-Length is checked first, then streamed chunks are counted before a
  bounded owned body is allocated.
- Fixed non-leaking responses: unknown path 404, wrong method 405, origin 403,
  overflow 413, drain 503, timeout 504, uncaught error 500.

## Checkpoint 4: Cancellation and close convergence

Timeout, request/response disconnect, listener drain, explicit close, and
process shutdown abort the same route signal. Timeout covers body intake,
handler work, and response transfer. Rejected routes start no work.

Close order is intake drain; abort active auth and RPC work; close subscription
admission/relays and owned bindings; await listener/request settlement; close
the combined owned native server. Concurrent closes share one attempt and a
retry resumes unfinished phases. Preflight failure takes no ownership;
post-validation startup rollback closes new resources once.

## Checkpoint 5: Envoy, compatibility, and documentation

Envoy renders exact routes, never prefixes: the six reserved Spine RPC paths
plus supplied auth method/path registrations with matching route origins,
limits, and timeouts. Activate alone uses streaming timeout zero. There is no
catch-all upstream.

Run the locked JVM static fixture/wire suite unchanged. Assert the five
forwarded RPCs use its frozen shared descriptors and ResolveContext remains the
TS gateway descriptor. Label evidence as partial static source/descriptor
compatibility; JVM runtime verification remains deferred because the frozen
fixture has six unresolved transitive imports. Do not build, modify, download
dependencies for, or launch JVM code.

## Ownership and gates

One implementer owns the existing browser/server/durable-binding seams,
exports, mirrored server tests, Envoy renderer/tests/reference, and focused
README/REFERENCE claims. `compatibility-tests/jvm/**` is evidence-only unless a
strictly necessary deterministic TS-side assertion is added.

Changed production files require at least 90% statements, branches, functions,
and lines. Run focused route/configuration/mode/origin/limit/cancellation/
rollback/close/Envoy/compatibility tests, then the cheap preflight. Use one
complete review wave across style, documentation, TypeScript/API, and
performance/reliability. Final security remains the Wave 5 G1 role; fail-closed
routing, origin isolation, redaction, and cancellation remain mandatory here.
After convergence, run `verify:release` once.
