# Release verification attempt 4 result

Date: 2026-10-14

Branch: `sql-delivery-subscription-reliability`

HEAD: `6ee3272d8747d3ed9a6603f9c72958759edf76d4`

Tree: `231992192ccb7bf0c366ca874df7f80361650bc6`

Lockfile blob: `d4c4186a5d53b300883b89826df05578f4144c16`

Lockfile SHA-256: `208f8a77f22da9858c4d143f50b43de09f81036ef065c1d87d7b6ea8d97ffcd3`

The deterministic preflight passed; see [preflight-5.md](preflight-5.md) and [preflight-5.log](preflight-5.log). The one `pnpm verify:release` invocation then exited 1. Its exact output and exit marker are [verify-release-4.log](verify-release-4.log) and [verify-release-4.exit](verify-release-4.exit). Vitest reported 17 failed, 303 passed, and 1 skipped test file; 37 failed, 5,320 passed, and 3 skipped tests (5,360 total). One unhandled rejection was reported. No global coverage summary or coverage artifacts were produced, so global coverage is unavailable for this attempt.

The temporary directory for this run was inside the worktree's `node_modules/.cache/sql-delivery-runtime-tmp`. That placement was a verification setup mistake: Node 24.18.0 refuses TypeScript type stripping for `.ts` files under any `node_modules` path. Future ephemeral test directories are assigned to the worktree's `.worktrees/sql-delivery-tmp`, outside `node_modules`; persistent browser tooling cache remains under `node_modules`. This classification does not establish that every failure below is environmental or that all tooling failures are resolved.

## Failures strongly attributable to temporary-directory placement

- `scripts/proto-workflow.test.mjs` — clean proto-tools bootstrap failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` while loading the cloned repository's `packages/proto-tools/src/generation/rejection-generator.ts` under `node_modules/.cache/sql-delivery-runtime-tmp`.
- `packages/core/test/time.test.ts` — dependency-free import check failed with the same Node error for its temporary `time.ts` under that path.
- `packages/proto-tools/test/package-bin.test.ts` — isolated clean build failed with the same Node error in the staged proto-tools source under that path.
- `packages/proto-tools/test/proto-tools.test.ts` — two temporary model checks failed with TypeScript `TS5112` because `tsconfig.json` was discovered while files were passed on the command line. Their temporary model directories were created under the mislocated TMPDIR.

## Possible or uncertain temporary-path effects

- `packages/proto-tools/test/external-consumer.test.ts` — isolated-tree assertion expected `node_modules/@bufbuild` not to resolve beneath the repository root, but it did. The staged directory was under the repository's `node_modules` tree, so the path placement plausibly invalidated this isolation assertion; it is classified as likely environmental, not confirmed.
- `packages/proto-tools/test/generated-registry-writer.test.ts` — two isolated declaration compilations could not resolve `@spine-event-engine/server/spi/handler-registry`. The evidence does not establish whether the temporary path caused the resolution failure; classification remains uncertain.
- `scripts/normalize-generated-declarations.test.mjs` — the CLI returned status 1 where 0 was expected. The captured assertion did not include the child process diagnostic, so the cause is unknown.
- `packages/client-web/test/client.iterator-return.test.ts` — all four iterator disposal/cancellation cases timed out at 15 seconds. No direct TMPDIR link is shown; cause remains uncertain.
- `examples/todo/test/black-box.test.ts` — the exact subscribed task scenario did not observe a task-list projection update. No direct TMPDIR link is shown; cause remains uncertain.
- `packages/delivery-client/test/managed-remote-delivery-readiness.integration.test.ts` — RED-28 failed with ConnectError `[internal] internal error`; the same rejection was reported as unhandled. Cause remains uncertain.

## Remaining exact assertion failures

- `scripts/check-api-docs.test.mjs` — provider export inventory mismatch. Expected exports missing from actual inventory: `CleanupOperation`, `cleanupOperationActive`, `DeliveryCleanupInput`, `DeliveryCleanupStorage`, `DeliveryCleanupStorageFactories`, `DeliveryCleanupStorageFactory`, `eventStoreAccess`. Actual inventory additionally contained `EntityCommitSnapshots`.
- `scripts/clean-build-outputs.test.mjs` — root build references `packages/server-blackbox-tests/dist`, but `buildOutputPaths` does not include it.
- `scripts/package-boundary-policy.test.mjs`, synthetic fixture case — expected seven sibling-package source-tree reach diagnostics, received none. The expected paths are `packages/consumer/filename-only.spec.ts`, `packages/consumer/test-fixtures/app.ts`, `dynamic-import.ts`, `export-from.ts`, `import-equals.ts`, `require.cjs`, and `url.ts`, each reaching `packages/sibling/src/api.ts`.
- `scripts/package-boundary-policy.test.mjs`, repository case — expected no reaches, received six: `packages/delivery-client/test/remote-inbox-paging.integration.test.ts` reaches `packages/delivery-server/src/index.ts` and generated `project_events_pb.ts` and `project_workflow_pb.ts`; `packages/server-blackbox-tests/test-fixtures/project-subscription-transport.mjs` reaches `packages/client-node/dist/index.js`, `packages/client-web/dist/index.js`, and `packages/server/dist/server/node-coordinator.js`.
- `packages/proto/test/module.test.ts` — manifest expected 50 canonical Proto source files, actual count was 51.
- `packages/server/test/context/entity-inbox.test.ts`, nine failures:
  - Line 311: expected the batch drain to resolve with two results; it rejected with `first drain failed`.
  - Line 673: expected `undefined`; received `Error: batch replay failed`.
  - Line 1306: expected only the received row; read also returned an unrelated backlog row.
  - Line 1340: expected resolution; received `Error: target failed`.
  - Line 1372: expected resolution; received `Error: Entity Inbox replay failed.`
  - Line 1497: expected resolution; received no-handler error for inbox label `UPDATE_SUBSCRIBER`.
  - Line 1527: expected resolution without replaying an unconfigured event label; received `unconfigured event label should not replay`.
  - Line 1557: expected resolution for a shard outside the configured endpoint; received `non-configured shard should preserve drain failure`.
  - Line 1583: expected resolution for a missing process-manager target; received no Entity Inbox target error for `type.example.dev/Tasks.ProcessManager`.
- `packages/server/test/context/projection-handoff.test.ts`, five failures:
  - Line 223: expected `undefined`; received `Error: projection replay failed` while the readiness observer also threw.
  - Line 473: expected first and duplicate results to resolve `undefined`; both received `Error: projection replay failed`.
  - Line 509: expected a persisted `HANDLE_COMMAND` label to resolve; received no-handler error.
  - Line 574: expected a persisted row without a projection target to resolve; received no projection subscriber target error.
  - Line 608: expected a row outside the configured endpoint to resolve; received `non-configured shard should preserve drain failure`.
- `packages/server/test/entity/process-manager-querying.test.ts`, three failures — the cyclic, too-deep (maximum depth 64), and too-wide (maximum node count 10,000) predicate cases expected rejection handling before storage reads, but `TypeError` escaped from entity query compilation through the process-manager replay path.

The assertion failures not explicitly classified as TMPDIR-caused should be triaged as behavior or harness failures; this record does not attribute them to a cause beyond the evidence above. This run did not replay SQL-container matrices or start additional services.
