# T-0059: Public Client Subscriptions

Status: Complete

Baseline: `11a54925`

## Objective

Add the end-user-facing `@spine-ts/client` subscription facade for Projection
state and event topics, with bounded async iteration, immutable actor/tenant
scope, explicit cancellation, stable terminal errors, and deterministic client
ownership.

## Classification

High-risk. This packet adds public generic streaming APIs, server-stream
lifecycles, bounded buffering, filtering semantics, cancellation races, and
client-close ownership. T-0052 already accepted the Wave 1 architecture and
public responsibility split, so no duplicate requirements-splitter dispatch is
warranted unless investigation exposes a genuine contract conflict.

## Accepted Wave Contract

- Projection-state and event subscriptions use the frozen Spine topic and
  subscription services already present in `@spine-ts/proto`.
- Entity-state topics support the frozen ID/equality filters and expose both
  matching state updates and IDs that no longer match.
- Event topics support the frozen filters available in the copied contract; do
  not invent unsupported server filtering.
- A public handle implements `AsyncIterable`, explicit idempotent `cancel()`,
  and distinguishable terminal transport/protocol/overflow errors.
- Per-subscription buffering is bounded with documented deterministic overflow
  behavior. No update is silently lost.
- Subscribe/activate/cancel ordering and cancellation propagate to the
  transport/server. Client close terminates every active subscription exactly
  once and settles owned work.
- Guest/actor/tenant context is identical to T-0058 command/query scoping and
  remains immutable across concurrent calls.
- Supplied transports remain caller-owned; owned transport close semantics stay
  exactly those accepted in T-0058.
- T-0059 does not add retry/authentication policy, callback hierarchies,
  Aggregate/Process Manager high-level query factories, or `BlackBox` APIs.

## Frozen Public Contract

- `ClientRequest` adds separate state and event subscription methods. Both
  accept generated message schemas and resolve after `Subscribe` succeeds, the
  returned subscription is validated against the exact requested topic, and
  `Activate` has been invoked with one bounded internal consumer attached. The
  frozen stream has no remote success acknowledgement, so resolution does not
  prove that the server listener is already attached. Each method exposes a
  single-consumer bounded `AsyncIterable` handle with idempotent
  `cancel(): Promise<void>`.
- A state handle yields a discriminated union containing either an immutable
  decoded state or an immutable decoded `noLongerMatching` ID. The caller
  supplies the generated ID schema needed to decode the frozen `Any`; neither
  packed values nor raw subscription messages leak through the facade.
- State options are immutable and support IDs, typed Projection predicates, a
  state field mask, and `AbortSignal`. Subscription predicates accept equality
  leaves and nested `all`/`either` groups only, matching the frozen server
  capability; ordered comparisons, query ordering, and limits are rejected.
- An event handle yields immutable decoded event values together with their
  immutable `EventContext`. Event options expose `AbortSignal` only because the
  current TS server rejects event target filters and masks.
- Topic IDs are fresh `t-<UUID>` values. Topic actor/tenant/timestamp context is
  built by the same request scope as T-0058. State criteria combine IDs and
  predicates with the frozen server semantics; an empty criterion is
  `includeAll`.
- Local buffer overflow is an explicit terminal `ClientProtocolError` and
  initiates remote cancellation. A normally completed remote stream is
  terminal but cannot be labelled as remote overflow because that condition is
  not represented by the frozen wire contract.
- Failures known before the activation consumer is attached reject creation and
  initiate bounded cleanup. Once attached, asynchronous activation transport
  or server failures terminate the handle and make pending and future iterator
  reads reject with the stable stream error. Normal activation-stream
  completion terminates iteration normally. Updates delivered before the caller
  claims the iterator are retained in the bounded queue. Cancellation makes the
  local stream terminal immediately, destroys the remote subscription with the
  existing bounded cleanup policy, and reports remote cleanup failure to
  explicit `cancel()`.
- Public names and signatures may be adjusted by the implementation owner only
  to preserve existing TypeScript generic inference or avoid a duplicate query
  compiler; any semantic expansion requires orchestrator approval.

## Required Verification

- RED/GREEN public contract tests for state/event topic construction, update
  decoding, no-longer-matching IDs, ordering, filtering, immutable values,
  bounded overflow, single-consumer behavior, explicit cancel, activation
  completion/error, abort, subscribe/activate/cancel races, and client close.
- Real native loopback state/event subscription integration through public
  client/server APIs.
- Compile-time public generic/declaration tests and scans proving no server or
  test-runner implementation leakage.
- Package graph, TypeDoc/API inventory, README and user-guide snippets, format,
  diff, generated-clean, and full repository verification before acceptance.
- All four specialist review lanes are required. Security is N/A unless the
  implementation adds a credential/metadata/deserialization boundary beyond
  the frozen validated service transport; final Wave 1 security remains T-0067.

## Ownership

One existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, owns the
production/test/docs/package slice after the investigation contract is frozen.
It follows RED/GREEN and may not commit, push, merge, edit review dispositions,
install dependencies, or spawn children. The orchestrator owns task records,
review aggregation, gates, commits, pushes, merges, and post-merge verification.
