# Managed shutdown deadline clarification

2026-10-14. Bounded follow-up for the demonstrated managed shutdown blocker.
Existing `requirements_splitter`, explicitly dispatched `gpt-6-astra` / `high`,
Standard speed, no children. `.codex/agents/requirements-splitter.toml` confirms
the configured profile. Actual runtime model/reasoning introspection is not
exposed; no visible mismatch. Production source was read only. No builds, tests,
runtime probes, commits, or changes to the original checkout were performed.

Classification: high-risk lifecycle/public-contract correction within the
existing SQL delivery/subscription task. No human product decision remains.

## Evidence and scope

- `managed-server-application.ts`: `ManagedChildLifecycle` drains Delivery,
  reports `delivery-drained`, waits for `finish-close`, then closes the server.
  The release wait has no bound while IPC remains connected. Parent
  `awaitChildClose` bounds only initial DRAINING acknowledgement/exit; its
  subsequent outcome wait is unbounded. Parent also awaits unary reconciliation,
  all Delivery drains, subscription cleanup, and Coordinator close without an
  overall bound. IPC send callbacks themselves may fail to settle.
- `server.ts`: `RunningHttp2Server.drainDelivery()` awaits environment detach.
  Context `beginClose`/`drainWork` happen later inside server close. D-0130
  expressly excludes unrelated network/Delivery teardown; its 5,000 ms context
  deadline does not solve these waits.
- `environment-delivery-worker.ts`: retirement fences routes, then awaits
  reserved/admitted replay work. Abandoning an outward wait must not acknowledge
  an unfinished Inbox message, release an actual execution queue, or invent a
  successful drain. Parent process control can bound child lifetime without
  changing Delivery persistence.
- `node-coordinator.ts`: `beginDrain` gates unary forwarding, but `subscribe`
  and new `activate` requests currently have no corresponding admission guard.
  `closeSubscriptions` waits for reconciliation and kernel close. `#closeOnce`
  awaits reconciliation before starting network cleanup, so simply racing that
  method does not guarantee the parent listener is closed.
- `backend-membership-kernel.ts`: cleanup retry and pending-dispose coalescing
  must remain. Individual dispose waits have limits, but complete reconciliation
  and client close can still block; they cannot supply the managed overall bound.
- `managed-remote-delivery-readiness.integration.test.ts`: the admitted handler
  deliberately remains active for more than 1,100 ms, then its actual generated
  Project state must reach the existing subscriber before stream end. Applying
  the 1,000 ms acknowledgement grace to all work violates this requirement.

JVM guardrail inspected: `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
lines 287–308; local `core-jvm/server/.../Server.java` lines 112–149,
`BoundedContext.java` lines 450–474, and `delivery/Delivery.java` lines 465–491
under `/Users/armiol/development/Spine`. JVM distinguishes orderly intake stop
from forceful transport stop and continues closing contexts after individual
failure; Delivery releases its session after the actual run. These support the
small graceful/force distinction and truthful failures. They do not establish
a JVM managed-child IPC protocol or a matching timeout value. This is a bounded
TypeScript process-lifecycle policy, not a JVM wire/parity claim.

## Decision

Add one optional `ManagedServerApplicationOptions.shutdownTimeoutMs`, default
**30,000 ms**. Validate a positive safe integer no greater than **2,147,483,647**
before assembling/spawning anything, including the internal Coordinator test
entrypoint. This is the total graceful managed shutdown budget, not an operation
timeout or a per-phase allowance. Thirty seconds is a chosen framework default
that leaves room for admitted work and the existing context/cleanup phases;
applications with longer legitimate work configure it explicitly. No finite
budget promises completion of arbitrarily long handlers.

Capture one deadline synchronously on the **first close start**, before any
await, and arm its watchdog then. Delivery drain, reconciliation, relay Cancel,
server close, IPC notifications, and retries share its remaining time. Duplicate
close/messages cannot extend it. Do not reset it at DRAINING, delivery-drained,
finish-close, or a failed cleanup attempt. Preserve D-0130 independently: each
context still applies its configured deadline once context closing begins; the
earlier applicable bound wins. Do not start context close merely to borrow its
timer while legitimate Delivery replay is still entering the context.

Keep the existing **1,000 ms** acknowledgement and process-exit graces and
**1,000 ms** TERM/KILL waits separate. Cap acknowledgement waiting by the
remaining managed budget. After successful final cleanup, the existing bounded
exit/reaping sequence may run; its maximum extra wait is 3,000 ms. After managed
deadline expiry, skip its initial graceful-exit wait: TERM then KILL/reap adds at
most 2,000 ms. These fixed process-control waits are additional to the graceful
budget, and the public TSDoc must say so. All waits run concurrently across
children, not multiplied by replica count. An early missing acknowledgement or
forced signal is a reported failure, never silent graceful success.

Use the existing managed classes and small private helpers. No new lifecycle
subsystem, phase-specific public options, reusable scheduler, persistence state,
or general Server/Delivery timeout API is needed.

## Phases and private handoff

1. **Stop admission immediately.** Parent rejects new Post, Read, Subscribe, and
   Activate requests as unavailable while retaining already-entered activation
   relays and Cancel. Unactivated definitions are cleanup work, not permission
   for a new Activate after the boundary. Stop replacements and new subscription
   installation waits. Child starts its existing Delivery admission fence/drain
   before waiting for any IPC callback. Late activate/start/reconciliation work
   cannot reopen admission.
2. **Drain actual admitted work.** Keep child listeners and active relays live.
   Await actual Delivery detachment before reporting delivery-drained. A failed
   or timed-out drain must not emit that success fact. Preserve the original
   accepted business update through the existing relay.
3. **Cancel relays while children listen.** Once successful drains permit it,
   parent awaits existing kernel Cancel/cleanup. Only successful relay cleanup
   permits normal finish-close. A cleanup failure must not close the very child
   listener needed for its retry.
4. **Finish and reap.** Matching finish-close releases the child server close.
   Parent observes the real close result and child exit. Close the parent
   Coordinator network and kernels, aggregating independent failures.

Parent's private close frame carries the **remaining graceful milliseconds** at
send time. Child validates the finite bounded value and establishes its local
deadline on receipt, clamping an existing deadline earlier; it never adds a new
full budget on retry. Same-host delivery latency does not extend the parent's
authoritative deadline. Child direct close or parent-disconnect close starts its
configured local budget if none exists. Disconnect releases the relay gate
immediately; a connected silent parent cannot disable the watchdog. No old IPC
fallback or compatibility mode is required. Lifecycle facts must match the
current incarnation and active phase; late/stale success cannot revive timeout.

All IPC sends are observed but cannot block watchdog/force cleanup. Install
observations before starting work so synchronous failures and rejected deferred
phase promises cannot become unhandled rejections. Settle/cancel all waiting
phase gates on terminal exit or timeout rather than leaving the outer drain
waiting for an impossible delivery-drained message.

## Expiry, cleanup, and truthful results

At deadline expiry, record an identifiable terminal timeout with phase and
replica identity where relevant. No requirement for a new exported error class:
ordinary errors and AggregateError with preserved causes suffice. Prevent late
continuations from advancing graceful phases or emitting CLOSED success.

Attempt independent remaining cleanup without awaiting past the graceful
deadline: abort/fence kernel intake and activation, stop pending timers/member
listeners, cancel existing relays where possible, and close/destroy parent HTTP/2
sessions and tracked sockets. Parent network teardown must start independently
of stuck membership reconciliation; a small internal forced-network cleanup
path in NodeCoordinator is sufficient. Observe late cleanup settlement. Do not
claim arbitrary custom client/provider resources have been reclaimed merely
because an outward wait settled.

Parent terminates only its recorded managed children using the existing bounded
TERM/KILL/reap procedure. Force or timeout remains failure even if the OS process
then exits successfully. Aggregate termination/cleanup errors with the initiating
timeout rather than replacing it. Do not terminate the embedding parent process.

The child independently needs a terminal watchdog: when its budget expires,
report close-failed best-effort, release the relay wait, initiate existing server
cleanup if not already running, and allow at most the existing 1,000 ms force
cleanup grace before exiting the **managed child process** with a nonzero status.
Do not await IPC or server close to arm that exit. A Promise.race or setting
exitCode alone is insufficient when a hung server retains handles. Keep this
action private to the actual framework-created managed-child lifecycle, with a
private test seam or real child fixture. Parent-enforced termination still bounds
a child whose event loop cannot run its watchdog; no in-process timer can solve
an event-loop block when the parent is also unavailable.

Force may interrupt handlers between effects and acknowledgement. Entered SQL
may complete despite transport/process interruption; no rollback, exactly-once,
successful drain, or recovery completion is implied. Unacknowledged persistent
Delivery remains eligible for existing at-least-once recovery and may repeat
effects. Do not add acknowledgements, guessed completion, or lock/session release
to manufacture graceful shutdown.

## Retry and coalescing

Before expiry, ordinary cleanup errors remain retryable through close(). Clear
only the failed attempt promise, preserve completed phases and pending cleanup,
and reuse any still-running raw operation. A retry must never overlap the same
dispose/detach/close operation. Retain the existing kernel dispose coalescing.

In particular, if relay Cancel fails, return that failure without sending normal
finish-close, keep drained child listeners available, and observe/cache their
still-pending close operations. Next close retries outstanding relay cleanup and
then releases those same child waits. Do not create replacement phase deferreds
that demand the already-drained child repeat an old notification. Child server
close or drain failures may start a fresh attempt after the previous raw attempt
has settled. Already-successful cleanup is not repeated unnecessarily.

The first-close watchdog stays armed even after a retryable call rejects, so a
caller that never retries cannot leave a connected child waiting indefinitely.
Deadline expiry is terminal: repeated close returns the retained timeout result,
not success with a fresh budget. Bounded best-effort cleanup/reaping may still be
retried without erasing that outcome. A pre-deadline non-timeout failure followed
by successful cleanup can succeed; forced/time-out cleanup cannot be relabeled
as graceful success.

## Small implementation slices and acceptance

The current sole implementer remains responsible for overlapping runtime/tests.
The orchestrator records API/decision changes and gathers relevant existing
review concerns after deterministic preflight. No additional production writer.

1. Add/validate/document the single managed option; retain one deadline and
   bounded private handoff/watchdogs in managed-server-application. Add focused
   deterministic tests for default/range, duplicate close, remaining budget
   across phases/retry, missing acknowledgement, DRAINING without completion,
   and terminal repeated close. Use injected clock/process seams; never risk
   killing the test runner.
2. Complete admission and two-phase retry behavior in NodeCoordinator/managed
   lifecycle. Tests prove Post/Read/Subscribe/new Activate fail after drain;
   Cancel and already-active relays remain usable; failed Cancel retries while
   the child listener lives; successful retry does not duplicate disposal;
   late readiness/finish-close cannot reopen a terminal lifecycle. Preserve the
   existing kernel coalescing regression and context shutdown tests.
3. Add narrow force-path tests: connected silent parent after delivery-drained;
   parent disconnect during drain and relay wait; never-settling Delivery drain,
   membership/Cancel, final server close, and IPC callback. Every case settles
   within its configured budget plus stated force grace, reports failure, removes
   timers/listeners/network handles that the framework can remove, and observes
   late rejection. Independent cleanup starts even when another phase hangs.
   Prove SIGKILL/reap failure is retained alongside the initiating timeout.
4. Retain the real accepted-work regression with its handler held beyond 1,100
   ms and real generated final business update before stream end; exercise a
   separately short configured deadline in a real managed child so timeout and
   nonzero exit are established without a 30-second unit-test sleep. Assert
   actual child exit and parent listener closure, not only a resolved race.

Risks: deadline/IPC races can erase retry state, report false success, or leave
unobserved promises; force can repeat already-applied effects; arbitrary entered
code/SQL cannot be cancelled by a timer. Acceptance targets these boundaries.
Exclude legacy/application/data migration, public force APIs, domain/persistence
changes, automatic historical replay, new lifecycle entities, broad framework
roadmaps, PR creation, and changes to the already accepted context deadline.
