# @spine-event-engine/testing

`BlackBox` starts an ephemeral local server and exposes a Node-backed shared
client scope. Scopes use the protocol verbs `post`, `send`, and
`createSubscription`; subscriptions are inactive until `activate()` and must
be ended with `cancel()`.

```ts
const response = await alice.send(taskListQuery);
const subscription = await alice.createSubscription(topic);
await subscription.activate();
await subscription.cancel();
```

`BlackBox.close()` cancels tracked subscriptions, closes its client, and closes
the local server.

`BlackBox` also retains its public `postEvent`, `eventually`, tenant, zone, and
timeout workflows. Set tenant and zone on a scope before issuing protocol work;
the supplied timeout bounds polling and must be a positive finite duration.
`eventually` is for observable asynchronous consequences, not a replacement for
asserting the immediate command outcome. The helper runs only against its local
ephemeral server and does not provide cross-process, browser, authentication, or
production-persistence coverage.
