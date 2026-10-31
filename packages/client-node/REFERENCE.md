# @spine-event-engine/client-node reference

This reference records the exact public contract of `@spine-event-engine/client-node`.
Start with the [Node client overview](README.md) for the shortest connection path.

## Client construction

`Client.connectTo(baseUrl, options)` creates a shared `client-web` `Client` with a Node Connect HTTP/2 session. `client.close()` stops local subscriptions and attempts remote cleanup before aborting that session. Failed cleanup rejects closure and retains the session for a later explicit `close()` retry; new operations remain rejected. `client.cleanupFailures` exposes currently retained cleanup errors. `Client.usingTransport(transport, options)` uses a Connect transport supplied by the caller; closing the returned client does not close the supplied transport. Each `post()` creates its Command through the shared core signal-envelope helper, which assigns a fresh secure UUID-based Command ID.

The returned kernel supports `asGuest()` and `onBehalfOf(user)` request scopes. A scope has `post(schema, value, options)`, `send(query, options)`, `query(generatedQ, options)`, `createSubscription(topicOrSchemas, options)`, and `postAndSubscribe(schema, value, options)`. See the [client-web reference](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-web/REFERENCE.md) for application query pairing, Command acknowledgements and outcomes, optional activation and first-update timeouts, cancellation, subscription lifecycle, recovery, and terminal behavior shared by both clients.

## Continuing subscriptions

Node uses the same subscription implementation and public types as the browser
client. Both timeout options are absent by default. `postAndSubscribe` waits for
all selected subscriptions to activate, posts once, and returns its immediate
acknowledgement separately from the continuing update stream. Event and rejection
schema arrays can each contain several types.

Use `for await` in an asynchronous consumer with rejection handling. Waiting for
an update suspends that function, leaving the Node event loop available for
other work. Explicitly cancel when the application no longer needs updates.
See the runnable [Todo client](../../examples/todo/scripts/smoke.mjs), which
receives multiple outcomes and then checks the authoritative Projection.

## Entity query API

Normal model generation emits a `_query.ts` companion for each eligible Entity
state. Import its named query, for example `TaskListQuery`, then call
`TaskListQuery.create().openTaskCount().isAtLeast(1).build()`. The import
registers its declared columns automatically. The built query contains no actor
or tenant; `request.send(query)` binds both at execution.

`EntityColumn.register(schema, definition)` and `EntityQuery.select(...)` remain
available for existing low-level callers. Their schema-and-columns setup is not
required when using a generated query.

Predicates accept only columns registered for the selected Entity. `limit()` requires at least one order clause. The compiler packs declared values and the `version`, `archived`, and `deleted` system columns into the wire query. Builders and columns are immutable, so a predicate cannot be reused for a different Entity target.

## Code generation

Run the model package's normal `spine-proto generate` command. It emits the
query companion and column registration together; application code imports the
named query without a second generation command or manual registration.

This package is Node-only because it imports Node HTTP/2 and code-generation dependencies. Browser applications use `@spine-event-engine/client-web`.
