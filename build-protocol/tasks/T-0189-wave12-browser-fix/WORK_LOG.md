# T-0189 Work Log

Status: CORRECTION IN PROGRESS

Await T-0188 ownership classification. Preserve best-effort notification
semantics, explicit overflow termination, bounded cancellation/cleanup,
cookie/CSRF, and no automatic command retry.

2026-08-15: not authorized. Direct native three-update comparison passes while
the real browser path cannot complete its first forwarded request. Ownership
must narrow to the browser/Envoy/Gateway transport boundary through further
diagnostics; no runtime source was edited.

2026-08-15 update: T-0188 proved `interop/envoy/render.mjs` as the single
owner. Chromium CORS diagnostics and a live direct OPTIONS probe both show an
unmatched preflight (404/no CORS headers); Gateway admission remains zero. The
smallest correction is now authorized only after a failing renderer test.

GREEN: the renderer now emits an exact OPTIONS route beside each bounded public
RPC route. `interop/envoy/render.test.mjs` passes; the unchanged Chromium
cookie/CSRF flow passes; a passive Chromium viewer receives three sequential
updates from a separate Ada writer tab through Envoy and Gateway; and the
direct-native three-update comparison passes. Bert was intentionally denied as
a writer, so the valid two-tab regression uses separate authenticated Ada tabs.

Mechanical convergence: Node V8 executed 10 focused MJS tests. `render.mjs`
reported 100% lines/functions and 88.46% whole-file branches; the one changed
`flatMap` route-expansion line executed both POST and OPTIONS outputs, so its
changed executable lines/branches are 100%. This V8 accounting is distinct
from real Chromium evidence. Focused ESLint, Prettier, `git diff --check`, and
`pnpm typecheck:build` passed. The first Vitest coverage invocation found no
tests because the repository's Vitest include deliberately excludes MJS;
Node's V8 runner is the applicable scoped evidence.

Final correction evidence: `topology.test.mjs` proves both an accepted-origin
and missing-origin OPTIONS request return terminal 204 and leave every Gateway
admission counter unchanged. Chromium full-suite output could not be retained
after its child process exceeded this surface's 30-second capture window; it
must be treated as an evidence-capture limitation, not a passing claim.

2026-08-15 replacement-implementer correction: the browser runner now consumes
ordered `PASSIVE_VIEWER_UPDATE 1..3` markers from the real Chromium test and
snapshots the parent-owned Gateway binding and native active-stream counters
after every update. It rejects an unhealthy binding/stream or out-of-order
marker. The abrupt-disconnect scenario emits `FORCED_VIEWER_DISCONNECT` only
after closing its page and context; the parent runner then waits for zero
bindings and active streams before it may call `topology.close()`. Node unit
coverage proves the ordered healthy snapshots, unhealthy-stream rejection, and
bounded settlement. This replacement owner is the existing `implementer`,
explicitly configured `gpt-5.6-terra` / `medium`; Desktop exposes no runtime
model/token/latency telemetry.

Fresh complete Chromium evidence was captured with
`node examples/message-board/web/test/interop/browser/run.mjs --project chromium`:
exit `1`; eight tests ran, three negative cases passed, and five positive-path
cases failed before Gateway admission. Chromium reports that the terminal Envoy
OPTIONS responses lack `Access-Control-Allow-Origin`; the runner diagnostic
reports zero bindings and all Gateway counters zero. Therefore no real-browser
per-update snapshot can truthfully be claimed from this attempt. This is the
same Envoy CORS boundary previously assigned to the completed production owner,
not a harness-induced lifecycle failure.

2026-08-15 CORS correction: terminal direct-response OPTIONS routes cannot
receive the virtual-host CORS headers. The renderer now orders a first exact
genuine-preflight route for each public RPC path (OPTIONS plus present Origin
and `Access-Control-Request-Method: POST`) through the ordinary bounded route,
where Envoy's CORS filter intercepts it. A second exact OPTIONS-only terminal
204 route remains the local fallback for missing-Origin, malformed, and
non-preflight OPTIONS. `forward_not_matching_preflights: false` keeps rejected
genuine preflights local. Renderer and live-topology tests prove allowlisted
preflight returns 200 with `Access-Control-Allow-Origin`, rejected genuine
preflight returns local 200 without that header, and missing-Origin fallback
returns 204; all leave Gateway counters unchanged.

Fresh complete Chromium output is captured: CORS admission is now healthy and
7 of 8 tests pass. The passive viewer receives only two of its three ordered
writer updates, then reaches Playwright's 30-second timeout; the parent cleanup
correctly reports two residual bindings after the forced test timeout. This is
a newly proven post-admission sustained browser-delivery failure, distinct from
the corrected CORS regression. No healthy third-update snapshot or green
browser acceptance is claimed at this endpoint.

## C-01 Boundary Diagnosis (2026-08-15)

Diagnostic capture ran from `288bfb8a` with test-only Envoy access logs,
browser iterator/response markers, Gateway/native handoff events, and timeout
state. The isolated passive-viewer run fails on its first received update, not
the third: `nextPassiveUpdate()` calls `JSON.stringify(update.value)`, whose
payload contains `BigInt`, producing `TypeError: Do not know how to serialize a
BigInt`. Its rejected browser evaluation aborts the gRPC-Web stream. The trace
is ordered `gateway.subscribe`, `native.subscribe`, `gateway.activate`, one
`gateway.forward`, one `native.update`, one `gateway.update`, then activation
end/cancel; Envoy reports successful 200 Subscribe and Activate responses with
no transport error. This proves the owner is the browser test bridge
`test/interop/browser/entry.ts`, not client-web, Gateway forwarding,
subscription runtime/observer, browser-server, Envoy, or native delivery.

The direct-native three-update control remains required beside the bridge RED.
No runtime behavior is changed by this diagnostic checkpoint.

Bridge GREEN: `nextPassiveUpdate()` now serializes only its test identity with
a BigInt-to-decimal replacer. The isolated Chromium passive-viewer test receives
all three distinct updates and records healthy parent snapshots for updates
1/2/3: one binding, one active native stream, and matching Gateway update
counters. The direct-native three-update control also passes. The test-only
runner parent did not exit after the successful child despite bounded cleanup,
so its two explicitly identified stale processes were stopped; that teardown
monitoring anomaly is separate from the fixed bridge serialization path and
requires later lifecycle investigation before final browser closure.

## Lifecycle Correction (2026-08-15)

Async-handle capture proved the post-child parent hang was neither a Playwright
child nor an HTTP/2 listener: only stdio pipes and an active timeout remained.
The timeout's creation stack is `SubscriptionGateway.scheduleExpiry()`. The
topology constructed that Gateway but had not registered it as a cleanup owner,
so its finite expiry timer could retain Node after a successful test. The
harness now closes the subscription Gateway (thereby clearing expiry timers)
before closing its bindings; it also tracks and destroys live Gateway HTTP/2
sessions before awaiting `server.close()`. Focused lifecycle tests prove this
ordering on both success-adjacent and startup-failure paths, including container,
listener, binding, and native-owned cleanup attempts.

Fresh focused Chromium acceptance for the passive viewer exits automatically
with status 0 and records three ordered healthy snapshots: each has one binding,
one active native stream, and the matching update counter. A fresh full
Chromium command now also exits automatically (status 1 in 15 seconds) rather
than retaining the runner; it exposes the separate, pre-existing full-ordering
C-01 passive-viewer timeout on update 1 while the other seven browser cases
pass. The failure path reports bounded post-child settlement state and leaves
no task-owned runner process. This is distinct from the lifecycle leak, which
is corrected; complete-suite browser behavior remains unresolved.

The runner unit regression also proves a successful Playwright child exits
before a drained topology is closed; the existing settlement regression requires
zero bindings and zero active native streams. The final focused process scan
found no task-owned runner, no listener on 9443, and no Envoy container.

## Full-Suite Ordering And Disconnect Correction (2026-08-15)

Incremental Chromium selection isolates the minimal contaminating predecessor:
the initial CSRF-protected subscription test followed by C-01 fails, while C-01
alone passes. Pre-C-01 topology state is clean (zero bindings and zero active
native streams), and auth session, page, and client contexts are independent.
The persistent board state instead contains the predecessor's
`browser-interop-1`; C-01 reset its page-local counter and posted the same
message ID, so command idempotency emitted no first update. Browser test pages
now use an explicit C-01 `messageIdPrefix`, while every other page defaults to
a fresh UUID prefix. The two-test predecessor-plus-C-01 regression passes with
zero preexisting binding/stream state and all three causal updates.

The first green 8/8 run then exposed one genuine disconnect defect: a browser
transport abort left an inactive Gateway binding despite zero native streams.
The native bridge propagated stream abort to active backend work but did not
issue the authenticated logical `Cancel`. It now issues exactly one bounded
Cancel only after an activation has started and the external transport signal
aborts; iterator-local termination and relay overflow retain their former
one-call behavior. Focused native tests cover that cancellation, and forced
Chromium disconnect now reaches zero bindings and native streams before
topology close. Fresh complete Chromium acceptance exits 0 with 8/8 tests,
three healthy ordered snapshots, no runner process, no 9443 listener, and no
Envoy container.

Focused V8 coverage exercised `packages/auth/src/native/index.ts` at 85.45%
lines and 78.35% branches. The command exits nonzero only because this
repository applies its 90% global threshold to the entire monorepo even for a
single-file Vitest invocation; it is recorded as a tooling limitation rather
than a test failure. Native behavior tests, browser runner tests, formatting,
lint, whitespace, and build typechecking are green.
