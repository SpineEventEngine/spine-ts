# T-0201 Work Log

## Dispatch — 2026-08-16

- Baseline `origin/main` is
  `a680ba5b8423736dc644d6c9d5e74335c2546917`; the task is isolated in
  `wave13-t0201-cross-process`.
- Dispatched the existing implementer role with explicit
  `gpt-5.6-terra` / `medium` reasoning, no subagent authority, and exclusive
  fixture/task-record ownership. Runtime telemetry is unavailable.
- Required first action is a retained live RED run, followed by the smallest
  fixture correction using the established generated-entity metadata seam.
  Product behavior may not be changed to accommodate a test shortcut.

## Fixture correction and product handoff — 2026-08-16

- Retained the prescribed live RED before editing:
  `pnpm exec vitest run packages/server/test/server/server-integration-broker-cross-process.test.ts --reporter=verbose`.
  It failed with `Child exited before ready: 1/null`, matching the audit's
  invalid `StringValueSchema` repository-state metadata diagnosis.
- Rebuilt local generated runtime outputs with `pnpm proto:generate && pnpm
typecheck:build:generated` (exit 0) and restored all ten volatile generated
  `generationId` changes before the fixture checkpoint.
- Replaced only the generated-registry repository state schema with the
  established descriptor-marked `ProjectionState` pattern. The child retains
  registry version 3, external generated receptor metadata, normal producer
  `context.eventBus().post()`, and the real ZeroMQ factory.
- Corrected the transported fixture payload to generated `EmailAddress`, whose
  canonical event type is `type.spine.io/spine.net.EmailAddress`; `StringValue`
  remains only the producer identity because its WKT type URL is not a native
  message-channel target.
- Added a context-local consumer EventBus observer solely to prove the complete
  imported envelope (ID, type URL, payload, producer, import actor, absent
  single-tenant ID, and `external`). The generated external handler remains
  active with `parameterCount: 2`; the observer neither posts nor routes
  events, and no transport wrapper, forwarder, shared EventBus,
  ContextTransport, SignalTransport plan, or RuntimeTransportBinding is used.
- Focused native rerun reaches two ready child PIDs, consumes the probe and
  target Event, and satisfies the exact delivery assertion. It remains RED only
  during required bounded cleanup: `IntegrationBroker.#publishEmptyWanted()`
  serializes a legitimate zero-field `ExternalEventsWanted` to zero bytes, and
  native `validateFrame()` rejects it as lacking an original message. Both
  children consequently require SIGTERM and leave adapter artifacts. Per
  orchestrator direction, this narrow product defect is handed back without a
  workaround or product edit.
- Focused fixture syntax and formatting passed:
  `node --check packages/server/test/server/server-integration-broker-child.mjs`
  and `pnpm exec prettier --check packages/server/test/server/server-integration-broker-cross-process.test.ts packages/server/test/server/server-integration-broker-child.mjs`.
- `pnpm exec eslint packages/server/test/server/server-integration-broker-cross-process.test.ts`,
  `git diff --check`, and the separate in-memory evidence command
  `pnpm exec vitest run packages/server/test/integration/integration-broker.test.ts --reporter=verbose`
  passed; the latter reports 13 passing RED-01 through RED-16 broker cases.
- Configured implementation profile remains `gpt-5.6-terra` / `medium`;
  runtime self-inspection telemetry is unavailable.
