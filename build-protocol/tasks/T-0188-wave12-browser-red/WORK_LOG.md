# T-0188 Work Log

Status: COMPLETE

- Baseline: `e2ab42d2`; branch/worktree: `codex/wave-12-browser` /
  `.worktrees/wave-12-browser`.
- Frozen dependency installation: passed with `pnpm install --frozen-lockfile`.
- Before production edits: create and run the real-browser and direct-native
  three-update diagnostic; commit and push its RED/isolation evidence.
- Assigned role/profile: existing `implementer`, `gpt-5.6-terra` / `medium`.
  Explicit dispatch was supplied by the orchestrator; runtime telemetry is not
  exposed and no self-claimed runtime metadata is used.
- RED/isolation evidence (2026-08-15): direct native gRPC activation with the
  same board filter and a passive viewer passed three sequential writer commands
  (`node --test --test-name-pattern='direct native' .../topology.test.mjs`).
  The initial unfiltered direct probe failed subscription validation, so it was
  corrected before classification; it was not treated as lifecycle evidence.
- Real Chromium -> Envoy -> Gateway -> native gRPC RED: the passive viewer
  fails during `SubscriptionService.Subscribe`/client recovery with
  `ConnectError: Failed to fetch`, before its first writer update. An unchanged
  cookie/CSRF browser acceptance independently fails at `ResolveContext` with
  the same error. This isolates the currently reproducible fault outside native
  subscription production, but does not yet reproduce the reported
  post-successive-update termination. No production owner is proven.
- Counters/cleanup: the harness closes in `finally`; no Envoy container or
  listener remained after either browser run. Browser-side active-stream/update/
  cancel/dispose counters cannot be sampled because forwarding does not reach
  the Gateway. The direct-native run closed its iterator, cancelled the
  subscription, and closed the topology.
- `pnpm typecheck:build` was invoked to prepare the focused tests, but shared
  concurrent Wave compilation was active; generated manifest IDs were restored
  because they are verification byproducts, not task changes.
- Systematic transport diagnosis (serialized topology): Chromium captured the
  exact `OPTIONS https://127.0.0.1:8443/spine.auth.AuthenticationService/ResolveContext`
  request, `net::ERR_FAILED`, and the browser CORS message that no
  `Access-Control-Allow-Origin` header was present. While live, Envoy reported
  running, Gateway counters remained all zero, and a direct host probe returned
  `404`, null allow-origin, and null allow-methods. Native direct activation
  remains green. `interop/envoy/render.mjs` emits only POST route matches; the
  CORS filter therefore has no matching OPTIONS route. Owner proven: Envoy
  reference renderer. This is product transport configuration, not an
  environment/harness failure.
- Closure: the ownership finding authorized the bounded T-0189 Envoy correction
  and no longer leaves T-0188 active. T-0189 separately owns its remaining
  browser-harness evidence and re-review readiness.
