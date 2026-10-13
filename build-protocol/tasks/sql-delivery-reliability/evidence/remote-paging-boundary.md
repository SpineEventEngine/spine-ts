# Remote Inbox paging boundary

2026-10-14. Existing `requirements_splitter`, explicitly dispatched
`gpt-6-astra` / `high`, Standard speed. Configured role/profile agrees with the
assignment; runtime model self-introspection is unavailable. Read-only source
analysis except this explicitly assigned planning record. No builds, tests,
application processes or database operations were run by this agent.

## Decision and evidence

High-risk, bounded serialized/public-contract correction: add one authored
`spine.delivery.InboxReadService.ReadPage` RPC with an exact tuple cursor.
Use it for every `DeliveryClient.readPage` and consequently `RemoteInbox.read`.
Do not increase pages, reassign timestamps, depend on the cursor row remaining
present, or fall back to timestamp paging. No new persistence or transaction
concept is required. The managed shutdown decision remains independent.

The existing timestamp-only request cannot identify a position inside an
arbitrarily large equal-timestamp group. `RemoteInbox.#readPage` rejects a full
page ending in tied timestamps; `exactAfter` also requires the previous row to
remain in the first time-anchored page. Both prevent correct continuation,
including at the 1,000-row cap and after deletion. Server ordering already uses
receive time, version and UUID, but only the first component crosses the wire.

This is a confirmed source defect under the stated preconditions, **not a
confirmed explanation for the 49 missing projection executions** in run
`8cfa18b18f9e40958bc5855b50b962c7`. The source diagnosis records the missing
failure-time Inbox and worker evidence. The corrected real-wire artifact
`real-wire-paging-5cb2e6f2-aa03-400e-8642-4bbf7f3d7749.json` reports PASS for
the conditional reproduction: 101 stored tied rows, raw pages of 100/101 and
two `DeliveryPagingError` results from `RemoteInbox.read(limit: 100)`. Runtime
packages use built output; the generated domain fixture was loaded from TS.
The subsequent plain-Node built-fixture rerun
`real-wire-paging-19e22f16-7d88-4982-acd6-5eab207320b7.json` confirms the same
result with generated JavaScript schema hashes and clean client/server teardown.
The earlier `03d85a0d-e8c2-470b-8055-ce659a1a1ace` run failed before writes on a
fixture timestamp and is not paging evidence. Neither artifact establishes the
cause of the earlier full workload failure.

### JVM and provenance basis

Inspected local reference sources, without modifying or building them:

- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/delivery/InboxStorage.java:118`:
  `readAll` filters `received_at > sinceWhen`, orders receive time/version and
  limits the result. `InboxPage.java` continues from the final row's timestamp.
- `/Users/armiol/development/Spine/delivery-server/client/base/src/main/java/io/spine/delivery/client/RemoteInboxStorage.java`:
  delegates bounded shard reads to `InboxClient`.
- `/Users/armiol/development/Spine/delivery-server/simple-server/src/main/java/io/spine/delivery/server/grpc/InboxService.java`:
  forwards only shard, timestamp and page size to `ExtendedInboxStorage`;
  that class delegates to the same JVM Inbox read.
- The local `delivery-server/grpc-api/src/main/proto/spine/delivery/message_delivery.proto`
  and the copied TS contract provide no full cursor. These sources support the
  existing Inbox read responsibility, but do not establish safe arbitrary-tie
  continuation. The extension is an explicit TS contract, not claimed JVM parity.

Do not add a field directly to the copied `message_delivery.proto`.
`PROJECT_COMPLETION_PLAN.md:436–437` prohibits manual edits to original copied
JVM contracts. `packages/proto/proto/spine-sources.json:222` records this file
as an exact copy of `SpineEventEngine/delivery-server` revision
`21f2901f393e552208b97166f4eaeb942f9f5172` with its SHA-256. The source verifier
checks those bytes; `packages/proto/scripts/verify-descriptor-compatibility.mjs`
also compares complete frozen descriptors, excluding source locations only.
Updating a checksum or reclassifying the copied file would falsely discard
that provenance. No external upstream change is needed for an authored sibling.

The manifest's existing authored files cover authentication, a subscription
record and deployment discovery. None provides Inbox reads; placing this RPC
there would mix responsibilities. Protobuf cannot add a method to an existing
service from a second file. A single-method sibling service is therefore the
smallest provenance-preserving RPC addition. Existing copied mutation/shard/
Admin contracts remain useful independently; they are not fallback paths.

## Exact supported contract

Add authored `packages/proto/proto/spine/delivery/inbox_read.proto` with the
normal project header/options/style and these domain types:

```proto
service InboxReadService {
  rpc ReadPage(ReadInboxPage) returns (PageOfMessages);
}

message InboxCursor {
  google.protobuf.Timestamp when_received = 1;
  int32 version = 2;
  string message_id = 3;
}

message ReadInboxPage {
  spine.server.delivery.ShardIndex shard = 1;
  InboxCursor after = 2;
  int32 page_size = 3;
  google.protobuf.Timestamp since_when = 4;
}
```

Import `PageOfMessages` from the unchanged copied delivery contract. Required
annotations and comments must reflect the validation below; the sketch omits
them only for brevity. The existing `sinceWhen` public option remains a genuine
exclusive timestamp filter for a first read, not a continuation workaround.
Reject requests containing both `after` and `since_when`. No response token,
snapshot ID, cursor storage, status field or protocol negotiation is needed.

1. Within the requested shard, order ascending by exact timestamp seconds,
   nanos, non-negative version, then message ID. Define the ID comparison as
   unsigned lexicographic UTF-8 bytes, with no locale, normalization or case
   folding. Use that same comparison for sorting, cursor predicates and client
   response validation. Replace `localeCompare` in the affected remote order;
   it is not an exact locale-independent tie-breaker for arbitrary accepted IDs.
2. An `after` request returns rows whose tuple is strictly greater than the
   supplied tuple. Never load or search for the cursor row. Deleting that row
   or changing only its status does not affect continuation. The cursor is a
   position, not evidence of a presently stored message or permission token.
3. Keep the existing 1–1,000 row limit and 4 MiB encoded response cap. A short
   page means the end of this read; an exactly full page may need one additional
   request. Retain explicit resource-exhausted failure for an oversized response.
   No larger-page retry is part of tie handling.
4. Validate shard, timestamp bounds/nanos, nonblank message ID, cursor version
   `0..2147483647`, page size, mutual exclusion and existing request-byte cap.
   Zero version is valid; missing timestamp or blank ID makes a present cursor
   invalid. Public TS cursor version stays `bigint`, with checked int32 mapping.
   Server validation returns `INVALID_ARGUMENT`; client input validation fails
   before transport. The request shard scopes the cursor, so it needs no second
   shard field.
5. Add `after?: InboxReadContinuation` to `DeliveryReadPageOptions`, reusing the
   existing server port type instead of creating another public TS cursor shape.
   Return detached messages as today. Validate response count, shard, strict
   tuple ordering, unique identities and advancement beyond the supplied bound;
   malformed/repeated/backward pages fail as protocol errors before consumption.
6. `RemoteInbox` passes `after` directly, removes `pageAnchor`, `exactAfter` and
   the full-page tie rejection, and requests ordinary bounded pages. Keep local
   status filtering. Advance the internal cursor from the final **raw** row
   even when every row is excluded. When the result limit is met, return it
   immediately; callers continue from the last returned row. Empty statuses
   return an empty result after input validation without scanning the service.
7. Bound the entire `RemoteInbox.read` collection with one cancellation/deadline
   budget (`timeoutMs`, or the current finite-read default of 30,000 ms). Pass
   remaining time/cancellation through each page and retry; do not renew the
   budget per filtered page. Check cancellation before every subsequent RPC,
   dispose timer/listeners, and do not return partial results as an exhausted
   successful scan. Keep result memory at the requested limit plus one bounded
   raw page. Do not add a scheduler or generic retry subsystem.
8. `UNIMPLEMENTED` for the required RPC is an actionable endpoint incompatibility:
   explain that this client requires `InboxReadService.ReadPage` on a matching
   TS DeliveryServer and retain the original cause/code. It is not a malformed
   Inbox message and must not be translated into today's generic message error.
   Do not retry the RPC within that read or try the old service. A later explicit
   read is a new operation; no negative capability cache or protocol negotiation
   state is introduced. Ordinary bounded supervisor recovery remains independent.
   Reuse an appropriate existing error with useful detail rather than creating
   an error hierarchy. Other transient reads retain finite existing policy.

The read is live, not a snapshot. Concurrent insertions ahead of the cursor can
appear; insertions behind it are observed by a later fresh drain/recovery scan.
Removal can make a page shorter. This correction cannot promise exact-once
delivery, transactional fanout, or observation of every concurrent insertion in
one traversal. Ordering fields must remain stable for a row; preserve existing
immutable payload/identity validation and status-only acknowledgement behavior.

## Small ordered implementation slices

One existing implementer (`gpt-6-sol` / `medium`) is responsible for overlapping
runtime and contract edits. Mechanical generation/testing is an orchestrator
function. Do not split this into competing production writers.

1. **Authored contract and server endpoint.** New proto plus its `ownedSources`
   manifest entry; generated framework export/manifest outputs through
   `pnpm proto:generate`; curated export in `packages/proto/src/delivery-server/index.ts`.
   Add the bounded read handler using the existing state in
   `packages/delivery-server/src/core/inbox-service.ts` (a small sibling handler
   module is acceptable if needed). Wire it through both `core/in-memory-delivery-core.ts`
   and `server/assembly.ts`, `server/delivery-server.ts`, and the health service's
   known-service list. Share the remote ordering predicate; do not duplicate a
   second Inbox state. Acceptance: direct new RPC traverses all static rows,
   including deleted cursor and 1,001 tied rows, within existing caps.
2. **Client and adapter cutover.** `delivery-client/src/client/client.ts`,
   `client/types.ts`, `wire/codec.ts`, `remote/adapters.ts` and focused tests.
   Remove unsafe continuation helpers; preserve other RPCs. Acceptance: public
   direct and RemoteInbox reads use the new endpoint, exact order and full
   cursor; filtering, cancellation, deadline and unsupported-RPC behavior meet
   the preceding contract. Update narrow TSDoc and delivery package references
   to distinguish copied JVM RPCs from the required authored paging extension.
3. **Wire proof and targeted acceptance.** Update existing direct/core/client
   lifecycle tests and add actual loopback DeliveryServer/DeliveryClient proof.
   Run source/provenance, generated/declaration, focused tests and cheap preflight
   before the concern-specific review wave. Rebuild declarations through the
   normal build; never edit generated `.ts`, `.d.ts` or descriptor baselines by
   hand. Existing final `verify:release` remains the convergence gate; do not run
   it repeatedly as a diagnostic step. Then repeat the instrumented eight-process
   workload independently of the deterministic paging proof.

Required behavior cases: page sizes 1, 100 and 1,000; 101 and 1,001 identical
timestamps, mixed versions, reversed/random insertion order and equal version
IDs; nanosecond differences and minimum timestamp; deleted cursor; skipped
status-only full pages followed by matching rows; no matches and empty statuses;
same cursor repeatedly gives the same static page; cancellation between pages,
in-flight cancellation and finite deadline under continuing excluded arrivals;
invalid cursor fields/shard/limits; wrong-shard, unordered, repeated or oversized
responses; one unsupported call per read despite configured retries, no fallback.
Use generated domain-correct ProjectCreated Events and projection state target
identifiers for projection Inbox rows. Assert exact IDs and handler counts where
dispatch is exercised, not only page lengths.

The API/declaration reviewer checks the authored wire boundary, generated
exports and error claims. Reliability checks ordering, deletion/filter
advancement, bounds and cancellation. Style checks focused modules and prose;
documentation checks the precise compatibility/live-read limitations. Record
security disposition under the task's existing final-release policy.

## Risks and exclusions

- A new TS client requires the authored endpoint. That intentional requirement
  matches the human's no-legacy-app/no-migration direction. Do not claim complete
  corrected paging against the inspected JVM DeliveryServer.
- Remote ID collation becomes explicit and deterministic; no local SQL/provider
  collation redesign is included. No rows are mutated to establish this order.
- Existing finite in-memory retention and 4 MiB limits remain. A cursor neither
  makes shared Delivery durable nor survives loss of its in-memory contents.
- The 49-projection failure still needs failure-time evidence/repeated workload
  reconciliation after the deterministic defect is corrected. Do not equate the
  paging fix with closure of all multiprocess acceptance.
- No persistence schema, outbox, distributed transaction, global timestamp
  allocator, arbitrary page growth, skip-on-error or compatibility fallback.
  No upstream checkout modifications or JVM build. No broad replanning.

There is no unresolved external architectural constraint for this scoped fix.

Orchestrator acceptance: the cursor decision is accepted. The proposed sticky
unsupported-endpoint cache is omitted as unnecessary lifecycle state; existing
non-retryable status classification suffices per read and lets a corrected
endpoint work on a later operation. This is a narrowing of implementation, not
a fallback or compatibility guarantee.
