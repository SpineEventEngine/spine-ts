# T-0092 Subscription Coordination Split

Status: Accepted implementation map

Task: `T-0092`

Baseline: `229b610e`

This split refines only Wave 5 B2. One implementation owner deepens the T-0091
durable bindings and their existing storage. It does not create another
registry, persistence mechanism, scheduler, host, or deployment controller.

## Persisted model

All rows remain in the T-0091 namespaced `RecordStorage<string, Any>`. The
codec recognizes three closed record families and rejects every unknown
version or inconsistent combination without exposing private bytes:

1. A binding-slot record uses the existing durable-binding type URL and format
   version 2. Its common fields are `id`, `revision`, `admissionToken`,
   `lifecycle`, and `fence`. `revision` starts at 1 and increases by exactly one
   on every successful replacement. `fence` starts at 0 and increases by
   exactly one whenever active or cancellation work receives a new owner; a
   renewal changes only `revision` and `leaseUntilMs`.
2. A quota-control record uses its own reserved storage ID, type URL, and
   format version 1. It stores `revision`, `used`, and at most one recoverable
   `reserve`, `release`, or `repair` operation. A reserved ID prefix is rejected
   for generated public binding IDs.
3. A cleanup-control record uses a second reserved storage ID, its own type
   URL, and format version 1. It stores `revision`, optional `ownerId`, `fence`,
   `leaseUntilMs`, optional `afterId`, `failureCount`, and `retryAfterMs`.

The binding lifecycle is exact:

| Lifecycle    | Required fields and meaning                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reserved`   | `reservationOwner`, `reservationUntilMs`; no principal, tenant, backend, session expiry, or work owner. The durable slot already consumes one unit of namespace capacity.                        |
| `inactive`   | Principal fingerprint, optional tenant, session expiry, canonical private backend bytes, and exact backend-byte accounting; no work owner and no lease.                                          |
| `active`     | All inactive facts plus `ownerId` and finite `leaseUntilMs`. Its fence authorizes one activation effect, renewal, update admission, and finalization.                                            |
| `cancelling` | All private binding facts plus `ownerId`, finite `leaseUntilMs`, and cancellation reason (`client`, `activation-end`, or `expired`). Its fence authorizes one retryable backend cleanup attempt. |
| `retired`    | `admissionToken` and the last fence only. Principal, tenant, and backend bytes are erased. The slot remains capacity-accounted until the recoverable quota release deletes it.                   |

`absence` is the only closed state. No transition recreates a retired record or
decreases a revision or fence. Format version 1 binding rows from T-0091 are an
internal development format and receive no migration path; the version-2
codec fails closed rather than guessing missing coordination facts.

The encoded `Any` size is computed before persistence and must not exceed
`maxRecordBytes`. Canonical base64 and the persisted decoded backend-byte count
must agree. The quota and cleanup rows contain no principal, tenant, backend
envelope, credential, callback error, or stack.

## Invariants

- Every mutation uses `RecordStorage.compareAndSet()` against the exact bytes
  read. No backend effect starts until its authorizing CAS is known to have
  applied or is reconciled by a reread of ID, lifecycle, revision, fence, and
  operation ID.
- At a stable quota record, `used` equals the number of binding slots in any of
  the five lifecycle states. While a quota operation is present, no second
  quota mutation is admitted; every gateway may help the recorded operation to
  completion within the common finite attempt bound.
- Capacity reservation allocates the final public binding ID. Creation replaces
  that same slot from `reserved` to `inactive`, so reservation conversion has
  neither a cross-row gap nor double counting.
- A successful reserve is the only operation that increments `used`. A
  recoverable release deletes one exact `reserved` or `retired` slot and is the
  only operation that decrements it. Creation, claim, renewal, cancellation,
  and retirement never change the counter.
- An unexpired `active` or `cancelling` lease cannot be stolen. Expired work may
  be claimed by CAS with a new owner, revision, fence, and lease. A former owner
  cannot adopt the new fence.
- One active operation retains one controller and one renewal timer locally.
  Their map is bounded by admitted local operations. Close aborts and clears
  local work but leaves durable records for lease recovery.
- Before forwarding each update, the active owner rereads the slot and proves
  the same `active` owner/fence and an unexpired lease, renewing by CAS when it
  enters the renewal window. The successful guard is the forwarding
  linearization point. Cancellation may still linearize after an already
  admitted sink call; the framework cannot retract that in-flight call.
- Finalization performs the same durable guard. A stale activation result is
  reduced to `denied`; it cannot call backend cancellation, retire, delete, or
  restore the row.
- Provider exceptions and callback failures retained in memory are reduced to
  bounded, payload-free errors. Raw records, private backend bytes, credentials,
  and provider diagnostics never enter public errors or control records.
- Coordination loops use an internal attempt limit of eight. Lease renewal
  uses the existing finite `leaseMs` and direct Node timers; tests use a
  controlled clock and fake timers. This is not a public scheduler.

## Transition table

| Operation           | Admitted durable state                                                             | CAS and effect                                                                                                                                                                                                                                               | Result or recovery                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserve capacity    | Stable quota with `used < recordLimit`                                             | Stage `reserve(opId, bindingId, token, reservationUntilMs)` in quota; CAS the final binding slot from absent to `reserved`; complete quota to `used + 1` and clear the operation.                                                                            | An applied-then-thrown CAS is reread and accepted only when the exact operation or reserved slot is present. A helper completes an interrupted operation. The returned reservation has asynchronous, idempotent release.                                                                    |
| Create binding      | Exact live `reserved` slot and matching reservation object                         | Validate and encode first; CAS that slot to `inactive` with the same admission token and `revision + 1`.                                                                                                                                                     | Ambiguous success is reconciled by exact token/revision/content. Failure leaves or releases the reservation exactly once; it never allocates another ID.                                                                                                                                    |
| Claim activation    | `inactive`, or `active` with an expired lease                                      | CAS to `active` with this boot-unique owner, `fence + 1`, finite lease, and `revision + 1`; then start the backend effect.                                                                                                                                   | An unexpired foreign claim is denied. Same-process duplicate activation is coalesced or denied without a second callback. Applied ambiguous claims are reread before the effect.                                                                                                            |
| Renew lease         | Exact current `active` owner/fence before expiry                                   | CAS only `leaseUntilMs` and `revision`; keep the fence. Renewal runs at a finite interval and opportunistically in the update guard.                                                                                                                         | CAS loss, expired time, cancellation, replacement, or bounded storage failure aborts the local controller and prevents later forwarding/finalization.                                                                                                                                       |
| Guard update        | Exact current `active` owner/fence with unexpired lease                            | Reread, renew if due, then admit one sink call.                                                                                                                                                                                                              | A stale update is erased and not sent. No replay, completeness, order, or exactly-once promise is added.                                                                                                                                                                                    |
| Finalize activation | Exact current `active` owner/fence after the callback settles                      | CAS to `cancelling` with reason `activation-end`, a new fence, owner, lease, and revision; run the supplied backend cancellation; retire and release.                                                                                                        | Callback failure remains authoritative after bounded cleanup. If the active guard is lost, return `denied` and perform no cleanup mutation. This replaces the gateway's unfenced blind activation cleanup.                                                                                  |
| Cancel              | Owned `reserved`, `inactive`, `active`, or an expired/same-owner `cancelling` slot | A reservation cancels through quota release. A binding CASes to `cancelling` with a new fence and finite lease before backend cancellation. Success CASes to `retired` with private bytes erased, then runs quota release.                                   | Absence is `closed`; wrong principal/tenant is denied. Same-fence retries are idempotent. Another gateway can take over expired cancellation. Backend Cancel/Dispose remains retry-safe because an ambiguous remote outcome may be invoked again.                                           |
| Release capacity    | Exact `reserved` or `retired` slot                                                 | Stage `release(opId, id, token, expectedRevision)`; delete only the exact slot; complete quota to `used - 1` and clear the operation.                                                                                                                        | Absence or a different admission token after an ambiguous delete proves the old slot left; complete the decrement without touching a replacement. A matching live non-releasable state fails closed. Repeated reservation release is a no-op after reconciliation.                          |
| Clean expired       | Due cleanup control and no unexpired foreign cleaner                               | Claim cleanup with owner/fence/lease; query at most `cleanupBatchSize` rows after the durable ID continuation. Release expired reservations, fence session-expired bindings into `cancelling`, retry expired cancellation leases, and release retired slots. | Persist the last completed ID. End-of-scan resets the continuation. A failure persists the last safe cursor, increments the capped failure count, releases ownership, and sets overflow-safe exponential backoff from `leaseMs`, capped at `leaseMs * 16`. Restart resumes from that state. |
| Repair accounting   | Stable quota, or an interrupted `repair` operation                                 | Stage repair, scan binding slots in finite ID-ordered pages, durably store `afterId` and count, then replace `used` with the final physical slot count.                                                                                                      | Reserve/release operations help or wait while repair is present; state-only transitions may continue because they do not change slot count. Reserved metadata rows are excluded. Malformed data slots count as occupied and remain inert, so corruption cannot create capacity.             |
| Close one handle    | Any local state                                                                    | Refuse new local calls, stop timers, abort controllers, zero private copies, and close only this storage handle.                                                                                                                                             | Durable rows, quota, cleanup cursor, and backoff remain. A later independently opened registry recovers expired work; active streams themselves are not recovered.                                                                                                                          |

The minimum binding-contract evolution is owned here: durable reservations
carry their preallocated ID and have an awaitable exactly-once `release()`;
reserve receives finite current/deadline facts; activation supplies a guarded
forward check and a cancellation callback so cleanup occurs under the durable
fence. The in-memory implementation and every caller change in the same
checkpoint. No coordination primitive is exported from the server package
root unless the existing public `SubscriptionBindings` declaration requires a
structural type.

## Implementation checkpoints

### 1. Codec, control rows, and deterministic faults

One writer first replaces the T-0091 development codec with the exact three
record families and adds controlled clock, barrier, fake-timer, and
apply-then-throw storage fixtures beside the durable-binding tests.

RED evidence:

- every invalid state/field/version combination, reserved-ID collision,
  noncanonical bytes, and oversized encoded row fails before storage or effect;
- revisions/fences cannot decrease, and control records reject private fields;
- a faulting CAS can apply and throw while the fixture preserves the applied
  row for reconciliation.

Checkpoint gate: focused codec tests, generated typecheck, affected lint,
format, and `git diff --check`; commit and push immediately.

### 2. Global admission and repair

Implement the quota record, preallocated durable reservation, same-slot create,
awaitable release, helping/reconciliation, and finite accounting repair. Update
the in-memory contract and `SubscriptionGateway` atomically.

RED evidence:

- two registries at capacity one cross a barrier before CAS; exactly one
  reservation succeeds and the physical binding-slot count never exceeds one;
- apply-then-throw at quota stage, slot creation, binding conversion, slot
  deletion, and quota completion rereads to one outcome without a duplicate
  increment/decrement or backend Subscribe;
- concurrent create and repeated release of one reservation retain either one
  inactive row or zero rows and return capacity exactly once;
- a crash at each reserve/release step is completed by a fresh registry;
- a paged repair survives restart, counts malformed data rows conservatively,
  and restores the exact namespace-global count without an unbounded query.

Checkpoint gate: focused auth/server durable-admission tests with changed-file
coverage, provider CAS/query conformance for in-memory, Datastore, and MySQL,
then cheap preflight; commit and push immediately.

### 3. Lease, fencing, guarded forwarding, and cancellation

Implement active/cancelling claims, renewal, local controller/timer ownership,
the per-update durable guard, fenced activation finalization, retry-safe
cancellation, and private-byte erasure.

RED evidence uses two registries A and B over one store:

- one barrier race produces one active owner/fence; B cannot steal A's
  unexpired lease, but claims with a new fence after controlled expiry;
- A pauses with an open backend effect, B takes over or cancels, then A resumes:
  A's update guard sends nothing, its finalizer mutates nothing, and B's durable
  state remains unchanged;
- fake-timer renewal keeps a healthy owner current, while a CAS loss or bounded
  renewal fault aborts it and leaves no timer/controller;
- cancellation reaching either gateway fences before callback, retries the
  same fence locally, transfers only after lease expiry, and never invokes two
  local callbacks concurrently;
- applied-then-thrown claim, renewal, cancellation, retirement, and deletion
  each reconcile before another callback or update; retained errors contain no
  backend bytes, principal, tenant, or provider payload.

Checkpoint gate: focused gateway/bindings race tests and changed-source branch
coverage at or above 90%, followed by the cheap preflight; commit and push
immediately.

### 4. Finite cleanup and restart

Implement the cleanup-control claim, durable ID continuation, session and
reservation expiry, cancellation takeover, retirement release, bounded retry,
backoff, and restart resumption. Cleanup and quota recovery share only the
binding codec and storage; they remain separate control rows in one registry.

RED evidence:

- a batch with more than `cleanupBatchSize` rows performs one finite query and
  persists the exact next ID; a new registry resumes without rescanning the
  completed prefix;
- crashing after cancellation fence, backend cleanup, retirement, slot delete,
  quota update, and continuation update converges after restart;
- two cleaners racing through barriers do not dispose twice, double-decrement,
  or delete a replacement with a different admission token;
- controlled failures persist sanitized backoff, perform no work before
  `retryAfterMs`, cap the delay, and resume after the controlled clock advances;
- repeated cleanup and close retain no more than the configured batch of
  temporary entries and no timers, controllers, continuations, or errors after
  settlement.

Checkpoint gate: focused cleanup/restart/provider tests with changed-source
coverage, affected lint/docs checks, and cheap preflight; commit and push
immediately.

### 5. Contract reconciliation and task gate

Reconcile public TSDoc and focused human/agent documentation for configuration,
global limits, finite leases, cancellation retries, restart, cleanup, and the
best-effort update boundary. Run the pre-review status/API/claim scan, then one
complete relevant specialist wave. Aggregate all findings before one
correction batch to the same writer and reopen only substantively changed
lanes.

Reviewer scope:

- style/maintainability: state-machine locality, short names, one storage/codec,
  and deterministic fixtures;
- documentation: configuration, failure behavior, reconnect/re-query, and no
  completeness or stream-recovery overclaim;
- TypeScript/API: the minimum reservation/activation contract evolution,
  declarations/TSDoc, compatibility, and no leaked control primitives;
- performance/reliability: every CAS, fence, lease, update guard, quota,
  cleanup, backoff, crash point, provider bound, and retained resource;
- security is not a new lane here; G1 performs the final Wave 5 security gate,
  while this task must already pass private-byte and sanitized-error tests.

After review convergence, run `verify:release` once because this is shared,
high-risk persistence/concurrency runtime work. Merge only the reviewed task
tree, perform change-sensitive post-merge verification, push the task branch
and `main`, verify remote SHAs, and remove the clean worktree.

## Ownership and exclusions

The sole production writer owns
`packages/server/src/server/durable-subscription-bindings.ts`, the minimum
`packages/auth/src/subscriptions/**` contract/caller changes, their mirrored
tests, focused exports/TSDoc, and the task records. Provider production code
changes only if a deterministic conformance test proves that the already
declared atomic CAS or bounded query contract is broken.

The task does not add a host, background service, public scheduler, deployment
controller, storage selector, generic cursor, second registry, durable update
queue, stream replay, Wave 6 cross-node notification propagation, JVM build, or
JVM source change. It preserves the explicit limitation that clients reconnect
and re-query authoritative entity state and may observe notification gaps,
duplicates, and different order.

No governing requirement conflicts with this map. The necessary awaitable
reservation release and guarded activation callback are direct consequences of
the already approved global-capacity and stale-owner guarantees; they do not
broaden the product scope.
