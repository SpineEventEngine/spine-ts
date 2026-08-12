# T-0176: Wave 10 Documentation And Release Convergence

Status: Convergence starting

## Objective

Reconcile the complete Wave 10 reader-document ledger, remove only integration
contradictions, verify every snippet/link/license contract, review the integrated
result, and run one final release profile before closing Wave 10.

## Classification

High-risk release convergence: all current reader documentation, shared snippet
and copyright gates, generated builds, packages, and release tests are evaluated
together. This task is not a new rewrite or feature task.

## Human-Imposed Requirements Ledger

- Reconcile all 64 current reader-facing Markdown paths from the Wave 10
  ownership table. Every path has exactly one final `changed` or
  `reviewed-no-change` disposition.
- Fix only cross-family contradictions, broken handoffs, strict-snippet issues,
  and release defects discovered at integration. Do not start another general
  rewrite or add runtime behavior.
- Preserve the beginner guide, README look/feel, natural prose, canonical
  reference layering, and reduced needless “own” wording.
- Enforce absence from active reader guidance of `routeSemantic`, `@Route`, and
  TypeScript routing via `(is).java_type`/`(every_is).java_type`; preserve frozen
  Proto definitions only as wire history.
- Preserve single-Gateway/fixed-topology scope. Multiple-Gateway remains
  deferred; Cloud Run remains outside the offering.
- Preserve exact copyright/license policy and the default strict TypeScript
  snippet inventory. Third-party/frozen sources retain upstream headers.
- Run one complete relevant review wave, one consolidated correction batch, and
  one converged `verify:release` after cheap preflight.
- Push all commits and final `origin/main`; do not publish to any upstream remote.

## Assignment And Reviews

- Convergence implementation/mechanical verification: root orchestrator;
  production behavior is not in scope.
- Documentation: existing immutable `documentation_reviewer`, configured
  `gpt-5.6-luna` / medium.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / high.
- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / high, because shared checker/license tooling is part of the
  integrated release surface.
- Security: N/A unless convergence changes a trust boundary. Secret-safe auth
  and logging facts are cross-checked by documentation/API review.

Runtime metadata is recorded when exposed; otherwise immutable configured roles
and explicit profiles are accepted unless a mismatch or fallback is reported.

## Verification

Cheap preflight: generation/build, strict snippets, API/audience, copyright,
TSDoc/cleanup/logging containment, links, formatting, diff, ledger and retired
API/scope scans. After review convergence, run `pnpm verify:release` once.
