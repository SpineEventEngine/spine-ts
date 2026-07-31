# @spine-event-engine/testing reference

This reference describes the public test API for coding agents.

## Entry point

Import `BlackBox`, `BlackBoxClosedError`, `BlackBoxTimeoutError`, and their
option/scope types from `@spine-event-engine/testing`. Do not use the package's
internal test access or the server's `BoundedContextFixture` as application
test APIs.

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
