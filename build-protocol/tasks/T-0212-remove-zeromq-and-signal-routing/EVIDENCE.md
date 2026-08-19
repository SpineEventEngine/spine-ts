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

## Review-ready verification

- Canonical task verifier (terminal exit 0):
  - generated TypeScript build and tooling typecheck;
  - cleanup, TSDoc, copyright, logging-containment, and formatting gates;
  - documentation audience/API inventory, Buf, generated-output, and
    release-readiness gates;
  - 33 test files and 557/557 tests.
- Serialized process-heavy acceptance:
  - `managed-server-application.test.ts`: 58/58;
  - managed external-event and remote-Delivery readiness fixtures: 4/4.
- Total retained test evidence at review handoff: 619/619.
- `pnpm check:t0212-removed-routing` passed after the final verifier.
- A fresh dependency audit found no `zeromq` or `ZeroMQ` reference in the root
  manifest, lockfile, workspace manifest, or transport package manifest.
- Coverage over `server.ts` and `server-environment.ts` passed 212/212 tests.
  Whole-file coverage was 94.38% lines and 89.68% branches. The exact added
  executable intersection at `server.ts` lines 507–509 was 3/3 lines and 5/5
  branch outcomes (100%); all other runtime changes are deletions,
  declarations, or error-text cleanup.
- The review-ready checkpoint worktree was clean.
