# M8 close corrections: public runs and individual contexts

2026-10-28. Bounded ruling for accepted R1–R3 in the complete M8 review wave.
Source: current environment-lifecycle worktree. Configured requirements-splitter
profile is explicitly gpt-6-astra/high; independent runtime metadata is unavailable.
No source changes, tests, or child agents were performed.

## Decision

Use three existing controls, with narrow internal additions:

1. Track every admitted CoreDelivery drain by operation identity until its session
   release settles. Keep the per-shard shared-run map for default replay joining.
2. Give each BoundedContext one Agent-only cancellation signal, composed with the
   ordinary Delivery-session signal. Keep ordinary admitted work drainable.
3. Remove a closing context from fresh recipient selection synchronously, while
   retaining its state reservations. Track already-entered shared replay in that
   context until completion, then finish the existing bus/follow-up drain.

No public lifecycle methods, second Delivery, new scheduling policy, durable
backlog, recovery path, timer, or generic lifecycle registry is needed.

## R1: all admitted drains remain live until release

Current evidence:

- BuiltDelivery.run() delegates to CoreDelivery.run()
  (`delivery/delivery-builder.ts:488`).
- CoreDelivery.run() directly calls drain() (`delivery/delivery.ts:392`).
- #activeDirect is populated only by #startShared() (545), while close() (312)
  snapshots that map. Explicit custom-callback runs therefore escape its wait.
- #runSession() (654) also uses a shard-keyed #directDrains map. A map intended
  for shared-run wake/join cannot represent all independently admitted explicit
  operations.
- Release failures are currently copied through the shared shard slot
  (#releaseStoppedSession at 627 and #runSession at 654). They need the precise
  operation record, including a pickup that resolves after shutdown starts.

Concrete change:

Keep one private Set of active drain records in CoreDelivery. Each record contains
its terminal completion promise, optional acquired DeliveryDrain handle, and
release failure. Register it synchronously before the first asynchronous pickup.
The private admitted implementation performs the existing pickup/drain/release
logic and finally removes precisely that record.

The existing public/internal drain() entry wraps that admitted implementation.
Thus run(), standalone runControlled(), and shared #startShared() all use the
same tracking. #activeDirect continues to select the one joinable default replay
run for a shard, referencing its exact record/handle. An explicit run with a
custom onMessage remains an independent attempt with that callback. It can
receive SKIPPED from ordinary shard coordination; it must never silently join a
run using a different callback.

Keep all active acquired handles reachable by operation identity for close.
Only the joinable shared handle participates in the existing shard wake map.
Do not let a custom explicit run overwrite a shared run's wake handle or release
failure. A run that has not acquired its session yet is still active; after
pickup settles it observes the closing fence and releases without dispatch.

Add an internal synchronous beginClose() on CoreDelivery if needed to reuse the
fence. It closes admission, captures the active operation records for this close
attempt, then stops existing drain handles. CoreDelivery.close() calls it and
uses that retained snapshot, waits through release, attempts both retained store
closes, and aggregates original rejection/release/cleanup
failures. Preserve public terminal result conversion and monitor semantics;
do not change an existing FAILED result into an unrelated thrown close error.

A valid ServerEnvironment.close() must invoke the core admission fence
synchronously before its asynchronous setup/supervisor/facility cleanup chain.
A rejected environment close while contexts remain active keeps its existing
behavior. Capture at the synchronous fence, because a run can release and leave
the active set while asynchronous supervisor cleanup precedes core.close(); its
release failure must remain visible to this close attempt. Retain only that close
snapshot, not an accumulating history of completed runs. Environment close
otherwise retains the current supervisor/core/remote
facility/store ordering. Store and factory closure cannot precede active run
release even when a stop signal has already been sent.

Use the same active-record set for CoreDelivery.whenIdle(), so explicit runs
participate in its terminal wait too. No joining by callback equality or arbitrary
custom callback cancellation is required. A held ordinary callback can delay
close until it settles; retained resources must remain available during that wait.

## R2: cancel only this context's live Agent turns

Current evidence:

- Repository InboxReplay.admitAgent() takes only AgentDeliveryScope.signal()
  (`repository/repository.ts:11455`).
- recordAcceptedAgent() passes the later Delivery signal/checkSession straight to
  AgentLiveRunner (11530–11560).
- Capacity reservation already accepts a signal and cancels waiting entries
  (`agent/agent-execution-capacity.ts:148–244`).
- AgentLiveRunner already uses its signal and checkSession for model, tool,
  read, audit, state and output work (`repository.ts:4583` onward).
- Repository closeRuntime() fences new storage work and waits admitted work,
  but does not cancel execution (9801).
- DeliveryDrain's #agentController belongs to the whole shard session; aborting
  it for one context would incorrectly affect sibling recipients.

Concrete change:

Add one AbortController to BoundedContext for Agent lifetime only. Pass its
readonly signal through the existing RepositoryRegistration/RepositoryRuntime
internal fields. In #beginClose(), abort it synchronously and idempotently.
Do not abort the Delivery session or a sibling AI registry.

Compose the context signal with AgentDeliveryScope.signal() before capacity
reservation. Use the same context signal again with the live session signal
received by recordAcceptedAgent.run(). Both phases matter: cancelling only the
runner leaves capacity waiters resident; cancelling only the reservation does
not cancel an already-started runner.

Construct one Agent effect guard from the composed signal plus the supplied
session check:

```ts
signal.throwIfAborted();
await checkSession();
signal.throwIfAborted();
```

Pass that guard to AgentLiveRunner and withDeliveryCommitFence. The second check
closes the cancellation-during-validation gap. Existing live model/tool/read/
audit guards then inherit context cancellation without changing ordinary
Entity commit guards. An operation already committed or external request already
issued before cancellation cannot be undone.

Track context Agent work from reservation through settlement, including the
receipt/acknowledgement-to-run gap. The smallest reuse is to expose the capacity
reservation's existing completion promise as an internal readonly member and
have #reserveAgent retain those promises in a context-local Set. Do not introduce
a second scheduler or new pending descriptor. Completion already settles when
an unstarted reservation is cancelled/released or its started callback settles.
Observe rejections immediately while preserving their ordinary Delivery failure
reporting. A late receipt result remains subject to the aborted signal; it can
leave immutable acceptance evidence but must not start effects after close.

Await these admitted reservations before closing Agent receipt/history/repository
resources. Also wait admitted replay callbacks so an in-flight receipt attempt
cannot arrive behind that drain. Receipt close retains its existing physical
operation drain. Cancellation does not delete receipts, synthesize termination
history, undo an acknowledgement, or revive an accepted signal.

Cancellation is cooperative. Existing AgentLiveHandler.awaitHandler() races a
handler against its established signal/deadline (`repository.ts:4528`); this
correction supplies the missing signal and retains its existing behavior. It
does not add a detached execution strategy, timeout or claim that arbitrary
JavaScript/external effects can be forcibly terminated. Late framework calls
must fail through closed live facades/guards. Tests may release an application
barrier after proving cancellation and sibling progress.

## R3: early recipient fence, with admitted ordinary work preserved

Current evidence:

- #beginClose() fences public buses/publisher, but not recipient selection
  (`context/bounded-context.ts:1398`).
- EnvironmentContextRegistrations keeps #recipients and #states separately
  (`server/server-environment.ts:750–805`). remove() currently deletes both
  after context cleanup.
- Environment #acceptsMessage/#replayMessage select the registered recipient.
- ContextParts.createDeliveryDescriptor() calls Entity/Projection replay
  (`bounded-context.ts:3777`); these paths await tenant admission and handlers.
- Existing drainContextWork() loops until accepted bus/follow-up work stabilizes
  (3835). Keep this behavior.
- DeliveryDrain checks acceptMessage before async monitoring/session work
  (`delivery.ts:1010–1070`), creating a close race before actual endpoint entry.

Concrete change:

Add a package-local registration operation that removes only the selected
context's recipient entries. Call it synchronously from #beginClose(), before
awaiting integration or bus shutdown. Retain #states and context tracking until
actual cleanup has completed. This is a dispatch fence, not full deregistration.

At actual shared callback entry, capture the selected context and register the
replay completion in a Set on that context, before any await. Invoke the captured
descriptor for the remainder of this already-admitted callback. Its ordinary
tenant checks, handler work, Entity commits and follow-ups can finish after the
recipient has been removed. Wait those replay completions before repository and
Stand closure. The set tracks running promises only; it stores no Inbox payload,
retry plan or backlog.

The predicate and endpoint entry must have a single synchronous handoff. Recheck
the existing acceptMessage predicate immediately before invoking onMessage on
every dispatch attempt, including monitor-requested repeats. If the recipient
has closed during earlier awaits, return a private 'not admitted' dispatch
sentinel and leave the row pending. #processAttempt must return without
acknowledgement, handler-failure policy, Agent receipt, or further execution for
that row. Continue unrelated targets. This sentinel is an internal application
of the existing admission predicate; do not expose a new public policy or label
ordinary closure as Agent capacity deferral. A plain Error sent through
FailedReception is unsafe because its default policy can acknowledge the row.

Ensure there is no await between that final predicate check, recipient capture,
and context active-promise registration. If code structure adds one, recheck
inside that same atomic admission step. Never resolve an empty callback as if
it processed the row.

Distinguish the three existing cases:

- Shared replay already entered before close: drain it and its accepted ordinary
  follow-ups. Closing the public bus does not invalidate the captured work.
- Local direct post already admitted by its bus/handoff: preserve its existing
  exact-message callback and result, even if persistence finishes after
  beginClose. Existing bus drains and readiness gates keep its work alive.
  Selected direct-message callbacks remain eligible; the fresh shared fallback
  does not. Internal follow-ups from that accepted work continue through the
  existing internal publisher/bus admission path.
- Remote row successfully received before close, but not yet dispatched into
  this context: D0161 reception success has already occurred. Leave the row
  pending after recipient fencing. Close does not promise local execution or
  wait for another replica's dispatch. No queue or new remote completion wait.

Do not impose a blanket 'context closing' rejection inside all Inbox/repository
callbacks; that would reject legitimate accepted local work and ordinary
follow-ups. Gate fresh shared entry separately from those existing retained
direct callbacks.

## Context close ordering and failures

1. Synchronously fence fresh recipients and public input; abort the Agent-only
   controller. Keep state reservations. Remove this context's capacity-availability
   listener without disabling sibling listeners.
2. Close integration intake and drain existing public/internal bus work.
   Await the context's already-entered shared replay promises and its Agent
   reservations. Keep the existing ordinary follow-up drain and repeat the bus/
   publisher stabilization after replay settlement.
3. Close readiness after admitted local handoffs have settled; it must not stop
   the environment core. Complete the existing second bus/follow-up drain.
4. Close receipts, buses/monitoring, Stand and repositories in the existing
   resource order. Perform independent cleanup attempts and aggregate failures.
5. Remove final context/state registrations only when no admitted execution or
   delivery target can still use them. A failed phase does not reopen recipient
   admission. Never release a state reservation while execution is still active.

The context-local active promise sets must retain failures for the close attempt
that waited them, without unhandled rejections. Preserve the original operation
error on its operation/Delivery path. Expected cooperative cancellation is not
automatically a new cleanup failure; actual release/store/cleanup failures remain
observable. If all execution is settled and resources are irrevocably fenced,
the existing attempt-all disposal behavior can remove final registrations even
when cleanup reports an error; an unresolved active operation cannot be treated
as completed merely because another cleanup phase failed.

JVM guardrail: local official `core-jvm/server/.../entity/Repository.java:585–616`
explicitly unregisters its Inbox before closing storage and attempts remaining
cleanup after failure. `BoundedContext.java:455` closes buses, broker, Stand and
repositories. These support early recipient disposal before storage closure.
They do not establish TS Agent cancellation or async-drain guarantees; the
composition above follows current TS live execution and D0157.

## Bounded implementation and acceptance

The sole existing writer can implement R1 separately, then R2/R3 together.
Independent documentation/dead-helper corrections remain independent.

Required focused tests:

- Hold a custom public Delivery.run callback, begin valid environment close,
  reject new runs, and prove retained stores remain usable until callback and
  session release settle. Preserve its custom callback and terminal result.
  Gate pickup as well as an acquired session. Inject release failure and verify
  the original failure is visible in close; attempt all remaining cleanup.
- Race custom public/default shared runs on one shard and on different shards:
  no callback substitution, no shared wake-handle overwrite, actual SKIPPED
  preserved. Retain existing same-process direct/supervisor join proofs.
- Two contexts with distinct Entity state types: hold an acknowledged Agent in
  one, close it, observe cancellation/no later model/tool/audit/state/output
  effects, and process sibling input on the same shared shard. Release any
  uncancellable test handler gate; verify settled cleanup and no late commit.
- Exercise Agent cancellation while capacity-waiting and while receipt/ack is
  in flight. Accepted evidence survives; no restarted execution; no capacity
  leak; sibling capacity/notifications remain usable.
- Hold context cleanup at a barrier, then notify a fresh shared row for it.
  No endpoint enters, no acknowledgement or FailedReception action occurs, and
  the row remains pending. Duplicate-state registration stays rejected until
  safe final cleanup. Use distinct state schemas for the healthy sibling.
- Gate monitoring/session validation after the first admission predicate and
  close before actual callback entry. Recheck leaves the row pending. Cover a
  monitor retry too.
- Gate an already-entered ordinary replay; close; release it and verify its
  commit/follow-up succeeds before resource closure. Separately gate a locally
  admitted post's receive before close and prove exact completion survives.
- Remote reception before close with dispatch afterward remains pending and
  preserves D0161 post success; no cross-process wait. Keep managed relay and
  existing D0157/D0161 close/fencing regressions.

No broad environment rewrite, public cancellation API, new general registry,
Agent recovery, arbitrary timeout, migration, or delivery-policy change belongs
in this correction.

## Exact local-handoff and follow-up mechanics

This elaborates the admission and drain steps above; it adds no second dispatcher.

CoreDelivery already has the required retained exact-row route:
`#drainDirect()` (`delivery.ts:483`) installs `#directPending` keyed by tenant,
Inbox message ID and shard before starting/waking the shared run. `#directOptions()`
(about 575) selects that entry before consulting `#replay`/`#acceptReplay`.
`#controlledOptions()` (446) also uses these direct options when the environment
has installed replay. Therefore the precise selector during close remains:

1. If that exact row has an existing direct-pending entry, use its captured
   `input.acceptMessage` and `input.onMessage`. Do not additionally require the
   environment recipient lookup to succeed.
2. Otherwise consult the environment's normal open-recipient predicate and
   callback. Removing the context makes this fallback ineligible.

This also handles an admitted local bus operation whose receive resolves after
close starts: the bus drain is still waiting for that operation, readiness has
not yet closed, and its normal `drainMessage()` installs the exact entry. Keep
that sequence. Do not move readiness close ahead of accepted bus work, or add a
closing-context check to the captured exact callback. Normal external bus
admission is already fenced, so this exception cannot create fresh public work.

Ordinary internal follow-ups use the existing SignalPublisher/internal bus paths
and therefore become tracked bus operations. In local mode their own received
rows install normal exact entries in the same map. They do not require retaining
the context in the fresh shared lookup. In remote-supervised mode their handoff
continues to mean reception/notification only under D0161; the close wait does
not grow into waiting for remote execution. An acknowledged Agent's late output
is not an allowed ordinary follow-up: its composed Agent effect guard rejects it
once that context is closing.

Use a private sentinel local to DeliveryDrain for the final predicate race, e.g.
`const dispatchNotAdmitted = Symbol(...)`, and extend only its private dispatch
result union. At entry to `#dispatch`, immediately before entering
`AgentDeliveryScope.run` and its synchronous callback invocation, evaluate the
effective options.acceptMessage again. Return the sentinel on false, before
`observation.entered = true`. There must be no await between this check and
onMessage entry. Return the sentinel from #dispatch itself: the existing
AgentDeliveryScope.run intentionally discards its callback's return value and
must not be expected to transport this sentinel. In `#processAttempt`,
test that sentinel immediately after dispatch and return without calling
`#completeAttempt`, `#handleReceptionFailure`, or any Agent-specific branch.
Do not increment successful/admitted statistics for that rejected entry. Its
pending row can be passed over for the rest of the current scan; other targets
continue. A later lifecycle replacement/ordinary notification can retry it.
The same `#dispatch` path is used by monitor-requested repeats, so it repeats the
final check. Exact pending entries still pass through the first selector above.

Follow-up completion has two existing forms:

- Shared descriptor replay calls `LocalEntityInbox.replay()`, which uses
  `#replay(..., runFollowUp=true)` (`entity-inbox.ts:135,505–532`). Its promise
  already includes the returned callback. The context active-replay gate must
  surround that whole promise, not merely `target.replay()`.
- Exact local drain captures the callback in `#replayAndFollowUp()` (395) and
  schedules it in `#drainInboxRow()`'s finally block (355), through the existing
  `#followUps` map and `#chainFollowUp()` (483). Include those existing promise
  values in a package-local EntityInbox drain operation used by context shutdown.
  Drain until its current follow-ups settle, then run the existing bus/publisher
  stabilization again. Do not return from the context drain merely because the
  exact-message acknowledgement has resolved. Preserve the callback's existing
  publication-error handling; this is lifetime tracking, not a new retry policy.

Register/retain the callback's completion before the containing handoff reports
completion. Callback code must keep the existing synchronous ordinary bus
admission that D0157 relies on. Never wait on the originating shared shard's
full terminal run to execute or drain these follow-ups. Only the selected
context's admitted replay, callback and bus promises participate; an unrelated
sibling's live Agent can keep that shard active without blocking context close.

Add focused tests for both callback forms and the supervisor-first shared run:
close after local bus admission but before Inbox receive resolves, then prove
the exact row and its internal ordinary follow-up still complete through the
same core, while a different unadmitted row for that closing context stays
pending. Keep a sibling handler active to prove no whole-shard wait was added.
