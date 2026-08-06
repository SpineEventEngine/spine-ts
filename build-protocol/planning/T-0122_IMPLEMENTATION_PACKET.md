# T-0122 Implementation Packet

This packet resolves the demonstrated implementation blocker without changing
the approved T-0122 scope or creating another human-facing task.

## Single Reconciliation Owner

`DynamicUnaryForwarder` remains the only membership/generation owner. Extend
its desired state to include the complete node set, logical subscription
definitions and activation state, node clients, ephemeral definition/node
children, retryable cleanup, one generation, one latest pending snapshot, and
one shutdown fence.

`DynamicSubscriptionCreator` is an adapter into that owner. It has no queue,
timer, scheduler, or generation counter. `DynamicUnaryClient` also implements
the existing per-node `SubscriptionCreator` operations. Browser-created
`NativeSubscriptionCreator` values already provide both unary and subscription
operations and keep their `Http2SessionManager` as the owned node resource.

Membership, Activate, Cancel, and close mutations synchronously change desired
state, increment the shared generation, replace the single pending state, and
await that generation's bounded acknowledgement.

## Logical Binding Contract

Keep `BackendSubscriptionEnvelope` only as an ephemeral per-node native seam.
The logical coordinator receives canonical `PublicSubscriptionWire`
definitions.

- `SubscriptionCapacityReservation` exposes the final logical ID before native
  Subscribe begins.
- `SubscriptionBindings.create()` persists the canonical definition, principal,
  tenant, expiry, and reservation—not backend envelope or topology.
- Remove topology arguments and `topologyFencing` from bindings, Gateway
  options, and private Gateway methods.
- Cleanup callbacks consume logical definitions and route ephemeral cleanup
  through the shared owner.

Subscribe orders reserve ID, build the trusted canonical definition, create
ephemeral children on current nodes, persist v4, then return that same public
definition. Failure compensates every child and releases the reservation.
Zero membership fails before persistence.

Activate claims the durable definition before registering it with the owner.
Zero membership keeps activation logically alive. Only downstream abort,
explicit Cancel, expiry, or Gateway close ends local activation ownership.

## Durable V4 Cutover

`DurableSubscriptionBindings` writes only
`spine.gateway.SubscriptionBinding:v4` with binding version 4.

- Replace topology/backend fields with canonical `definition` and
  `definitionBytes`.
- Preserve lifecycle coordination fields: ID/admission token, revision,
  lifecycle, fence, principal, tenant, expiry, owner/lease, and cleanup reason.
- Ownership never compares node membership.
- Quota/control rows retain version 1 under the v4 namespace.
- Delete all v3 reads, fixtures, migration paths, dual writes, and legacy
  defaults. The versioned key makes old development rows invisible.

## Ephemeral Child Lifecycle

Keep at most one child for `(definition ID, node ID, definition token, node
incarnation)`. A child owns its backend envelope, activation controller,
activation completion, and installation generation/token.

Removal first removes/fences live routing, then aborts controllers, cancels or
disposes children, joins or retains failed cleanup, and finally closes the node
client.

Addition creates the node client under the shared bound, checks generation and
incarnation, native-subscribes the topic under the same bound, rechecks
definition/generation, installs the child, and starts Activate without awaiting
stream termination. Late completion may remove only its exact installed token.
Unexpected completion may emit the existing loss notice but never deletes the
logical definition.

## Cancel, Close, And Restart

Cancel durably transitions to cancelling and increments its fence, removes the
logical definition from desired state, increments the shared generation before
awaiting, aborts/joins all children, performs cancel/dispose, and retires the row
only after cleanup succeeds. Failed cleanup remains durable/retryable; later
membership cannot reactivate the tombstone.

Browser close retains ordered phase-safe cleanup: fence admission, close the
SubscriptionGateway, stop discovery input, close the shared owner, close the
listener, then close the native server. Startup rollback attempts every
relevant phase even after failure.

Restart reads only v4 logical definitions and creates fresh ephemeral children
from the currently discovered set.

## Browser Assembly And Deletions

- Dynamic discovery drives the shared owner for unary and subscriptions.
- Fixed `baseUrl`/`baseUrls` become a static complete membership input through
  the same owner.
- Retain non-empty/canonical/unique validation but delete the 32-node cap.
- Delete topology hashing/fencing, positional child indexes/envelopes,
  `FanInSubscriptionCreator`, and old 1-to-32 subscription validation.
- Retain `RoundRobinUnaryForwarder` only if a current caller still needs it.

## RED And Checkpoint Order

1. Dynamic creator tests: add/remove/re-add, repeated/reordered snapshots,
   add-versus-activate, and stale completion.
2. Churn, zero-node recovery, cancel/close races, failed cleanup, and 40-node
   bounded full fan-in.
3. Logical binding tests: final reservation ID, canonical definition, ownership,
   tenant, and no topology argument.
4. Durable tests: exact v4 key/version/definition, absence of topology/backend,
   changed-topology restart, and no v3 read/migration.
5. Server tests: fixed static membership, dynamic unary plus streams, 40 nodes,
   and retryable shutdown phases.
6. Deterministic scans delete v3, topology fingerprint/fencing, positional
   envelope, fan-in creator, and old cap wording.

Push checkpoints after RED evidence, shared-owner GREEN, logical/v4 GREEN,
Browser/deletion GREEN, and focused preflight/docs. Run one `verify:release`
after review convergence.
