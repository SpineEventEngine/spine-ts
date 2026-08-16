# T-0199 Integration Broker Exchanges

Status: implementation checkpoint; T-0200 lifecycle/context wiring remains the
explicit dependent owner.

## Assignment

- Existing role: implementer.
- Configured profile: `gpt-5.6-terra` / medium; runtime telemetry is not
  surfaced by this execution environment.
- Baseline: `origin/main` `b6069398` in isolated worktree
  `.worktrees/wave13-t0199-broker`.
- Scope: internal broker exchanges, exact wrapper, dynamic domestic EventBus
  dispatcher removal, focused broker evidence. No context, environment,
  ThirdParty, public root, ZeroMQ, or handler-generator changes.

## Behavior implemented

- `external-messages.ts` uses exact generated Protobuf frames: complete Event
  and EventId for event frames, UUID `StringValue` identities for control
  frames, required source context, and strict Event wrapper validation.
- `IntegrationBroker` keeps status, wanted-config, and per-event channels
  distinct; ignores self/paired origins; rebroadcasts wanted documents after a
  valid peer-online message; suppresses ordinary unchanged documents; and sends
  empty wanted configuration before consumer teardown.
- Complete wanted sets are serialized per receiving broker. First interest
  installs one type-specific domestic dispatcher/publisher, references retain
  it, final withdrawal unregisters it, and failed acquisition closes partial
  resources while leaving the old authoritative set intact.
- A wanted type remains a wire type URL only. A receiving context without an
  admitted local domestic schema records no producer for that type and ignores
  it without failing the shared configuration broadcast; T-0200/fixture owners
  must declare a normal domestic dispatcher before posting a producer event.
- Imported frames are marked external only and passed to the supplied existing
  EventBus/tenant intake seam. Domestic dynamic dispatchers exclude external
  events, preserving the no-reexport invariant.
- Event dispatcher unregister removes only routes. It retains schema admission
  for schema-only registrations and other dispatchers.

## TDD and evidence

The precommitted RED-14 exact wrapper test initially failed solely because
`integration/external-messages.js` was absent. After the smallest wrapper
implementation, it passed. `pnpm exec tsc --noEmit -p packages/server/tsconfig.json`
and `pnpm exec vitest run packages/proto/test/integration-broker-contract.test.ts
packages/server/test/bus/event-bus.test.ts --reporter=dot` pass (45 tests).

The T-0196 whole-context broker suite still has 13 failures because T-0200 has
not yet connected one broker to each `BoundedContext`, supplied the distinct
environment `TransportFactory`, or supplied the context tenant intake seam.
This is a recorded dependency, not a claim of green context behavior.

## Correctness correction

After read-only lifecycle review, `open()` now closes partial attachments when
setup fails, `close()` waits for an in-flight open, closed brokers stop intake,
and a failed final-removal cleanup leaves the authoritative wanted map intact.
The dynamic publisher is unregistered only after its channel closes cleanly.

## Consolidated review correction — 2026-08-16

The accepted review batch required canonical `TypeUrls.derive()` identities:
WKT external-event channels now retain their `type.googleapis.com` URL while
Spine schemas retain `type.spine.io`. Broker schema iterables are snapshotted
and deduplicated at construction. EventBus dynamic unregister/schema discovery
is package-internal through `eventBusAccess`, not public API. A direct module
suite proves one-shot iterable handling and closed-open rejection. The RED-14
control-frame expectation now uses the canonical helper; this is a fixture
expectation correction, not a wire change.

Follow-up lifecycle correction: each successful attachment is retained
immediately; a failed consumer attachment closes its subscriber. Accepted
callbacks are tracked, and close gates new intake then drains accepted
callbacks/transitions before publishing its final empty wanted document.
`SubscriberResource` now attempt-closes both handle and subscriber; domestic
publisher close clears its shared completion after failure so context close can
retry. Direct module evidence now covers peer-online forced resend and
self/paired suppression.

## T-0200 handoff

Construct one internal broker with `IntegrationBrokerInput`, call `open()` as
the private context readiness gate, and invoke `close()` before the factory is
torn down. `open()` is shared/idempotent; failed close releases its shared
promise for retry. Supply `postImported` to validate with the existing
`TenantBoundary` and call the normal domain `EventBus`; do not expose a public
broker accessor. A later ThirdParty internal caller may use the same complete
Event publication path through its hidden context broker only.

## Exclusions audit

`rg -n "ContextTransport|RuntimeTransportBinding|SignalTransport" packages/server/src/integration`
must remain empty. There is no Inbox, retry, deduplication, replay, election,
lease, cursor, or ownership mechanism in the broker.

## Quality-convergence ownership transfer — 2026-08-16

- Ownership transferred from the turn-budget-exhausted original implementer to
  the replacement **implementer** for bounded T0199 quality/convergence only.
- Configured dispatch profile: `gpt-5.6-terra` / `medium`, explicitly supplied
  by the orchestrator. Runtime telemetry is unavailable on this surface; the
  configured role/profile is the durable metadata.
- The existing uncommitted decoder correction was preserved and completed:
  control-frame decoding now guards a local `originalMessage` before reading
  bytes, with concrete online/wanted decoders and no non-null assertion,
  `any`, `never`, or unsound decoder generic.
- Wrapper construction no longer uses a conditional generic cast. Internal
  broker API surfaces and their fields have narrow TSDoc.
- Focused ESLint over all assigned broker, EventBus/registry, direct broker
  tests, Wave 13 transport support, and wrapper-contract paths: passed with
  zero diagnostics.
- Focused direct verification passed: `pnpm exec vitest run
packages/proto/test/integration-broker-contract.test.ts
packages/server/test/bus/event-bus.test.ts
packages/server/test/integration/integration-broker-module.test.ts
--reporter=dot` — 61 tests passed.
- Broader direct regression invocation added `integration-broker.test.ts`, the
  registry test path, and the Wave 13 repository-routing test path. It retained
  the already-recorded 13 T-0196 whole-context failures: no T-0200 broker/context
  wiring causes no imported delivery or wanted publications; RED-15 additionally
  reaches the pre-existing generated-repository fixture identity failure. The
  61 direct tests remained green. This remains an explicit dependent-owner
  limitation, not an accepted T0199 quality finding.
- Canonical review dispositions: correctness/type safety **resolved** by typed
  decoder and typed transport double; style **resolved** by focused lint and
  formatting; API documentation **resolved** by internal markers/field docs;
  performance/reliability **N/A** for this no-behavior-change convergence
  correction; security **N/A** (release-only gate, no new trust boundary).

## Coverage convergence evidence — 2026-08-16

- Focused V8 invocation over direct wrapper, broker-module, EventBus, and
  registry tests passed 61 tests. It measured 92.85% lines but 80.49% branches
  across changed executable product files, so it does **not** satisfy the Wave
  13 90/90 coverage gate.
- A wrapper-focused follow-up added behavior assertions for missing event
  identity, missing event origin, and missing control origin. The two direct
  suites passed 17 tests and measured: `external-messages.ts` 96.00% lines /
  88.88% branches; `integration-broker.ts` 95.65% lines / 76.66% branches;
  aggregate 95.69% lines / 79.48% branches. The remaining branch deficit is
  explicit open T0199 convergence work; no ignore/source-inclusion mechanism
  was used.
