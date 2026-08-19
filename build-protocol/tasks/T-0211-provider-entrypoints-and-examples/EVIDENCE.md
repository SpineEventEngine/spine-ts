# T-0211 evidence

## Provider lane checkpoint — 2026-08-19

- RED: `pnpm exec vitest run packages/deployment-gce/test/terraform-policy.test.ts
  packages/deployment-gke/test/terraform-policy.test.ts --reporter=verbose`
  failed in five required places before the product changes: no managed
  entrypoint, no explicit settings, and the old GKE Service target.
- GREEN: the same policy suite passed 20/20 after implementation; the complete
  provider suite then passed **107/107** in 15 files.
- `pnpm proto:generate && pnpm typecheck:build:generated` passed. The generation
  command refreshed unrelated opaque generation IDs; those changes were removed
  before this checkpoint.
- `pnpm typecheck:tooling` and the four provider documentation snippet checks
  passed.
- `terraform -chdir=packages/deployment-gce/terraform fmt -check` and the GKE
  equivalent passed.
- Scoped changed-entrypoint coverage passed the required threshold: **94.50%
  statements, 90.00% branches, 95.65% functions, 98.78% lines**.

## Provider review-correction checkpoint — 2026-08-19

- Consolidated API and performance/reliability review corrections were applied
  by the existing implementation owner. Reviewer profiles: `gpt-5.6-terra` /
  `high`; runtime telemetry unavailable.
- Retained REDs proved the old GKE readiness port mismatch, omitted partial
  registrar rollback, and competing inner signal listener. GREEN proofs cover
  the Coordinator probe, `start → withdraw → managed → registry` rollback, and
  simulated `SIGTERM` outer-path ordering.
- Fresh post-correction provider suite: **114/114** tests in 15 files;
  typecheck build/tooling, documentation snippets, Terraform formatting, and
  diff check passed.
- The changed GCE entrypoint itself is above the required line and branch gate:
  **96.38% statements, 90.24% branches, 95.00% functions, 100.00% lines**.
- `pnpm lint:generated` passed after the final tooling typecheck.
