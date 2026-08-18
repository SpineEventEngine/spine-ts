# T-0204 implementation report

## Outcome

- Renamed the public `ServerEnvironmentSettings` and resolved environment
  facility to optional `integrationChannelFactory`.
- Every environment now selects one owned `InMemoryTransportFactory` when no
  override is supplied. Bounded contexts pass that one selected factory to
  their IntegrationBroker; the broker's `TransportFactory` SPI and generic
  SignalTransport remain unchanged.
- A supplied integration-channel factory remains authoritative and is closed
  once by the existing environment close group.

## TDD evidence

- RED 1: `pnpm vitest run packages/server/test/server/server-environment.test.ts
--testNamePattern='defaults one process-wide integration channel factory in
production'` failed before product code with `Production ServerEnvironment
requires transportFactory.`
- RED 2: after restoring the old source, `pnpm vitest run
packages/server/test/server/server-environment.test.ts
--testNamePattern='uses and closes a supplied integration channel factory
once'` failed with the same obsolete requirement.
- GREEN: the two new tests pass, along with the focused five-file suite (80/80).

## JVM/source guardrail

- Inspected pinned source records for JVM `ServerEnvironment`,
  `IntegrationBroker`, and transport ownership in
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` and
  `spine-jvm-docs/spine-validation-storage-observability-and-support.md`.
  They require a process-wide environment/factory model, in-memory test
  transport default, and environment-owned lifecycle. No JVM build or external
  dependency was used.

## Validation

- `pnpm typecheck:build:generated` passed.
- Focused server environment, singleton, broker lifecycle, broker module, and
  public index tests: 80/80 passed.
- Changed executable coverage: 100% lines and branches. Both `??` resolver
  alternatives are covered by the default and override tests; local default
  traffic and context broker lookup are covered by existing broker tests.
- Passed individually: tooling typecheck, changed-file ESLint, cleanup, TSDoc,
  copyright, logging containment, Prettier, docs audience, TypeDoc/API
  inventory (255 exact server exports), Buf lint, generated-current,
  release-readiness, and `git diff --check`.

## Limitation and next gate

- `verify:task` detached after generated build without a terminal result. Its
  two exact processes were terminated after confirming no child process; no
  verifier temp/lock artifact was present in this worktree. The equivalent
  deterministic gates and focused coverage were run separately.
- `verify:release` is intentionally not run: task requirements defer the single
  expensive shared-runtime profile until after review corrections.
- Runtime self-telemetry is unavailable. Configured dispatch evidence is the
  existing implementer role, `gpt-5.6-terra` / `medium`.
