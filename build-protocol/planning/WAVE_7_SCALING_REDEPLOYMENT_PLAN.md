# Wave 7: Scaling And Redeployment

Status: Execution authorized; corrected dependency split complete

Planning task: `T-0120`

Baseline: `origin/main@e6666605`

## Outcome

Wave 7 will let one standalone Gateway follow a changing set of identical
application nodes on GKE or GCE. Cloud infrastructure performs scaling and
replacement; Spine TS discovers the resulting nodes, connects subscriptions to
all of them, and preserves the durable work already established in Waves 5 and 6.

Cloud Run is not part of the initial offering. Multiple Gateways, operational
logging adapters, the next `validation-ts` upgrade, and storage-layout tuning
belong to Wave 8.

## Approved Package Boundaries

- `@spine-event-engine/deployment` contains platform-neutral node discovery,
  bounded reconciliation, and the storage-backed leased registry contract.
- `@spine-event-engine/deployment-gke` contains GKE-specific assembly,
  Terraform, and guidance. It uses headless-Service DNS rather than the leased
  registry.
- `@spine-event-engine/deployment-gce` contains GCE metadata integration, node
  registration, Terraform, and guidance. It uses the generic leased registry.

Platform packages do not choose domain storage, authentication providers,
business logic, or scaling policy.

## GCE Registry Ownership

The proposed registry is a discovery directory, not a domain repository and
not the Stand subscription registry.

Each running application node maintains exactly its own leased record. The GCE
package attaches a registrar to the application server lifecycle:

1. The application opens its gRPC listener.
2. The registrar obtains a stable GCE instance identity and the endpoint that
   other private-network participants can reach.
3. It writes one record through the explicitly supplied registry
   `StorageFactory`.
4. It renews that record every 20 seconds with a 60-second expiry.
5. On graceful shutdown it fences new registrar work, quiesces initial
   registration/renewal/cleanup operations, conditionally deletes its own
   record, and only then closes the listener. A crashed node cannot delete
   anything, so its record simply expires.

The Gateway is a reader. Every 10 seconds it obtains the complete set
of non-expired records and reconciles its gRPC clients. It does not register
application nodes and does not decide how many nodes should exist.

The internal record needs only a stable node ID, reachable gRPC endpoint,
lease expiry, and an opaque registration identity. Conditional renew/delete by
registration identity prevents an old process from overwriting or deleting a
new process that reused the same node ID. Its internal encoding version is 1
and its initial storage key is `spine.deployment.ApplicationNodeLease:v1`.
Readers accept only well-formed version-1 records. A malformed record or unknown
encoding version fails the complete snapshot read; it is never silently omitted,
deleted, or rewritten. The Gateway retains its last still-valid applied snapshot
and retries discovery. An incompatible future record shape uses a new storage
key rather than dual-reading, dual-writing, or migrating this one.

Expired rows are ignored immediately. Each healthy registrar also performs a
finite, idempotent expired-row cleanup after renewing, so abandoned records do
not accumulate. If all application nodes scale to zero, expired rows are
harmless and the first later node resumes cleanup.

The default endpoint is the GCE instance's private address plus the configured
gRPC port. An explicit endpoint override supports proxies, private DNS, or
other network layouts. Publishing a public address is not a default.

## Node Identity And Endpoint Canonicalization

The platform-neutral node descriptor contains an opaque stable node ID, a
canonical HTTP(S) origin, and an optional TLS server name. An endpoint is valid
only when it is an absolute `http:` or `https:` URL with no credentials, query,
fragment, or non-root path. Canonicalization uses the URL origin: DNS names are
lowercase, default ports are removed, non-default ports are retained, and IPv6
literals use brackets. Equality and replacement decisions use that canonical
form rather than caller spelling.

For HTTPS, certificate verification and SNI use the explicit normalized TLS
server name when supplied and otherwise use the endpoint host. Resolving a DNS
name to an IP address must not silently replace its TLS authority. HTTP may use
private IPv4 or bracketed IPv6 literals directly.

GCE derives its stable node ID as
`gce/<project-id>/<zone>/<numeric-instance-id>` from metadata. Reuse of a
logical application label does not reuse that identity; a canonical endpoint
change for the same instance ID is a replacement. GKE DNS has no Pod UID, so
its node ID is derived from the canonical address origin plus TLS server name.
If an address is observed absent and later reused, the reconciliation
generation treats it as a fresh membership and cannot attach a stale client or
stream from its previous presence.

## GKE Discovery

A headless Kubernetes Service publishes the ready application Pods. The
Gateway resolves that Service and reconciles the complete address set on a
configurable ten-second interval. After a successful answer, the next lookup is
scheduled at the earlier of that interval and the answer's smallest positive
TTL. A zero or missing TTL uses the configured interval as the finite fallback
rather than causing a tight loop. The last successful answer remains usable
only until its positive TTL expires, or until the fallback interval expires
when TTL is zero/missing.

An empty answer or NXDOMAIN is a successful empty membership snapshot. A
resolver failure applies no replacement snapshot: the Gateway retains the last
successful answer only until that answer's validity deadline, then reconciles
to empty/backend-unavailable while retrying at the configured interval. A later
successful answer resumes normal precedence. Kubernetes readiness controls
whether a Pod appears. No storage-backed node registry or GCE-style registrar
is involved.

## Discovery Capacity

The default expected application-node count is 32. It is an operational
threshold, not a hard limit. When discovery returns more nodes, the Gateway
continues to reconcile and use all of them. It never selects an arbitrary
subset and never rejects subscriptions merely because the threshold was
exceeded.

Reconciliation uses bounded connection concurrency and finite work batches so
a large discovery change does not create one unbounded connection spike. Every
discovered node is nevertheless included after reconciliation completes.

Implementation load tests document tested and recommended capacity. They do
not create an absolute runtime maximum. Wave 8 operational logging emits an
ERROR when the discovered count exceeds the configured expectation. Wave 7
keeps the observed and expected counts package-internal and tests them for later
logging work. It exposes no public diagnostics/logging API and does not
introduce the Wave 8 logging subsystem early.

## Scaling And Replacement

Spine TS does not scale infrastructure. The GKE and GCE templates expose the
inputs that their platforms' autoscalers need, and the guide explains CPU,
request/load-balancer, and custom-metric examples. Optional autoscaling
resources are disabled until an operator chooses metrics, minimum and maximum
capacity, and thresholds.

The runtime supports:

- scaling one application version up and down, including zero nodes;
- overlap between compatible versions during a rolling replacement;
- stop-all/start-new replacement when business logic or serialized behavior is
  incompatible; and
- single-Gateway replacement with an explicit client interruption.

At zero application nodes, the Gateway reports backend unavailability. Durable
subscriptions and Inbox work remain stored. When nodes return, delivery and
subscription reconciliation resume. A scaling mechanism based only on
application-node CPU cannot wake a zero-node deployment; the platform guide
must use an external request or queue metric when scale-from-zero is required.

Pending Inbox messages may execute under the newly deployed business-logic
version. Wave 7 adds no framework version handshake and no automatic decision
about compatibility.

## Infrastructure And Documentation

Wave 7 supplies reusable Terraform modules and complete beginner guides for:

- GKE: Gateway, application Deployment, headless Service, simple delivery
  server, readiness, scaling, and rolling replacement;
- GCE: Gateway and simple delivery-server placement, managed application
  instances, leased discovery, scaling, and replacement; and
- operator-owned configuration, storage endpoints, secret references,
  monitoring inputs, and rollback.

The minimal GCE topology may colocate one Gateway and the one in-memory simple
delivery server. Production guidance recommends separate failure and resource
boundaries. Templates remain editable examples, not infrastructure enforcement.

## Q&A Closure

The human approved the registrar lifecycle, private-address default, package
boundaries, discovery mechanisms, timings, storage ownership, deployment
topologies, scaling boundary, and replacement semantics. No product question
remains before the dependency-ordered implementation split is finalized.

On 2026-08-06, the human instructed the autonomous process to start Wave 7.
This authorizes the dependency split and subsequent implementation, review,
integration, post-merge verification, and pushes without another routine
approval pause.

## Split Method And Cross-Slice Rules

The split applies the workflow, business-rule-variation, and simple/complex
patterns. Each runtime slice produces an observable end-to-end behavior before
the next platform variation is added. Package scaffolding, public contracts,
runtime behavior, infrastructure, and broad documentation are not mixed into
one review surface.

Every implementation slice must:

- start from the integrated and post-merge-verified endpoint of its dependency;
- create its own task, work, and review records before runtime or public-doc
  edits, including the applicable human-imposed requirements ledger;
- use one implementation owner for all overlapping production paths;
- add deterministic behavior tests in RED state before implementation, retain
  the RED command/output in the work log, and then make those same tests GREEN;
- run the cheap affected-scope preflight before specialist review and before
  any repeated expensive verification;
- record all four canonical review-concern dispositions, invoking only relevant
  existing reviewers and aggregating a complete review wave before fixes;
- commit and push every feature-branch checkpoint immediately; and
- leave npm publication, the future migration remote, Cloud Run, multiple
  Gateways, and Wave 8 logging out of scope.

The expected node count defaults to 32 in every applicable slice. It is
package-internal observation state, not admission control. In the completed
Wave 7 path, no collection validation, envelope encoding, batching policy,
connection pool, or infrastructure default may turn it into a runtime node
ceiling. A snapshot above the expectation is processed in bounded
connection-start batches until every discovered node is in use. Wave 7 exports
no count diagnostics, emits no structured ERROR, and adds no logging adapter;
Wave 8 owns public operational exposure.

One generation-fenced reconciliation owner serializes all membership work.
While one generation is reconciling, a newer complete snapshot replaces the
single pending snapshot; intermediate pending generations are coalesced rather
than queued. Every connection, disposal, and subscription completion carries
its generation and is discarded if a newer generation or shutdown fence makes
it stale. Close stops refresh input, prevents new work, waits for the active
generation to quiesce under its operation bounds, and then releases resources.

## Incompatible Pre-Wave-7 Cutover

The repository has no deployed users and requires no migration or deprecation
cycle. T-0122 may delete the fixed subscription-topology field and positional
fan-in envelope, and it bumps durable Gateway bindings from
`spine.gateway.SubscriptionBinding:v3` to `:v4`. It must not add a legacy
reader, dual-write path, migration command, compatibility shim, or pre-Wave-7
restart fixture. Pre-Wave-7 development data is discarded. This cutover does
not remove fixed backend configuration as a static discovery input; it removes
the old topology from durable subscription identity.

## Dependency-Ordered Implementation Slices

### T-0121: Dynamic Discovery And Unary Gateway Routing

**Depends on:** T-0120 only.

**Outcome:** A standalone Gateway can consume changing complete node snapshots,
maintain a bounded-concurrency connection set, and route commands and queries
across every currently discovered application node. This is the simplest
complete dynamic-discovery path; subscription reconciliation follows in
T-0122.

**Ownership:** One implementation owner exclusively owns the new
`packages/deployment/**` package, its tests and package docs; the dynamic unary
pool changes in `packages/auth/src/gateway/**`; standalone browser-Gateway
assembly in `packages/server/src/server/**`; and only the root workspace,
package metadata, and API-reference entries required to expose those packages.
No later platform package is created in this slice.

**Observable acceptance criteria:**

- A platform-neutral discovery source returns a complete snapshot of stable
  node IDs, canonical private-network HTTP(S) origins, and optional TLS server
  names, including an empty snapshot. It applies the shared identity,
  authority, IPv6, and address-reuse rules above and supports
  cancellation/closure without leaving timers or connection attempts alive.
- A configurable refresh policy defaults to ten seconds. Deterministic tests use
  an injected clock/scheduler and do not wait on wall-clock time.
- Adding, removing, replacing, reordering, or repeating a node in successive
  snapshots converges to exactly the latest complete set. Endpoint change for
  the same stable ID is treated as replacement; identical repeated snapshots
  cause no duplicate client creation.
- Exactly one generation-fenced reconciliation loop owns topology changes. If
  snapshots B and C arrive while A is still reconciling, only latest pending C
  follows A; B is coalesced. Late work from A cannot mutate C's client set.
- Commands and queries use bounded round-robin over the reconciled current set,
  are never broadcast, and are never automatically retried after dispatch.
- Zero nodes produces the existing backend-unavailable behavior. When a later
  snapshot contains nodes, routing resumes without restarting the Gateway.
- Connection creation and disposal are cancellation-fenced and bounded by an
  explicit concurrency setting. Snapshot processing uses finite batches while
  eventually including every node.
- A snapshot containing at least 40 nodes proves that the default expected
  count of 32 is not a cap: all 40 become routable. Package-internal tests retain
  `observed = 40` and `expected = 32`; no public count API or ERROR log is added.
- Existing fixed backend configuration remains available as a static discovery
  input for local/combined usages. T-0121 separates unary child validation from
  the shared fixed `FanInSubscriptionCreator` validation so a 40-node dynamic
  unary pool is routable. The fixed positional subscription fan-in and its
  1–32 validation remain untouched and unused by dynamic discovery until
  T-0122 deletes them.

**RED-first tests:** package-contract/export tests; stable opaque ID validation,
endpoint canonicalization, TLS authority, IPv6, and observed address-reuse
tests; fake-discovery add/remove/replace/reorder/idempotence tests; A/B/C churn
proving latest-pending coalescing and stale-generation fencing; fake-clock
refresh and shutdown tests; bounded connection-start tests with stalled client
creation; zero-to-nonzero routing; no-retry unary failure; and unary-only
40-node all-used coverage. Capture the pre-implementation failures before
changing runtime code.

**Documentation obligations:** Add `README.md` and `REFERENCE.md` for
`@spine-event-engine/deployment`; document the discovery snapshot semantics,
node identity, endpoint/TLS canonicalization, refresh/cancellation ownership,
latest-pending coalescing, expected-count behavior, and bounded reconciliation.
Expected/observed count fields remain package-internal and absent from public
API docs. Update affected auth/server API prose without claiming GKE, GCE,
leases, logging, subscriptions through dynamic discovery, or autoscaling
behavior not implemented here.

**Review concerns:** style/maintainability, documentation, TypeScript/API docs,
and performance/reliability are all relevant. Public contracts, connection
concurrency, cancellation, and resource lifecycle require Terra/high review.
Per-task security review is N/A because discovery endpoints remain trusted
operator configuration and no authentication boundary changes.

**Verification:** `pnpm verify:release` after convergence because new public
package metadata and shared Gateway runtime behavior change. Focused tests and
affected-package checks form the mandatory preflight.

**Risks and exclusions:** The principal risks are stale connection completion,
an accidentally reintroduced count cap, and retrying a non-idempotent command.
This slice does not reconcile subscriptions, implement a leased registry,
remove the fixed positional subscription envelope/count validation, resolve
DNS, read GCE metadata, create Terraform, or emit operational logs.

### T-0122: Dynamic Subscription Reconciliation

**Depends on:** integrated T-0121.

**Outcome:** Existing durable subscription definitions follow the changing
node set, so one logical Gateway maintains a native stream on every discovered
application node without making node topology durable subscription identity.

**Ownership:** One implementation owner exclusively owns the dynamic
subscription code in `packages/auth/src/gateway/**` and
`packages/auth/src/subscriptions/**`, the discovery-to-subscription bridge in
`packages/deployment/**`, standalone assembly changes in
`packages/server/src/server/**`, and their focused tests/docs. T-0121's public
node-discovery contract changes only if RED evidence exposes a real blocker.

**Observable acceptance criteria:**

- A subscription activated while nodes A and B are present has one live native
  stream on A and B. Adding C activates the same durable definition on C;
  removing B stops only B's runtime stream and does not delete the shared
  definition.
- A node added concurrently with activation is included exactly once after
  reconciliation. Late activation/retry completions for a removed node cannot
  resurrect its stream.
- Subscription work runs inside T-0121's single generation-fenced
  reconciliation owner; it does not add a second queue or scheduler. Rapid
  membership churn retains only the latest pending complete snapshot.
- Reordering or replaying a discovery snapshot creates no duplicate streams.
  Duplicate best-effort updates remain allowed and clients still re-query
  authoritative state.
- At zero nodes, existing durable definitions remain stored and the Gateway
  reports backend unavailability. When nodes return, definitions reactivate
  without client re-subscription; a new Subscribe that requires backend
  creation reports backend unavailability while none is reachable.
- Cancel and Gateway close fence discovery and activation work. A concurrent
  Cancel joins the existing durable cleanup path, no later snapshot can
  reactivate it, and interrupted cleanup remains restart-recoverable.
- Logical subscription ID, principal ownership, tenant, and canonical
  Subscription definition are the complete durable identity. T-0122 deletes the
  fixed-topology fingerprint, ordered child indexes, and positional private
  fan-in envelope, then writes only the new
  `spine.gateway.SubscriptionBinding:v4` storage key. Restart against a
  different discovered node set accepts those v4 bindings without making
  membership durable identity or imposing a count-width ceiling.
- This is an intentionally incompatible cutover. No v3 read, migration,
  dual-write, compatibility shim, or pre-Wave-7 restart fixture is implemented;
  stale development records are discarded.
- Subscription stream starts use the same bounded connection/work policy as
  discovery. At least 40 discovered nodes receive one stream each even though
  the expected count is 32; no overflow rejection or arbitrary subset exists.

**RED-first tests:** active subscription add/remove/re-add; add-versus-activate
races; A/B/C latest-pending snapshot coalescing; stale completion fencing;
reordered/repeated snapshots; zero-node survival and recovery; v4 restart with
changed topology; explicit absence of v3/topology/envelope code and fixtures;
cancellation/close races; interrupted cleanup; and 40-node full fan-in with
bounded concurrent starts.

**Documentation obligations:** Revise deployment, auth, and server references
to distinguish durable logical definitions from ephemeral per-node streams and
to explain loss notices, duplicate tolerance, zero-node behavior, cancellation,
and reconnect/re-query semantics. Record the no-migration v4 cutover for
repository contributors without presenting a migration path to end users. Do
not promise complete notification history.

**Review concerns:** all four canonical concerns are relevant. Dynamic durable
subscription semantics, restart compatibility, cancellation, and concurrency
require Terra/high TypeScript/API and performance/reliability review. Security
is N/A because authentication remains solely at the one Gateway and its trust
boundary is unchanged.

**Verification:** `pnpm verify:release` because shared subscription runtime,
durable restart behavior, and cross-package assembly change.

**Risks and exclusions:** The main risks are deletion of the shared definition
on ordinary node removal, resurrection after cancellation, and durable state
tied to a transient topology. No platform adapter, registry, Terraform,
version-compatibility handshake, legacy binding migration, deduplication
history, public count diagnostics, or Wave 8 logging is in scope.

### T-0123: Storage-Backed Leased Node Registry

**Depends on:** integrated T-0122.

**Outcome:** `@spine-event-engine/deployment` provides a storage-neutral leased
registry that a later GCE registrar can write and the Gateway can read, with
atomic ownership fencing and finite abandoned-record cleanup.

**Ownership:** One implementation owner exclusively owns leased-registry
source/tests/docs in `packages/deployment/**` and the minimum internal persisted
schema source needed for its record. Existing storage packages may receive
provider-conformance tests, but no storage-layout tuning or provider-specific
physical controls. Generated Protobuf output remains untracked.

**Observable acceptance criteria:**

- Construction requires an explicit `StorageFactory` and a separate,
  operator-supplied logical storage namespace/context. No application domain
  storage factory or namespace is selected implicitly.
- Registration stores only stable node ID, canonical endpoint, expiry, and an
  opaque per-process registration identity as logical data. Its internal
  encoding version is 1 and its storage key is
  `spine.deployment.ApplicationNodeLease:v1`.
- A complete registry read accepts only well-formed version-1 records with a
  canonical endpoint. One malformed or unknown-version row fails that snapshot
  without returning a partial node set; the row is not deleted or rewritten.
  The discovery owner retains its last still-valid successful snapshot and
  retries. Incompatible future encoding uses a new versioned storage key, with
  no dual-read, dual-write, or migration layer.
- Register and renew use atomic compare-and-set storage. A factory without that
  capability is rejected before lifecycle work starts.
- A previous process cannot renew or delete a replacement process's record
  after the same node ID is reused. Conditional delete removes only the caller's
  registration identity.
- Reads return every well-formed record whose expiry is later than the supplied
  clock and omit expired records immediately. More than 32 live records are all
  returned.
- Cleanup is finite per pass, idempotent, safe under concurrent registrars, and
  repeatable until abandoned rows are gone. A healthy registrar can resume it
  after a scale-to-zero interval.
- Storage handles and in-flight operations close deterministically; timestamps,
  identities, and cleanup ordering are tested without wall-clock sleeps.

**RED-first tests:** two-handle registration collision/replacement fencing;
stale renew/delete; exact expiry boundary; exact v1 encoding/storage key;
malformed and unknown-version complete-read failure without partial membership
or mutation; 40-live-row read; concurrent cleanup; finite cleanup batches
across repeated passes; unsupported atomic storage; namespace isolation; and
close/cancellation. Run the registry conformance suite against in-memory
storage and the existing Datastore/RDBMS provider test paths available in the
repository.

**Documentation obligations:** Document explicit factory/namespace ownership,
record fields, atomic storage requirement, expiry versus physical cleanup,
scale-to-zero behavior, supported v1 reads, whole-snapshot failure on malformed
or unknown versions, versioned-key cutover policy, and the fact that the
registry is neither a domain repository nor the Stand subscription registry.
Public exports receive complete TSDoc; the persisted record stays out of the
end-user root unless generation policy makes a technical internal import
unavoidable.

**Review concerns:** all four concerns are relevant. Persistence compatibility,
compare-and-set correctness, identity fencing, cleanup bounds, and lifecycle
require Terra/high API and performance/reliability review.

**Verification:** `pnpm verify:release` because persistence, an internal
serialized record, and shared runtime behavior change.

**Risks and exclusions:** Risks are ABA-style ownership loss, clock-boundary
errors, cross-namespace collisions, and unbounded cleanup. GCE metadata,
registrar scheduling, legacy storage-key migration, DNS, provider layout
tuning, and infrastructure are not owned here.

### T-0124: GCE Registration And Discovery Runtime

**Depends on:** integrated T-0123.

**Outcome:** A GCE application node registers itself after its listener is
reachable, and a standalone Gateway follows live GCE nodes through the leased
registry across scale up, crash expiry, scale to zero, and return.

**Ownership:** One implementation owner exclusively owns the new
`packages/deployment-gce/**` runtime, tests, package metadata/docs, and the
minimum application-server lifecycle integration point in
`packages/server/**`. It consumes the generic registry and discovery contracts;
it does not edit GKE paths or infrastructure templates.

**Observable acceptance criteria:**

- The registrar obtains stable instance identity and private address through an
  injectable GCE metadata seam. Its node ID is exactly
  `gce/<project-id>/<zone>/<numeric-instance-id>`. By default it publishes the
  canonical private-address HTTP(S) origin plus configured gRPC port; an
  explicit canonical endpoint/TLS-server-name override wins for private DNS,
  proxies, or nonstandard layouts. IPv6 and TLS authority follow the shared
  canonicalization rules. Public address selection is never implicit.
- Registration starts only after the application gRPC listener reports ready.
  Defaults renew every 20 seconds with a 60-second expiry; fake-clock tests
  prove renewal cadence and expiry without sleeping.
- Each process creates a new opaque registration identity. Renewal, expired-row
  cleanup, and graceful conditional deletion use that identity. Graceful
  shutdown first fences new scheduled work, then aborts and waits for initial
  registration, renewal, and cleanup promises to settle under their individual
  operation deadlines. Only after no registry mutation can complete late does
  it conditionally delete its registration; only after that attempt settles
  does the listener close. Timeouts cannot detach a late mutation that could
  recreate the row after deletion.
- Crash simulation leaves the row present but undiscoverable at expiry. At
  zero live rows, the Gateway reports backend unavailability; starting a later
  node restores routing and durable subscription streams and resumes cleanup.
- The Gateway reads the complete live registry set every configurable ten
  seconds and uses every node, including at least 40 nodes. The expected count
  remains diagnostic and produces no Wave 7 ERROR log.
- Transient metadata, storage, and connection failures do not leak timers,
  handles, or unhandled rejections; later refresh/renew cycles can recover while
  lease expiry remains the authoritative crash-removal mechanism.

**RED-first tests:** exact GCE ID derivation; private endpoint default/override,
TLS authority, IPv6, and invalid endpoint; listener-ready ordering; 20/60
fake-clock cadence; restart with reused logical label but new numeric instance
ID; stale-process renew/delete fencing; stalled initial-registration,
renewal-versus-shutdown, and cleanup-versus-shutdown quiescence proving no late
write after conditional delete/listener close; crash expiry; registry read
failure and recovery; scale zero/return; and one-Gateway 40-node end-to-end
routing/subscription coverage.

**Documentation obligations:** Add GCE package README/reference for runtime
assembly, metadata permissions, private networking, explicit registry storage
and namespace, stable ID derivation, endpoint/TLS rules, timings, endpoint
override, failure semantics, and the exact quiesce/delete/listener shutdown
order. State that Terraform and beginner deployment procedures arrive in
T-0127.

**Review concerns:** all four concerns are relevant. Metadata trust,
registration identity, persistence, timers, shutdown order, retry recovery, and
resource ownership require Terra/high API and performance/reliability review.
No separate security lane is required because no new external authentication
surface is introduced.

**Verification:** `pnpm verify:release` because a public runtime package,
dependencies, server lifecycle, persistence, and cross-package behavior change.

**Risks and exclusions:** Risks are publishing an unreachable/public endpoint,
registering before readiness, stale deletion, and shutdown hangs. Terraform,
autoscaling policy, Cloud Logging, multiple Gateways, and GKE are excluded.

### T-0125: GKE DNS Discovery Runtime

**Depends on:** integrated T-0122. It may run after T-0124 to preserve the
single-writer sequence, but it does not depend on the GCE registry behavior.

**Outcome:** A standalone Gateway discovers ready GKE application Pods through
a headless-Service DNS name and follows scale up, scale down, zero, and return
without using the leased registry.

**Ownership:** One implementation owner exclusively owns the new
`packages/deployment-gke/**` runtime, tests, package metadata/docs, and the
minimum standalone Gateway assembly hook in `packages/server/**`. It does not
edit the GCE package or Terraform paths.

**Observable acceptance criteria:**

- The package resolves a configured headless-Service DNS name through an
  injectable resolver and converts the complete current address set into
  canonical HTTP(S) origins. Node IDs derive from canonical address origin plus
  TLS server name; IPv6 is bracketed, and HTTPS resolution preserves the
  configured Service DNS name as authority rather than silently replacing it
  with an IP. Kubernetes readiness is the membership authority; no storage
  registry or registrar is created.
- Refresh defaults to ten seconds and is configurable. After a successful
  answer, the next lookup occurs at the earlier of the configured refresh
  interval and the smallest positive TTL. Zero or absent TTL falls back to the
  configured interval for both refresh and validity, avoiding a tight loop. A
  positive answer is usable only through its TTL deadline.
- Empty/NXDOMAIN is an immediate successful empty snapshot. A resolver failure
  does not itself replace membership: the last successful answer remains only
  until its TTL/fallback deadline, then one empty snapshot is reconciled while
  retries continue at the configured interval. A later successful answer
  restores normal scheduling.
- Address reorder and duplicate answers are idempotent. Address disappearance
  removes its connection/streams; later reuse of the same address creates fresh
  work in the current reconciliation generation and cannot reuse stale client
  or stream completion from the earlier presence.
- Empty answers or name-not-found during a legitimate scale-to-zero state yield
  backend unavailability without terminating discovery. Later valid answers
  restore unary routing and durable subscription reconciliation.
- Every returned address is used, including a 40-address response when expected
  count is 32. Connection starts remain bounded; no subset selection, overflow
  rejection, public count diagnostics, leased-registry access, or ERROR logging
  occurs.
- Resolver cancellation and Gateway shutdown leave no DNS requests, timers,
  connection attempts, or streams running.

**RED-first tests:** DNS normalization/deduplication/reordering; GKE node-ID,
IPv6, TLS authority, disappearance/address-reuse fencing; configured interval
shorter than TTL; positive TTL shorter than interval; zero/missing TTL fallback;
empty/NXDOMAIN; resolver failure before and after the last answer's validity
deadline; later recovery; bounded 40-address reconciliation; durable
subscription reactivation; and shutdown cancellation.

**Documentation obligations:** Add GKE package README/reference covering the
headless Service, readiness ownership, DNS/TTL behavior, service-name and port
configuration, canonical identity/TLS authority, exact refresh/TTL/failure
precedence, scale-to-zero semantics, expected-count behavior without a public
diagnostics API, and package assembly. State that Kubernetes
manifests/Terraform and the beginner guide arrive in T-0126.

**Review concerns:** all four concerns are relevant. DNS semantics, timer/cache
lifecycle, cancellation, resource bounds, and public assembly require
Terra/high API and performance/reliability review.

**Verification:** `pnpm verify:release` because a public runtime package,
dependencies, shared server assembly, and dynamic runtime behavior change.

**Risks and exclusions:** Risks are treating a transient DNS result as permanent,
retaining Pods after TTL/membership loss, and conflating DNS with readiness.
No Kubernetes API watch, leased registry, Terraform, Cloud Run, or logging
adapter is in scope.

### T-0126: GKE Terraform And Beginner Deployment Guide

**Depends on:** integrated T-0125.

**Outcome:** A beginner can deploy the one-Gateway GKE topology, verify dynamic
membership, deliberately scale it, replace compatible or incompatible versions,
and roll back using reusable editable Terraform examples.

**Ownership:** One implementation owner exclusively owns
`packages/deployment-gke/terraform/**`, the GKE package guide/examples, and only
the root deployment-guide link needed for discoverability. Runtime source is
changed only for a confirmed documentation/example mismatch returned to the
T-0125 implementation context.

**Observable acceptance criteria:**

- Terraform validation covers one standalone Gateway, application Deployment,
  headless Service, readiness, one simple delivery server, private networking,
  configuration, and external secret references.
- Optional autoscaling resources are disabled by default and require the
  operator to choose metrics, thresholds, and minimum/maximum capacity. Spine
  TS never changes replica count.
- The guide gives copyable prerequisites, inputs, init/plan/apply, verification,
  scale up/down/zero, return from zero, compatible rolling replacement,
  incompatible stop-all/start-new replacement, rollback, troubleshooting, and
  teardown procedures.
- Scale-from-zero guidance uses an external request/queue metric rather than
  application-node CPU alone. Storage engine selection remains application
  configuration and is absent from templates.
- Gateway replacement is documented as interrupting clients; durable
  subscriptions survive and clients reconnect and re-query. No second Gateway
  or interruption-free claim appears.
- Terraform provider/resource claims are checked against then-current official
  Google and HashiCorp documentation and recorded in the task log.

**RED-first tests:** start with failing deterministic Terraform format/validate
and fixture/policy checks for required resources, disabled autoscaling defaults,
headless Service/readiness, secret-reference-only inputs, one Gateway, and
prohibited Cloud Run/storage-engine selection. Documentation command/link and
beginner-section checks must also fail before content is added.

**Documentation obligations:** The beginner guide is the primary deliverable.
It must distinguish platform behavior from framework behavior, explain DNS TTL
and readiness in plain language, link package API reference, and avoid internal
wave/task jargon in end-user prose.

**Review concerns:** style/maintainability for Terraform module shape,
documentation for teaching quality and factual claims, TypeScript/API docs for
runtime snippets, and performance/reliability for scaling/replacement claims.

**Verification:** Run
`pnpm verify:task -- --no-coverage packages/deployment-gke/test/terraform-policy.test.ts`
so the deterministic Terraform fixture/policy test is part of the focused task
gate, alongside Terraform format/validate and docs/link checks. No coverage is
required because this slice changes infrastructure/docs rather than production
TypeScript. This profile is sufficient only while the slice changes no runtime,
dependency, generated, or shared-build behavior; otherwise promote to
`verify:release`.

**Risks and exclusions:** Risks are unsafe production-looking defaults,
secret-value materialization, and promising autoscaling the templates do not
enable. GCE, Cloud Run, multiple Gateways, framework scaling, and package
publication are excluded.

### T-0127: GCE Terraform And Beginner Deployment Guide

**Depends on:** integrated T-0124 and T-0126's shared documentation conventions.

**Outcome:** A beginner can deploy the one-Gateway GCE topology with managed
application instances and leased discovery, verify scaling/replacement, and
roll back using reusable editable Terraform examples.

**Ownership:** One implementation owner exclusively owns
`packages/deployment-gce/terraform/**`, the GCE package guide/examples, and its
root deployment-guide link. Runtime source changes require a confirmed mismatch
and return to the T-0124 implementation context.

**Observable acceptance criteria:**

- Terraform validation covers a standalone one-Gateway topology, managed
  application-node instances, private networking/firewall, health/readiness,
  external registry/storage endpoints, configuration, and external secret
  references.
- The minimal topology may colocate the Gateway and in-memory simple delivery
  server. The production section recommends separate failure/resource
  boundaries and never presents the in-memory delivery server as durable or
  highly available.
- Optional autoscaling configuration is disabled until the operator supplies
  metrics, thresholds, and minimum/maximum capacity. The guide explains that
  GCE, not Spine TS, owns scaling.
- The guide gives copyable prerequisites, inputs, init/plan/apply, registry
  verification, scale up/down/zero, return from zero, compatible rolling
  replacement, incompatible stop-all/start-new replacement, Gateway
  interruption, rollback, troubleshooting, and teardown procedures.
- Configuration selects private endpoint defaults or explicit overrides and an
  explicit registry `StorageFactory`/namespace without selecting the
  application's storage engine. Secret values are not placed in Terraform
  state by example defaults.
- Terraform provider/resource claims are checked against then-current official
  Google and HashiCorp documentation and recorded in the task log.

**RED-first tests:** begin with failing Terraform format/validate and policy
checks for managed instances, private networking, registry inputs, disabled
autoscaling, one Gateway, permitted minimal colocation, external secret
references, and prohibited Cloud Run/storage-engine selection. Add failing
docs command/link/beginner-section checks before authoring the guide.

**Documentation obligations:** Explain the registrar/reader roles, 20/60/10
timings, registration identity fencing, crash expiry, finite cleanup,
scale-to-zero behavior, private-address default/override, minimal versus
production placement, and operator compatibility decisions in plain language.

**Review concerns:** style/maintainability for Terraform module shape,
documentation for beginner usability and factual claims, TypeScript/API docs
for runtime snippets, and performance/reliability for leases, scaling,
replacement, and failure-boundary claims.

**Verification:** Run
`pnpm verify:task -- --no-coverage packages/deployment-gce/test/terraform-policy.test.ts`
so the deterministic Terraform fixture/policy test is part of the focused task
gate, alongside Terraform format/validate and docs/link checks. No coverage is
required because this slice changes infrastructure/docs rather than production
TypeScript. Promote to `verify:release` if any runtime, dependency, generated,
or shared-build path changes.

**Risks and exclusions:** Risks are public endpoint publication, unbounded
shutdown/cleanup claims, hidden secret persistence, and presenting the minimal
topology as production HA. GKE runtime, Cloud Run, multiple Gateways, durable
delivery-server work, and logging are excluded.

### T-0128: Cross-Platform Capacity, Replacement, And Wave Closure

**Depends on:** integrated T-0126 and T-0127.

**Outcome:** Wave 7 closes with reproducible cross-platform behavior evidence,
documented tested capacity rather than a runtime maximum, reconciled public
docs, and durable task/remote state.

**Ownership:** One implementation owner owns cross-platform acceptance/load
fixtures, example orchestration, root deployment/architecture docs, and Wave 7
closure records. Platform runtime fixes return as one accepted batch to the
still-available owning context when possible; this slice does not casually
refactor stabilized packages.

**Observable acceptance criteria:**

- Deterministic acceptance covers one Gateway with GKE-style DNS and GCE-style
  leased discovery through scale up, scale down, zero, and return, including
  unary routing and durable subscription reactivation.
- Replacement coverage proves compatible old/new application versions can
  overlap and incompatible replacement can stop all nodes before starting the
  new version. Tests/docs make no framework compatibility decision or version
  handshake claim.
- Gateway replacement evidence records the expected client interruption,
  durable definition survival, reconnect, and authoritative re-query.
- A reproducible load profile exercises the expected 32 nodes and at least one
  above-expectation topology, records environment and measured results, and
  demonstrates that every discovered node is used with bounded connection
  concurrency. Published guidance labels only measured/recommended capacity
  and explicitly states there is no hard runtime maximum.
- Documentation consistently says one Gateway, GKE/GCE only, Cloud Run
  excluded, platform-owned scaling, external secret references, application-
  owned storage choice, best-effort notifications, and pending Inbox work may
  execute under the new version.
- No Wave 8 structured logger, Google Cloud Logging adapter, ERROR emission,
  multiple-Gateway behavior, `validation-ts` upgrade, or storage-layout tuning
  is present. Package-internal observed/expected count behavior is covered, but
  no public diagnostics seam is exported; Wave 8 owns that design and exposure.
- All task/work/review statuses, completion-plan state, branch/main refs, tags
  if any, and remote pushes are reconciled and verified.

**RED-first tests:** add failing cross-platform scale/replacement scenarios,
40-node above-expectation assertions, bounded-concurrency instrumentation,
Gateway-restart recovery, and deterministic docs/policy scans before completing
fixtures or prose. An opt-in real-cloud smoke profile may supplement but never
replace deterministic CI evidence.

**Documentation obligations:** Reconcile root navigation, architecture and
deployment guides, all three package references, runnable commands, measured
capacity notes, rollback, failure semantics, and explicit Wave 7 exclusions.
End-user docs contain no internal task/wave terminology except a clearly
historical roadmap page.

**Review concerns:** all four canonical concerns are relevant. Run one complete
concern-specific review wave over the stabilized Wave 7 diff/claims;
performance/reliability validates capacity, scale, lease, DNS, replacement,
and cleanup evidence. TypeScript/API docs validates public imports/snippets.
The dedicated final security reviewer remains reserved for the final project
release-readiness gate unless the human separately requests it.

**Verification:** Run the mandatory cheap preflight, then one final
`pnpm verify:release` after review convergence because this is the shared
runtime/build/release boundary. After merge, apply the protocol's tree-equality
rule to decide whether full verification must repeat, then push and prove
remote ref equality.

**Risks and exclusions:** Risks are non-reproducible capacity claims, docs that
overstate cloud behavior, and cross-slice contract drift. No npm publication,
future migration-remote push, Cloud Run, multiple Gateways, Wave 8 subsystem,
or unrelated completed-wave refactor is allowed.

## Split Evaluation

The split exposes two independently valuable platform variants and keeps their
infrastructure guides optional until each runtime contract is stable. It also
separates the high-risk persistence and dynamic-subscription boundaries so each
can be reviewed in one careful pass. The slices are intentionally dependency
ordered rather than independent: dynamic unary routing establishes the
connection owner, dynamic subscriptions reuse it, the leased registry supplies
GCE, and each guide follows its actual platform API. No product work is removed;
Cloud Run, multiple Gateways, and structured ERROR logging remain explicitly
deferred by human decision.
