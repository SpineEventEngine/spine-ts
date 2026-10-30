# @spine-event-engine/client-web reference

This reference records the exact public contract of `@spine-event-engine/client-web`.
Start with the [browser client overview](README.md) for a first connection.

## Transports and request scopes

`Client.forGrpcWeb(baseUrl, options)` always uses gRPC-Web. `Client.forConnect` always uses binary Connect (`application/proto`). Connect is optional only when the selected gateway already supports it; neither factory probes or falls back to the other protocol. `Client.usingTransport(source, options)` accepts an application or platform `ClientTransport` containing a Connect transport and an optional close hook. Each `post()` creates its Command through the core signal-envelope helper, which assigns a fresh secure UUID-based Command ID.

`ClientOptions` select tenant, zone, bounded subscription settings, and an optional `onReauthenticateBeforeReconnect` callback. `BrowserClientOptions` also accept per-call synchronous metadata and Fetch credential mode. The application supplies metadata; the client does not log it. `asGuest()` and `onBehalfOf(user)` return immutable request scopes. An empty actor is rejected.

`post(schema, value, options)` returns `CommandAcknowledgement`: `ok` for acceptance, `error` with an admission error, or `rejection` with a rejection message. Acceptance does not mean that Command processing has finished; Events and rejections observed after processing are its outcomes. Command-envelope packing deliberately skips client-side Proto validation so the authoritative server can return its configured validation details. Commands are never retried. `send(query, options)` returns the raw validated `QueryResponse`. Caller cancellation and `client.close()` abort admitted work; transport, deadline, and wire-contract failures remain errors.

`send()` accepts a generated `StateQuery.create()...build()` value. The value has no actor or
tenant; each request scope applies its actor and the client's tenant to a fresh wire query, so
one value can be reused across scopes and clients.

## Browser sessions

`BrowserSession.cookie(options)` uses browser-managed cookies with Fetch credentials `include`; cookie values never enter JavaScript metadata. `BrowserSession.bearer({ token, ...options })` holds one bearer value only in memory with Fetch credentials `omit`. `replaceBearer` and `clearBearer` alter that memory value. Neither mode uses browser storage.

`session.fetch()` applies credentials and a finite deadline. Its default is ten seconds and the maximum is one minute. `reauthenticate()` asks an application-supplied callback for informational actor, tenant, and expiry facts; they are not credentials. `close()` aborts session work and clears bearer and informational context. Provider redirect, token exchange, storage policy, and authorization are application responsibilities.

## Subscriptions

`createSubscription(topic, options)` returns an inactive handle. `activate()` performs Subscribe and waits for a matching response-only successful ACK before reporting `connected`; an idle subscription can therefore become ready without a business update. A malformed, mismatched, failed, or missing ACK never establishes readiness. A duplicate ACK after readiness is a protocol error, not a business update. Cancel during a pending Subscribe or ACK rejects pending `activate()`. `cancel()` ends local iteration immediately and coalesces concurrent remote Cancel attempts. A failed attempt can be retried from the same handle; successful cleanup is terminal and idempotent. `updates` and `lifecycle` are independent single-consumer async streams with no cross-stream ordering guarantee. `client.close()` stops local subscriptions and attempts their remote cleanup. If cleanup fails, it rejects and keeps the transport available; a later explicit `close()` retries unfinished cleanup. New operations remain rejected once closure starts. Concurrent close calls share one attempt. `client.cleanupFailures` reports currently retained cleanup errors, including failures from setup that returned no subscription handle. A failed cancellation does not prove that the remote stream has stopped.

For Entity subscriptions, `authoritativeQuery` may return a generated query value and is evaluated
during authoritative reads, including recovery after reconnect. Its target must be byte-equivalent
to the Topic target. The returned query response is delivered as `resynchronization` before held
updates. For event subscriptions, reconnection reports `gapPossible`; events can be missing,
duplicated, or differently ordered, and no replay, completeness, or cluster-complete guarantee is made.
An RPC `NotFound` carrying a structured `spine.base.Error` detail with type
`TENANT_UNKNOWN` ends the subscription without recovery attempts. Other transient
transport failures retain the configured retry behavior.

The defaults are 64 queued updates, 1,048,576 queued update bytes, 32 lifecycle notices, five retry attempts, and 30,000 milliseconds of elapsed recovery. Every capacity, retry value, scheduler value, and custom delay is a positive safe integer. The default retry delay starts at 250 milliseconds with bounded jitter, caps at 5,000 milliseconds, and never falls below one millisecond. A stream connected for at least the configured elapsed-recovery window starts a fresh finite retry episode when it later fails; rapid failures remain in one episode and exhaust its limits. Overflow is terminal and never silently drops an update. `connecting`, `connected`, `resynchronizing`, `gapPossible`, `notificationFailed`, `failed`, and `closed` lifecycle notices describe that local subscription state.

## Several Event types and Command outcomes

`createSubscription([EventSchema, RejectionSchema, ...], { kind: "event", ... })`
observes all selected types through one subscription. The existing Topic form
remains available. Duplicate types are combined; an empty selection is rejected.
A group becomes ready only after every member is ready. Updates keep arriving
until cancellation or terminal failure; there is no expected outcome count and
no automatic completion after the first update. Independent streams have no
shared total order. If one member terminates, the group reports failure and
cancels the others; it does not silently continue with fewer selected types.

`postAndSubscribe(schema, command, options)` accepts `events` and `rejections`
schema arrays. It constructs one Command internally, activates subscriptions
filtered by that Command's complete Origin, then posts that same Command once.
It uses Spine JVM's immediate `Event.context.past_message` comparison, including
identity and actor context, rather than matching every signal in a causal chain.

An accepted result has `kind: "accepted"`, `acknowledgement`, and `subscription`.
A refused result has `kind: "refused"` and `acknowledgement`, without a
subscription handle. Refusal closes local streams and starts remote cleanup;
failed cleanup stays available through the client. Setup and transport failures
reject the call. An uncertain transport failure never triggers automatic repost.

The helper preserves updates that arrive before the acknowledgement. Consume
its continuing `subscription.updates` stream once, and handle
`subscription.lifecycle` separately. Application cancellation in a timeout
callback can close the handle before the accepted result returns.

## Optional startup timeouts

Neither `activationTimeoutMs` nor `firstUpdateTimeoutMs` has a default. Configured
durations must be integer milliseconds from 1 through 2,147,483,647, the
portable timer limit. Larger values are rejected rather than expiring early.

- `subscription.activate({ activationTimeoutMs })` limits initial Subscribe,
  activation acknowledgement, and setup retries together. Concurrent activation
  calls share the first attempt and its settings. The helper accepts the same
  option and does not post if activation fails. Expiry rejects with
  `SubscriptionActivationTimeoutError`, also exported by the Node client.
- Supply `firstUpdateTimeoutMs` with `onFirstUpdateTimeout(subscription)` when
  creating a subscription or calling the helper. The ordinary subscription's
  timer starts at readiness; the helper's timer starts just before posting.
  It fires once if no matching update arrives. It neither cancels the
  subscription nor determines whether the Command succeeded.
- The first actual update clears the timer at receipt, even before application
  code consumes it. Activation acknowledgements and lifecycle notices do not
  count. A successful authoritative Entity resynchronization does count, even
  when its result contains no rows; an empty live protocol envelope does not. After that first update, an indefinite quiet period causes no timeout.
  Reconnect does not restart the deadline. Cancellation or terminal failure
  clears it.
- The callback receives the subscription so it can explicitly cancel, even if
  the posting acknowledgement has not returned. A thrown error or rejected
  callback promise emits `notificationFailed` through `lifecycle`; update
  delivery continues.

These options do not change gateway request limits, abandoned server-definition
expiry, or finite reconnect budgets. A missing first update can reflect slow
processing or a missed notification. Continue observing late updates or check
application state; do not infer that resending the Command is safe.

## Errors and extension

`ClientProtocolError` identifies an invalid response under the public wire contract. Browser Web Crypto must be available for browser request identifiers; otherwise a request fails before transport work. An injected transport closes only when it supplies `close()`.

Use the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md) for gateway, Envoy, authentication extension, and deployment guidance. The guide is customizable guidance, not an enforced policy.
