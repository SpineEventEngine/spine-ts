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
- Retained REDs proved the old GKE readiness port mismatch and omitted partial
  registrar rollback. GREEN proofs cover the Coordinator probe,
  `start → withdraw → managed → registry` rollback, and simulated `SIGTERM`
  outer-path ordering while preserving an unrelated listener.
- Fresh post-correction provider suite: **114/114** tests in 15 files;
  typecheck build/tooling, documentation snippets, Terraform formatting, and
  diff check passed.
- The changed GCE entrypoint itself is above the required line and branch gate:
  **96.38% statements, 90.24% branches, 95.00% functions, 100.00% lines**.
- `pnpm lint:generated` passed after the final tooling typecheck.
Evidence will be appended after retained REDs, implementation checkpoints,
real deployment smoke, reviews, integration, and remote cleanup.

## Runtime prerequisite checkpoint

| Evidence                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED — `pnpm exec vitest run packages/server/test/server/server-environment-singleton.test.ts packages/server/test/server/managed-external-events.integration.test.ts` before product changes | Production environment expectation failed exactly with `Production ServerEnvironment requires transport.` The managed fixture could not load before Todo build output existed; that setup failure is separate from the retained runtime RED.                                                                                                                                                                                            |
| Generated build plus focused lifecycle suite                                                                                                                                                 | `pnpm typecheck:build:generated && pnpm typecheck:tooling && pnpm exec vitest run packages/server/test/server/server-environment-singleton.test.ts packages/server/test/server/server-context-transport-lifecycle.test.ts packages/server/test/server/server-lifecycle-integration.test.ts packages/server/test/server/server.test.ts packages/server/test/server/managed-external-events.integration.test.ts` exited 0: 195/195 tests. |
| Real managed Production child                                                                                                                                                                | `pnpm typecheck:build:generated && pnpm exec vitest run packages/server/test/server/managed-external-events.integration.test.ts` exited 0: 2/2 tests. The child had storage/type registry/remote Delivery but no legacy generic signal transport.                                                                                                                                                                                       |

The Production warning about volatile in-memory managed-child subscription
registries is expected for the accepted Gateway-owned registry design.

Focused source coverage over `server-environment.ts` and `server.ts` executes
the same 195 tests. Its whole-file branch total is 81.22% because those mature
modules have unrelated historical branches; the exact
`origin/main...working-tree` changed executable intersection is **5/5 lines**
and **4/4 branches** (100% each), with no coverage exclusion.

## Managed caller-owned lifecycle checkpoint

| Evidence | Result                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RED      | Caller-owned managed startup retained an unexpected managed `SIGINT` listener.                                                                                                                                                                                                                               |
| GREEN    | `pnpm exec vitest run packages/server/test/server/managed-server-application.test.ts` exited 0: 57/57. The caller-owned path installs no managed signal handlers and explicit close succeeds; run-owned shutdown removes only its own handlers and preserves an unrelated listener installed during startup. |

Focused source coverage for `managed-server-application.ts` is 93.80%
statements, 92.02% branches, and 96.68% lines. Its exact
`a67daeb9b...working-tree` changed executable intersection is **10/11 lines**
(90.91%) and **4/4 branches** (100%).
