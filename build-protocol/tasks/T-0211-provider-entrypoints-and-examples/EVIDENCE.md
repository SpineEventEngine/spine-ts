# T-0211 evidence

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
