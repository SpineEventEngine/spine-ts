# @spine-event-engine/client-web

Framework-neutral, browser-safe Spine protocol client. Applications inject a
Connect `Transport` and request-ID source. Concrete gRPC-Web and Connect
browser factories arrive in A3. Reconnect, signal-lifetime composition, bounded
queues, overflow, and gap/resynchronization lifecycle arrive in A4.

The public protocol verbs are `post`, `send`, `createSubscription`, `activate`,
and `cancel`. A subscription is created inactive, then activated explicitly.
