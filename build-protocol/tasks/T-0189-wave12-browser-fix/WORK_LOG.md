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
