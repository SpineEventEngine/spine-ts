# @spine-event-engine/client-node reference

This reference is for agents and other automated tools that need the exact public contract of `@spine-event-engine/client-node`.

## Client construction

`Client.connectTo(baseUrl, options)` creates a shared `client-web` `Client` with a Node-owned Connect HTTP/2 session. `client.close()` closes subscriptions and then aborts that owned session. `Client.usingTransport(transport, options)` uses a caller-owned Connect transport; closing the returned client does not close the supplied transport. Both factories use Node `randomUUID()` for command request identifiers.

The returned kernel supports `asGuest()` and `onBehalfOf(user)` request scopes. A scope has `post(schema, value, options)`, `send(query, options)`, and `createSubscription(topic, options)`. See the [client-web reference](../client-web/REFERENCE.md) for command outcomes, cancellation, subscription lifecycle, recovery, and terminal behavior shared by both clients.

## Entity query API

`EntityColumn.register(schema, definition)` validates and binds generated columns to one Entity schema. The generated `EntityColumnDefinition` comes from the package's `./codegen` entry point. `EntityQuery.select({ schema, columns, context })` starts a builder. It supports `where`, `orderBy`, `limit`, and `build`, plus static predicates `eq`, `gt`, `lt`, `ge`, `le`, `all`, and `either`.

Predicates accept only columns registered for the selected Entity. `limit()` requires at least one order clause. The compiler packs declared values and the `version`, `archived`, and `deleted` system columns into the wire query. Builders and columns are immutable, so a predicate cannot be reused for a different Entity target.

## Code generation

Use `protoc-gen-spine-entity-columns` or the `@spine-event-engine/client-node/codegen` entry point only from a model-generation workflow. Generated code uses `GeneratedEntityColumns`; application code should import the generated definition, register it, and construct queries through the public API above.

This package is Node-only because it imports Node HTTP/2 and code-generation dependencies. Browser applications use `@spine-event-engine/client-web`.
