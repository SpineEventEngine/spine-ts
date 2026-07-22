# T-0058: Public Client Command And Query Facade

Status: Complete

Baseline: `9a247c77`

## Objective

Add the end-user-facing `@spine-ts/client` facade for posting commands and
executing the Projection queries completed by T-0057, with idiomatic
TypeScript lifecycle and error semantics matching the accepted Spine JVM
behavioral contract.

## Classification

High-risk. This packet adds public generic/network APIs, actor and tenant
context propagation, application-versus-transport outcome boundaries,
cancellation, owned-resource cleanup, and close races. T-0052 already
completed and accepted the required architecture/public-contract split, so no
new requirements-splitter dispatch is warranted unless implementation exposes
a genuine conflict.

## Human And Wave Requirements

- Provide behavioral and conceptual Spine JVM parity through small idiomatic
  TypeScript APIs; do not copy JVM implementation details or over-engineer.
- Node is the only supported runtime in Wave 1.
- Support guest defaults, explicit actor context, tenant context, command
  posting, and Projection query execution.
- Keep accepted application/protocol outcomes distinct from transport
  failures. Do not flatten gRPC/network failures into business rejection
  results or throw protocol/application refusals as transport errors.
- Immediate command-event observation must be cancellable and must not leak a
  subscription or pending task after post failure, cancellation, or client
  close.
- A caller-supplied transport remains caller-owned. A transport created by the
  client closes exactly once.
- `close()` is idempotent, rejects new work once closing starts, and
  drains/cancels every operation owned by the client.
- Public production declarations must not expose `@spine-ts/server` types or
  test-runner types.
- T-0059 owns the general public entity/event subscription facade. T-0058 may
  implement only the bounded immediate-event observation needed by command
  posting and must not pre-build T-0059.
- TS/JVM live compatibility tests remain deferred to Wave 3; T-0058 requires
  real TS-to-TS command/query integration over the frozen Protobuf services.
- No deprecation aliases are required because there are no real-world users.

## Behavior Acceptance

1. A minimal public client builder/factory creates a Node client from either a
   caller-supplied transport seam or a supported endpoint-owned transport.
2. Guest is the default actor. Explicit actor and tenant selections are
   immutable/scoped so concurrent calls cannot leak identity or tenancy.
3. Posting accepts a generated command schema/value, compiles the frozen
   command request, and returns a stable public acknowledgement/outcome that
   preserves successful acceptance, validation/business refusal, and any
   immediate observed events required by the frozen contract.
4. Projection query execution accepts the typed T-0057 query/builder output,
   calls the frozen Query service, validates the response outcome, and returns
   immutable typed state/version values without leaking wire-transport or
   server implementation types.
5. Transport/deadline/cancellation failures remain distinguishable from valid
   protocol responses. Malformed success responses fail deterministically.
6. Immediate observation starts/stops in the correct order, propagates
   cancellation, and is cleaned up on successful post, refusal, transport
   failure, caller abort, and client close.
7. Supplied versus owned transport lifecycle is explicit and covered by
   exactly-once close tests. Closing rejects new calls and deterministically
   settles in-flight owned work.
8. Public README and user-guide snippets use real exported types and are
   compile-checked. Package exports/dependencies and TypeDoc expectations are
   updated without server-type leakage.

## Frozen Minimal Public Shape

- The root concept is `Client`, matching Spine JVM. `Client.connectTo(baseUrl,
options?)` creates and owns the Node HTTP/2 session/transport;
  `Client.usingTransport(transport, options?)` uses a caller-owned Connect
  `Transport` and never closes it.
- Tenant and guest configuration are fixed when creating the client. The
  default guest ID is exactly `guest`, matching the frozen JVM contract.
- `Client.asGuest()` and `Client.onBehalfOf(user)` return immutable
  `ClientRequest` scopes sharing only the lifecycle owner. Actor context is
  freshly created for every call with timestamp and optional fixed tenant.
- `ClientRequest.post(schema, message, options?)` and
  `ClientRequest.query(stateSchema, queryOrBuilder, options?)` are the two
  operation methods. Each supports `AbortSignal`; query execution replaces the
  builder/query's actor context with the current immutable request context.
- Valid service statuses are returned as frozen discriminated results using
  the canonical cases `ok`, `error`, and `rejection`. Error and rejection data
  may use cloned public frozen Protobuf messages; raw `Ack`, `QueryResponse`,
  Connect client objects, and server types are not returned. Transport failures
  reject unchanged. Missing/invalid status, mismatched `Any`, missing version,
  or inconsistent IDs throw one small public protocol error.
- An `ok` query result contains immutable `{ state, version }` entries decoded
  by the caller's generated state schema. It never returns partial results.
- `post(..., { observe: [EventSchema, ...] })` creates event subscriptions
  before posting and returns an `ok` result with one narrow `CommandEvents`
  handle. The handle is cancellable and async-iterable over decoded event
  message/context pairs, filters locally by the posted command origin because
  general server-side event filters belong to T-0059, and is bounded against
  unrelated updates. No reusable topic/subscription builder is exported.
- The observation is cancelled automatically on `error`, `rejection`,
  transport/post failure, abort, or client close. On `ok`, the caller owns the
  decision of when enough immediate events have arrived and calls `cancel()`;
  `Client.close()` remains the final safety net.
- Client close state is monotonic: open → closing → closed. Starting close
  rejects new operations immediately, aborts/cancels tracked work, awaits its
  settlement, and aborts an owned HTTP/2 session exactly once. Repeated closes
  share the same completion.

These names are the public contract for implementation and review. Do not add
builders, aliases, callback/error-handler hierarchies, general subscriptions,
authentication, retry policy, or non-Node transport factories in T-0058.

## Required Verification

- TDD RED/GREEN evidence for public command, query, error, cancellation, and
  lifecycle behavior.
- Complete fake-transport contract tests that mirror the frozen service shapes
  rather than asserting mock calls as the behavior.
- Real loopback TS command/query integration through public APIs.
- Cancellation and close-race tests, owned/supplied transport tests, malformed
  response tests, declaration/API scans, client package gates, format, diff,
  and generated cleanliness.
- Full verification cadence may be deferred to the next listed full packet by
  the Wave plan, but final task and post-merge focused integration gates must
  cover the accepted tree. The orchestrator may run the full gate if risk or
  integration evidence warrants it.

## Ownership

One existing `implementer` owns all production, test, package, and public-doc
changes in this isolated worktree. It follows strict RED-GREEN-REFACTOR and may
not commit, push, merge, tag, or spawn children. The orchestrator owns task
records, review dispositions, commits, merges, pushes, and post-merge gates.
