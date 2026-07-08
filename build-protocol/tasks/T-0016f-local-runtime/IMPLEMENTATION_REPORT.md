# T-0016f Implementation Report

Status: DONE

Commit: final review-fix commit

## Summary

Implemented the narrow transport-backed local runtime binding:

- Added `RuntimeTransportBinding` as a grouped server runtime API over a supplied
  `SignalTransport` and supplied `SingleProcessServerRuntime`.
- Registered command routes with request/respond semantics and event routes with
  publish/subscribe semantics from `ServerRuntimeRoutingPlan`.
- Validated generated Spine command/event envelope shape and enclosed
  `message.typeUrl` before runtime intake.
- Review-fix pass now parses accepted generated command/event envelopes into
  clean generated messages before enqueue, refuses command/event accept paths
  once close starts, and makes rejected close attempts retryable after trying
  all registered transport handles.
- Final review-fix pass now renders the `RuntimeTransportBinding.open()`
  local-only scope, validation-before-callback-enqueue, and close-order wording
  on the exported `RuntimeTransportBinding` TypeDoc page.
- Final review-fix pass now tracks per-transport-handle close success during
  binding close retries, so retry attempts only revisit handles that have not
  closed successfully and do not depend on adapter handle idempotence.
- Enqueued accepted command/event callbacks through
  `SingleProcessServerRuntime`.
- Returned an idempotent close handle that closes transport registrations before
  closing the runtime.
- Kept ZeroMQ hidden behind `@spine-ts/transport`; the server API mentions only
  `SignalTransport`.

## Changed Files

- `packages/server/src/runtime/runtime-transport.ts`
- `packages/server/src/index.ts`
- `packages/server/test/runtime/runtime-transport.test.ts`
- `packages/server/test/index.test.ts`
- `scripts/check-api-docs.mjs`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/transport/README.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/work-logs/T-0016f.md`
- `build-protocol/reviews/T-0016f-local-runtime.md`
- `build-protocol/tasks/T-0016f-local-runtime/IMPLEMENTATION_REPORT.md`

## Verification

- Red test:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  initially failed because `RuntimeTransportBinding.plan` was missing.
- Focused runtime binding:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  passed with 1 file and 8 tests.
- Review-fix focused runtime binding:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  passed with 1 file and 11 tests.
- Focused runtime plus local IPC:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime packages/transport/test/zeromq`
  passed natively with 6 files and 47 tests. The same command failed in the
  managed sandbox with ZeroMQ `Operation not permitted`, so live IPC verification
  requires native IPC filesystem/socket permission.
- `pnpm --config.verify-deps-before-run=false typecheck`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing invalid-`origin` TypeDoc source-link warning.
- Native `pnpm --config.verify-deps-before-run=false verify`: passed. Full
  tests passed with 52 files and 868 tests. Coverage passed with 94.92%
  statements, 90.15% branches, 97.68% functions, and 94.91% lines. TypeDoc
  completed with the existing invalid-`origin` source-link warning; API export
  checks passed with 196 server exports; proto lint passed; generated proto
  outputs were confirmed ignored, untracked, and freshly regenerated.
- Review-fix required verification passed:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  with 1 file and 11 tests;
  `pnpm --config.verify-deps-before-run=false typecheck`;
  `pnpm --config.verify-deps-before-run=false lint`;
  `pnpm --config.verify-deps-before-run=false format:check`; and
  `pnpm --config.verify-deps-before-run=false docs:check` with the existing
  invalid-`origin` TypeDoc source-link warning.
- Review-fix broader sandboxed
  `pnpm --config.verify-deps-before-run=false verify` failed only in local
  IPC/loopback tests with ZeroMQ `Operation not permitted` and
  `listen EPERM: operation not permitted 127.0.0.1`; native rerun passed. Plain
  tests passed with 52 files and 871 tests. Coverage passed with 94.78%
  statements, 90.04% branches, 97.70% functions, and 94.77% lines. TypeDoc
  completed with the existing invalid-`origin` source-link warning; API export
  checks passed with 196 server exports; proto lint passed; generated proto
  outputs were confirmed ignored, untracked, and freshly regenerated.
- Final review-fix red test:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  failed before the production change because a non-idempotent event handle that
  had already closed successfully was closed again during retry.
- Final review-fix focused runtime binding:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  passed with 1 file and 11 tests.
- Final review-fix TypeDoc/API docs:
  `pnpm --config.verify-deps-before-run=false docs:check` passed with the
  existing invalid-`origin` TypeDoc source-link warning. A rendered-page grep
  confirmed the new `open()` semantics on
  `docs/api/reference/variables/packages_server_src.RuntimeTransportBinding.html`.
- Final review-fix required checks passed:
  `pnpm --config.verify-deps-before-run=false typecheck`;
  `pnpm --config.verify-deps-before-run=false lint`; and
  `pnpm --config.verify-deps-before-run=false format:check`.
- Final review-fix broad sandboxed
  `pnpm --config.verify-deps-before-run=false verify` failed only in local
  IPC/loopback tests with ZeroMQ `Operation not permitted` and
  `listen EPERM: operation not permitted 127.0.0.1`.
- Final review-fix native `pnpm --config.verify-deps-before-run=false verify`
  passed. Plain tests passed with 52 files and 871 tests. Coverage passed with
  94.78% statements, 90.05% branches, 97.70% functions, and 94.77% lines.
  TypeDoc completed with the existing invalid-`origin` source-link warning; API
  export checks passed with 196 server exports; proto lint passed; generated
  proto outputs were confirmed ignored, untracked, and freshly regenerated.

## Concerns

- Required reviewer lanes are still pending. They were not run in this
  implementation pass because the user explicitly instructed this sub-agent not
  to spawn sub-agents.
- No production ZeroMQ `SignalTransport` adapter was added. Runtime binding
  tests use the public `SignalTransport` contract; existing adapter-private
  ZeroMQ tests remain the local IPC smoke proof for this slice.
