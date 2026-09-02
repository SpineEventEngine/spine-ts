# T-0222 Official Repository Workflow

## Scope and acceptance

Classification: high-risk repository-policy and release-mechanics migration. The
sole remote becomes `SpineEventEngine/spine-ts`; future tasks start from
`origin/master` on non-`codex/` feature branches; agents never modify official
`master`, create or merge pull requests, or delete organization refs without
explicit human instruction. Historical records remain historical. The next
unused common package version accompanies this merge-triggered release.

## Review assignments

- Standards: existing style/maintainability reviewer, explicitly dispatched as
  `gpt-5.6-terra` with high reasoning. Read-only; no subagents.
- Specification: existing performance/reliability reviewer, explicitly
  dispatched as `gpt-5.6-terra` with high reasoning. Read-only; no subagents.
- Documentation: existing documentation reviewer, explicitly dispatched as
  `gpt-5.6-luna` with medium reasoning after the correction batch. Read-only;
  no subagents.
- Activation reliability re-review: existing performance/reliability reviewer,
  explicitly dispatched as `gpt-5.6-terra` with high reasoning. Read-only; no
  subagents.
- Activation security review: existing final security reviewer, explicitly
  dispatched as `gpt-5.6-terra` with high reasoning. Read-only; no subagents.

The Desktop dispatch surface exposes the immutable configured role/profile;
runtime self-introspection may be unavailable and is not required by the model
allocation acceptance gate.

## Evidence

- Baseline: official `origin/master@f85d817d2`.
- Version-only commit: `e050342b5`, pushed to the official feature branch.
- Internal-pin and lockfile commit: `c54745d97`, pushed separately.
- Proto metadata and current-version correction: `cd5566d10`, pushed after the
  local preflight exposed stale snapshot.5 generation metadata.
- Limitation: the first two commits were pushed before this durable task record
  was created. Published history is not rewritten; this record makes that
  process error explicit and the remaining work follows the recorded protocol.
- Standards review accepted missing durable records and ambiguous PR actors.
  Specification review accepted `origin/main` precedence, live old-trunk text,
  and 17 broken package README branch links. One correction batch addresses all
  findings before final verification.
- Documentation re-review used the explicitly assigned immutable
  `gpt-5.6-luna` medium role and is clean. It verified the changed official
  branch links with HTTP 200 responses and found no remaining live personal-fork
  or official `/main` link.
- Post-correction `pnpm verify:task --no-tests` passed the full applicable
  preflight, including TypeScript/tooling build, docs/API checks, generated
  cleanliness, 84 package imports, 54 package assets, and 359 relative Markdown
  links. The task is ready for human review after its final commit and push.
- Final affected regression wave passed 35 tests across the Git baseline,
  package metadata, workflow, and release-policy suites. Final formatting,
  diff, and release-readiness checks are clean.
- The official snapshot.5 run published all 18 packages successfully, then
  failed its immediate completeness check while NPM was still propagating the
  new version and tag. Focused TDD now proves bounded retries for only those
  expected propagation states and immediate failure for ambiguous responses.
- Reliability and maintainability review requested command-path retry coverage;
  the accepted correction proves that `verify-registry` retries while
  `preflight` does not. Security review found that attempt count did not bound
  slow per-package reads; the accepted correction shares one five-minute
  deadline across retries and all package reads. A focused test proves an
  active request is aborted at expiry and no later read begins; security
  re-review is clean.
- The first `verify:release` attempt stopped at ESLint because the new default
  timer used an unqualified global; `globalThis.setTimeout` corrected it and
  focused lint plus 35 release tests passed. The rerun reached all 4,547 tests:
  4,545 passed and two stale copyright fixtures still expected `origin/main`.
  Those fixtures now use authoritative `origin/master` and prove fail-closed
  behavior when it is unavailable; their focused 31-test suite passes. The
  final `verify:release` rerun passes all 287 test files and 4,547 tests with
  93.28% statement and 94.44% line coverage. Release readiness confirms 84
  package imports, 54 package assets, and 361 relative Markdown links.
