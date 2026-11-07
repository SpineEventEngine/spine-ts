# Tenant and authentication examples

## Approved scope

Continue on PR #22's existing branch and worktree. Keep protected master intact.
The human approved implementation on 2026-11-06. This supersedes earlier Message
Board demonstration scope in PROPOSAL.md and M12.md.

### Orders

Orders is always multi-tenant in every assembly: the main fixed-topology load
example, Catalog/Ordering composition, and order-card routing. Preserve the
existing domain behavior and memory/Datastore capability. Add runnable PostgreSQL
configuration with distinct shared, Northwind and Contoso databases. Stable
complete TenantId values are northwind and contoso. PersistentTenantIndex is
explicitly supplied to ServerEnvironment, using the selected StorageFactory.
Membership and storage routing are separate; register only explicit configured
tenants, reject unknown/missing tenant requests, validate persisted memberships
against routing before listening, and prove restart persistence before reseeding.
Restart acceptance includes recovery of pending durable delivery work from an
interrupted launch after its shard lease becomes eligible for takeover, with
new Commands progressing alongside recovery and committed follow-up Events
published during normal recovery. A still-valid lease is respected even after
its process exits; local synchronous delivery can report a failed acknowledgement
while the durable Command remains pending. Preserve existing acknowledgement, tracked
best-effort publication, tenant selection and shutdown guarantees; this does not
add durable Event republishing or historical Projection repair.
Use provider-neutral Orders names, retain fixed topology and existing load levels,
and add no browser UI or authentication to Orders. Fresh generated run identifiers
prevent repeated loads from overwriting prior runs. No database-reset behavior.

One bootstrap configures the environment; Bounded Context assemblies consume it.
Use current public APIs directly, with no old-API compatibility wrappers. The
server/index/environment lifecycle is sequential and partial-startup safe.
Document PostgreSQL provisioning separately from supported structure preparation.

### Fieldnotes

New Next.js web app demonstrating authentication. Single-tenant; no tenant index.
One Place Aggregate and one PlaceView Projection. Each saved PlaceId has a name,
coordinates, author, exactly one Markdown value, revision and timestamps. Markdown
may be empty. Multiple pins at identical coordinates are allowed, including for
the same author. No separate NoteId, note collection, note count or Add note action.
Commands: AddPlace, RenamePlace, MovePlace, EditPlaceNote, DeletePlace. Corresponding
Events: PlaceAdded, PlaceRenamed, PlaceMoved, PlaceNoteEdited, PlaceDeleted.
Optimistic version checks preserve drafts on conflict; event subscriptions update
PlaceView after the committed change. Each distinct Event carries the complete
post-command place details and creation/change times; the Projection replaces
state only with a newer revision, keeps author/creation time immutable, and treats
a removal marker as terminal. This preserves a coherent view under reordered
Event delivery. Delete hides current data and does not claim
physical erasure of immutable history/backups.

Use MapLibre GL JS with OpenFreeMap (no map API key); Next.js App Router; reused
shadcn/ui components and Lucide; maintained Markdown editor/rendering libraries
with GitHub-flavored Markdown, safe preview and no automatic external-image loads.
Match the accepted calm map/side-panel mockups, adjusted to one note per place.
Responsive desktop and mobile; loading, empty, error, expired-session and conflict
states; explicit saves preserve drafts on failure. Private saved-place search,
not a new geocoding service. Map/location access never sends note content to tiles.

Two explicit launch configurations share one UI/domain: direct Google through
existing component OIDC integration, and Google through Firebase Auth using the
official browser/Admin SDKs. Both issue persistent Spine opaque application
sessions. Validate Firebase project/provider/revocation and recent login at
exchange, protect exchange/logout against CSRF, namespace provider identities,
and never merge accounts by email. Firebase is not the business storage provider.
State the distinction between provider revocation and an already issued app
session. Application expiry is explicit configuration, not an invented hidden
limit. Logout revokes this app session, clears cookies/SDK state and stops local
protected streams best effort. No distributed-logout claim. One long-lived Spine
host behind a same-origin Next-facing proxy; private downstream services cannot
be bypassed by a browser. Configure authenticated reader forwarding explicitly.
Author authorization covers commands, reads, updates and outcomes, including
inaccessible-ID collision/replay cases. Entity subscriptions must use the
canonical author-scoped PlaceView target: output filtering alone can leave IDs
in removal controls. Reject broad, foreign-author and alternative subscription
filters; test foreign creation, modification and deletion without identifier leaks.

The map loads the complete authorized collection through PostgreSQL keyset reads.
PlaceView has an immutable binary `place_key` containing UTF-8 bytes of its typed ID, allowing
ordered generated queries without name or coordinate uniqueness. Expose the
existing QueryService per-request capacity from browser-safe core and reuse it
in native validation and the example; add no total-place or page-count limit.
Keep the author-only live subscription. Its bounded reconnect response triggers
a complete scan and must not replace the collection. Merge page/live state by
revision, treat deletion controls as terminal, and fence stale results by
principal and scan generation. This is live reconciliation, not a database
snapshot. Large-collection acceptance uses real PostgreSQL; the memory test
provider does not establish equivalent candidate-selection behavior. Expose existing
unsigned byte comparison through generated queries and native admission so
PostgreSQL BYTEA ordering agrees with the shared evaluator. MySQL variable-BLOB
sorts must read enough candidates for exact evaluation or fail with the existing
candidate-budget error; do not return an inexact limited prefix.

### Message Board

Remove all PR #22-added functional/technical demonstration enhancements from
Message Board. Preserve origin/master behavior and only the changes necessary to
use current breaking framework APIs, plus consistent workspace versions/pins.
Do not remove features already present on the PR base. Remove new scenario files,
launch scripts/tests/dependencies/documentation where no longer needed. Audit
references outside the directory. No Message Board mention in the final PR text.

## Documentation and delivery

Orders and Fieldnotes each have a current README, detailed human workflow guide
and agent REFERENCE. Update maintained example selection and relevant storage/auth
guidance and task scope. README links in the PR must resolve to the new/rewritten
example READMEs. Auth examples explain features demonstrated by each launch.

Preserve PR #22 description sections unrelated to examples. Replace the Message
Board example section with detailed Orders and Fieldnotes sections: feature by
feature, working public-API code, process placement, configuration and README
links. Deliver the full copy-pasteable Markdown in chat; do not edit GitHub PRs or
Issues. Current PR text is captured outside Git before editing.

## Acceptance and workflow

High-risk example wave: tenancy, persistence, authentication and browser flows.
Use one bounded implementation writer at a time. One fresh architecture pass for
the expanded Fieldnotes contract; focus tests before implementations and cheap
preflight before review. Fresh no-context reviewers for relevant code/API,
reliability and human/agent documentation; address relevant findings. Final
security review at release readiness, then full verification/packed-consumer
checks appropriate to the coordinated change. Test live PostgreSQL and Datastore
emulator where applicable; browser acceptance for Fieldnotes with isolated test
identity services, distinguishing it from live Google/Firebase credentials.
No unapproved hard-coded caps, timeouts or retry budgets. Document every authored
Proto message/field and TypeScript type/method. Preserve domain-correct Protobufs.
Keep detailed execution/review reports outside Git. Commit coherent semantic
slices and push each commit immediately. Reuse the existing version-only commit
if it still satisfies branch publication rules; do not make a gratuitous bump.

## Remaining sequence

1. Implement Fieldnotes persistent authenticated host, both login adapters,
   Next.js interface, browser acceptance and documentation.
2. Complete example navigation and the feature-by-feature PR description.
3. Run fresh independent implementation/documentation reviews, corrections and
   final security/release checks; close all participating agents.
4. Push final changes and deliver the full preserved/revised PR description in
   chat, with Orders and Fieldnotes README links and the revised SVG.

The Message Board restoration, always-multitenant Orders provider launches,
restart acceptance and documentation, and the Fieldnotes domain are implemented.
Orders passed independent API, reliability, style and documentation review;
accepted findings were corrected. Recovered publication uses the existing
tracked follow-up queue, preserving source acknowledgement and shutdown tracking.
The Fieldnotes domain diagram is recorded under
`examples/fieldnotes/docs/event-storming.svg`; keep it aligned with the implemented
contracts. Detailed execution evidence remains outside the repository.
