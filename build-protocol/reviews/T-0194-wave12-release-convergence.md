# T-0194 Review Record

Status: COMPLETE

Wave endpoint: `a232191c`. Applicable lanes are all four existing specialist
concerns plus the final security reviewer. The dispatch roles/profiles and
telemetry limitation are frozen in the task brief before review begins.

Corrections return to the existing owning implementation context; deterministic
record-only corrections do not reopen unaffected lanes. One converged
`verify:release` follows review convergence.

Combined preflight is clean at `6886340e`: all deterministic gates, 172
focused Vitest passes, 14 browser/topology passes, and accepted changed-source
coverage inputs are ready for review. Generated residue is absent.

## Wave-wide Review Result

- TypeScript/API, style/maintainability, and documentation are clean.
- Performance/reliability confirmed one P1: MySQL and Datastore validate lease
  currency before an awaited Inbox read but do not recheck the same locked
  session immediately before delete/commit. Expiry during the read can permit a
  stale-owner deletion.
- Final security confirmed one in-scope Medium: `candidateLimit` accepts any
  positive safe integer, allowing an arbitrarily large provider/materialization
  budget. Wave 12 must cap it at the documented framework maximum.
- Final security confirmed one in-scope Low: browser failure capture retains
  full URLs and credential-bearing request headers. Diagnostics must use a
  path-only URL and a non-sensitive header allowlist.
- Production `brace-expansion` and `uuid` advisories are confirmed and retained
  for the binding Wave 17 dependency-hygiene milestone. Updating dependencies
  in Wave 12 would violate the human-imposed Wave order; this is an explicit
  deferred security disposition, not a clean audit claim.

## Correction Dispatch

- Inbox lease recheck: existing `implementer`, explicit `gpt-5.6-terra` /
  medium, no subagents; owns only provider cleanup/tests and its correction
  record.
- Query hard cap: existing `implementer`, explicit `gpt-5.6-terra` / medium,
  no subagents; owns query policy/execution/provider tests and affected docs.
- Browser diagnostics: existing `implementer`, explicit `gpt-5.6-terra` /
  medium, no subagents; owns only browser acceptance diagnostics/tests.
- The three correction worktrees branch from frozen `b1b0b023`, have
  non-overlapping ownership, and push every checkpoint. Runtime telemetry is
  unavailable; configured profiles are the durable record.
- Re-review only performance/reliability and security, plus TypeScript/API or
  documentation if the query cap changes a public/current claim.

## Correction Convergence

- Converged correction endpoint: `fc88a494` on the pushed integration branch.
- Browser diagnostics retain only a path-only request location and a bounded
  non-sensitive header allowlist. The focused browser correction and tooling
  typecheck pass.
- The normalized candidate budget rejects values above 10,000 before provider
  access while admitting the exact 10,000 boundary. The focused policy suite
  passes 11 tests; scoped coverage is 97.76% lines and 96.85% branches, with
  both arms of the new maximum check executed.
- MySQL and Datastore recheck the same locked ownership session after the Inbox
  read and immediately before mutation/commit. Focused deterministic provider
  tests pass 20 cases. Separate live MySQL and Datastore runs each pass both
  provider cases and their native physical-row assertions.
- The converged deterministic preflight passes 221 tests with four expected
  service-gated skips and 25 browser runner/Envoy/harness/native-topology tests.
  Build and tooling typechecks, cleanup, TSDoc, API/audience, formatting, and
  diff gates pass. Diff-scoped executable correction lines and branch arms are
  fully exercised; live runtime/provider evidence remains separate.
- Affected re-review lanes are performance/reliability, final security,
  documentation, and TypeScript/API. Style/maintainability remains closed
  because the correction batch does not restructure the implementation.

## Final Re-review Acceptance

- Accepted pushed endpoint: `746b00e8`.
- Performance/reliability is clean. MySQL rolls back when the locked lease
  expires during the awaited delete; Datastore performs the symmetric
  post-mutation precommit check. Query candidates remain bounded, and memory
  preserves its `candidateLimit + 1` overflow sentinel before local ordering.
- TypeScript/API is clean. The public candidate budget is a positive safe
  integer with default and inclusive maximum 10,000; the optional Inbox removal
  contract remains source-compatible; the cleanup SPI remains internal-only.
- Documentation is clean. User and provider references distinguish the
  accepted 10,000 maximum from MySQL's 10,001 and Datastore's 1,001 raw probes,
  and retain all Wave 12 scope/exclusion constraints.
- Final security is accepted with `brace-expansion` and `uuid` production
  advisories explicitly deferred to the binding Wave 17 dependency-hygiene
  milestone. No new immediate exploit was identified. Browser diagnostic
  capture no longer retains raw console errors, credential-bearing headers, or
  full/query-bearing URLs.
- Final focused evidence passes 224 runtime tests with four expected live
  provider skips, 25 browser topology tests, and the affected re-review suites
  (139 reliability, 77 security, 65 TypeScript/API). Style remains accepted
  from the complete review wave because no subsequent correction restructured
  production code.
- Final live runtime evidence is separately green. Real Chromium passes all
  nine acceptance cases through Vite, Envoy, Gateway, and the native service;
  the passive viewer retains one healthy binding/stream across three distinct
  writer updates and forced disconnect cleanup. Live MySQL 8.4 passes the
  production normalized-plan case and both Inbox cases. The separate Datastore
  emulator window passes both normalized-plan/tenant-group cases and both Inbox
  cases. Native physical-row/key assertions pass, all windows are released,
  and no broad provider cleanup ran.

## Release-suite integration correction

- The restarted release profile cleared every deterministic gate, then exposed
  42 server integration failures. Same-drain cleanup correctly removed eligible
  delivered rows before local Inbox handoff code could reread them as completion
  evidence.
- The correction introduces an internal direct-drain result that records exact
  durable acknowledgement, keyed by the complete message ID including shard.
  Local Entity and Projection handoffs keep only bounded in-flight acknowledgement
  state and restrict opportunistic backlog work to labels and target types they
  own. Exact received rows remain eligible so missing-target and malformed-row
  containment behavior is unchanged.
- Rejection publication is deferred until the outer command drain releases its
  shard. This prevents a nested Projection handoff from persisting a row and
  immediately losing the same shard lease while the command callback is active.
- Regression evidence covers structural acknowledgement after physical cleanup,
  refusal to infer target success from aggregate counters, exact target failure,
  protected `keepUntil`, skipped-owner retry, cross-family isolation, and the
  rejection-event handoff. The affected context/repository suites pass 359/359;
  the expanded delivery/context/repository selection passes 636 tests with four
  service-gated skips.
- Diff-scoped coverage against `96501a07` is 83/83 executable lines (100%) and
  56/61 branches (91.80%). Performance/reliability and TypeScript/API re-review
  are required before the release profile restarts.

### Release-correction re-review assignment

- Frozen pushed endpoint: `b3407245`.
- Existing `performance_reliability_reviewer`, explicitly configured
  `gpt-5.6-terra` / high, reviews acknowledgement identity, bounded in-flight
  state, concurrent batch/single handoffs, shard ownership, post-release
  follow-up ordering, and cleanup lifecycle. No subagents.
- Existing `typescript_api_docs_reviewer`, explicitly configured
  `gpt-5.6-terra` / high, reviews internal/public surface placement, structural
  compatibility, return contracts, TSDoc, and generated API exposure. No
  subagents.
- Runtime telemetry is unavailable on this surface; the immutable configured
  role/profile and this limitation are the durable acceptance record.
- Documentation is N/A because the correction changes no user-facing behavior
  claim; it makes the already documented cleanup and local handoff behavior
  coexist. Style/maintainability is reopened only if either affected reviewer
  finds substantive structural complexity. Final security remains accepted:
  this correction adds no external input, trust-boundary, credential, or
  destructive-provider behavior.

### Release-correction acceptance

- Performance/reliability is clean at `b3407245`: exact acknowledgement follows
  durable marking, uses full message and shard identity, retains bounded state,
  and releases that state on every handoff completion path. Target filters and
  post-release rejection follow-ups preserve shard ownership and cleanup order.
- TypeScript/API is clean at `b3407245`: the result and callback seams are
  internal, generated declarations match runtime signatures, and no root or
  package export changes.
- Mechanical cleanup consolidated the unchanged identity key into internal
  `InboxHandoff.messageIdKey` at pushed endpoint `b811d724`. Both reviewers
  confirmed the endpoint remains clean; cleanup enforcement and server
  typecheck pass.
- Canonical `verify:task --no-coverage` passes at `b811d724`: generation,
  build/tooling typechecks, repository-wide ESLint and formatting, cleanup,
  TSDoc, copyright, logging containment, API/audience, Proto current-output,
  release readiness, and 636 tests with four expected service-gated skips.
- Documentation and style remain accepted under their recorded N/A
  dispositions, and final security remains accepted. The full release profile
  may restart from this converged endpoint.

## Converged Release Verification

- The single converged `pnpm verify:release` completed successfully at pushed
  endpoint `03d89e76` after every specialist and security disposition was
  accepted.
- All 256 executable test files passed; four service-gated files were skipped.
  The suite reports 4,172 passing tests and 19 expected skips.
- Repository-wide V8 coverage is 94.14% statements, 90.49% branches, 94.02%
  functions, and 95.21% lines. Live browser, MySQL, and Datastore evidence
  remains recorded separately from this accounting.
- Generated-source, build/tooling typecheck, repository-wide ESLint, cleanup,
  TSDoc, copyright, formatting, API/audience/snippet, Proto, logging, and
  release-readiness gates all passed. Integration and post-merge closure remain.

## Integration Closure

- Fresh fetch confirmed `origin/main` at `e2ab42d2`; every other remote branch
  was an ancestor of the accepted Wave endpoint before integration.
- Isolated merge `f06f87d2` has the exact tree of release-verified endpoint
  `05af3dd1`. Generated/build prerequisites, server typecheck,
  release-readiness, diff integrity, and the affected post-merge runtime slice
  pass with 416 tests and four expected provider-gated skips.
- The final documentation-only closure commit marks Wave 12 complete and Wave
  13 next. Remote branch/tag and disposable-provider cleanup follows the push
  and is recorded in the final work log.

## Remote And Resource Closure

- After `main` was pushed, every remaining remote feature branch was again
  proven to be an ancestor of `origin/main` and deleted. The final remote audit
  exposes exactly `refs/heads/main` and no tags.
- The dedicated `spine-wave12-mysql` MySQL 8.4 container was stopped and
  removed. The verified `spine-wave12` Datastore emulator parent was terminated
  normally, its Java child exited, and listener 127.0.0.1:8081 was released.
- No protected primary-checkout content was staged, edited, stashed, or removed.
