# @spine-event-engine/client-node reference

This reference records the exact public contract of `@spine-event-engine/client-node`.
Start with the [Node client overview](README.md) for the shortest connection path.

## Client construction

`Client.connectTo(baseUrl, options)` creates a shared `client-web` `Client` with a Node Connect HTTP/2 session. `client.close()` closes subscriptions and then aborts that session. `Client.usingTransport(transport, options)` uses a Connect transport supplied by the caller; closing the returned client does not close the supplied transport. Each `post()` creates its Command through the shared core signal-envelope helper, which assigns a fresh secure UUID-based Command ID.

The returned kernel supports `asGuest()` and `onBehalfOf(user)` request scopes. A scope has `post(schema, value, options)`, `send(query, options)`, and `createSubscription(topic, options)`. See the [client-web reference](../client-web/REFERENCE.md) for command outcomes, cancellation, subscription lifecycle, recovery, and terminal behavior shared by both clients.

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
