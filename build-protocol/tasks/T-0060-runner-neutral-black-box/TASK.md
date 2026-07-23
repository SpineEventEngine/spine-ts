# T-0060: Runner-neutral BlackBox

Status: Accepted for integration

Baseline: `de0a5867`

## Objective

Replace the advertised low-level bounded-context fixture with an end-user-facing
`BlackBox` in `@spine-ts/testing`. The facade owns one context and client,
supports the Wave 1 input/query/subscription capabilities, exposes immutable
observations and predicate-based eventual waits, and has deterministic cleanup
without depending on a test runner.

## Classification

High-risk. This packet adds a public testing API over command, event, query,
subscription, timeout, and multi-resource lifecycle seams. T-0052 already
accepted the Wave 1 architecture and responsibility split, so no duplicate deep
planning is warranted unless investigation exposes a real public-contract
conflict.

## Accepted Wave Contract

- `BlackBox` is the public end-user testing facade and creates/owns its bounded
  context plus public client.
- It supports guest/default and explicit actor scopes, optional tenant and time
  zone context, command and event input, Projection queries, and state/event
  subscriptions where the current runtime supports them.
- Returned states, emitted-message observations, and subscription values are
  immutable snapshots; callers do not receive mutable server or wire objects.
- Eventual waits accept caller predicates and explicit/default bounded timeouts.
  A timeout fails with a stable testing error and never silently returns a
  nonmatching value.
- `close()` is idempotent, stops admission, cancels/drains owned subscriptions,
  closes the client, and closes the context without skipping later cleanup when
  an earlier step fails.
- No Vitest, Jest, Chai, Node test-runner, assertion-subject, raw Connect, or
  server implementation types appear in generated public declarations.
- `BoundedContextFixture` becomes private implementation detail or is removed;
  there is no compatibility alias or deprecation cycle.
- T-0060 does not add Aggregate/Process Manager high-level queries, new server
  runtime features, Delivery APIs, or runner-specific assertion adapters.

## Frozen Public Contract

- `BlackBox.from(contextOrBuilder, options?)` asynchronously starts one
  ephemeral local server over the supplied context/builder and creates exactly
  one public client. Ownership transfers to the BlackBox on a successful call;
  failed startup unwinds every acquired resource.
- `BlackBoxOptions` accepts immutable `tenant`, `zoneId`, `timeoutMs`, and
  `intervalMs`. A multitenant context requires a tenant; a single-tenant context
  rejects one before listener/client creation. One BlackBox represents one
  tenant and zone; another tenant requires another BlackBox.
- `asGuest()` and `onBehalfOf(actor)` return immutable BlackBox request scopes.
  They delegate generated command posting, Projection queries, and state/event
  subscriptions to the one public client. They also accept generated domain
  event input, which BlackBox packs with the selected actor/tenant/zone as an
  import context and posts through the owned context's public event endpoint.
- Command outcomes, immediate event streams, Projection query states, state
  subscription updates, event subscription values, and direct-event
  consequences are the runner-neutral observations. BlackBox does not recreate
  JVM assertion subjects or expose a raw historical probe.
- `eventually(read, accept, options?)` repeatedly invokes a caller read function
  until its predicate accepts, and otherwise rejects with a public stable
  `BlackBoxTimeoutError`. It never returns a nonmatching terminal value. Waits
  are bounded, cancellable by BlackBox close, and release their timers.
- BlackBox tracks subscription handles returned through its scopes. Explicit
  cancellation removes ownership; close stops admission/waits, cancels tracked
  subscriptions, closes the one client, then closes the running server. Every
  phase is attempted, failures retain stable phase order, and concurrent or
  repeated close calls share one outcome.
- The only production prerequisite correction is `ClientOptions.zoneId?:
  string | ZoneId`. Tenant remains client-wide; zone is likewise client-wide.
  An omitted zone resolves once to Node's nonempty system IANA zone. Strings
  must be nonempty, Protobuf inputs are cloned, and every command/query/topic
  ActorContext receives the fixed zone. `asGuest()` and `onBehalfOf()` do not
  gain context parameters or mutable state.
- No `withTenant()`, `in()`, callback context, generalized request-context
  object, multiple client per actor, raw `Ack`/`QueryResponse` facade, or
  compatibility export is added.

## Required Verification

- RED/GREEN contract tests for ownership, actor/tenant/time-zone scoping,
  command/event input, Projection query and subscription delegation, immutable
  observations, eventual success/timeout, post-close rejection, cleanup order,
  error aggregation, and idempotent close.
- Execute the same BlackBox contract suite through Node's test runner and the
  repository Vitest runner, with runner-neutral production declarations.
- Compile-time public API/declaration dependency scans plus package README and
  end-user guide snippets that use only public APIs.
- Package graph, TypeDoc/API inventory, format/diff, generated-clean, and full
  repository verification before acceptance.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability concerns are required. Security is N/A unless this
  testing-only packet introduces a new credential, endpoint, or unsafe payload
  boundary; final Wave 1 security remains T-0067.

## Ownership

One existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, owns the
testing production/test/docs/package slice plus the narrowly approved
`ClientOptions.zoneId` prerequisite and its focused client tests/docs. It
follows RED/GREEN and may not commit, push, merge, edit review dispositions,
install dependencies, or spawn children. The orchestrator owns records, review
aggregation, gates, commits, pushes, merge, and post-merge verification.
