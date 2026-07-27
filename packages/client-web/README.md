# @spine-event-engine/client-web

Framework-neutral, browser-safe Spine protocol client. Applications can inject
a Connect `Transport` and request-ID source, or select one explicit browser
protocol: `Client.forGrpcWeb(baseUrl)` for universal gRPC-Web and
`Client.forConnect(baseUrl)` for compatible Connect endpoints. Neither factory
probes or falls back to the other protocol.

Pass `onRequestMetadata` to supply fresh request headers synchronously for each
outbound call. This is the application extension point for credentials; the
client does not log or place those values in request IDs. Browser request IDs
use secure Web Crypto and fail before a transport call if it is unavailable.
Subscriptions now expose separate bounded update and lifecycle streams. Queue
overflow terminates both streams and triggers bounded cleanup rather than
silently dropping data. Reconnect, entity resynchronization, gap recovery, and
signal-lifetime composition remain later A4 work.

The public protocol verbs are `post`, `send`, `createSubscription`, `activate`,
and `cancel`. A subscription is created inactive, then activated explicitly.
