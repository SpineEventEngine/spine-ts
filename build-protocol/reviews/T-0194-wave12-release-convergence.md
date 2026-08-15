# T-0194 Review Record

Status: ACCEPTED

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
