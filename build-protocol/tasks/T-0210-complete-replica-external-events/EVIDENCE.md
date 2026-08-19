# T-0210 Evidence

## Baseline and authority

- Spine TS baseline: `origin/main@bc45eae2008589daf50c9b668360ed6ea65d1e2a`.
- Governing plan: `build-protocol/planning/T-0203_COMPLETE_REPLICA_DEPLOYMENT_PLAN.md`,
  especially complete-replica construction, external-event-caused change,
  RED 17–19/29, and T-0210.
- Wave 13 broker authority: the completed `T-0200`, `T-0201`, and `T-0204`
  records and their focused behavior suites.

## Intended behavioral chain

`CommandService -> Todo CommandBus -> domestic TaskCreated -> context-owned
IntegrationBroker -> generated external receptor -> LocalProjectionInbox ->
remote Delivery -> projection state -> native subscription child -> Coordinator
logical subscription`.

For the second case the chain begins with
`ThirdPartyContext.emittedEvent()` and otherwise remains identical.

## Retained RED — valid generated custom type URL is rejected

The real managed-process fixture reaches normal context construction, but its
consumer broker cannot create the `TaskCreated` event channel. The Todo Proto
declares the schema's `type.spine.examples.todo` prefix; `TypeUrls.derive()`
returns that exact URL. The default `InMemoryTransportFactory` rejects it with
`Message channel targetType must be a canonical type URL`, because its channel
validation allows only `type.spine.io` and `type.googleapis.com`.

This failure proves an adapter/product defect, not a fixture shortcut or a
newly invented deployment requirement. T-0210 does not modify the adapter.
The fixture and this evidence are retained as the RED checkpoint for the
separately owned transport correction.
