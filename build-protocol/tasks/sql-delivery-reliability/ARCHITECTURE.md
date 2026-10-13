# Accepted architecture pass

2026-10-13. requirements_splitter /root/architecture completed read-only analysis at 658da1cd. Explicit gpt-6-astra/high dispatch matches configured profile; actual runtime introspection unavailable. Parent accepts bounded recommendations below. No human blocker established.

## Independent storage

Generic SQL CAS reads raw bytes normally, compares decoded Protobuf semantics, then inserts absent records or conditionally updates/deletes with ID and observed raw bytes. Update bytes and all materialized columns together. Recognize only primary-key duplicate collisions; preserve unrelated failures. Reread guard misses for equivalent encodings with finite contention bound. Same-value no-op may linearize at the read. Never use unprotected read/write acquisition. Remove steady-state transaction/advisory wrappers; first-use schema initialization remains distinct.

Immutable insert never overwrites: insert-if-absent then compare on collision. Identical retry succeeds, conflicting payload fails. Batches retain their completed prefix on failure. Normalize scalar legacy list filters into existing predicates once, without changing normalized literal-array equality. Validate Inbox status names. Cleanup selects eligibility then deletes by ID across every provider/port; remove cleanup-only provider seam, session/snapshot arguments and post-delete rollback checks.

Entity saves retain history, diagnostics, delivery Events, current-state order. Dispatch begins only after complete save. Retry captured prepared input without rerunning handler or changing Event IDs. A fresh handler invocation is not an identical retry; partial Events do not prove successful state save. Remove EventStore batch compensation, cross-record append lock and unsupported appendAllWithRollback API. Preserve EventBus duplicate admission separately from immutable storage retries.

Bounded caller clarification: `EventStore.append()` and `appendAll()` accept identical complete persisted Events without rewriting and reject conflicting envelopes. Ordered batches retain successful prefixes and can retry the same captured input. Repeated IDs within one batch remain invalid. Use atomic absent-record CAS, exact-ID comparison after collision, and bounded retry when a collided row disappears. Preserve driver failures. `accept()` remains a strict uniqueness precheck; `acceptThenAppend()` keeps precheck, callback, then strict atomic insert. Never replace its final insertion with idempotent append: racing callbacks may both run, but only one insertion and subsequent EventBus dispatch may succeed. The inspected EventBus production caller uses `acceptThenAppend()`; stored replay bypasses append. This clarification implements the binding immutable retry requirement without a new persistence contract.

## Delivery and publication

Processing failure remains pending and blocks its target for the finite drain. Throwing monitor/failed repeat never defaults to acknowledgement. Separate successful processing followed by acknowledgement failure; retry only acknowledgement within the attempt. Diagnostic callback failure cannot rerun acknowledged processing. Avoid failure-driven rescheduling loops. Crash between effects and acknowledgement permits at-least-once redelivery; no durable exactly-once receipt is added.

Retry actual stored-Event dispatch before containment, with original ID/bytes and finite cancellable attempts. Expose publication results and exhaustion with Event ID, tenant/context, attempts and original cause. Admission is distinct from recipient completion. Command success may coexist with publication failure, without reposting the Command.

A bounded administrative context republishEvents operation may accept explicit known committed Event IDs, tenant and AbortSignal, read exact IDs, preserve supplied sequence and return truthful admitted/failed/notFound/cancelled or unattempted outcomes. Validate count/duplicates/blank IDs, reject after close, settle admitted operations during bounded shutdown. Current routing applies; historical recipients/order are not reconstructed. Successful recipients can run again after deduplication retention.

No automatic discovery claim: existing persistence has no publication-completion marker, and Event presence can precede failed state persistence. No blind historical replay, outbox or new persistence contract. Explicit repair is supported without a blocking product question.

## Subscription lifecycle

Use response-only successful SubscriptionUpdate as readiness ACK after attachment; no protobuf field change. Client activate/connected await validated ACK, never first business update. Gateway waits for all required children before forwarding one logical ACK; partial failure cleans up. Reconnect waits for readiness before resynchronization and guards late queries.

Coalesce authenticated per-ID teardown and Cancel before bounded ordinary-operation queue. Do not join different authentication contexts. Successful cleanup is idempotent; failed cleanup retains retry state and clears cached rejected promises. Local updates stop immediately; fresh same-handle cancel and client close use bounded cleanup and report permanent failure.

JVM evidence: Stand.java 241–242 ACKs internally, but SubscriptionService.java 139–146 suppresses successful ACK via forwardErrorsOnly. TS wire readiness is an explicit behavior extension using existing fields, not a JVM wire claim.

## Recovery and references

Default recovery interval ten seconds, separate stale-session/server-processing clocks. Bounded pending check after release may close end-of-run arrival race without replacing recovery or creating failure spin. JVM Delivery.java 483–488 demonstrates ordering.

Inspected local JVM AggregateRepository.java 237–250 journals then stores state; AggregateEndpoint.java 102–119 stores before posting; EventBus.java 280–281 appends Events. These do not promise atomic cross-record persistence. Relevant TS paths: SQL record-storage, entity-commit/storage-factory, shared record-query and EventStore, server delivery/monitor, SignalPublisher, repository persistence follow-up, client subscription lifecycle, services, auth subscription coordinator and durable bindings. Investigation references and detailed acceptance are in TASK.md and ACCEPTANCE.md.

## Bounded context shutdown clarification

Accepted targeted follow-up after a demonstrated never-settling recipient blocked context close. Existing requirements_splitter with explicit gpt-6-astra/high retained; runtime introspection unavailable. Evidence: evidence/repair-shutdown-boundary.md. No human product decision is required.

Add BoundedContextBuilder.withShutdownTimeout(milliseconds), default 5,000 ms, positive safe integer within supported timer range. Capture one absolute deadline at first beginClose, including server split-close paths. All drains and cleanup waits share remaining time. Before expiry preserve graceful admitted ordinary follow-ups; cancel admitted repair and reject new external admission. On expiry terminally fence buses/publisher, reject close through AggregateError with identifiable context/phase timeout, and cache that terminal result for repeated close. Preserve retry of unrelated cleanup failures.

Carry caller cancellation into stored-Event dispatch and guard queued execution, between recipients and before notifications. Leave the raw FIFO tail attached to actual work; race only outward completion and shutdown. Never advance a queue or retry while a detached underlying attempt still runs. Deadline cancellation yields truthful CANCELLED outcomes with actual attempted counts and internal shutdown cause; completed admissions remain ADMITTED. Remaining repair IDs receive cancelled/unattempted outcomes without reads. No normal-operation timeout is introduced.

Apply the same deadline to subsequent close awaits and attempt independent remaining cleanup without awaiting past expiry. Observe every late promise rejection and check terminal guards after late settlement. Already-entered application code/SQL may still finish or fail after resources close; no rollback, forced code termination or guaranteed reclamation claim. Server drain failure must not skip the remaining close group; aggregate drain and cleanup errors. This does not establish a new deadline for unrelated network/Delivery teardown.

Focused proof: never-settling repair and ordinary publication/follow-up; queued work cannot start after fence; partial fanout cancellation; caller abort preserves FIFO; graceful accepted follow-ups still drain; one deadline across every phase and server beginClose/drainWork; repeated timeout terminal result; unaffected cleanup retry; late success/rejection and throwing diagnostics without unhandled promises; timer/listener cleanup. No persistence or scheduler subsystem is added.
