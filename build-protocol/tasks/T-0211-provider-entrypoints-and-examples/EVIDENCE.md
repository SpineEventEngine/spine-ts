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
