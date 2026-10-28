# Implementation milestones

All milestones are high-risk unless narrowed explicitly: they affect storage,
lifecycle, concurrency or public contracts. One production implementer works at
a time; independent checks and relevant reviews may run concurrently. See the
[human requirements ledger](TASK.md) and [accepted specification](PROPOSAL.md).

1. **Retained Storage:** repository cache lookup before construction and partial
   acquisition/attempt-all cleanup; EventStore retention per captured tenant;
   retained repository query/history storage with request facades remaining
   short-lived. Include Agent history readers, Process Manager duplicate-history
   reads. Repeated use creates no throwaway storage; failure can retry;
   shutdown releases all acquired stores. Inbox retention waits for milestone 8.
2. **Shared AnyPacker:** implement JVM-like packing/unpacking and consistent
   callers, including exact per-occurrence Any URLs in nested identifier JSON
   round trips. Preserve packed Any instances and binary unknown fields. Retain
   semantic validation at signal/API entry points. No native-key workaround.
3. **Provider storage retention:** retain inner RecordStorage in memory,
   PostgreSQL, MySQL/MariaDB and Datastore commit wrappers. Coordinate admitted
   commits with awaitable factory/commit shutdown (D-0148). Correct Datastore trim
   pagination and verify
   deletion after the shared Any fix, including retention spanning pages.
4. **Factory preparation:** see [the accepted detailed contract](FACTORY_PREPARATION.md).
   Shared contracts and memory first, then bounded
   PostgreSQL, MySQL/MariaDB and Datastore slices. Offline factory build, explicit
   connection checks, creation and read-only compatibility, tenant resolvers,
   coordinated preparation and released temporary connections. No provisioning.
5. **TenantIndex and admission:** public membership/paging, effective live index,
   explicit keep, typed TENANT_UNKNOWN/NOT_FOUND, operational lookup errors,
   cleanup policy and direct input admission. No hidden tenant catalog.
6. **JVM PR 1698:** unconditional early state reservations with context identity,
   including tests and BlackBox; no disabling switch or test-profile exception.
   Preserve System exclusion, unique-destination lookup, registration rollback,
   attempt-all context cleanup and reset protection. Completed-context tracking
   is separate from early reservations. D-0151 advances the approved single async
   build API into this milestone so failed builds await cleanup; migrate callers
   and remove buildAsync without introducing initialization flags yet.
7. **Agent recovery removal:** fresh signals execute live without scheduler;
   remove replay, saved backlog and private outgoing obligations across runtime,
   storage, Proto, config and tests. Preserve active retries, state and all audit
   histories. Accepted interrupted work cannot return through ordinary Inbox
   delivery. This precedes shared saved-work scanning.
8. **Shared environment and Delivery:** completeSetup, one environment Delivery,
   one single-tenant Inbox and shard store, packed-signal tenant extraction,
   membership before persistence and dispatch, committed-write notifications,
   tenant-qualified identity and safe idle transitions. Shutdown fences input,
   stops notification/scan producers, settles dispatch and shard release, closes
   created delivery storage, then factories. Closing one context leaves shared
   resources open. Supplied ports follow explicit cleanup delegation.
9. **Bounded Context initialization:** the asynchronous build from M6 gains independent eager
   flags, shared preparation machinery and first-input gating across every ingress.
   Failed lazy attempts reject requests and remain retryable; explicit startup
   failure stops environment intake. Install consumers behind the gate so Events
   can trigger lazy preparation. No active/inactive context API.
10. **Subscription monitoring:** awaited first pass, separate initial-success and
    current-health state, WARN and restart after later errors, no overlapping loops
    or restart after close. No whole-environment failure after initial success.
11. **Explicit context and environment preparation:** public runtime/environment
    methods, completed/open context snapshot, paged effective
    indexes, all supplied IDs validated before structure work, no keep, close
    coordination and shared lazy/explicit attempts. No monitoring side effect.
12. **Server and protocols:** gRPC-only Server, typed errors through native/browser/
    gateway/client surfaces, complete ingress coverage, lookup ambiguity before
    readiness, revised managed startup, BlackBox and examples. Finish ordinary
    non-storage test/remote-app Any helper adoption from the residual audit, plus
    ordinary production integration wrapper packing;
    preserve intentional malformed, opaque and wire-compatibility inputs.
13. **Convergence:** current public documentation, provider and reopening evidence,
    final specialist/security review, cheap preflight then release verification,
    unused common workspace version, required feature pushes and exact remote
    state. No PR creation or merge without explicit instruction.

Every slice records focused acceptance evidence and review dispositions before
moving on. No existing-data migration or conversion work belongs to any milestone.
