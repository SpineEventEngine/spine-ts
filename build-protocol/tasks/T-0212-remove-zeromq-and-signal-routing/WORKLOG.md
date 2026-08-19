# T-0212 work log

## 2026-08-19 — start and inventory

- Started from clean `origin/main@bc65f7848` after T-0211 retained real
  complete-replica deployment acceptance and remote cleanup.
- Desktop execution supports explicit child model/reasoning dispatch. Two
  read-only mechanical scans were dispatched in parallel with the existing
  `explorer` function, explicitly configured `gpt-5.6-luna` / `low`; runtime
  telemetry is recorded if exposed, otherwise the configured immutable profile
  and limitation are retained.
- One bounded implementation owner will receive the converged inventory. It
  must not preserve aliases, move the rejected layer, or alter the process-local
  IntegrationBroker SPI.

## 2026-08-19 — RED-30 and deletion checkpoint

- Implementation owner: existing `implementer` role, explicitly configured
  `gpt-5.6-terra` / `medium`. This execution surface does not expose
  runtime-model telemetry, so the immutable configured profile is the evidence.
- Added `scripts/check-t0212-removed-routing.mjs` and
  `check:t0212-removed-routing`. Its baseline RED-30 run failed for the
  expected reason: rejected source paths and current references remained.
- Removed the ZeroMQ source/test trees, the generic transport root contract,
  context transport/routing/runtime files, cross-process fixtures, and the Todo
  local-multi-process fixture. Dependency manifest and workspace approval edits
  are included; `pnpm install --lockfile-only` refreshed the lock but still
  reported an ignored historical ZeroMQ build, which requires lock audit.
- This is an implementation checkpoint only. Current docs/API inventory and
  remaining tests still require cleanup before any green or completion claim.

## 2026-08-19 — convergence

- Rewrote the remaining current normative API and architecture documents around
  ServerEnvironment, IntegrationBroker message channels, normal generated
  services, managed replicas, Coordinator, Gateway, and durable Delivery.
- RED-30 now passes: `pnpm check:t0212-removed-routing` exits zero.
- Focused retained server and memory-channel tests pass (126 tests). The
  canonical task verifier was started with coverage after this green gate; its
  final result must be recorded separately before completion.

## 2026-08-19 — cleanup-policy convergence

- The first retained canonical verifier passed generated build, tooling
  typecheck, and repository ESLint, then stopped at the cleanup-policy gate.
- Removed only obsolete semantic-name and standalone-function dispositions for
  the deleted ZeroMQ adapter and runtime-routing functions. Wrapped the RED-30
  reference expression to satisfy the line-length policy.
- `pnpm lint:cleanup`, `pnpm check:t0212-removed-routing`, the affected Prettier
  check, and `git diff --check` now pass. No production behavior changed in
  this correction.
