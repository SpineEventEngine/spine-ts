# T-0213 evidence

## Baseline and generated setup

- Baseline: `main@4c28e2223b89fb203709413400770944778c071c`.
- Frozen installation, Proto generation, and generated TypeScript build passed.
- Random generation-ID metadata byproducts were restored; no generated source
  change belongs to this correction.

## Release-plumbing behavior

- RED: `pnpm exec vitest run scripts/package-metadata.test.mjs` failed while
  `verify:release:generated` retained the deleted broker cross-process path and
  two Vitest invocations.
- GREEN: package metadata passed 11/11; `pnpm check:t0212-removed-routing`
  passed; `pnpm install --frozen-lockfile` passed.
- Todo startup and black-box tests passed 55/55.
- The Todo transport importer is absent from the lockfile; no replacement
  transport or alias was introduced.

## Closure evidence

- A clean read-only cheap preflight passed frozen install, generated/tooling
  builds, 66 focused tests, policy/documentation/format/diff gates, and release
  readiness over 86 package imports, 54 package assets, and 390 Markdown links.
- Current release-plan and capability-matrix language supersedes the deleted
  local-IPC requirement without rewriting its historical record.
- Managed lifecycle passed 58/58; Coordinator/subscription acceptance passed
  116/116; managed Delivery/external-event acceptance passed 4/4.
- The real To-do smoke passed against a live server.
- Fresh container images passed their contract 5/5. One-node Compose passed
  3/3 and the two-node, four-replica distributed topology passed 4/4, with
  clean resource teardown.
- Four focused reviews completed. The accepted current-documentation/guard
  batch passes the removal guard, metadata 11/11, docs audience/snippets/API,
  cleanup, TSDoc, formatting, and diff checks.
- All affected specialist re-reviews pass with no remaining P0-P2 finding.
- First canonical release run passed deterministic gates and 4,267 tests, then
  exposed two direct removal-fallout test assumptions. Their focused correction
  passes 14/14 plus tooling/lint/format/diff checks.
- Second canonical run passed the prior corrections and 4,268 tests, then
  exposed a missing private drain-IPC causal boundary. The exact assertion
  passes under coverage and the full real-process file passes three consecutive
  runs after a test-only acknowledgement; mechanical checks pass.
- Final canonical release verification passes 4,269 tests with 90.35% branch
  coverage; every deterministic release gate passes.
- Post-merge deterministic gates passed; the coverage run exposed one fixed-
  delay child-readiness race after 4,268 passing tests. Its test-only IPC-ready
  correction passes under coverage and three additional runs plus mechanical
  checks.
- Reliability re-review passes that correction. A subsequent global run found
  a compiler-diagnostic timeout; the next exposed simultaneous To-do setup and
  isolated-build timeouts. The migrated failures prove global worker
  contention, not three independent product defects. The release command now
  keeps one coverage run bounded to four workers; its metadata regression is
  retained, and individual timeouts remain unchanged.
- Metadata passes 11/11, the compiler-diagnostic suite passes 16/16 under
  coverage, and the combined process-heavy selection passes 60/60 with four
  workers. Mechanical checks and narrow reliability/documentation re-reviews
  pass.
- Final post-merge `verify:release` passes all deterministic gates, 264 test
  files and 4,269 tests. Coverage passes at 93.89% statements, 90.34% branches,
  93.74% functions, and 95.04% lines. The four-worker global run completes in
  168.04 seconds without the prior contention timeouts.
- The correction is merged and pushed to `main`; only clean merged branch and
  worktree removal remains as repository housekeeping.
