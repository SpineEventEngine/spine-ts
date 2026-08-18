# T-0204 Work Log

## 2026-08-18 — Framing

- Task classified high-risk for public API and shared lifecycle behavior.
- Ownership, human requirements, TDD order, JVM guardrail, verification, and
  reviewer concerns were frozen before the implementation dispatch.
- No product code changed at this checkpoint.
- Skill inventory/lock and expected-skill manifest were checked. Selected
  workflow skills were fully read by the orchestrator; the implementation
  owner must read `test-driven-development` before changing product code.
- Explicit dispatch profile: existing `implementer` role,
  `gpt-5.6-terra`/`medium`; subagent spawning prohibited. The Desktop surface
  supports explicit model/reasoning dispatch. Runtime self-telemetry may be
  unavailable and must be recorded if so.
- Fresh isolated setup passed with `pnpm install --offline --frozen-lockfile`.
  `pnpm proto:generate && pnpm typecheck:build:generated` passed; known volatile
  Proto generation stamps were restored, leaving a clean worktree.
- Clean baseline passed 4 focused files and 69 tests:
  `server-environment`, singleton environment, IntegrationBroker lifecycle,
  and broker module.

## 2026-08-18 — Pinned JVM/source inspection and TDD setup

- Inspected the pinned JVM evidence recorded in
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` (source scope
  includes `core-jvm/server/.../ServerEnvironment.java` and
  `.../integration/IntegrationBroker.java`) and
  `spine-jvm-docs/spine-validation-storage-observability-and-support.md`
  (the same `ServerEnvironment` source plus `EnvSetting.java`). The JVM model
  is one process-wide environment shared by local bounded contexts, with a
  `TransportFactory` facility; test mode defaults it to
  `InMemoryTransportFactory`, and lifecycle closure belongs to the environment.
- Inspected the present TypeScript counterpart:
  `packages/server/src/server/server-environment.ts` resolves and owns the
  factory, and `packages/server/src/context/bounded-context.ts` injects it into
  every `IntegrationBroker`. The generic `transport` SignalTransport is a
  separate facility and remains outside this task.
- No external dependency is needed: the existing
  `@spine-event-engine/transport` `InMemoryTransportFactory` is the selected
  default. Next: capture the required production-default RED before changing
  product code.

## 2026-08-18 — TDD implementation checkpoint

- RED 1: `pnpm vitest run packages/server/test/server/server-environment.test.ts
--testNamePattern='defaults one process-wide integration channel factory in
production'` failed as expected with `Production ServerEnvironment requires
transportFactory.` before product changes.
- RED 2: after restoring the pre-change environment source, the supplied
  override test failed with the same obsolete required-setting error:
  `pnpm vitest run packages/server/test/server/server-environment.test.ts
--testNamePattern='uses and closes a supplied integration channel factory
once'`.
- GREEN: renamed only the application/environment facility to
  `integrationChannelFactory`; retained `IntegrationBroker`'s internal
  JVM-aligned `TransportFactory` input; defaulted exactly one environment-owned
  `InMemoryTransportFactory` for every environment; and retained its existing
  close-group ownership. `bounded-context.ts` now supplies that selected
  factory to every broker. The generic SignalTransport `transport` was not
  changed.
- Both new focused tests passed. Generated build passed. The four required
  focused server/broker suites passed 70/70 after the generated declarations
  were rebuilt; the initial lifecycle rerun correctly exposed stale package
  output, not a runtime defect.
- Next: complete deterministic docs/API, changed-source coverage, and task
  preflight before committing the review-ready checkpoint.

## 2026-08-18 — Preflight and verifier containment

- Focused public-index, environment, singleton, broker lifecycle, and broker
  module run: 5 files, 80 tests passed. The changed executable paths are
  exercised on both `??` branches: production default and custom override hit
  the production resolver; local default and custom broker configuration hit
  the local resolver; and built contexts resolve the selected factory for their
  brokers. Changed executable line and branch coverage is therefore 100%; the
  broad-file V8 report is not the changed-line metric and correctly falls below
  the repository-global threshold for a focused invocation.
- `verify:task` detached after generated build with no child process or terminal
  result. Only its exact parent/node PIDs were terminated. A hidden/ignored
  worktree scan found no `.generated-*`, Proto lock, or other known verifier
  artifact, so nothing was deleted. Equivalent deterministic gates then passed
  individually: tooling typecheck; changed-file ESLint; cleanup, TSDoc,
  copyright, logging, format, audience, TypeDoc/API inventory (255 exact
  server exports), Buf lint, current generated-output check,
  release-readiness, and `git diff --check`.
- The selected expensive profile remains `verify:release`, but it is deferred
  until the orchestrator completes the required review wave and returns any
  correction batch. No runtime telemetry surface is available; immutable
  dispatch evidence remains existing `implementer`, `gpt-5.6-terra`/`medium`.
