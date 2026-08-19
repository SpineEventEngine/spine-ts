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

## Post-review verification

- All specialist concerns converged with no remaining P0–P2 findings:
  style/maintainability, TypeScript/API documentation, documentation
  completeness, and performance/reliability pass. The security threat-model
  reconciliation remains explicitly assigned to T-0213.
- Final canonical task verifier exited zero after passing generated build,
  tooling typecheck, repository lint/policy/documentation/release-readiness
  gates, and 33 files with 562/562 tests.
- Serialized process-heavy acceptance passed after the canonical verifier:
  - managed lifecycle: 58/58;
  - real managed external-event and remote-Delivery readiness: 4/4.
- Final retained acceptance total: 624/624 tests.
- The strengthened RED-30 guard passed. A fresh manifest/lock/workspace audit
  found no ZeroMQ dependency or package reference.
- The final task branch was clean and all commits were pushed before integration.

## Residual affected-review correction

- `pnpm exec vitest run packages/transport/test/memory/message-transport.test.ts`
  passed 7/7, including delayed accepted publication draining through
  `factory.close()`, idempotent close, and post-close channel rejection.
- `pnpm check:t0212-removed-routing` passed after the guard added explicit
  natural-language deleted-setting checks over current normative documents;
  broad history remains excluded so truthful task/review records are retained.
- Terminal affected gates:
  - `pnpm typecheck:tooling` passed.
  - `pnpm docs:audience:check`, `pnpm docs:snippets:check:generated`, and
    `pnpm docs:api:check` passed; the API inventory retained all seven
    transport exports.
  - `pnpm lint:tsdoc`, `pnpm lint:cleanup`, `pnpm format:check`, targeted
    Prettier, and `git diff --check` passed.
- This correction is affected re-review-ready only. It changes no runtime
  behavior and leaves threat-model redesign explicitly to T-0213.

## Final narrow TSDoc correction

- `pnpm lint:tsdoc`, `pnpm typecheck:tooling`, and
  `pnpm exec vitest run packages/server/test/server/server-lifecycle-integration.test.ts`
  passed; the lifecycle suite passed 51/51.
- Targeted Prettier and `git diff --check` passed. The change is wording-only,
  so no additional runtime acceptance profile was required.

## Post-review verifier correction

- The full verifier's only failure was ESLint `no-invalid-void-type` at the two
  retained test deferred declarations. Exact-file ESLint, `pnpm typecheck:tooling`,
  the in-memory message-channel test (7/7), targeted Prettier, and
  `git diff --check` pass after the mechanical `undefined` correction.

## Post-merge acceptance

- Merge commit: `4ad39ef0c1e0af2e419246b0e44b729dadb69846`.
- `pnpm typecheck:build:generated` passed on merged `main`.
- `pnpm check:t0212-removed-routing` passed after removing only confirmed
  ignored stale TypeDoc/coverage artifacts from the integration worktree.
- Merged ordinary retained matrix: 33 files, 562/562 tests.
- Merged serialized process acceptance:
  - managed lifecycle: 58/58;
  - real managed external-event and remote-Delivery readiness: 4/4.
- Post-merge retained total: 624/624 tests. The tracked worktree was clean
  before the closure record commit.
