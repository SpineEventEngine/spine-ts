# T-0194: Wave 12 Release Convergence

Status: COMPLETE

Baseline: `a232191c5ffb7a815a43b1d4380deac83692ee5e`

Risk: high. This task converges browser lifecycle, SQL/provider execution,
atomic durable cleanup, public contracts, documentation, security, release
verification, integration, and remote state.

## Objective

Close C-01, X-01, D-01, and the Wave 12 portion of P-04 with one converged
release/security result, durable main integration, post-merge verification, and
an origin containing exactly `main` and no tags.

## Human-Imposed Requirements Ledger

1. The strict review classification is binding: all Wave 12 findings are true;
   S-04 alone is false.
2. Real browser/Gateway, live MySQL, and live Datastore evidence are separate
   from mocks and V8 coverage.
3. Changed executable lines and branches remain at least 90%.
4. Provider-bearing suites run sequentially when sharing databases, emulator,
   ports, generation, or coverage resources.
5. Healthy streams do not terminate after ordinary successive updates;
   best-effort recovery remains for real gaps/disconnects.
6. Admitted MySQL plans use bounded parameterized SQL with tenant/group
   containment; unsupported shapes reject without broad fallback.
7. Delivered cleanup is bounded and current-owner fenced; `keepUntil` is dedup
   protection, not retention configuration.
8. No Wave 13-19 feature or provisional API leaks into Wave 12.
9. `catchUpReadSide()` is not Projection catch-up; cross-context exchange and
   runtime enrichment remain unimplemented.
10. Root README remains repository-entry documentation only.
11. Final security review is mandatory before release verification.
12. Run one converged `pnpm verify:release` only after review convergence.
13. Merge and verify from isolated worktrees; never implement in the primary
    checkout or mutate its protected human review folder.
14. Push every checkpoint. Reconcile unique remote work, delete contained
    completed branches and every tag, then prove origin exposes only `main` and
    no tags.

## Acceptance And Evidence

- Map every finding to retained failing-before and passing-after evidence.
- Run combined cheap preflight before specialist/security review.
- Collect all four specialist concerns as one Wave-wide review and the existing
  final security reviewer. Corrections return to the existing owning context.
- Re-run only substantively affected review lanes.
- Run real Chromium/Envoy/Gateway, live MySQL 8.4, and Datastore emulator
  sequentially; record exact behavior separately from coverage.
- Run exactly one converged `pnpm verify:release` after all corrections.
- Merge integration into `main` in an isolated worktree, perform post-merge
  checks, push `main`, reconcile/delete remote branches and all tags, and stop
  disposable provider resources.

## Review Dispatch

- Documentation: existing `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API: existing `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high.
- Style/maintainability: existing `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high.
- Performance/reliability: existing `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high.
- Security: existing `security_reviewer`, `gpt-5.6-terra` / high.
- All reviews are read-only, concern-specific, and may not spawn subagents.
  Runtime telemetry is unavailable; immutable configured profiles are the
  durable acceptance record.
