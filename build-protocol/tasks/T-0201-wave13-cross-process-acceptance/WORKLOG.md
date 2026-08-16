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

## Native GREEN after transport handoff — 2026-08-16

- The transport owner corrected valid empty protobuf frame handling in
  `7a67a51a`; it was merged into this branch as `62541618`. No product code was
  changed by this implementer.
- Refreshed local runtime outputs with `pnpm proto:generate && pnpm
typecheck:build:generated` (exit 0). The generation run left no tracked
  volatile generation-ID changes.
- Exact native acceptance is GREEN:
  `pnpm exec vitest run packages/server/test/server/server-integration-broker-cross-process.test.ts --reporter=verbose`
  (1 file, 1 test passed). It proves two distinct PIDs and context names, v3
  generated external metadata, normal domestic producer posting, original Event
  ID and canonical type URL, generated payload, producer identity, import actor,
  absent single-tenant ID, and external context; both children exit code 0 and
  no sockets or manifests remain. Empty adapter layout directories are retained
  as benign transport structure and the parent removes the temporary root.
- Same-process/in-memory evidence remains GREEN:
  `pnpm exec vitest run packages/server/test/integration/integration-broker.test.ts --reporter=verbose`
  (13/13 passing).
- Native empty-frame regression is GREEN:
  `pnpm exec vitest run packages/transport/test/zeromq/message-transport-manifest.test.ts --reporter=verbose`
  (15/15 passing, including valid empty `ExternalEventsWanted` payload delivery).
- Final mechanical checks passed: focused ESLint, child `node --check`,
  Prettier, `git diff --check`, and a child-source shortcut scan. The only
  `eventBus().post()` is the producer's normal domestic publication; the child
  contains no `ExternalMessage`, `ContextTransport`, `RuntimeTransportBinding`,
  `SignalTransport`, forwarder, `externalEventSchemas`, or
  `addEventDispatcher` shortcut.

## Focused review — 2026-08-16

- The existing `performance_reliability_reviewer` was dispatched with explicit
  `gpt-5.6-terra` / `high` configuration, no subagent authority, and unavailable
  runtime telemetry. It passed T-0201 without findings after 10 consecutive
  native cross-process runs (10/10), the ZeroMQ manifest suite (15/15), and a
  clean diff check.
- The existing `style_maintainability_reviewer` used the same explicit
  `gpt-5.6-terra` / `high` profile and telemetry disposition. It confirmed the
  generated metadata, complete Event proof, adapter consistency, and absence of
  new concepts, but found one P1 acceptance-regression gap: the durable source
  guard omitted `SignalTransport` and `RuntimeTransportBinding` even though the
  current fixture uses neither.
- The guard now enumerates every prohibited shortcut explicitly, including
  those two APIs. This deterministic test-only correction reopens only the
  maintainability review lane.

## Review correction refinement — 2026-08-16

- Maintainability re-review confirmed the two missing API names were added but
  found that the list-based correction had made the previously case-insensitive
  scan case-sensitive. A differently cased alias could therefore evade the
  durable regression guard even though the current fixture is clean.
- Each explicit prohibited term is now checked with its own Unicode-aware,
  case-insensitive regular expression. The complete names remain readable while
  preserving the original guard strength.
- The canonical task profile on the preceding correction passed every
  policy/build/documentation/release-readiness gate and 3 files / 29 tests. The
  final guard-only tree receives a focused native/lint/format check and the
  reopened maintainability re-review before closure.
