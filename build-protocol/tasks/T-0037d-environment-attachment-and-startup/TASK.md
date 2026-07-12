# T-0037d: Environment Attachment And Startup

Status: Slice 3 Round 3 findings under bounded architecture resolution

Started: `2026-07-12T18:25:27Z`

Baseline commit: `d4cd3c4a`

Branch: `task/T-0037d-environment-attachment-startup`

This `Status` header is canonical for T-0037d. Its work and review logs are
derived mirrors and must match it before review.

Dependency: T-0037c complete and integrated.

The existing accepted task and completion-plan records are the completed deep
architecture plan for this concurrency/ownership milestone. A new requirements
split would only re-plan that accepted design, so no Sol planning pass is
invoked. One existing implementer is assigned the complete coherent milestone
with expected explicit `gpt-5.6-terra` / `medium`, sole write ownership, TDD,
and no subagents.

## Objective

Make `ServerEnvironment` the sole package-internal delivery owner for
registration attachment and finite startup recovery, including cardinality,
attribution, and registration-scoped failed-start rollback before listener
integration.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep the implementation/review package small and limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using TDD.
- Do not assign duplicate authors or reviewers for the same role, and close
  every participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before its work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions instead of preserving them, and invent
  no abstraction without corresponding Spine JVM evidence.
- Before server-module implementation, inspect and record the relevant Spine
  JVM `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review.
- Run all four independent review lanes until clean; defer security review to
  final project readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final child
  acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Preserve existing public `ServerEnvironment` construction/options and add no
  public attach, detach, generation, scheduler, monitor, or retry surface.
- Use T-0037a descriptors, T-0037b coordination, and T-0037c records; do not
  duplicate their ownership.
- Commit no generated artifacts and make no root/public export or API change;
  emitted internal declarations may change.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns the package-internal lifecycle gate for attach/startup, at most
one current/non-retired delivery generation per environment at a time,
caller-owned shared registration cardinality, registration for a server-owned
environment exclusivity, registration tokens, startup recovery admission,
post-persist readiness routing, the atomic no-overlap ownership switch from
direct immediate exact drain to environment coordination for attached contexts,
the bounded transition readiness buffer used while that route is being
installed, and failed-start rollback. It
assembles startup obligation scopes from T-0037a's built-context descriptors,
including actual storage factories and enumerated tenants, installs readiness,
and awaits one finite recovery result before declaring attachment ready.

When failed-start rollback removes the first or sole registration, this child
invokes T-0037b's existing authoritative coordinator-instance
stop/await/retire primitive, supplies the T-0037c record-consumption step, and
clears the stopped, quiescent, permanently retired empty generation slot through
a finally-equivalent path before propagating any combined reporting or cleanup
error. The primitive preserves close-admission/stop, await, classify, consume/
report, then permanent-retirement/cleanup order. A later attach to an open
caller-owned environment may then install one fresh generation without overlap.
If the primitive cannot establish quiescence, rollback retains the slot and
every endpoint dependency, performs no classification, consumption/reporting,
permanent retirement/cleanup, or slot clearing, and prohibits replacement
instead of claiming endpoint safety. An explicit retry resumes that same
admission-closed, stopped failed-start rollback without duplicating completed
admission closure or stop. It must prove quiescence, complete classification,
eligible consumption/reporting, permanent retirement/cleanup, and safe slot
clearing exactly once, then permit exactly one later eligible fresh attachment
without old/new overlap. T-0037d owns this caller-owned failed-start rollback
state machine and same-operation retry. T-0037f separately owns deferred
server-level cleanup around this seam for both caller-owned and server-owned
startup failure, while preserving their different environment and facility
ownership.

The child exposes an internal attachment handle for future server integration.
It does not yet change `Server.start()` or listener ordering.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- New package-internal environment lifecycle/generation modules under
  `packages/server/src/server/` or `packages/server/src/delivery/`
- Minimal package-internal access additions to T-0037a/T-0037b/T-0037c modules
- Focused server-environment attachment/startup tests
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Multiple caller-owned registrations share exactly one generation/coordinator;
  a registration for a server-owned environment is exclusive, with conflicts
  rejected before registration or work admission. At most one current/non-
  retired generation exists at a time; retirement permits one later fresh
  generation where the environment remains reusable.
- Attachment installs readiness routing and disables direct immediate exact
  drain as one lifecycle-gated ownership barrier before startup admission. A
  focused concurrency test blocks an already-admitted direct exact drain, begins
  attachment, and proves attachment/startup environment admission remains
  pending until that drain settles. The barrier closes new direct-drain
  admission before it waits. Any row persisted after that close but before the
  readiness route is installed submits readiness to a transition buffer bounded
  by canonical tenant/configured-scope cardinality; it never falls back to
  direct drain. Installing the route transfers each buffered scope exactly once
  into the generation's lossless pending admission before environment/startup
  admission opens. Every subsequent receive settles from durable persistence
  plus non-throwing readiness submission only and neither invokes nor awaits
  exact drain. Before attachment, handoff completion/error behavior still
  follows exact drain. No durable row loses both owners, and no handoff exact
  drain overlaps an environment-owned worker run for the same row or scope.
- A focused race test blocks one already-admitted direct drain and readiness-
  route installation, persists a supported row after direct-drain admission is
  closed, and proves that row is buffered without exact drain. After route
  installation it receives exactly one eventual lifecycle admission, while the
  older direct drain must settle before startup/environment work is admitted.
- Startup installs readiness after context assembly, enumerates pre-existing
  supported tenant work using each built context's actual storage, and awaits
  one finite recovery obligation.
- Fulfilled `FAILED`, `PAUSED`, or `SKIPPED` is observed without claiming all
  pending rows completed; fulfilled `FAILED` alone does not fail startup.
- Rejection overlapping the attaching scope fails startup; wholly disjoint
  sibling rejection allows exactly one unaffected startup admission without
  restarting rejected scope or recursive readmission.
- Failed startup closes only the attaching registration's admission, waits for
  endpoint-dependent active work, consumes/reports only eligible causes, and
  preserves sibling progress/readiness/records.
- An already-reported unresolved overlapping shared cause produces exactly the
  D-0085 plain startup blocker message and no original-cause chain.
- A sole failed attachment quiesces its empty generation internally while a
  caller-owned environment remains reusable: rollback invokes T-0037b's
  primitive in exact close-admission/stop, await, classify, consume/report, then
  permanent-retirement/cleanup order and clears the inert retired empty slot
  through a finally-equivalent path before propagating cleanup errors. Separate
  reporting-failure and permanent-retirement-cleanup-failure tests prove the
  original sole-registration start still rejects once; the old instance cannot
  start, accept notification, or invoke endpoints; the slot is cleared; and the
  caller-owned environment later attaches one fresh generation without reuse or
  old/new overlap. A cleanup error may leak inert resources but cannot reactivate
  the instance. A distinct deterministic quiescence-failure test proves the
  initial attempt retains the unsafe sole slot and every endpoint dependency,
  performs no classification, consumption/reporting, permanent retirement/
  cleanup, or slot clearing, and rejects replacement. The test explicitly
  retries that same caller-owned failed-start rollback, proves admission closure
  and stop are not repeated, establishes quiescence, completes every remaining
  phase exactly once in the authoritative order, and clears the slot only after
  safety is proven. It then permits exactly one later eligible fresh attachment
  without reuse, owner gap, or old/new overlap. Permanent close remains
  T-0037e3; server-owned startup continuation remains T-0037f.

## D-0085 Invariants

- Exactly one environment owner and generation seam exists across attached
  servers.
- Startup recovery completes before network intake, though server listener
  wiring is deferred to T-0037f.
- Notification is readiness-only and follows durable persistence.
- Cleanup never deletes pending rows or closes a shared environment wholesale.
- Rejection attribution uses T-0036 per-shard evidence and T-0037c ownership;
  no unrelated registration is blamed.

## Explicit Exclusions

No public lifecycle option, final `Server.start()` wiring, network intake,
ordinary detach/last-detach invocation, explicit-generation-stop invocation,
permanent-close invocation,
fresh-generation attach/detach/close race policy, environment/facility close,
retry timing, monitor/action API, topology, or T-0036 redesign belongs here.
This child invokes but does not reopen T-0037b's retirement primitive.

## Implementation Decomposition

Implementation inspection established that all three inbox handoffs currently perform
`persist -> readiness notify -> await exact drain` in their own receive path.
`DeliveryReadiness` permits callback replacement only; it has no lifecycle gate
to close direct-drain admission, wait for already-admitted exact drains, buffer
new durable readiness, or atomically install the environment route. There is
also no existing `ServerEnvironment` attachment/generation/internal-handle
module. Implementing the entire accepted milestone from that starting point
requires coordinated, behavior-first changes across every handoff, built
context descriptor, environment lifecycle, T-0037b coordination access, T-0037c
attribution/consumption, and focused race/rollback tests.

To keep packages and review waves bounded, the accepted milestone proceeds in
three sequential TDD implementation slices on this branch:

1. Add and prove the private handoff ownership barrier shared by local,
   process-manager, and projection inboxes: close direct admission, await
   admitted drains, bounded readiness buffer, one transfer, then route-only
   persisted receives.
2. Add and prove the private `ServerEnvironment` generation/registration
   lifecycle and attachment handle: caller-owned sharing, server-owned
   exclusivity, descriptor/storage/tenant startup scope assembly, and finite
   recovery admission/attribution through T-0037c.
3. Add and prove registration-scoped failed-start rollback: sibling isolation,
   D-0085 blocker shaping, sole-generation retirement, reporting/cleanup error
   safety, quiescence retention, and same-operation retry.
4. Freeze and run the canonical four review lanes after each slice, then run the
   complete T-0037d focused gate and final review closure after Slice 3.

This decomposition is progress, not a project blocker. Slice 1 is assigned to
the existing Terra Medium implementation context; slices 2 and 3 remain pending
and must consume rather than reopen earlier slice contracts.

- `2026-07-12T18:49:21Z`: Independent coordinator verification repeated six
  focused files and 145 tests, all generated/build/tooling typechecks,
  changed-file ESLint/Prettier, and diff hygiene. Slice 1 is ready to freeze for
  its own four-lane review before Slice 2 consumes the barrier.

### Slice 1 Round 1 Findings

One Terra Medium fix owner must prove and resolve this complete deduplicated
batch before Slice 1 re-review:

1. Register the direct handoff gate before invoking a readiness callback, so a
   reentrant transition cannot miss admitted direct work.
2. Preserve ownership for every already-persisted batch row when a later write
   or earlier drain fails; do not abandon it into an owner gap.
3. Never silently drop unconfigured readiness after direct admission closes;
   fail closed or retain explicit ownership without changing durable receive
   outcomes.
4. Make `DeliveryHandoff.complete()` one-shot/idempotent across concurrent,
   repeated, and post-`abandon()` calls so no late duplicate drain can start.
5. Lock route ownership after transfer; later `onReady()` replacement must not
   detach the installed environment route.
6. Make the promise-returning transition expose validation failure through its
   promise channel rather than synchronously throwing.
7. Remove active task/log claims that overstate batch and invariant coverage
   until the new regressions prove them.

- `2026-07-12T19:07:40Z`: Independent coordinator verification repeated the six
  focused files and 151 tests, all generated/build/tooling typechecks,
  changed-file ESLint/Prettier, and diff hygiene. The complete seven-finding
  fix is accepted for re-review; the exceptional unknown-scope retention remains
  an explicit boundedness/ownership review target before Slice 2.

### Slice 1 Round 2 Findings

1. Publish a shared one-shot completion gate before invoking `onDrain`, so
   synchronous reentrant `complete()` or `abandon()` cannot duplicate a drain or
   release transition ownership early.
2. Remove the unbounded exceptional unknown-scope map. The barrier must remain
   lossless and finite by construction even when transition scope input is
   stale or incomplete; it may fail the ownership transition closed and rely on
   durable recovery, but it must not silently drop work, grow per unknown scope,
   or claim successful transfer.

- `2026-07-12T19:22:00Z`: Coordinator inspection found the finite failure is
  not recoverable: `failed` mode rejects every later transition and drops every
  later readiness, so no retry or durable recovery can acquire ownership. Add a
  focused RED proving one failed stale-scope transition can be retried with a
  refreshed complete domain, while no environment route is published between
  attempts and durable rows remain eligible for startup recovery.

## Slice 1 Outcome

The complete Round 1 batch is implemented and focused verified. Direct gates
are published before readiness callbacks; handoff completion is one-shot across
concurrent/repeated/abandoned calls; transition validation rejects through its
Promise; and routed ownership cannot be replaced by later `onReady()` calls.
Process-manager batches exact-drain every persisted row after either a later
write failure or an earlier drain failure while preserving the first failure.

Configured transition readiness remains deduplicated and bounded by the
configured canonical scope map. An omitted key sets one finite invalid-transition
flag; no unknown key is retained. Durable receives continue to resolve without
direct drain, then the transition waits admitted drains, clears configured
readiness, and rejects without installing/reporting a route. The claim that
permanent `failed` mode supports later retry/recovery is replaced by a finite
recoverable checkpoint: a failed attempt may start one refreshed transition,
which resets attempt-local configured/buffered/invalid state without reopening
direct admission. Readiness observed between attempts remains durable and is
recovered by the later startup scan; no route is installed until the refreshed
transition succeeds. Slice 2 must assemble the complete canonical scope domain
before invoking transition.

Direct completion publishes and memoizes one shared Promise before invoking
`onDrain`. Synchronous reentrant `complete()` returns that Promise without a
second drain, and synchronous `abandon()` cannot resolve its active gate. The
gate settles only with the original drain.

The later-slice interface remains the package-internal descriptor
`transition(scopes, onReady)` method. No registration, generation, startup,
rollback, public API/export, listener, lifecycle policy, or generated artifact
was added. Slice 2 must not consume the barrier until targeted recovery
re-review accepts this corrected package.

Round 5 accepted the corrected transition-state competitor proof with all four
canonical lanes clean. Slice 1 is closed and may now be consumed by Slice 2.
Slice 2 owns only the private environment generation/registration lifecycle,
caller-owned sharing, server-owned exclusivity, canonical descriptor/storage/
tenant scope assembly, readiness transfer, and one finite startup recovery
result with truthful attribution. Registration-scoped failed-start rollback
remains Slice 3 and must not be implemented in this pass.

Slice 2 coordinator pre-commit inspection found that a descriptor repeated in
one attachment input passes the two-pass freshness check. The first transition
may install ownership before the duplicate transition rejects. Reject duplicate
descriptor identities during synchronous generation preflight, before any
descriptor is marked, tenant scope is enumerated, or readiness transition runs.

### Slice 2 Round 1 Findings

1. Preserve descriptor/storage-context identity in generation coordination so
   equal endpoint/tenant/shard facts in distinct contexts never collapse,
   cross-run, or share rejection attribution.
2. Persist each dynamically observed multitenant tenant through the owning
   descriptor before readiness admission, so a fresh generation can enumerate
   and recover its durable rows without another notification.
3. Bound the outer registration readiness transition by the assembled canonical
   scope domain. A scope outside that domain while peer transitions are stalled
   must fail closed without per-scope retention.
4. Add deterministic tests for concurrent caller attachments serialized by the
   lifecycle gate, overlapping rejection preserving its cause, and fulfilled
   `PAUSED`/`SKIPPED` cause-less parked outcomes.
5. Split the worker/evidence adapter from the 541-line attachment owner and
   extract named attachment phases so lifecycle ownership remains reviewable.

These cross-context identity and transition-boundedness findings demonstrate a
high-risk architecture ambiguity. The existing requirements splitter is
assigned one bounded read-only resolution with explicit `gpt-5.6-sol` / `high`;
it must propose the smallest internal fix using existing roles and no public or
Slice 3 lifecycle surface. The Terra Medium implementation owner remains paused
until that resolution returns.

The Sol High resolution accepted every premise and selected a private,
generation-local owner-qualified run scope: `{ owner: { key }, ready }`, where
one owner identifies exactly one descriptor/tenant/actual-storage runtime.
Coordinator keys, pending/settled maps, worker selection, and obligation units
must include the owner key; the coordinator partitions a union by owner and
runs each owner group serially through one coordinator. Dynamic multitenant
receive must await the existing descriptor-owned `TenantIndex.keep()` before
inbox persistence/readiness. Outer readiness is a finite `waiting | open |
failed` gate over the preassembled canonical domain: canonical keys deduplicate,
unknown keys set one bit and are not retained, and invalid open rejects before
coordinator work. After open, a durable first tenant may create/configure its
owner runtime and notify normally. Split the owner-to-worker adapter into
`environment-delivery-worker.ts` and extract named attachment phases; add the
complete regression sequence recorded in the work/review logs. Slice 3 remains
the owner of failed-generation rollback and retained references.

Coordinator pre-commit acceptance requires the resolution's end-to-end tenant
durability proof, not only compositional tests: persist the first multitenant
row through a real built descriptor, reconstruct a fresh context/descriptor over
the same storage, prove `startupScopes()` enumerates that tenant, and prove
startup recovery replays the durable row without another receive/readiness
notification. This remains a focused test-first completion of Slice 2.

Round 2 requires one final integration proof through `EnvironmentAttachments`:
use two descriptors, stall one descriptor transition, route thousands of
unknown dynamic scopes through the already-transferred peer, prove the
attachment fails closed after the peer settles, and prove no coordinator work
was admitted and no unknown per-key state was retained. Direct helper-only
coverage does not satisfy this lifecycle race.

Round 5 accepted all Slice 2 behavior and evidence with four clean lanes. Slice
2 is closed. Slice 3 now owns only registration-scoped failed-start rollback:
sibling isolation, D-0085 blocker shaping, sole failed-generation quiescence/
classification/reporting/retirement/slot clearing, cleanup/reporting failure
safety, and same-operation retry after quiescence failure. It consumes the
existing T-0037b retirement primitive and T-0037c records without reopening
their contracts. Ordinary detach/stop/close and server lifecycle integration
remain later tasks.

### Slice 3 Round 1 Findings

1. Shared registration rollback must stop selected owners and prove quiescence
   before classifying/consuming/reporting, then retire; quiescence failure must
   retain registration/generation state and report nothing.
2. Selected-owner stop/await failure must not discard registration state or
   endpoint dependencies. Preserve a retryable failed rollback and complete
   remaining phases exactly once.
3. Coalesce simultaneous `retryFailedStart()` calls around one memoized rollback
   operation; successful duplicate retries must not re-enter slot clearing.
4. Bound unresolved reported-overlap memory by configured scope/owner domain;
   merge/deduplicate repeated failures and remove resolved state.
5. Once an already-reported unresolved overlap blocks startup, throw only the
   exact plain D-0085 blocker even if the same attempt also observes a fresh
   rejection; do not aggregate or chain the original/fresh cause.

One Terra Medium owner receives the complete batch with deterministic phase,
quiescence, concurrency, boundedness, and fresh-cause tests before Round 2.

### Slice 3 Round 2 Findings

1. Recheck unsafe rollback admission when each serialized attachment operation
   begins. A caller queued before the preceding failure must release its
   preclaimed registration and perform no descriptor transition/startup work;
   it must not overwrite the retained rollback.
2. Keep reported-overlap identity owner-qualified end to end. Equal readiness
   facts in distinct descriptor/storage owners must neither inherit nor resolve
   each other's blocker; add a deterministic equal-facts sibling test.

One Terra Medium owner receives both under TDD before Round 3.

### Slice 3 Round 3 Findings

1. Recompute whether rollback is now sole after queued claims are removed. A
   rollback initially classified shared must retire/clear the generation if it
   becomes the last claim before retry completes; prove a genuinely fresh
   generation/worker, not only claim count.
2. Ephemeral exact owner keys make reported overlap unreachable after the failed
   descriptor is retired, so records only grow and the D-0085 path is tested
   only as a helper. Define a stable generation-local overlap-domain identity
   that is reachable across a replacement descriptor over the same actual
   storage/context while still isolating equal readiness facts in different
   storage owners. Bound, deduplicate, resolve, and prove it end to end.

This is a demonstrated architecture ambiguity between stable overlap semantics
and storage-owner isolation. The existing requirements splitter receives one
read-only `gpt-5.6-sol` / `high` resolution before the Terra owner resumes.

### Slice 3 Round 2 fix outcome

Both findings are implemented under strict TDD. Attachment claims remain
synchronous, but every serialized operation now rechecks the retained rollback
before descriptor work. A queued claim is removed without touching descriptor,
storage, transition, readiness, or worker state; the operation rejects the
canonical explicit-retry error and cannot replace the earlier rollback. After
that same rollback succeeds, registration cardinality is zero and the untouched
queued descriptor can attach once as the fresh sole registration.

Reported unresolved identity is now an exact owner-qualified `scopeKey` set,
not a readiness-keyed map. Equal ready facts in distinct descriptor/storage
owners neither inherit nor resolve each other. Repeating an exact owner key
deduplicates, and only successful settlement for that exact owner key removes
it. The set remains bounded by configured owner-qualified scope cardinality;
the 2,048-owner regression retains exactly 2,048 entries.

Focused RED failed 4/27 before production edits. GREEN passes 27/27; the
seven-file regression passes 188/188; native server loopback passes 21/21;
affected coverage passes at 96.52% statements, 90.02% branches, 98.27%
functions, and 96.75% lines. Generated build typecheck, ESLint, cleanup,
format/diff/public/generated/protected checks are the final handoff gate. No
public export, later lifecycle, subagent, commit, or full `pnpm verify` is in
scope.

### Slice 3 Round 1 fix outcome

The complete five-finding batch is implemented under strict TDD. Shared
selected-owner rollback now closes readiness/admission, stops owners, retries
quiescence without repeating a completed stop, then classifies/consumes/reports
before permanent owner retirement and registration deletion. A stop or await
that cannot establish safety retains the rollback, registration, parked state,
and worker dependencies; replacement remains blocked until the same private
retry operation succeeds. A throwing stop is retried because T-0037b defines
that throw as incomplete stop; a completed stop is never repeated after await
failure.

`retryFailedStart()` publishes one in-flight promise before advancing rollback,
so simultaneous callers receive the same promise and resolve together. Round 1
used a readiness-keyed reported-overlap map with owner identity only in its
value; Round 2 review found that cross-owner defect and the corrected
owner-qualified set is recorded above. Existing exact-owner overlap still takes
precedence over any fresh cause and throws only the exact plain D-0085 blocker.

Focused RED failed 7/26 before production edits. GREEN passes 26/26; the
seven-file Slice 1/2/3 plus T-0037a/b/c regression passes 187/187; native server
loopback passes 21/21. Affected coverage passes at 96.49% statements, 90.21%
branches, 98.25% functions, and 96.73% lines. Changed files are the private
environment attachment/worker modules, their focused test, and canonical
TASK/work/review records. No public API/export, later lifecycle, generated
artifact, subagent, commit, or full `pnpm verify` is included.

The focused fix validates the complete input through one temporary identity set
before mutating generation descriptor ownership. A repeated identity now
rejects before `startupScopes()`, `storageContext()`, `transition()`, or the
installed readiness callback can run. Because Slice 3 owns failed registration
cleanup, the failed caller claim remains; the descriptor itself remains fresh
and succeeds in one later valid caller attachment to the same generation.

### Slice 1 Round 3 Findings

1. Keep the canonical task status and both derived log status mirrors identical.
2. Add a focused concurrent-retry regression proving that two simultaneous
   retries from the finite failed checkpoint produce exactly one accepted
   transition/route, while the loser rejects without resetting state or
   replacing the winning callback.

### Slice 1 Round 4 Finding

The retry competitor must start synchronously while the winner remains in
`transition` mode. The current test yields first and therefore proves only
post-transfer route immutability. Buffer the winner's readiness, start the loser,
and buffer the remaining readiness before any `await`; then prove neither route
ran early and only the winner flushes the complete buffered set.

The Round 3 test-only regression established post-transfer route immutability,
but its intervening `await` did not establish transition-state competition or
buffered-state immutability. The corrected Round 4 chronology now proves both:
the winner buffers configured readiness, the loser starts and rejects while the
winner is still transitioning, omitted readiness is buffered before any yield,
neither callback runs synchronously, and only the winner flushes both scopes in
order and owns later readiness. No production source or Slice 2 behavior
changed.

## Slice 2 Outcome

Slice 2 adds one package-internal registration/generation owner per
`ServerEnvironment`. Caller-owned registrations receive distinct tokens and
share exactly one current generation/coordinator. A server-owned registration
is exclusive, and every conflict rejects at the synchronous cardinality gate
before descriptor enumeration, route transition, or startup work admission.
The successful opaque attachment handle exposes only its token, generation
identity, finite startup settlement, and bounded parked records for later
lifecycle slices.

Each attachment crosses every descriptor's actual storage context, recorded
tenant scopes, supported endpoints, and canonical shards. An internal
environment-only `allowEmpty` transition handles an initially empty recorded
multitenant domain while preserving Slice 1's default Promise-channel empty
validation. The first later durable tenant readiness configures its exact
tenant/storage worker scope in the same generation before notification.

Descriptor transitions close direct admission and await admitted exact drains.
Registration route closures buffer readiness until every transition completes,
then combine buffered and startup scopes into one finite coordinator admission
before opening later route-only notification. Fulfilled `FAILED`, `PAUSED`, and
`SKIPPED` remain cause-less parked operational work; rejected attaching scopes
retain their original cause, while wholly disjoint sibling rejection is neither
blamed on nor restarted by the attaching registration.

Registration-scoped rollback, detach, generation stop/close, public API,
`Server.start()` wiring, and listener ordering remain Slice 3 or later work.

### Slice 2 Round 1 Fix Evidence

The fix carries a generation-local owner through coordinator configuration,
pending/settled identity, serial owner partitions, exact worker selection, and
parked-obligation units. Equal readiness facts in distinct descriptor/storage
owners execute independently; same-shard rejection keeps its original cause
and neither blames nor restarts the sibling. The exact worker now lives in
`environment-delivery-worker.ts`, merge aggregation is removed, and attachment
assembly, transition, recovery, and evidence recording use named bounded phases.

Process-manager and projection receives await the built descriptor's
`TenantIndex.keep()` before inbox persistence; process-manager batches keep once
before any row. Registration readiness is a finite `waiting | open | failed`
bridge over the preassembled owner-qualified domain. Waiting performs canonical
replacement only; 4,096 distinct unknown facts set one invalid bit, retain no
keys, and fail closed on `open()` before coordinator admission. Failed ignores
later facts; open permits a durable zero-to-first tenant to add its exact
runtime before notification. Focused evidence also covers concurrent caller
serialization, exact owner worker selection, PAUSED/SKIPPED cause-less parking,
and equal-fact cross-context isolation.

The affected server loopback suite produced the expected sandbox `listen
EPERM`, then passed 21/21 under native execution. Full `pnpm verify` remains the
final milestone gate and was not run.

### Fresh-generation tenant recovery acceptance proof

A focused real-context test now persists the first multitenant process-manager
row through the built context's command receive path. The first handler fails
after persistence, leaving the exact version-1 row `TO_DELIVER`; the context is
closed, then rebuilt with a fresh repository and descriptor over the same
storage factory. The fresh descriptor enumerates the durable tenant through
`startupScopes()`, environment attachment recovers that existing row to
`DELIVERED`, and the fresh process-manager state proves replay. No second
command, inbox receive, or readiness notification is issued. Current production
behavior passed this acceptance proof without modification.

Final focused verification passes 175/175 across the canonical seven files;
generated typecheck, ESLint/cleanup, format, diff, public-entrypoint,
generated/Protobuf/protected-file, and identical-Status checks pass. No commit
or full `pnpm verify` was run.

### Slice 2 Round 2 stalled-peer integration proof

The deterministic `EnvironmentAttachments` race uses two descriptors in one
attach. One peer waits on an already-admitted exact drain while the other has
completed route transfer. The transferred route receives 4,096 distinct
unknown tenant readiness facts; every durable completion resolves with zero
exact drains, zero coordinator inbox queries, and zero replay. Releasing the
peer makes attachment reject with `Registration readiness received an
unconfigured scope.` before startup admission. A later configured durable fact
is ignored by failed mode, starts no exact drain or worker query, and both rows
remain `TO_DELIVER`. Those integration observations prove fail-closed behavior,
zero coordinator work, and no later admission; they do not directly expose
retained-state cardinality. Finite one-bit/no-per-key retention is established
by the current `RegistrationReadiness` source structure — one boolean invalid
flag and a canonical-only buffered map — together with the direct finite helper
that drives 4,096 distinct unknown facts.

Final focused verification passes environment 15/15 and the canonical seven
files 176/176. Generated typecheck, ESLint/cleanup, changed-file Prettier,
`git diff --check`, public/generated/Protobuf/protected, and identical-Status
scans pass. Frozen commit `e0c1a5e3` contains the integration test and records
plus a mechanical Prettier-only change to
`environment-delivery-worker.ts`. It contains no behavioral, public API,
package-export, or Protobuf production change; repository-wide formatting
passes with that mechanical correction.

Round 3 record-only verification confirms the current diff contains exactly
the three canonical records and no source/test/package/Protobuf file. Targeted
docs/status overclaim lint, record Prettier, and `git diff --check` pass; all
three Status headers remain identical.

Round 4 record verification corrected the sole active polarity typo above.
Task/work/review scanning found no other active inaccurate occurrence; reviewer
finding chronology remains unchanged. Record Prettier and `git diff --check`
pass with identical Status mirrors and no source/test diff.

### Slice 3 focused implementation outcome

Slice 3 adds only package-internal failed-attachment rollback. A failed shared
registration is removed from admission and readiness without disturbing sibling
registration state, progress, parked records, or worker ownership. Previously
reported overlapping unresolved work adds the exact D-0085 plain startup
blocker, without chaining the earlier cause; disjoint work remains sibling
owned.

The first/sole caller registration uses the existing coordinator `retire()` and
parked-obligation APIs. Observable retirement order is stop, quiescence,
classification/report consumption, permanent worker retirement, and safe slot
clear. Reporting or post-quiescence cleanup failure still leaves the old
generation inert and safely clears its slot while rejecting the original start
once. Quiescence failure retains the generation and dependencies, blocks a
replacement, and exposes one package-internal same-operation retry. The retry
does not repeat stop, completes the remaining phases once, then permits exactly
one fresh generation.

Strict TDD REDs first observed missing registration removal and four failed
rollback scenarios before the internal lifecycle seam and implementation
existed. GREEN proves sibling isolation, exact blocker shaping, report and
cleanup failure behavior, quiescence retention/retry order and counts, slot
clear/retention, and one fresh generation. A final real-worker adapter test
proves owner-only retirement leaves its sibling selectable and rejects missing
or invalid owner selection.

The final focused gate passes 7 files/181 tests and native server loopback
passes 21/21 after the expected sandbox-only `listen EPERM`. Affected lifecycle
coverage passes at 96.33% statements, 90.61% branches, 97.70% functions, and
96.57% lines. Generated build typecheck, ESLint/cleanup, formatting, diff, and
public/generated/protected scans are the recorded handoff gate. Full `pnpm
verify`, commit, Slice 3-excluded lifecycle policy, and public API/Server wiring
remain absent.

Slice 3 changed exactly these implementation-owned files:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/environment-delivery-worker.ts`
- `packages/server/src/server/server-environment.ts`
- `packages/server/test/server/environment-attachment.test.ts`
- this task and its canonical work/review records

Final `pnpm lint:generated`, repository Prettier, and `git diff --check` pass.
Public entrypoint/package/lockfile diffs and generated/Protobuf/protected-human-
review scans are empty; all three Status mirrors are identical.
