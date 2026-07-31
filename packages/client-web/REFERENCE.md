# @spine-event-engine/client-web reference

This reference is for agents and other automated tools that need the exact public contract of `@spine-event-engine/client-web`.

## Transports and request scopes

`Client.forGrpcWeb(baseUrl, options)` always uses gRPC-Web. `Client.forConnect` always uses binary Connect (`application/proto`). Connect is optional only when the selected gateway already supports it; neither factory probes or falls back to the other protocol. `Client.usingTransport(source, options)` accepts an application or platform `ClientTransport`, including a request-ID factory and optional close hook.

`ClientOptions` select tenant, zone, bounded subscription settings, and an optional `onReauthenticateBeforeReconnect` callback. `BrowserClientOptions` also accept per-call synchronous metadata and Fetch credential mode. Metadata is application-owned; the client does not log it. `asGuest()` and `onBehalfOf(user)` return immutable request scopes. An empty actor is rejected.

`post(schema, value, options)` returns `ClientOutcome`: `ok`, `error` with an application error message, or `rejection` with a rejection message. Command-envelope packing deliberately skips client-side Proto validation so the authoritative server can return its configured validation details. Commands are never retried. `send(query, options)` returns the raw validated `QueryResponse`. Caller cancellation and `client.close()` abort admitted work; transport, deadline, and wire-contract failures remain errors.

## Browser sessions

`BrowserSession.cookie(options)` uses browser-managed cookies with Fetch credentials `include`; cookie values never enter JavaScript metadata. `BrowserSession.bearer({ token, ...options })` holds one bearer value only in memory with Fetch credentials `omit`. `replaceBearer` and `clearBearer` alter that memory value. Neither mode uses browser storage.

`session.fetch()` applies credentials and a finite deadline. Its default is ten seconds and the maximum is one minute. `reauthenticate()` asks an application-supplied callback for informational actor, tenant, and expiry facts; they are not credentials. `close()` aborts owned session work and clears bearer and informational context. Provider redirect, token exchange, storage policy, and authorization are application responsibilities.

## Subscriptions

`createSubscription(topic, options)` returns an inactive handle. `activate()` performs Subscribe; `cancel()` is terminal, ends local iteration, and performs at most one bounded remote Cancel per accepted wire. `updates` and `lifecycle` are independent single-consumer async streams with no cross-stream ordering guarantee. `client.close()` terminally closes every owned subscription.

For Entity subscriptions, `authoritativeQuery` is evaluated only after reconnect. Its target must be byte-equivalent to the Topic target. The returned query response is delivered as `resynchronization` before held updates. For event subscriptions, reconnection reports `gapPossible`; events can be missing, duplicated, or differently ordered, and no replay, completeness, or cluster-complete guarantee is made.

The defaults are 64 queued updates, 1,048,576 queued update bytes, 32 lifecycle notices, five retry attempts, and 30,000 milliseconds of elapsed recovery. Every capacity, retry value, scheduler value, and custom delay is a positive safe integer. The default retry delay starts at 250 milliseconds with bounded jitter, caps at 5,000 milliseconds, and never falls below one millisecond. Overflow is terminal and never silently drops an update. `connecting`, `connected`, `resynchronizing`, `gapPossible`, `failed`, and `closed` lifecycle notices describe that local subscription state.

## Errors and extension

`ClientProtocolError` identifies an invalid response under the public wire contract. Browser Web Crypto must be available for browser request identifiers; otherwise a request fails before transport work. An injected transport closes only when it supplies `close()`.

Use the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md) for gateway, Envoy, authentication extension, and deployment guidance. The guide is customizable guidance, not an enforced policy.
