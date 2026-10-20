# @spine-event-engine/client-react reference

This reference records the exact public contract of `@spine-event-engine/client-react`.
Start with the [React adapter overview](README.md) for a first integration.

## Provider and hooks

`SpineClientProvider` accepts a `ClientRequest` supplied by the application from `@spine-event-engine/client-web`. `useSpineClient()` reads that scope and throws when no provider exists. Create the client and scope outside render, keep them stable, and close the client in application lifecycle code.

`useRequest(factory, dependencies)` starts an asynchronous operation after commit and returns `idle`, `loading`, `success`, or `error`. Its factory receives an `AbortSignal`; forward it to the cancellable work. Cancellation is cooperative: ignored signals can leave external work running, but a retired generation never publishes its late result.

`useEntityQuery(query, dependencies)` is `useRequest` for public `request.send(query, { signal })`. `useEntitySubscription(topic, authoritativeQuery, dependencies, onDelivery?, onLifecycle?, options?)` creates and activates an Entity subscription after commit. Its optional trailing callbacks receive every respective delivery or lifecycle notice synchronously before React publishes the coalesced observation field. Callback identities are excluded from subscription identity: replacing a committed callback does not recreate the subscription. Each callback remains bound to the active committed subscription generation and handle; retired handles and uncommitted renders cannot invoke it. If either callback throws, the hook publishes that error as its observation error and cancels the subscription once. `useEventSubscription(createSubscription, dependencies, onDelivery?, onLifecycle?, options?)` observes an application-created Event subscription, including a group of Event and rejection types. It uses the same per-delivery and per-lifecycle callback rules as the Entity hook. Use `onDelivery` when each update matters: several deliveries can be combined into one React render, so the latest observation is not an update queue. `useSubscriptionDelivery` and `useSubscriptionLifecycle` select the latest independently delivered fields.

Do not use `useRequest` to post Commands automatically from an effect: React
can restart effects, causing another Command to be sent. Call `postAndSubscribe`
from the user action, consume its returned updates in one asynchronous task,
handle errors, and cancel on component retirement. Do not give that same stream
to a subscription hook as well. The Message Board posting form demonstrates
this pattern while its board-view Entity subscription remains active.

Both subscription hooks accept a final options object with optional
`activationTimeoutMs`. The Entity hook also accepts `firstUpdateTimeoutMs` and
`onFirstUpdateTimeout`; an Event factory supplies these to `createSubscription`.
Neither timeout has a default. The first-update callback is a one-time delay
notification, not a request to terminate the stream. It receives the handle for
explicit cancellation, and late updates remain deliverable. A successful
Entity resynchronization counts as a delivery even if its authoritative result
is empty. See the browser reference for callback error and timing semantics.

Changing either timeout value recreates the corresponding subscription. For
the Entity hook, adding or removing the first-update callback also recreates
it; replacing an existing callback uses its latest committed version without
restarting. Event factories follow their supplied dependency list: include
values that change the subscription they create.

## Subscription lifecycle

Each hook generation creates one subscription and cancels it when retired. A late factory result, activation, update, lifecycle notice, callback, iterator failure, or query result from a retired generation is not published. Strict Mode can mount, unmount, and remount components; each still-live generation activates at most once. Cleanup invokes bounded idempotent `cancel()` and does not turn cleanup failure into a rendered error.

Entity recovery uses the supplied authoritative query and can publish a `resynchronization` delivery. Event recovery may publish `gapPossible`; it does not mean history was replayed or complete. Updates and lifecycle notices have no cross-stream ordering guarantee. The adapter provides no cache, normalized state, SSR support, Suspense integration, service-worker support, or external state-manager integration.

React is a peer dependency. The hooks are the only API here named `use...`; client requests retain the protocol verbs from `client-web`.
