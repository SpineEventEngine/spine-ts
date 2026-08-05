# T-0115 Subscription Runtime Cutover Map

Status: Accepted implementation guidance after demonstrated blocker

## Runtime Owner

Add package-internal `packages/server/src/stand/subscription-runtime.ts` with a
`SubscriptionRuntime` receiving the domain Stand, System Stand, domain
EventBus, System EventBus, and shared `StandSubscriptionRegistry`.

It owns exactly one registry, ten-second timer, reconciliation tail, attachment
map, consumer map, and coalesced terminal close. Keep it absent from the public
server root. Package-internal access supplies start, consume, explicit
reconcile/remove for tests and convergence, registry lookup, and phased
begin/drain/finish close operations on the same close state.

## Stand Cutover

Move subscription consumers, attachments, both observed buses, reconciliation
tail/timer, start/consume/remove/reconcile, attach/detach/notify, local
attachment records, and the corresponding weak maps out of `Stand`.

Keep on each Stand:

- storage context/factory and entity-storage handles;
- state registrations and state metadata;
- direct state subscribers;
- query/read/update in-flight work;
- Stand-local terminal close.

Give `standAccess` only narrow operations to classify domain state metadata and
create an event observer on domain Stand/domain bus or a state observer on
System Stand/system bus. The System Stand receives domain metadata as an
argument and does not copy entity state.

Make Stand close attempt every entity handle, clear every handle/subscriber in
`finally`, and aggregate failures after all hooks run.

## Observer Routing

Split observer construction into unambiguous `observeEvent()` and
`observeState()` operations. Runtime attachment performs one branch using
domain Stand metadata:

- missing state metadata: domain-event observer through domain Stand and
  domain EventBus;
- present state metadata: Entity observer through System Stand and System
  EventBus using `EntityStateChanged`.

One subscription ID/revision has one attachment. Both routes notify the same
runtime consumer map and active client stream. Never attach one target to both
buses.

## Subscription Service

Keep registry create/activate/delete/get behavior unchanged. Replace Stand-level
consumer attachment with `boundedContextAccess.consumeSubscription(context,
id, onUpdate)`. Preserve the structural fake-context fallback used by unit
tests. Ten-second complete-snapshot reconciliation remains authoritative for
deletion convergence.

`BoundedContext` owns the runtime rather than a standalone registry.
`boundedContextAccess.subscriptionRegistry()` delegates to the runtime, and a
new internal context-level consume operation delegates to it. Retain one
context-to-runtime weak map and clear it during cleanup.

## Construction And Partial Cleanup

Perform repository/dispatcher preflight and mixed domain/system classification
before acquiring resources. Then acquire in order:

1. system spec and optional system EventStore;
2. system-role EventBus, which assumes optional store ownership;
3. System Stand;
4. domain EventStore and domain-role EventBus;
5. domain Stand and CommandBus;
6. shared registry using the existing domain subscription namespace;
7. unstarted SubscriptionRuntime;
8. context tenant index, repository storage/bindings, registrations, and
   metadata;
9. start runtime only after every state registration is complete.

On synchronous build failure, preserve the original immediate error and start
best-effort cleanup of every acquired resource in dependency order. Once a bus
owns a store, do not close that raw store separately. Catch every async cleanup
rejection. Clear every weak-map/binding/tenant/storage resource acquired before
failure.

## Terminal Close

`BoundedContext.close()` memoizes one promise and never retries hooks:

1. begin-close domain CommandBus and EventBus;
2. drain domain command/event work while system publication remains open;
3. finish-close domain buses/store;
4. begin runtime close, reject new consumers/reconciliation, and clear timer;
5. begin and drain System EventBus after domain publication is impossible;
6. drain runtime reconciliation; prevent late gated attachment; detach every
   observer despite independent failures; clear attachment/consumer maps;
7. finish System EventBus/optional store;
8. close domain Stand and System Stand;
9. finish runtime close and close shared registry exactly once;
10. close tenant index, clear repository bindings, close repository storage,
    and delete pair metadata.

Flatten nested `AggregateError` values in encounter order and throw one
`BoundedContext close failed` aggregate after attempting every hook. Repeated
close returns the same promise and rejection object.

## RED Sequence

1. Add runtime tests for one initial snapshot, one ten-second timer, complete
   snapshots, and timer removal.
2. Move Stand reconciliation cases: revision fencing, deletion detachment,
   activation/restart, consumer rollback, and gated close.
3. Prove Entity targets attach only to System EventBus and domain-event targets
   only to domain EventBus, with one delivery per ID/revision.
4. Prove SubscriptionService entity/event activation uses the same runtime,
   duplicate activation remains inert, and structural test fallback survives.
5. Add partial-build failure table covering bus/Stand/registry/tenant/repository
   acquisition and zero leaked metadata/timers/resources.
6. Inject snapshot, consumer, observer-unsubscribe, and Stand-handle close
   failures; prove later work and remaining cleanup continue.
7. Add one terminal-order/aggregation test gating domain work that posts a
   system event, injecting independent failures, and proving order, flattened
   errors, exact-once hooks, same close outcome, and zero remaining resources.

## Compatibility Traps

- Remove any default that substitutes the domain bus for an omitted system bus.
- Background reconciliation must catch its own rejection; explicit
  reconciliation/consume still surfaces failures.
- Preserve the domain subscription storage namespace, not the System Context
  name.
- Preserve the current structural service-test fallback until an explicit
  adapter is separately approved.
- EventBus owns its EventStore after construction; avoid double close during
  partial cleanup.
