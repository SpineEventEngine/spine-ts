# D-0157: Agent acknowledgement and complete Delivery lifetime

Accepted 2026-10-28, bounded M7b decision. Source read in the environment-lifecycle worktree;
the relevant files contain active uncommitted implementation. Existing requirements
splitter, explicitly configured Astra/high; runtime model introspection unavailable.
No source changes, tests, or child agents. This decision preserves D0152–D0156.

## Decision

Keep two distinct completions on the existing Delivery execution:

1. The exact input's delivery attempt: ordinary processing and acknowledgement,
   or Agent receipt admission and acknowledgement.
2. The complete shard run: page processing, all admitted live Agent closures,
   session maintenance, and final release.

Local input posting awaits the first. Delivery.run/drain, supervisor run tracking,
whenIdle, readiness transfer, and shutdown await the second. Neither completion
may be represented by a fabricated terminal DRAINED result while a handler runs.
An accepted Agent closure starts only after its Inbox acknowledgement succeeds.

Pull forward only retention of an actual core Delivery instance. The existing
DeliveryReadiness is already shared by LocalEntityInbox and LocalProjectionInbox.
Its route() should select/reuse a retained Delivery for the complete existing
storage namespace, tenant mode/ID, factory and installed facility configuration.
Today it returns the supplied per-operation instance or constructs another one.
The core Delivery retains active shard runs. Do not add a second context-level
Agent scheduler or a detached work registry beside Delivery.

M8 will supply the single environment Delivery to this same routing path; active
run/message completion/wake mechanics remain in Delivery. The temporary part is
only selection of the existing context/tenant storage facilities. Do not pull
forward shared Inbox tenant extraction, global route consolidation, or the rest
of environment setup in this slice.

## Exact internal contracts

Introduce a package-internal handle around the existing DeliveryDrain:

```ts
interface ActiveDeliveryDrain {
  readonly completed: Promise<DeliveryRun>;
  wake(): void;
  stop(reason: unknown): void;
}

type DeliveryMessageOutcome =
  | { readonly kind: "acknowledged"; readonly agent: boolean }
  | { readonly kind: "deferred" }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "unresolved"; readonly run: DeliveryRun };
```

The outcome is internal, transient, and per full Inbox row identity. No status
Proto, Agent status API, or persisted continuation is added. `agent` distinguishes
the deliberate early Agent completion where useful; ordinary acknowledgement still
requires the ordinary endpoint/monitor path to finish.

Core Delivery starts or joins one active run per shard in its configured physical
scope. Register the exact-message observer **before starting/waking** the run.
`drainMessage()`/InboxHandoff use that message promise; they no longer need a
terminal DeliveryDirectRun.run to recognize the selected row's success. Keep a
terminal run fallback for a row that was never attempted. Public builder-created
Delivery.run and the existing drain API continue to return terminal results.
Use the existing package-local deliveryControls seam to expose wake to controlled
delivery; no application-facing lifecycle handle is required.

The run record must be installed synchronously before asynchronous pickup starts,
so two posts cannot start two local acquisitions. Joining an active run only wakes
it and attaches an observer; it does not try to acquire its shard again. Resolve
all unresolved observers on terminal pickup failure, stop, release/fatal run error,
or exhaustion using the existing direct error policy. Remove observers as soon as
their exact outcome settles.

### Outcome ordering

- Agent accepted: CAS true, ack succeeds, retain/schedule live closure, emit
  acknowledged. Track the closure before yielding completion to posting. An
  immediate handler rejection belongs to live-run completion, not a reversal of
  input acceptance.
- Agent duplicate: verified matching receipt, successful Inbox acknowledgement,
  acknowledged; no closure.
- Capacity unavailable: deferred, leave row pending, no FailedReception, no ack.
  Direct handoff reports its existing unsuccessful-delivery error; it cannot
  report success just because ordinary Inbox persistence succeeded.
- Receipt/CAS error: failed with the original error; keep pending. Do not use
  generic markDelivered or an unrelated row's acknowledgement to settle it.
- Ack failure: discard accepted closure/reservation, failed with original ack
  error after existing acknowledgement-only retries. Receipt remains inert.
- Ordinary endpoints: await the existing endpoint and selected monitor action;
  retain ordinary error classification and retry/mark-delivered policy. Emit an
  acknowledged outcome only after that policy has completed. Propagated ordinary
  Command rejection/errors still propagate. This change must not resolve a post
  merely because onDelivered ran while its error-handling path is unfinished.

The present `InboxHandoff.drainAttempt()` success-first readback must not override
an explicit Agent failed/deferred outcome. A selected message's observer cannot
be satisfied by another row with merely the same target. Continue exact typed
signal/action/tenant checks for duplicate semantics.

## One complete dispatcher and ordinary follow-ups

A retained run cannot capture the first post's limited route callback forever.
Configure it with the context's existing combined Entity/projection routing
(ContextParts.createDeliveryDescriptor already selects by label). Keep registration
and route selection local and established before input arrives. LocalProjectionInbox
must reach the same active core Delivery when an Agent holds the shard.

Adapt the existing local replay methods into this dispatcher without changing
their follow-up placement: Entity replay can return its existing ordinary
EntityInboxFollowUp to the current ordinary post-ack follow-up path. Do not replace
local replay with descriptor.replay indiscriminately: supervised replay currently
awaits its callback, whereas direct replay collects callbacks separately. Preserve
that distinction and the existing ordinary follow-up error policy. Agent closures
use the separate tracked live result and never enter the shard-wide follow-up map.

Readiness direct claims currently stop being active when the posting promise
settles. Track the underlying retained run.completed independently. Transition
must await the complete direct runs/session releases, not only message outcomes.
While transitioning, buffer notifications under existing configured-route rules;
after installing new ports, forward them to the new route. Do not let old/new
facilities execute the same shard concurrently. Context close also reaches these
runs even if every originating post already returned.

## Wake, scanning, and capacity

Replace `Promise.race(liveAgents)` as the sole idle wait with a coalesced wake
generation plus live-settlement/stop notification. A wake means rescan durable
Inbox input; it is not executable work. Register the wait and capture the generation
before checking for no work. Before sleeping or releasing, recheck generation;
a notification between the last empty read and sleep/release must either cause
another scan or a new run after release. Wake during acquisition is retained too.
No polling loop or new timer interval is needed for input/capacity wakes.

DeliverySupervisor.notify(activeShard) must forward wake through DeliveryRunControl
to the active core run. Existing queuing alone waits for that run to end and blocks
late input behind a long model call. Retain a coalesced pending notification until
active-run routing accepts it; if the run is releasing, its completion starts the
pending run. Preserve configured supervisor shard concurrency and pending bounds.
New unrelated Agents in an already active shard proceed under existing AI capacity.

Capacity release needs a concrete bridge even when the deferred shard has no
active run. Add a small availability subscription on the existing
AgentExecutionCapacity, e.g. `onAvailable(listener): () => void`. Notify after
reservation removal/promotion leaves availability; include same-target availability
when its entry disappears, not only a global full-to-nonfull transition. Local
delivery remembers only coalesced deferred shard/route hints and forwards them
through ordinary readiness; supervised mode invokes supervisor.notify. Hints are
removed on successful rescan/disposal, listeners on context retirement/close.
They contain no input payload/handler closure and are not a new accepted queue.

Concretely, expose `DeliveryReadiness.notify(ready): void` for this existing
eligibility route, independent of claim(). In direct mode it starts or wakes the
retained core Delivery with its configured dispatcher even when the external
onReady observer is absent. In transition mode it buffers; in routed mode it
forwards to the installed supervisor. Core Delivery's package-internal
`notify(shard)` wakes an active run or starts one with that configured dispatcher.
Installing the dispatcher precedes accepting input; it is never guessed from the
last posted message. Observe terminal failures through the configured delivery
reporter. Calling only today's optional onReady callback would lose direct-mode
capacity release when there is no active run.

Subscribe/retain the hint before the failed reservation check, or recheck an
availability generation after registering it, so release cannot fall in a lost
notification gap. Keep the existing safety scan as fallback. Never notify solely
on WRITTEN: a retry of an existing pending row and a capacity release also make
work eligible without writing another row.

Defer the rest of the same target for that ordered scan after its oldest row is
deferred; unrelated targets continue. Clear only temporary capacity blocks on a
new eligibility wake/rescan, preserving failure/ack blocks as required by existing
policy. A capacity release between two rows must not admit the later same-Agent
row first. Accepted same-Agent live work remains serialized by the current capacity
gate and ordinary shard session. Read state when its turn begins.

## Session lifetime, authority, and close

Run completion waits for all accepted live closures. Normal empty input is not a
reason to abort them. On normal completion release only after live work settles.
On explicit stop/session loss/fatal run failure, fence admission first, cancel the
live signal, wake sleeping scans, await entered work under existing shutdown rules,
then attempt release. Do not unconditionally abort in the normal release path.

Maintain leased sessions while live work waits. Reuse the configured lease duration
(derive from the issued session's pickedUpAt/expiresAt where needed), schedule
renewal before expiry, serialize renewal with validation/release, and update one
current session snapshot. No arbitrary Agent timer. A failed/undefined renewal or
validation permanently fences that run. Never reacquire to continue accepted work.
Exclusive remote sessions get authoritative validation at effects; do not invent
a renewable expiry for them.

`#startAgent()` currently runs outside the dispatch's withDeliveryCommitFence scope.
Establish that same current-session guard around the **whole live closure**. Signal
cancellation alone is insufficient when an external session can be lost without
a local abort. Pass a minimal live control `{signal, checkSession(): Promise<void>}`
to the accepted run, or expose that same guard through the existing scope; require
it before subsequent model/tool sends, audit/publication, and final commit. The
runner must not retain the obsolete withoutDeliveryCommitFence escape. Existing
D0152 limits still apply: no atomic guarantee spans external services and storage,
and already issued external calls may finish after loss.

Add core Delivery close/stop access through the package-internal lifecycle seam:
fence new runs synchronously, cancel/wake all active runs, await all completed
promises, and report release/cleanup errors after attempting all runs. Direct
readiness close invokes it before receipt/repository storage closes. Supervisor
continues its existing grace/fence/cleanup behavior against the full terminal
promise. Retained direct-run failures need the existing delivery logger/monitor
reporting path even when no post is waiting; do not detach with catch-and-ignore.
No new public shutdown timeout or unlimited error backlog is introduced.

Same-shard outgoing Commands must enter ordinary bus/publisher tracking once and
must not await the originating shard's full run. Register the ordinary send before
the handler settles; let existing bus drain track that send. Do not weaken all
Command posting to fire-and-forget, await a same-Agent deferred response from its
current turn, or save an Agent-private outgoing list. Close drains those already
tracked bus sends before closing their resources.

## Required focused evidence

1. C=2 gated Agent A/B: both posts acknowledge before their model gates release;
   both handlers enter. A third distinct Agent arriving after an empty scan also
   enters while A remains held when configured capacity permits it.
2. Same Agent: later input never starts first; after the first finishes a pending
   row is promptly admitted without another write or safety timer. Different
   Agents/projections/ordinary Entities in the shard continue independently.
3. Exact result matrix: Agent CAS error, capacity defer, ack failure, duplicate,
   post-ack handler rejection; ordinary rejection/monitor retry/ack behavior.
   Assert pending rows and original error identity where applicable.
4. Wake race barriers at empty-read/sleep, acquisition, release, and capacity
   subscription. Cover capacity freed on another shard/context sharing the registry
   and no active run for the deferred shard. No arbitrary sleeps.
5. Fake-clock lease renewal across a held handler; concurrent renew/validate
   serialization; sticky loss cancelling queued/live work and rejecting later
   audit/state/tool effects. Exclusive-session validation has no synthetic lease.
6. Close and readiness transition after posts returned but handlers remain live:
   full runs stay tracked; resources are not closed early; release failures are
   visible; cancellation cannot revive work. Preserve strict state registration.
7. Same-shard outgoing Command, including same-Agent target: ordinary persistence
   occurs once and no recursive drain wait; command can execute after the current
   turn. Context bus close still waits for already handed ordinary output.

## Source evidence and bounded implementation order

- `delivery.ts`: #drainDirect awaits terminal drain; DeliveryDrain.#readPages and
  #shortPageDrained await only liveAgents; #release aborts/awaits them; #startAgent
  lacks the dispatch commit-guard scope. #processAttempt contains the correct
  internal Agent outcomes, but must expose their exact message completion.
- `local-inbox-handoff.ts`: DeliveryReadiness.route/claim/transition and
  InboxHandoff.drainAttempt currently couple message success to terminal drain.
- `entity-inbox.ts` and `projection-handoff.ts`: both share route(); their replay
  filters/follow-up behavior differ and must survive dispatcher consolidation.
- `delivery-supervisor.ts`: #admit queues active shards rather than waking them;
  #run/whenIdle/close already provide the correct full-run tracking location.
- `delivery-run-control.ts`/`delivery-builder.ts`: existing controlled runner seam.
- `agent-execution-capacity.ts`: release/#finish/#settle have no availability bridge.
- `bounded-context.ts`: #createDelivery shares readiness; createDeliveryDescriptor
  already combines route families; #closeOnce must drain retained live delivery
  before receipt/bus/repository closure after scheduler removal.

One implementer: first exact-message versus completed handle and retained instance;
then wake/supervisor/capacity wiring; then renewal/authority/close integration.
Validate together before accepting the coherent M7b cutover. This is the minimum
delivery lifetime needed by live Agent execution, not an extra recovery subsystem.
