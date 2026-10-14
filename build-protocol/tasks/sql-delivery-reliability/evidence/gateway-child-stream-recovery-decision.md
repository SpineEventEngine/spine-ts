# Gateway child stream recovery decision

2026-10-14. Bounded follow-up for the demonstrated subscription lifecycle block.
Existing requirements-splitter role; explicit dispatch `gpt-6-astra` / `high`;
actual runtime metadata unavailable. The orchestrator assigned this evidence
file. No runtime, fixture, build, service, or other worktree changes were made.
Codebase-design skill applied to keep the correction behind the existing
activation interface. This is a high-risk lifecycle correction within the
already authorized reliability task; no human product decision is required.

## Decision

An unexpected rejection or normal EOF of a current backend child activation
must terminate that logical activation with an observable failure, including
after its readiness ACK. Fence further updates and starts for that activation,
cancel its remaining children through existing bounded cleanup, and propagate
the cause through the existing `activate()` promise and transport relay.

The existing high-level Client then performs its current bounded sequence:
dispose the old iterator, Cancel the previous logical subscription, wait its
positive retry delay, Subscribe again, await every required child's ACK, and
resume. Entity subscriptions use their existing authoritative resynchronization;
Event subscriptions emit their existing `gapPossible` notice. This does not
promise replay, gap-free Events, or uninterrupted healthy-child delivery.

Do not add a child retry loop or call `#schedule()` automatically on unexpected
EOF. The kernel currently has bounded cleanup retries and bounded start
concurrency, but no timed/budgeted child-reattachment policy. Scheduling on every
failure would introduce an independent retry mechanism and could spin on an
immediately failing backend. Client retry already supplies attempt, elapsed-time,
delay, cancellation, and credential-refresh behavior.

## Observations and their limits

Measured evidence is
`transport-runs/5b3608b5e6694509a6b22f6e665c2d7c/{resource,result,cleanup}.json`:
PostgreSQL 16, gRPC-Web, database-only Delivery, `stream-reconnect` scenario,
PID 16681, with artifact hashes recorded. The result is FAIL with one Subscribe,
one Activate, one released ACK, one injected stream fault, one successful Cancel,
zero remaining backend iterators, and a timeout waiting for reconnect. Cleanup
reports database dropped, zero remaining SQL sessions, and no errors. The
orchestrator reports the reconnect observation bound was ten seconds and the
injected child failure was UNAVAILABLE. The JSON itself establishes the counts
and timeout, not that all resources were idle throughout the observation.

Source inference explaining the measured failure:

- `packages/server/src/browser/browser-server.ts:240` reconciles fixed backend
  nodes once; further discovery callbacks exist only with `options.discovery`.
- `packages/deployment/src/internal/backend-membership-kernel.ts:520`
  waits for readiness and then only for cancellation. At line 1086,
  `#failReadiness()` ignores errors after the readiness gate settles.
- At lines 876–979, child activation rejection reaches only that readiness gate;
  post-ready completion drops/disposes the child without notifying the logical
  activation or scheduling reconciliation. Another subscription/reconcile may
  incidentally recreate it, so the permanent stall is specifically possible
  without those unrelated triggers.
- `packages/deployment/test/membership-kernel.test.ts:766` currently encodes
  disposal followed by replacement only after explicit reconciliation. Update
  that expectation for unexpected EOF; do not preserve the demonstrated defect
  as a required recovery contract.
- `packages/auth/src/gateway/dynamic-unary-forwarder.ts:275` returns the kernel
  activation promise directly. `SubscriptionGateway` retains and rethrows
  activation errors; `packages/auth/src/native/index.ts:598` converts a rejected
  gateway activation into a failed stream relay. No new error callback is needed.
- `packages/client-web/src/client/client.ts:1267–1366` already supplies bounded
  recovery. Its actual current classifier accepts every Error except
  `ClientProtocolError`; it is not a status-code-specific permanent-failure
  classifier. This correction must not claim otherwise or widen that policy.

The current fixture is concurrently being extended with separate client-facing
proxy faults. Such tests exercise another useful seam but cannot replace the
backend-child fault regression above. No new runtime test was executed during
this read-only architecture pass.

## Precise implementation constraints

1. Keep readiness and activation lifetime distinct. Add private per-activation
   failure/completion state, or an equivalently small private mechanism, whose
   failure remains observable after the one readiness ACK. The existing public
   and SPI method shapes, Protobufs, options, and persistence records stay as they
   are. Do not attempt to reject an already resolved readiness promise.
2. Retain the first unexpected child/sink error; synthesize an internal generic
   stream-ended Error for unexpected EOF. Preserve the internal original cause
   and existing safe transport/error policy. Do not copy endpoint, credential,
   or child-envelope details into a new public error message. Do not turn an
   unexpected EOF into successful completion or an extra ACK.
3. Accept a terminal report only for the current definition, logical activation
   generation, child entry, and child activation controller. Check intentional
   child abort, public abort, logical cancellation, and kernel shutdown before
   treating completion as failure. Removed/replaced children and late results
   from an old generation must not terminate a replacement activation. Apply
   the same rule to late-joining children, including failure before their local
   ACK after logical readiness has already completed.
4. Fence the failed generation immediately. No subsequent sibling business
   update or queued reconciliation may recreate/relay into that failed logical
   activation. A successful readiness ACK remains exactly once per activation;
   a failure while its sink is pending still terminates and cleans up. If abort
   is used for the fence, retain/check the failure explicitly so an abort race
   cannot convert rejection into successful cancellation.
5. Perform cleanup from the logical activation completion path, using existing
   removal/Cancel machinery. Do not await logical cleanup from the child promise
   that cleanup itself awaits. Retain the ended child for that cleanup or ensure
   any separately started disposal is tracked and joined; never dispose the
   same child concurrently via two new paths. Preserve bounded activation waits,
   retained failed disposal, and the existing AggregateError behavior when
   activation and cleanup both fail. Failed cleanup must remain reportable and
   retryable by existing Cancel/close operations.
6. A failed child invalidates the entire affected logical activation, even when
   siblings remain healthy. Cancel those siblings once and reconnect the logical
   subscription as a whole. Preserve unrelated logical subscriptions, shared
   member connections, and unary routing. Intentional membership removal or
   replacement continues through existing reconciliation; it is not a new
   stream-failure retry trigger.
7. Keep failure signaling independent of whether ACK callbacks are configured.
   Readiness validation remains conditional, but a generic active relay must
   not silently hide an unexpected child completion. The unary-only kernel has
   no activation to change. Preserve generic activation cancellation behavior.

## Managed coordinator and authenticated cleanup

`packages/server/src/server/node-coordinator.ts:512–590` uses this same kernel.
Its adapter closes its update queue when activation settles, awaits the
activation result, and invokes existing definition cancellation. The shared
correction must therefore propagate through managed native service streams as
well as BrowserServer, including nested Gateway → Coordinator → child relays.
Do not add a second coordinator-specific retry scheduler. Keep the accepted
managed drain/deadline and intentional membership replacement behavior intact.
Test immediate post-ACK rejection for unhandled-promise and queue-drain races.

The kernel removes only ephemeral child state. Authenticated logical records
remain under the existing binding lifecycle. Client retry must Cancel the old
logical ID before creating the next subscription. Preserve per-ID/context Cancel
coalescing, actor/tenant/session checks, expiry timers, private-envelope wiping,
and failed-cleanup retry state. A kernel stream failure must not directly delete
authenticated storage or manufacture an authenticated Cancel. Public-access
automatic cleanup and client Cancel may both arrive; existing idempotent,
coalesced paths must prevent duplicated backend cleanup. Credentials or another
logical subscription cannot be borrowed to complete cleanup.

## Ordered correction and acceptance

The existing `/root/implementation` context remains the sole production writer
and is responsible for this bounded source/test/TSDoc correction. The
orchestrator retains evidence, dist-window coordination, review dispositions,
and final acceptance. Do not change frozen dist or process fixtures before the
active process matrix releases them.

1. **Kernel lifecycle correction.** Add a focused RED for ready-child rejection
   and EOF with no further reconciliation, then implement the private lifetime
   signal. Acceptance: logical activation rejects with the original rejection
   or explicit EOF cause; all of its admitted children dispose once; no child
   starts again without a new logical operation; a separate logical subscription
   and unary routing remain usable. Cover ACK disabled as well as ACK enabled.
2. **Race and adapter integration proof.** Keep existing all-child initial
   readiness, partial activation failure, replacement, and cancellation tests.
   Add ready sibling + failing child; late-joining child failure; held ACK sink;
   public Cancel racing failure; intentional member replacement; stale child
   rejection after replacement; failed then successful cleanup; and child that
   ignores abort. Acceptance: no false terminal failure for intentional/stale
   completion, no extra logical ACK, no late update/start after failure, bounded
   cleanup and preserved causes, no unhandled rejections. Exercise the managed
   coordinator or existing nested coordinator fixture so the shared path is
   verified, rather than inferred solely from the browser case.
3. **Real-transport regression.** After the frozen build window ends, rerun the
   original PostgreSQL fixed-backend child fault via high-level Client on
   gRPC-Web and Connect; retain native control. Add child EOF, and a two-child
   logical subscription where one ready child fails. Acceptance: one recovery
   episode with expected Subscribe/ACK/Cancel counts, all new required ACKs
   before readiness, one deliberately posted update after reconnection, no
   business-handler rerun, and zero remaining streams/registrations/SQL sessions
   after teardown. Independently verify entity resynchronization or Event
   `gapPossible`, according to the fixture's actual subscription kind.
4. **Budget, documentation, review.** Repeated post-ACK faults use the existing
   client attempt/time budget and positive delay; the server performs no
   autonomous reattachment. Cancellation during retry prevents new Subscribe.
   Cleanup failure stops unsafe overlapping recovery and remains observable.
   Update narrow activation TSDoc and the misleading explicit-reconcile test.
   Run deterministic scoped checks, then relevant existing reliability and API
   review concerns; record concrete dispositions for style/documentation.
   Preserve the task's later release gate rather than invoking it diagnostically.

## Risks and exclusions

Healthy siblings temporarily lose their relay when one child fails. This is
intentional: the logical fanout can no longer represent the complete stream,
and client recovery already exposes resynchronization/gap semantics. Already
delivered updates are not rolled back. Repeated backend failure can exhaust
client recovery; bounded visible failure is the accepted outcome. Cleanup may
also fail and block reconnection; do not hide that result by recreating children
while previous cleanup remains unresolved.

No new public API, wire field/status, persistence, outbox, background poll,
reattachment scheduler, retry-budget reset, universal terminal-status policy,
Event replay, exact-once delivery, or guaranteed continuity during topology
changes is included. Do not broaden this correction into a gateway redesign.

JVM guardrail: inspected local
`core-jvm/server/src/main/java/io/spine/server/SubscriptionService.java:106–156`
and `stand/Stand.java:229–277`. The service forwards activation failures to the
observer; Stand registers activation and removes subscriptions on Cancel.
Successful wire ACK is already an explicit TS extension, as recorded in
`ARCHITECTURE.md`. These JVM sources do not define the TS multi-child gateway
or a child reconnect budget. This decision corrects existing TS relay lifecycle
and makes no new JVM parity claim.
