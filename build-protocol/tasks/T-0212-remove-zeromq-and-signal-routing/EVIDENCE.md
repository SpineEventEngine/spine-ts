# T-0212 evidence

Evidence will be appended after retained RED-30, implementation checkpoints,
deterministic preflight, reviews, isolated integration, and post-merge proof.

## RED-30

- `pnpm check:t0212-removed-routing` exited 1 before deletion, listing the
  removed paths and live package/runtime/documentation references. The initial
  guard implementation was corrected after an EISDIR harness error, then failed
  for the intended behavior condition.

## Checkpoint limitation

- `pnpm install --lockfile-only` refreshed dependency resolution but exited
  nonzero with `ERR_PNPM_IGNORED_BUILDS` for `zeromq@6.5.0`; it is not
  acceptance evidence and needs removal/audit during convergence.

## Retained behavior and convergence

- `pnpm exec vitest run packages/server/test/server/server.test.ts packages/transport/test/memory/message-transport.test.ts`
  passed 126 tests.
- `pnpm check:t0212-removed-routing` passed after deleting current source,
  package, test, fixture, export, and normative-document references.
