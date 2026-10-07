# @spine-event-engine/testing reference

This reference describes the public test API for coding agents.

## Entry point

Import `BlackBox`, `BlackBoxClosedError`, `BlackBoxTimeoutError`, and their
option/scope types, plus `AiTestBackend` when scripting a model deployment, from
`@spine-event-engine/testing`. Do not use the package's
internal test access or the server's `BoundedContextFixture` as application
test APIs.

## Scripted AI backend

Create `AiTestBackend` with a credential-free `ModelRef` and either the
`generation` or `decision` kind, then register its `registration` in the
application `AiRegistry`. `forModel(model)` requires an `AiModel.define()` result
of the same kind. For generation, queue `respondWith(value)` or
`respondWithText(text)`; for decisions, queue `respondWithDecision(result)`.
Wrong-kind calls fail when scripting. `failWith(failure)` and `refuse()` queue
safe failures; the runtime supplies the diagnostic ID even when the supplied
failure carries one. `withUsage(usage)` defensively copies known token counts
onto the preceding response. `delay()` queues a pause and returns a gate whose
`release()` resumes it; runtime cancellation also ends the wait.

Each admitted physical request crosses `beginAttempt`, `reserveTransport`, and
`finishAttempt` or the runtime's failure path. Typed generation output still
passes through the runtime candidate parser, Proto constraints, and application
validation; decision answers pass through the runtime decision admission.
`requests()` gives immutable per-request snapshots with capability name, Agent
call name, one-based attempt, prepared input ProtoJSON, correction target and
issues, local validation issues, and advertised tool names. Recovery reuse does
not produce a new backend request. `assertSatisfied()` fails for any queued
response left unused or any admitted request without a matching script. This
includes a request waiting at a gate. If cancellation interrupts a reserved
response, the scripted observation remains pending and satisfaction does not
pass. This dependency does not replace BlackBox, establish delivery or state, or provide an
MCP tool transport.

`BlackBox.from(contextOrBuilder, options?)` accepts a built `BoundedContext` or
`BoundedContextBuilder`, builds a builder asynchronously, starts a local
`Server`, and connects a Node client. The returned box is ready to use. Options
are fixed for its lifetime:

- `tenant` is required by a multitenant context and must not be supplied to a
  single-tenant context;
- `zoneId` defaults to the framework's valid zone value;
- `timeoutMs` defaults to 500 and `intervalMs` defaults to 5; both must be
  positive integers.

`asGuest()` creates an immutable guest scope. `onBehalfOf(actor)` creates an
immutable actor scope; actor text is validated by the client contract.
`BlackBoxScope` includes the Node client request operations and adds
`postEvent(schema, message)` for a direct event post in a test.
`postExternalEvent(schema, message)` preserves the scope actor, tenant, zone,
timestamp, and external marker, reaches only external handlers, and is not
captured as produced output. `assertCommands()` and `assertEvents()` return
independently cloned snapshots of admitted produced signals in admission order.
They exclude test inputs, external inputs, system events, stored-event replay,
and output from unsuccessful handlers. Use `eventually()` when detached handling has not yet
admitted a produced signal.

`readAgentHistory(repository, entityId, request)` reads the registered Agent's
full retained history newest first. It uses the same `HistoryRead` page size and
opaque cursor as protected Agent history; a cursor from another Agent or view
is rejected. `readSystemEvents(ids)` reads exact persisted System Event IDs from
the paired context, in requested order, and returns independent envelope copies;
missing IDs are omitted. Both methods use the BlackBox's fixed tenant and fail after close. History
reads also reject a repository from another context. System reads fail when System Event
recording is unavailable. These audit reads are separate from `assertEvents()`,
which observes produced domain output.

## Waiting and lifecycle

`eventually(read, accept, options?)` retries `read` until `accept` returns true
or the deadline is reached. It returns the accepted value, throws
`BlackBoxTimeoutError` at the deadline, and rejects invalid timing values. It
stops waiting when close begins.

`close()` is idempotent and returns one shared completion promise. It stops new
operations, cancels tracked subscriptions, closes the client, then closes the
local server. Operations begun after close starts throw `BlackBoxClosedError`.

Subscriptions created by a scope are inactive until `activate()` and must be
ended with `cancel()`. The box tracks them so cleanup remains safe if a test
fails before it cancels one.

## Limits

BlackBox deliberately makes no guarantees about browser behavior, remote
servers, clustered delivery, authentication, or production persistence. Use
application integration tests for those boundaries.
