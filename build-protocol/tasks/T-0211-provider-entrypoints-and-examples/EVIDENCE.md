# T-0211 evidence

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
