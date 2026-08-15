# T-0189 Review Log

Status: FINAL AFFECTED-LANE RE-REVIEW IN PROGRESS

Performance/reliability and style/maintainability apply. TypeScript/API,
documentation, and security apply only if the proven implementation boundary
changes their respective contracts or authorization/context behavior.

Mechanical readiness: focused renderer/harness MJS coverage, typecheck, ESLint,
formatting, and whitespace checks are clean. Relevant specialist lanes:
style/maintainability (small renderer route expansion) and
performance/reliability (preflight remains bounded and does not forward to
Gateway). TypeScript/API and documentation are N/A: no declarations or public
claims changed. Security is a final-Wave lane; cookie/CSRF and origin-bound
CORS regression evidence is available for its later disposition.

Accepted correction batch: terminal local OPTIONS routes; distinct passive
update identities; `finally` cancellation before page closure; lifecycle
settlement remains asserted by the browser runner. Ownership is Envoy renderer
and browser diagnostic harness only. Re-review: style/maintainability and
performance/reliability.

Additional captured proof: accepted-, missing-origin, and rejected-origin
preflights are terminal and counter-neutral. Explicit per-update counter
snapshots, deterministic forced-disconnect settlement, and a captured complete
Chromium exit remain outstanding; this task is not ready for re-review until
those required cases are captured.

## Correction Ownership Transfer

- The original existing `implementer` exhausted its execution window after the
  durable `01db1632` checkpoint. It is inactive and retains no file ownership.
- A replacement existing `implementer` owns only the remaining browser
  lifecycle instrumentation and record corrections in the same worktree.
  Dispatch is explicit `gpt-5.6-terra` with `medium` reasoning, no subagents,
  and no query/Inbox ownership. Runtime model/token/latency telemetry remains
  unavailable on Desktop; the immutable configured profile is the evidence.

## Specialist Dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  configured as `gpt-5.6-terra` with `high` reasoning, bounded to the browser
  stream diff `e2ab42d2..ea32b4e9`; read-only and forbidden to spawn subagents.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly configured as `gpt-5.6-terra` with `high` reasoning, bounded to
  CORS preflight routing, stream lifecycle, cancellation, and topology
  resources in the same diff; read-only and forbidden to spawn subagents.
- Desktop dispatch does not expose runtime model, token, latency, or fallback
  telemetry. The immutable configured role/profile is the acceptance evidence
  unless the surface reports a visible mismatch.

## Replacement Implementer Correction (2026-08-15)

- Assigned existing role: `implementer`; explicit configured profile
  `gpt-5.6-terra` / `medium`; no subagents. Desktop runtime telemetry remains
  unavailable, so the immutable dispatch profile is the acceptance evidence.
- The parent harness now receives three ordered real-browser progress markers
  and records `{ update, bindings, activeStreams, updates }` immediately after
  each. It requires one binding, one active native stream, prior subscription
  and activation, and an update counter at least equal to the causal marker.
  Unit tests prove healthy ordered snapshots and reject a dropped stream.
- The deterministic abrupt-disconnect scenario closes page and context before
  it marks completion. The parent consumes that marker, waits for binding and
  active-stream counters to reach zero, and only then enters topology cleanup.
  Unit evidence proves the bounded wait.
- Complete focused Chromium acceptance was captured, not inferred: exit `1`,
  8 tests, 3 passed, 5 failed. Every failing positive flow reports CORS
  preflight without `Access-Control-Allow-Origin`; runner diagnostics show
  `bindings: 0` and every Gateway counter at zero. Because no browser request
  reaches the Gateway, the new per-update browser snapshots cannot be captured
  on this endpoint. Re-review remains blocked on restoring browser CORS
  admission at the existing Envoy production boundary; no query, Inbox, or
  provider files were changed here.

## CORS Correction And New Browser Finding (2026-08-15)

- Corrected renderer ordering: genuine CORS preflights select a bounded normal
  route so the CORS filter owns their response; a following exact OPTIONS local
  response handles missing-Origin/malformed/non-preflight requests. Neither
  shape reaches Gateway admission.
- Fresh complete Chromium acceptance: 7/8 pass. This disproves CORS as the
  remaining blocker. The passive viewer receives two updates and times out on
  the third; cancellation cannot finish after Playwright's timeout, leaving two
  bindings for the parent settlement check. The sustained post-admission stream
  failure requires a separate root-cause correction before re-review can close.

## C-01 Diagnostic Disposition

The post-admission failure is not a sustained server stream defect. Captured
browser `BigInt` serialization fails immediately after the first payload and
causes the observed cancellation. Diagnostic Envoy access, Gateway/native trace,
and gRPC-Web response status localize ownership to the browser test bridge.
The next correction must start with a focused bridge RED and preserve the
existing bounded cancellation and settlement assertions.

Bridge correction evidence: the focused Chromium viewer now consumes three
ordered updates with healthy counter snapshots, and direct native control
remains green. The sole remaining uncertainty from this diagnostic pass is a
runner parent that stayed alive after its passing child; no claim of complete
browser-suite closure is made until that separate teardown monitor is resolved.

## Lifecycle Correction Evidence (2026-08-15)

The remaining runner-retention owner was the test topology: it created a
`SubscriptionGateway` but did not own its `close()`. Active-timeout stack capture
identified `SubscriptionGateway.scheduleExpiry()` as the retained resource.
The correction registers Gateway cleanup ahead of bindings and destroys tracked
HTTP/2 sessions before listener closure. `harness.lifecycle.test.mjs` proves
the deterministic close and cleanup order. The focused Chromium passive viewer
passes and exits automatically with three healthy snapshots; the complete
Chromium command also exits automatically on its currently failing C-01
full-ordering test. Re-review may assess lifecycle ownership and bounded
cleanup, but full browser acceptance remains blocked on that distinct C-01
ordering failure.

The deterministic runner regression requires successful child exit before it
may close a drained topology; the existing settlement regression requires zero
Gateway bindings and active native streams. The focused post-run process scan
found no task-owned runner, 9443 listener, or Envoy container.

## Full-Suite Correction Evidence (2026-08-15)

The minimal order-dependent pair is the first CSRF subscription test followed
by C-01. Its only retained relevant state is the idempotent message entity:
both used `browser-interop-1`; the parent topology reports zero bindings and
active streams before C-01 begins. A C-01-specific message prefix eliminates
that collision, and a new parent marker rejects any nonzero pre-subscription
binding or stream state. The pair passes with all three causal updates.

The full green run localized the final disconnect residue to
`createNativeGatewayServices.activate`: external transport abort aborted native
work but did not submit logical Cancel. The bridge now performs one Cancel only
for a started activation and external transport abort. Focused native tests
prove the added Cancel and preserve the one-call behavior for iterator return,
throw, and relay overflow. Complete Chromium acceptance is now 8/8, exits 0,
settles forced disconnect to zero, and leaves no task-owned process/listener/
container. Re-review is not requested in this correction turn.

Focused V8 coverage reports 85.45% lines and 78.35% branches for the affected
native bridge. Its nonzero exit is solely the repository-wide 90% global
threshold applied to a single-file invocation; focused tests and all other
mechanical checks pass.

## Mechanical Re-review Endpoint (2026-08-15)

Re-review endpoint: `bba0ac1b`, baseline `e2ab42d2`. The existing implementer
remained explicitly configured `gpt-5.6-terra` / medium, used no subagents, and
had no exposed Desktop runtime telemetry. Fresh focused tests cover the native
transport-abort cancellation rejection. The changed native production slice is
8/8 executable lines and 2/2 branches; the Envoy renderer reports 100% lines
and 90.63% branches with every changed route shape exercised. Native, runner,
lifecycle, and renderer tests plus lint, format, and diff checks pass.

Node's V8 reporter excludes the browser test-harness directory, so it emits no
file-level accounting for `entry.ts`, `run.mjs`, or `harness.mjs`. Those are
test/runtime evidence infrastructure rather than shipped package source; their
proof remains the captured complete Chromium 8/8 run, focused runner/lifecycle
tests, and the clean process/listener/container scan. This evidence is not
represented as provider-backed or package-source V8 coverage.

Affected re-review lanes are the existing `style_maintainability_reviewer` and
`performance_reliability_reviewer`, each read-only, no subagents, explicitly
`gpt-5.6-terra` / high. Desktop telemetry remains unavailable. TypeScript/API
and documentation remain N/A because no declaration or reader-facing claim
changed. Security remains for final Wave review.

## Re-review Result And Accepted Batch (2026-08-15)

Both affected reviewers completed read-only against `bba0ac1b` under the
recorded explicit `gpt-5.6-terra` / high profiles, without subagents or exposed
Desktop runtime telemetry. Deterministic reviewer evidence passed renderer
6/6, runner 7/7, native 34/34, and diff checks. Neither reviewer ran Chromium.

The complete accepted correction batch is:

1. Generate genuine preflight matching from each route's admitted method so
   supported GET auth preflights receive CORS handling; retain counter-neutral
   local fallback behavior and add GET coverage.
2. Parse child stdout as buffered newline-delimited records. Route parsing and
   health-marker failures into the awaited child promise so `finally` always
   owns cleanup, require exactly three ordered snapshots when the passive case
   runs, and test fragmented/coalesced chunks plus disconnect settlement.
3. Render the shared Envoy stream idle timeout exactly once, including
   diagnostic access-log mode.
4. Cancel each passive-update timeout after its race settles so successful
   updates leave no test-owned timer handles.

The style reviewer additionally confirmed distinct identities, idempotency
isolation, and current task status. The performance/reliability reviewer
confirmed the earlier malformed OPTIONS, BigInt bridge, topology lifecycle,
idempotency, and external-abort Cancel corrections on their intended paths.
The batch returns once to the existing implementation context; both lanes must
re-review the final endpoint because the method and parser fixes are
substantive.

## Mechanical Coverage Closure (2026-08-15)

Changed executable native production coverage versus `e2ab42d2` is 8/8 lines
and 2/2 branches. Renderer focused V8 coverage is 100% lines and 90.63%
branches, including every changed route shape. Node's V8 reporter excludes
browser harness modules under `test/`, so it cannot provide analogous per-file
figures for browser entry/runner/harness; focused behavior tests and the
captured 8/8 Chromium acceptance are retained as their evidence. A focused
native test now also covers bounded cancellation rejection after transport
abort. The global coverage threshold remains inapplicable to changed-slice
measurement because it aggregates unchanged monorepo files. The existing
implementer profile is explicit `gpt-5.6-terra` / `medium`; Desktop runtime
telemetry is unavailable. No re-review is requested.

## Accepted Batch Implemented (2026-08-15)

The `b7716b08` batch is implemented test-first: GET auth genuine preflights
match GET and retain terminal local fallback; stream idle timeout occurs once
in both access-log shapes; child stdout is buffered newline-delimited and
health failures reject the awaited child promise; passive runs require exactly
three snapshots; and passive per-update timeouts are cleared after settlement.
Focused tests cover fragmented/coalesced records, health failure, snapshot
cardinality, GET/fallback rendering, and both access-log shapes. Focused
predecessor-plus-C-01 and fresh complete Chromium are green (8/8), followed by
clean process/listener/container state. Relevant re-review lanes may now
inspect this final endpoint; no self-review was performed.

Final affected-lane re-review is dispatched against production endpoint
`fd58c1bd` (baseline `e2ab42d2`) to the already recorded existing
style/maintainability and performance/reliability reviewers, each explicitly
`gpt-5.6-terra` / high, read-only, and forbidden to spawn subagents. Desktop
runtime telemetry remains unavailable.
