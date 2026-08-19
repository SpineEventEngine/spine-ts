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
  **97.10% statements, 94.28% branches, 94.11% functions, 100.00% lines**.
- `pnpm lint:generated` passed after the final tooling typecheck.

## Provider caller-owned lifecycle handoff — 2026-08-19

- Merged runtime prerequisite `origin/codex/t0211-runtime-prereq@ddd78fe81`.
  GCE now calls `ManagedServerApplication.start()` and never sweeps process
  listeners. Its provider-owned outer handlers are the only handlers it later
  removes.
- Retained provider proof: an unrelated `SIGTERM` listener remains installed
  through GCE startup, simulated graceful signal shutdown, and outer-handle
  close. The managed coordinator itself owns no signals on this path.
  Evidence will be appended after retained REDs, implementation checkpoints,
  real deployment smoke, reviews, integration, and remote cleanup.

## Managed Message Board checkpoint

- RED: `pnpm vitest run examples/message-board/app/test/deployment-entrypoints.test.ts --reporter=dot`
  failed at the new managed-entrypoint assertion because `managed-entry.ts` did
  not exist.
- GREEN: the same command passed 8/8 after the managed entrypoint and explicit
  configuration were added.
- Build: `pnpm typecheck:build` completed with the managed Message Board source
  emitted. Proto-generation identifier churn was reverted because it was not
  part of this task.

## Example topology and Todo checkpoint

- RED: the changed Compose/Kubernetes topology tests failed because the
  manifests still named individual application listeners and configured IPC.
- GREEN: `pnpm exec node --test examples/message-board/deploy/compose/topology.test.mjs examples/distributed-message-board/test/topology.test.mjs examples/message-board/deploy/kubernetes/manifests.test.mjs`
  passed 11/11 after the managed-node conversion.
- RED: `pnpm vitest run examples/todo/test/startup-contract.test.ts --reporter=dot`
  failed because `examples/todo/src/managed-entry.ts` did not exist.
- GREEN: the same command passed 8/8 after the entry used Datastore storage,
  RemoteDelivery, and explicit process/shard settings.
- Focused combined verification passed: Message Board deployment/configuration
  and Todo startup suites 36/36, plus the 11 Compose/Kubernetes topology tests.
- `pnpm images:build:local` rebuilt the local Message Board, Gateway, and
  Delivery images with the managed entrypoint. The live Docker container
  contract was launched twice against that image; all test processes and
  `spine-t0095`/`spine-t0096` containers cleaned up. This execution surface did
  not return the completed TAP status after its 30-second yield, so this is
  recorded as attempted live evidence rather than a passing assertion.

## Managed configuration coverage correction

- The focused V8 command with an include set limited to changed configuration
  modules passed 37/37 and measured 94.2% lines and 94% branches:
  `pnpm vitest run --coverage --coverage.include='examples/message-board/app/src/deployment-config.ts' --coverage.include='examples/todo/src/managed-deployment.ts' examples/message-board/app/test/deployment-config.test.ts examples/todo/test/startup-contract.test.ts`.
- The static deployment gate passed 11/11 and the combined Message Board/Todo
  focused suites passed 45/45 after the configuration extraction.

## Deferred managed-node smoke

- The retained live command is:
  `script -q -e /tmp/t0211-image-contract.log pnpm exec node --test examples/message-board/deploy/container/image-contract.test.mjs`.
  It captures the terminal TAP result while exercising the real image, managed
  Coordinator, Datastore emulator, Delivery server, browser Gateway, and clean
  shutdown. It is deferred only until the runtime removes the obsolete required
  Production signal transport; the current captured failure is the exact
  `Production ServerEnvironment requires transport.` error, not an example
  configuration workaround opportunity.
- RED-31 retained local proof: `pnpm vitest run examples/message-board/app/test/local-entry.test.ts --reporter=dot`
  passed 2/2. It starts the explicit local single-process entry, accepts both
  termination signals, and proves port release independently of managed mode.
- `pnpm docs:check`, `pnpm format:check`, and `git diff --check` completed
  cleanly after the source/documentation changes.

## Managed replica registry correction

- The first post-runtime container smoke reached managed child assembly and
  failed with the framework's deliberate guard requiring an
  `InMemorySubscriptionRegistry`. The durable client-subscription authority
  remains the Gateway; this registry is the existing volatile per-child
  runtime facility required by `ManagedServerApplication`.
- RED: the managed-entrypoint contract required that existing registry and
  failed before the entry supplied it. GREEN: Message Board deployment and
  configuration tests passed 32/32 and `pnpm typecheck:build` passed after the
  child supplied `new InMemorySubscriptionRegistry()` to its Bounded Context.

## Converged managed-container acceptance

- `script -q -e /tmp/t0211-image-contract-artifact-20260819.log pnpm exec node --test examples/message-board/deploy/container/image-contract.test.mjs`
  passed 5/5 after a clean emitted-artifact check confirmed the local image
  contains the emulator-aware logging branch. It exercises real managed
  Coordinator startup, Gateway forwarding, command/query/subscription/Delivery
  behavior, and PID-1 shutdown.
- Final focused suites passed 47/47; Compose/Kubernetes topology checks passed
  11/11; changed configuration coverage passed 38/38 at 92.75% lines and
  90.74% branches. Replacement deployment paths contain no retired IPC or
  ZeroMQ configuration.

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
