# T-0197c Work Log

## 2026-08-16 — harness acceptance

1. Inspected the accepted T-0196 RED-22 parent and child fixture and the Wave
   13 plan. The fixture has two distinct `fork()` children, distinct bounded
   context names, a shared configured ZeroMQ adapter identity/directory,
   generated-registry version 3, normal domestic producer posting, and full
   downstream Event evidence.
2. Installed the lockfile-resolved, untracked workspace dependencies in this
   isolated worktree. The first test invocation could not run because that
   state was absent (`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`); no repository files
   were changed by the install.
3. Ran the prescribed generated build to supply local runtime outputs. An
   initial direct `tsc -b` was invalid before generation and failed on missing
   generated sources; `pnpm proto:generate && pnpm typecheck:build:generated`
   succeeded. Its only tracked byproducts were volatile generation IDs, which
   were restored immediately.
4. The focused RED-22 run then failed at the exact intended missing factory
   contract. Node syntax, focused Prettier, and whitespace diff checks passed.
5. Completed a source-level shortcut audit. Neither fixture publishes an
   `ExternalMessage`, references `ContextTransport`, or implements an event
   forwarder; the producer's only event production is its application
   `context.eventBus().post()`.

No product or fixture code was changed. The task closes the behavior-first
harness readiness, not the later product-green acceptance.
