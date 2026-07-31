# @spine-event-engine/client-react reference

This reference is for agents and other automated tools that need the exact public contract of `@spine-event-engine/client-react`.

## Provider and hooks

`SpineClientProvider` accepts an application-owned `ClientRequest` from `@spine-event-engine/client-web`. `useSpineClient()` reads that scope and throws when no provider exists. Create the client and scope outside render, keep them stable, and close the client in application lifecycle code.

`useRequest(factory, dependencies)` starts an asynchronous operation after commit and returns `idle`, `loading`, `success`, or `error`. Its factory receives an `AbortSignal`; forward it to the cancellable work. Cancellation is cooperative: ignored signals can leave external work running, but a retired generation never publishes its late result.

`useEntityQuery(query, dependencies)` is `useRequest` for public `request.send(query, { signal })`. `useEntitySubscription(topic, authoritativeQuery, dependencies)` creates and activates an Entity subscription after commit. `useEventSubscription(createSubscription, dependencies)` observes an application-created event subscription. `useSubscriptionDelivery` and `useSubscriptionLifecycle` select the latest independently delivered fields.

## Subscription lifecycle

Each hook generation owns one subscription and cancels it when retired. A late factory result, activation, update, lifecycle notice, iterator failure, or query result from a retired generation is not published. Strict Mode can mount, unmount, and remount components; each still-live generation activates at most once. Cleanup invokes bounded idempotent `cancel()` and does not turn cleanup failure into a rendered error.

Entity recovery uses the supplied authoritative query and can publish a `resynchronization` delivery. Event recovery may publish `gapPossible`; it does not mean history was replayed or complete. Updates and lifecycle notices have no cross-stream ordering guarantee. The adapter provides no cache, normalized state, SSR support, Suspense integration, service-worker support, or external state-manager integration.

React is a peer dependency. The hooks are the only API here named `use...`; client requests retain the protocol verbs from `client-web`.
