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
