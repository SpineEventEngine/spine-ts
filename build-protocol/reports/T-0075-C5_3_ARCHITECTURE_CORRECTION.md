# T-0075 C5.3 Architecture Correction

Status: implementation-ready clarification

## Assignment evidence

- Existing role: `requirements_splitter`.
- Immutable configured profile:
  `.codex/agents/requirements-splitter.toml` selects `gpt-5.6-sol` with
  `high` reasoning.
- The task/work-log dispatch also explicitly records
  `requirements_splitter`, `gpt-5.6-sol`, and `high`.
- This surface exposes no independent runtime model/reasoning
  self-introspection. No visible mismatch or inherited fallback is present;
  the immutable configured role/profile is the available runtime evidence.
- Investigation was static TypeScript/source inspection only. No Spine JVM
  build, test, generation, dependency resolution, launch, or project execution
  was performed.

## Evidence and exact causes

### 1. Repeated generated Aggregate commands

The Chat failure is not a missing handler parameter and must not be fixed by
inventing an Aggregate-state context:

- `examples/chat/generated/handler/generated-handler-registry.ts` records
  `ChatMessageAggregate.postMessage` as a one-argument command assignment.
- The documented two-argument generated-handler contract supplies a generated
  `CommandContext`; it never supplies Aggregate state. Prior state belongs on
  the loaded entity instance (`this.state`).
- `AggregateExecutionSupport.loadAggregate()` in
  `packages/server/src/repository/repository.ts` opens repository entity
  storage and reads latest state through `storage.current`.
- `persistAggregateUpdate()` does not write the `LoadedAggregate.current` port.
  It writes the latest state through `standAccess.deferUpdate()`.
- `Stand.#deferUpdate()` in `packages/server/src/stand/stand.ts` opens its own
  current-record handle and performs the write there.
- Projection and Process Manager execution already load their latest state
  through `Stand.readVersioned()`, unlike Aggregate execution.
- The C5.3 focused integration records the observable consequence: after one
  successful post, a repeated `MessageId` reaches a newly created Aggregate
  without the prior state and returns `ok`.

The exact module defect is therefore split ownership of the Aggregate
read-after-write invariant: Aggregate loading reads one opened current-record
port while Aggregate persistence commits through Stand's separately opened
port. Shared storage keys are an adapter detail, not an explicit loader/writer
interface, and the demonstrated generated path does not obtain coherent prior
state from that implicit alias.

The smallest correct framework change is to make Stand's existing durable
current record the single Aggregate latest-state interface:

1. Add a package-internal `standAccess` read that returns a defensive copy of
   the complete current record needed by repository execution: state, version,
   archived, and deleted.
2. Change `AggregateExecutionSupport.loadAggregate()` to use that internal
   Stand read for latest state and version.
3. Continue opening repository entity storage only for state/event history
   ports; remove `LoadedAggregate.current`.
4. Keep persistence through `standAccess.deferUpdate()` unchanged.

This preserves lifecycle flags, avoids a duplicate write, adds no public
repository/Stand method, and follows the already-working Projection/Process
Manager load pattern. Do not change generated handler arity, pass state as a
second parameter, permit async `@Assign` solely for this guard, or use event
history as an existence substitute.

Within one built context, the existing `CommandBus` FIFO completion already
serializes accepted commands. Once the second command loads the committed
state, a synchronous `this.state` existence check deterministically rejects it.
This correction does not claim distributed cross-process uniqueness; Wave 6
still owns horizontal behavior.

### 2. Application command decoding in the native unary gateway

The registry support already exists at the semantic decoder seam:

- `CommandRequestInput` in `packages/auth/src/index.ts` has optional
  `registry?: TypeRegistryLookup`.
- `decodeIncomingRequest()` uses that registry to populate
  `IncomingCommand.message`, while preserving `messageType` for unknown types.
- `UnaryGateway.decode()` in `packages/auth/src/gateway/index.ts` currently
  calls `decodeIncomingRequest({ kind, value, transport })` without a registry
  for all three independent command views.
- `NativeGatewayServicesOptions` receives an already-constructed
  `UnaryGateway`; native handlers cannot repair the omitted constructor
  dependency per request.

The exact defect is missing composition, not missing decoding capability.

The smallest public seam is:

```ts
export interface UnaryGatewayOptions {
  readonly registry?: TypeRegistryLookup;
  // existing options unchanged
}
```

`UnaryGateway` passes this fixed application-owned lookup only when decoding a
command. Each source/authorization/context decode receives the same lookup and
still receives an independent decoded message instance. Query and
ResolveContext behavior are unchanged.

Do not add the registry to `UnaryGatewayRequest`, transport facts, forwarded
native requests, `NativeGatewayServicesOptions`, or wire contracts. The
application chooses the registry once when constructing its `UnaryGateway`;
`createNativeGatewayServices()` continues to consume that configured gateway.
Absence of a registry preserves the existing type-URL-only policy behavior:
`IncomingCommand.message` is `undefined`, while `messageType` remains
available. Unknown or malformed packed application payloads also remain
non-throwing and undecoded.

## Ordered correction slices and acceptance behavior

### S1 — Aggregate latest-state locality

Owner:
one existing `implementer`, exclusively
`packages/server/src/stand/stand.ts`,
`packages/server/src/repository/repository.ts`, focused server tests, and only
directly affected server documentation.

Acceptance:

1. A generated one-argument Aggregate assignee sees the state committed by the
   preceding command for the same entity ID through `this.state`.
2. Its version and archived/deleted lifecycle flags are restored unchanged.
3. A second sequential same-ID command can throw a domain rejection without
   overwriting state or publishing its normal event.
4. Two concurrent posts accepted by one context are processed FIFO; exactly
   one creates the entity and the other observes prior state and rejects.
5. A different entity ID remains independent and succeeds.
6. Existing Aggregate state/event history, Stand Query/subscription
   notification, subscriber-failure, and close behavior remain unchanged.
7. No public Stand/repository export or generated-handler contract changes.

Required regression location:
`packages/server/test/repository/repository-routing.test.ts`, using generated
handler metadata and a state-sensitive assignee rather than a fake direct
method call. Retain the C5.3 sequential/concurrent duplicate integration as the
end-to-end consumer regression after S1 lands.

### A1 — Fixed application registry at unary composition

Owner:
a separate existing `implementer`, exclusively
`packages/auth/src/gateway/**`, auth root type exports if required, focused auth
tests, README/TSDoc, and frozen auth API inventory.

Acceptance:

1. `UnaryGatewayOptions.registry` accepts the public
   `TypeRegistryLookup` interface and is optional.
2. A registered packed application command reaches authorization as an
   independently decoded `IncomingCommand.message`.
3. The context resolver receives a separate decoded message instance; mutation
   by authorization cannot alter its view or forwarded bytes.
4. A missing registry preserves `message === undefined` and the existing
   `messageType`.
5. Unknown or malformed packed application `Any` values do not throw and do
   not become trusted messages.
6. Query, ResolveContext, context replacement, byte bounds, cancellation, and
   single forwarding remain unchanged.
7. A real `UnaryGateway` configured with a test application registry and
   consumed by `createNativeGatewayServices()` proves the native Post path
   supplies the decoded application message to policy and forwards once.
8. No registry or credential reaches the backend forwarder.

Required regressions:

- focused `packages/auth/test/unary-gateway.test.ts` cases for registered,
  absent, unknown/malformed, and collaborator-mutation behavior;
- one real-composition case in
  `packages/auth/test/native-gateway-services.test.ts`, not a cast fake that
  bypasses `UnaryGateway`.

### C1 — Resume the Chat correction

Dependency: S1 and A1 accepted first.

Owner:
the existing C5.3 Chat implementer retains exclusive ownership of
`examples/chat-model/**`, `examples/chat/**`, its report, and its already
assigned evidence.

Acceptance:

1. Restore the synchronous `this.state` duplicate guard; do not retain the
   asynchronous event-history workaround.
2. Sequential and concurrent duplicate `MessageId` tests each report one
   accepted post and one `MessageAlreadyPosted` rejection, with the first
   Aggregate/Projection state unchanged.
3. The Chat gateway is assembled with the application `typeRegistry`; its real
   native Post policy denies spoofed author and unauthorized room before
   forwarding.
4. Existing room-filtered Query/subscription, multibyte bounds, and
   no-publication-on-rejection behavior remain green.
5. Generated registry output is regenerated by the implementation owner using
   repository tooling; it is never hand-edited.

## Risks and review lanes

### S1 risks

- Persistence/lifecycle regression if the internal Stand read omits archived,
  deleted, or version fields.
- Accidental public Stand expansion or duplicate current-record writes.
- Overclaiming atomicity beyond the existing single-context FIFO runtime.

Relevant reviews:

- style/maintainability: required for the internal seam and locality;
- performance/reliability: required at `gpt-5.6-terra` / `high` for
  persistence, read-after-write, lifecycle, and concurrency semantics;
- TypeScript/API: N/A only if the change remains package-internal with no
  declaration/export delta;
- documentation: required only for changed latest-state/concurrency claims.

### A1 risks

- Treating an unknown `Any` as authorized content.
- Sharing one mutable decoded command between policy and context resolution.
- Accidentally forwarding the registry, credential, or policy-only message.
- Expanding native options when the fixed `UnaryGateway` constructor seam is
  sufficient.

Relevant reviews:

- style/maintainability: required for the decode seam;
- TypeScript/API: required at `gpt-5.6-terra` / `high` for the public option and
  frozen export/inventory;
- performance/reliability: required for repeated decoding, mutation isolation,
  malformed payloads, and forwarding behavior;
- documentation: required for type-URL-only versus content-aware policy
  behavior.

The dedicated security reviewer remains the final Wave 4 release gate under
the governing protocol; this correction does not create an early separate
security-review role.

## Independence and exclusions

S1 and A1 are independent and may run in parallel in separate implementation
ownership contexts: their production/test paths do not overlap and neither
depends on the other's interface. C1 depends on both and must not guess or
duplicate either framework correction.

Excluded:

- Protobuf or wire-format changes;
- Aggregate/entity domain redesign;
- a public Aggregate lookup method;
- async-handler contract expansion;
- distributed uniqueness, CAS, idempotency keys, or Wave 6 coordination;
- React, browser UI, Envoy, session/provider, relay, or Chat feature expansion;
- Spine JVM source/build/test/generation/dependency resolution/launch;
- manual edits to generated sources;
- Git, task/review/work-log mutation by this planning assignment.
