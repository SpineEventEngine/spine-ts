# Keep subscription identity with its lifecycle record

The app-node `SubscriptionRecord` is a TS-maintained Proto definition, listed in
`ownedSources` in `spine-sources.json`. It is outside the frozen JVM descriptor
set. Add reader binding to this record while preserving fields 1–5, its type,
storage namespace and columns. Update its maintained-source checksum through the
normal generation procedure. The frozen descriptor baseline stays unchanged.

Add field 6 referencing `SubscriptionReaderBinding`, with an explicit oneof for
a nonblank application principal ID or anonymous admission (`google.protobuf.Empty`).
The browser's `GatewayAuthenticatedSubscription` can reference the same message.
There are three distinct states: an authenticated principal, explicitly admitted
anonymous access, and missing or unset identity from an older record. Missing
identity must never grant anonymous access or be filled from the next caller.

Persist only stable identity. Attributes and authority facts come from the
verified invocation; a reconnect with the same principal ID can supply different
facts. Credentials are never part of the binding.

Creation stores the subscription, binding, pending status and deadline together.
Activation and cancellation compare the expected reader on every record reread
after a failed compare-and-set. Identical-create detection also compares binding,
including recovery from an ambiguous write failure. Canonical actor and tenant
checks remain separate.

Check identity before acknowledging activation, attaching a listener, closing a
queue, aborting a stream or deleting a record. Browser cancellation must perform
the same check before aborting its local stream. An unknown ID retains idempotent
cancellation, without deleting a new record that appears afterward. Trusted
expiry and internal cleanup remain separate from caller-directed operations.

Older records stay structurally readable so recovery of valid subscriptions can
continue. They cannot be activated or cancelled by a caller without a verifiable
binding; the caller must create a fresh subscription. Recovery must not attach
such records as anonymous subscriptions. Older binaries lack these checks, so a
mixed-version deployment cannot promise this identity protection.

The existing single-record compare-and-set provides the needed atomic boundary.
A sidecar would introduce partial writes and orphan cleanup without a portable
cross-record transaction. A wrapper would unnecessarily change storage-family
integration. Unknown-field encoding is unsuitable because some providers discard
unknown fields.

Verify reopen/restart, principal changes with identical actor/tenant, explicit
anonymous access, missing or malformed legacy bindings, changing authority facts,
ambiguous writes, contended activation/deletion, and foreign cancellation without
disturbing the current stream. Failures must leave complete bound records and
must not change another reader's subscription.
