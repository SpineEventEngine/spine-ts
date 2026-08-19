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
