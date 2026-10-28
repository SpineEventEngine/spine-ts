# Fatal required initialization and automatic cleanup

2026-10-28. Bounded decision for the demonstrated eager-preparation failure.
Read-only against environment-lifecycle M9 WIP above M8 bc70731f55e7dcda0f5edcc551075bf244c8ee68.
Configured role/profile: existing requirements-splitter, explicitly
gpt-6-astra/high. Independent runtime metadata is unavailable. No source changes,
tests or child agents were performed.

## Required behavior and current gap

Required startup preparation failure synchronously prevents fresh input and
builds, automatically attempts safe cleanup, and reports the original cause plus
cleanup failures. Lazy failure, tenant admission failure and local misuse do not
initiate that shutdown. Already-admitted ordinary work remains drainable; Agent
cancellation follows D0162. No process exit, public lifecycle API or restart is
introduced.

Current source:

- Builder #buildAsyncWith() takes a count-based build ticket before awaitSetup()
  and releases it only in finally (`context/bounded-context.ts:2329`).
- #buildAsyncReady() awaits integration, eager preparation and registration, but
  catches failure by closing only its context (2345–2377).
- ServerEnvironment.close() rejects while contexts/builds remain active
  (`server/server-environment.ts:379`). It is consequently not the required
  automatic failure coordinator.
- awaitSetup()/beginContextBuild()/completeContext() do not check a fatal latch
  (same file, 865–887). A resolved setup promise still admits later builds.
- Registrations already distinguish all constructed contexts, completed contexts,
  fresh recipients and state reservations (710–840). Extend that existing class.
- D0162 CoreDelivery.beginClose() fences all drains, snapshots runs and stops them
  (`delivery/delivery.ts:364`). Calling it at first fatal failure would stop
  exact internal handoffs that admitted context work may still need.

The red log proves the later-build defect. The solution needs both an immediate
admission fence and an automatic cleanup operation; a fence alone is insufficient.

## 1. Environment-local failure record, not public close recursion

Add one private fatal-startup record to ServerEnvironment. It retains:

- original independently occurring startup causes in observation order;
- cleanup failures from participating build rollback/context/facility cleanup;
- one automatically started cleanup completion promise.

Use narrow package-local hooks such as:

```ts
serverEnvironmentAccess.failStartup(environment, cause): void;
serverEnvironmentAccess.awaitStartupFailure(environment): Promise<never>;
serverEnvironmentAccess.requireAvailable(environment): void;
```

Names can follow local conventions. failStartup is synchronous: record the cause,
latch unavailability, establish all immediate fences, and start the one cleanup
attempt. It must not await anything. awaitStartupFailure joins that attempt and
then rejects with the preserved failure. The cleanup task itself can settle to a
collected error list, so automatic scheduling does not create an unhandled
rejection before the initiating caller is ready to await it. No public event,
status class or generic lifecycle manager is required.

Reuse the existing closing state where appropriate, but preserve the distinction
between this fatal record and ordinary close's active-context rejection.
Fresh completeSetup, awaitSetup, beginContextBuild and final context publication
must check the latch. awaitSetup also rechecks after its awaited setup promise.
An already successful setup promise is not renewed authority after failure.

Public environment.close(), if invoked during fatal cleanup, joins that automatic
attempt rather than throwing the ordinary active-context error or starting a
second close sequence. Existing ordinary close behavior remains unchanged when
there is no fatal failure. A failed environment never becomes available after
cleanup or after removal of state reservations.

## 2. Synchronous first-failure fence

Before failStartup returns:

1. Fence new build tickets and public setup/preparation admissions.
2. Snapshot all currently constructed contexts and call their existing
   boundedContextAccess.beginClose() synchronously. This removes fresh shared
   recipients, fences public signal input, cancels this context's Agents and
   retains its state reservations.
3. Fence fresh explicit public Delivery runs, without yet stopping the shared
   core needed by retained ordinary handoffs. Details follow below.
4. Ensure query/subscription/public read entry points also consult an immediate
   input fence. Bus beginClose alone is insufficient for a previously obtained
   Stand or service reference.

Apply a public-input fence at actual entry, not as a blanket check in
#admitTenant(), #prepareInput(), provider preparation or repository callbacks.
Those helpers also serve admitted ordinary work after close begins.
For example Stand.#checkedTenantId() is shared by public reads, repository
#readCurrent(), and #prepareUpdate() (`stand/stand.ts:408,611,744,1047`).
A fatal check placed there would reject admitted commits/internal reads.
Use the existing public versus repository entry separation: a package-local
public admission callback/check before a public read is accepted, while retaining
the existing private repository paths. Public reads already admitted before the
fence continue under Stand's existing in-flight operation tracking.
Do not set Stand's full #closing flag early; that closes required mutation paths.

Subscription service preparation already reaches
boundedContextAccess.prepareInput() through TenantStatuses.require()
(`services/spine-services.ts:2165`). Ensure the fresh service admission check is
before its asynchronous membership/preparation work. A request already admitted
must retain its preparation through settlement. No new preparation should start
merely because cleanup scans a context.

This is one environmental failure fence using existing ingress controls, not a
new policy for otherwise healthy delivery. Previously committed business effects
remain committed.

## 3. Build-ticket ordering: never await one's own cleanup

Extend the existing build count with a whenBuildsIdle() promise/gate. There is no
need for a new general task registry. New tickets are impossible after the fatal
latch. A ticket finishes exactly once after its build's local assembly/rollback
work has quiesced, not after global cleanup.

The failure flow is:

```text
required phase fails
  -> failStartup(original cause)             [synchronous global fence]
  -> finish this build's local rollback      [partial resources/context]
  -> record rollback errors in fatal record
  -> release this build ticket              [finally]
  -> awaitStartupFailure()                   [outside the ticket]
```

In particular, do not await a fatal-cleanup promise in #buildAsyncReady's catch
while #buildAsyncWith's finally still retains the ticket. Move the final global
join outside the ticket-bearing try/finally. Local rollback still completes
before releasing the ticket, so shared factories cannot close under it.

Other builds already in flight follow the same rule. Recheck availability after
generated metadata loading and after every asynchronous construction/startup
phase, before entering another phase and before publishing completion. Capture
the environment once and pass it through builder work rather than repeatedly
looking up a potentially reset singleton. Do not return a successfully built
context after its build observed the fatal fence.

A build still loading generated metadata may have no context; it finishes that
operation, observes the fence before assembly, releases its ticket and joins
cleanup. A partially constructed context stays fenced, quiesces admitted setup
and receives the existing local rollback. A completed sibling can start close
immediately. No new context can be created/published after the final availability
check without a synchronous recheck at add/complete; if partial construction
has already acquired resources when this check fails, its normal rollback
must still dispose them.

Cancellation due to the already-recorded environmental failure is not a new
independent startup cause. If another admitted required phase fails for its own
reason, append that original cause before releasing its ticket.

## 4. Automatic cleanup sequence

The first failure schedules the following, without waiting for host permission:

1. Start closing the snapshot of completed contexts using their existing close()
   operations. They are already synchronously fenced. This allows their
   admitted ordinary work to drain while other builds unwind.
2. Wait for in-flight build tickets to finish local rollback. Do not attempt to
   dispose a partial context's model resources concurrently with the same
   builder's untracked assembly operation. Its beginClose fence was immediate;
   its builder performs rollback and releases the ticket.
3. Once builds are idle, close any remaining registered partial/completed contexts.
   Reuse already-started context close promises rather than concurrently retrying
   the same context. Collect all results, and preserve failures from contexts
   that removed their registration while reporting cleanup errors.
4. After contexts and their admitted preparation/follow-ups are safely drained,
   apply the core's full beginClose() fence. Then use the existing
   #deliveryCloseGroup/#closeGroup to stop supervisor activity, await all
   operation-level Delivery release, close the remote facility, transport and
   storage factory in their established order.
5. Report original startup causes first, followed by collected cleanup failures.
   Use CloseErrors.collect for nested aggregates and preserve original error
   objects. With one original error and no additional failure, reject with that
   original object. Do not replace it with “environment is closed.”

Attempt independent cleanup even when one close rejects. Awaiting a real active
operation is not the same as a rejected close: do not dispose shared storage
under a still-running build/preparation/callback merely to finish faster.
Cancellation is cooperative; there is no new timeout or forced JavaScript
termination. Existing resource close/release retry behavior remains available,
but automatic failure handling is one coordinated attempt, not a retry loop.

For setup's own failure before any context can build, reuse the same failure
reporting discipline without awaiting the setup promise from its own cleanup
task. Current #completeSetup catches and closes directly (355–365); a shared
helper must not introduce a setup self-wait.

## 5. Delivery's two internal shutdown steps and exact error retention

Add a narrow internal first step, e.g. beginStartupDrain(), separate from
beginClose(). It must:

- prevent new public run()/standalone drain attempts immediately, preserving the
  existing STOPPED terminal convention rather than inventing a new public result;
- retain all operation records active at this exact fence, including public
  custom-callback runs;
- keep shared drains available solely for already-admitted exact local work;
- preserve original release errors throughout this finite shutdown attempt.

Use the existing ActiveDeliveryRun records and #activeRuns/#directPending. The
first-step shutdown collection starts with current active records. Each physical
internal shared run admitted during this drain interval is added to that same
collection synchronously before pickup. Settled records stay in this shutdown
collection until final close consumes their outcomes, even though they leave
#activeRuns. Full beginClose seals this collection and stops the remaining
handles. It must merge/use this collection, not replace it with a later snapshot.

This is a collection for one finite shutdown attempt, not an accumulating history
of healthy completed runs. It is required because an allowed late exact handoff
can release and fail before context drainage reaches full core.close(). A static
first-failure snapshot would lose that error.

Do not allow “shared=true” alone to bypass the first-step fence. While draining:

- a currently retained shared run can settle its entered callbacks;
- a new physical shared run is permitted only when the existing #directPending
  map has an admitted exact handoff for that shard;
- a supervisor notification or safety scan with no exact pending work cannot
  create a new physical scan/run. It returns the existing stopped/no-admission
  result, without claiming a message acknowledgement;
- callback selection continues to prefer exact #directPending entries. The
  environment fallback has no fresh recipients after the synchronous context
  fence.

Retain shard identity on the existing exact-pending entry if needed to make this
test direct; do not store another signal payload or create an execution queue.
Internal ordinary follow-ups already accepted by the bus/publisher may add their
normal exact entry and start a needed run. Remote-supervised follow-ups preserve
D0161 reception completion; they do not require a new local scan while stopping.

Do not start supervisor.close() at first failure merely to stop notifications:
its existing grace/abort sequence can terminate a shared run still needed by an
admitted local handoff (`delivery-supervisor.ts:425–465`). The core's narrow
admission check prevents fresh scans during context drain. Full supervisor close
remains in the final facility sequence.

A previously admitted explicit custom run retains its actual callback and result.
It does not join or become the default dispatcher. Its active work and release
must settle before resources close. The fatal fence prevents additional explicit
runs; no callback may use that fact to admit new public context input.

## 6. Preparation policy and future M11 reuse

Classify failure where the operation's role is known. Required provider structure/
compatibility work, initial requested monitoring, and actual model-derived
transport setup are startup phases. Their eager/explicit wrapper records fatal
failure; the shared underlying preparation promise must not unconditionally
fail the environment, because lazy callers use that same promise.

Keep membership validation, unknown tenant, invalid input, duplicate-state/model
configuration misuse and absent explicit setup outside that fatal wrapper.
Do not infer “misuse” from Error versus TypeError or from error text: a provider
TypeError in a required structure phase can still be fatal. Preserve origin
through narrow call-site structure or an internal phase classification.
Operational directory failure at ordinary membership admission is request-local.
A failure while required structure work is being performed cannot be relabelled
membership failure just to avoid the required policy.

If eager/explicit work joins the same physical attempt as a lazy request and that
attempt fails, the explicit caller records the fatal cause. The lazy request
still receives its real operation failure; the environment is nevertheless
stopped because required explicit startup also failed.

An M11 explicit operation must obey the same release-before-join rule:

```text
admitted preparation promise:
  provider failure -> failStartup(error) synchronously -> settle/reject
  finally -> release context preparation admission

outer public explicit operation:
  await its admitted preparation settlement
  if that operation recorded/observed fatal startup -> await global cleanup
```

The promise retained in #activePreparations must never include the wait for
global cleanup: context close waits that promise. This also applies to an eager
phase participating in a shared attempt. No new M11 API is designed here.

Preserve admitted ordinary preparation after the global fence. The WIP
#preparationController is used for eager tenant enumeration; aborting that
enumeration on context close is appropriate. Do not pass it indiscriminately
into all lazy/provider work required by admitted ordinary inputs. Drain the
actual admitted preparation attempts; late completion cannot reopen context
intake or restart subscription monitoring. Keep provider coalescing and
successful read-only readiness unchanged.

## 7. Focused acceptance evidence

Use distinct generated Entity states for concurrently registered contexts.

- Reproduce the existing red: a completed sibling processes while another build
  is held; required preparation fails; immediately after observing the failure
  fresh posts, queries/subscriptions, public Delivery runs and builds are fenced.
  No extra resolver/DDL work starts for rejected fresh operations.
- Both original build rejection and automatic cleanup settle without an explicit
  environment.close() call. Assert completed sibling, partial context and shared
  facilities receive their cleanup attempts.
- Hold two concurrent builds at different phases, including one with no context.
  Fail one, release the other, and prove no self-wait, no late completed-context
  publication, no early factory close, and no reset to healthy.
- Two independent required phases fail before their tickets release. Final
  reporting includes both originals and injected context/release/factory cleanup
  errors without replacing them by shutdown-induced errors.
- Hold an already-admitted ordinary handler and a lazy preparation needed by it;
  fatal failure elsewhere fences fresh work but lets its captured exact local
  handoff and ordinary follow-up drain. No Agent effects survive cancellation.
- Start a necessary exact internal drain after the first fatal fence, make its
  release fail before the final core fence, and verify automatic cleanup reports
  that original release failure. Also cover an explicit public run active at the
  first fence. Stores stay open until both settle.
- A new supervisor notification with no admitted exact entry cannot start fresh
  callback work during fatal drain; the row stays pending. D0161 remote reception
  success is not rewritten as executed/acknowledged.
- A required preparation failure occurs inside the context's tracked preparation
  promise. Prove the promise releases before global cleanup is awaited. This is
  the bounded reusable M11 self-wait regression.
- Unknown tenant, invalid input, local misuse, directory admission failure and a
  failed lazy attempt leave the environment usable; a later lazy attempt retries.
  First eager monitoring/channel failure does initiate automatic cleanup; later
  periodic monitoring failure retains its WARN/retry policy.

No unresolved product choice remains. The implementation choice is the exact
private hook naming and representation of these existing context/build/run
lifetimes. Exclude public lifecycle additions, preparation API expansion,
recovery, new timers and changes to local versus remote delivery completion.

