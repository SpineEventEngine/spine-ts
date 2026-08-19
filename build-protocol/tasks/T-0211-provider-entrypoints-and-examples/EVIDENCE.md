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
