# Agent execution after recovery removal

This bounded implementation decision supplements the original task copied in full
in [PROPOSAL.md](PROPOSAL.md#14-original-agent-recovery-removal-task--included-in-full).
It does not change ordinary delivery policy for other Entity types. D-0152 records
its acceptance. M7 follows completion of M6; one production implementer changes
these overlapping paths. No existing-data migration is included.

## Acceptance and interruption

Ordinary Inbox reception and Agent acceptance remain distinct. Atomically insert
an immutable receipt at the current Agent-admission point, before waiting for an
Agent turn or active AI capacity. Only an explicit successful insert permits this
process to retain a live invocation. Use the existing cross-handle atomic
RecordStorage.compareAndSet capability; never emulate it with read then write.

The receipt identifies the complete tenant/storage scope, Agent state type, typed
recipient ID, typed source Command/Event ID, and delivery action. It contains no
input payload, handler plan, status, deadline, model/read result, outgoing Command,
or lease. It cannot be enumerated or interpreted as executable work. A false CAS
or uncertain error never grants execution permission. Reopening storage cannot
reconstruct a live invocation. A failed CAS must leave the Inbox message pending
and report the original error. A later attempt may run only after an explicit
successful insert; finding a receipt permits suppression only. A crash before
Agent acceptance still permits the
ordinary Inbox input's first admission; a crash after acceptance never restarts it.

Retain the receipt RecordStorage per repository/tenant, draining admitted writes
on close. No receipt TTL, logical-deletion cleanup or close cleanup is added.
Existing inspected Agent interfaces do not provide a physical purge cascade; do
not invent one here. A future physical purge must address older pending input
before removing suppression evidence. Retained audit remains readable and inert.

## Receipt record identity

D-0153 addresses a demonstrated SQL identifier-size failure. Store the complete
generated AgentAcceptanceKey as receipt evidence, using an ordinary string
RecordSpec slot: `v1:` followed by the full lowercase SHA-256 hex digest of the
UTF-8 compact JSON encoding of this ordered string tuple:

```text
[
  "spine.server.agent.AgentAcceptanceKey/v1",
  key.stateType,
  key.recipientId.typeUrl,
  standardBase64(key.recipientId.value),
  key.source.case,
  sourceIdValue,
  key.action
]
```

The source case is command or event; sourceIdValue is CommandId.uuid or
EventId.value. Existing provider storage/tenant selection supplies the outer
scope. Exact recipient URL and bytes participate; do not unpack/repack, normalize
prefixes, use application stringifiers or hash object enumeration order. Unknown
metadata on the outer key/source does not add identity fields. Opaque recipient
bytes include their contained unknown fields. No equivalence across alternative
wire encodings is promised; retain the validated packed target identity.

Clone the complete input before the first await. Derive both slot and stored
receipt from this captured identity, and use the same tuple for comparison.
After CAS false, read the same slot and return false only for matching complete
identity. Missing, malformed, different or unreadable evidence raises an admission
error; never acknowledge it, overwrite evidence, select another slot or execute.
CAS throwing still propagates its original error without a read-back success.
Track duplicate verification within the admitted operation so close waits for it.

A finite digest cannot prove collision-free availability. Full identity comparison
makes a collision observable and preserves the no-repeat rule. There is no collision
bucket, suffix allocator, repair job or extra size cap. The slot is67 ASCII characters;
existing provider record-size and valid-identifier rules still apply to its body.
This follows existing TS Agent history slots. Shared AnyPacker preservation remains
required; no provider-native key or Any-decoding workaround is introduced.

Test identity separation and mutation capture once in focused helper tests; use
real independent provider handles for CAS/reopen and tenant separation. Preserve
the long-ID PostgreSQL regression and verify MySQL's matching size constraint.
Inspect exact stored Any URL/bytes, including an explicit custom prefix; retain
shared Any/stringifier round-trip tests with their proper registry. Add a fixed
encoding vector, conflict/missing/malformed/read-failure cases, uncertain CAS, and
gated duplicate-read shutdown. Avoid repeating the full field matrix per provider.

## Live processing under ordinary Delivery

Replace scheduler wake-up with an internal ephemeral live result passed to the
current Delivery drain. Complete Inbox acknowledgement before starting it. If
acknowledgement fails, discard that live result and retain the receipt; later
ordinary delivery may acknowledge the duplicate but cannot reconstruct execution.

Keep the ordinary shard session until its accepted live work settles or is fenced
and cancelled under shutdown rules. Serialize signals for the same complete Agent
identity; different Agents can run independently under existing configured AI
capacity. Load Entity state when its turn begins. When existing resident capacity
is full, leave the input pending before Agent acceptance. Permit other targets
to proceed while retaining order for that Agent. Notify ordinary Delivery when
capacity becomes available; its existing safety scan remains a fallback. Do not
create an accepted durable overflow queue, busy retry loop or new capacity limit.

Represent capacity deferral and receipt-write failure with internal outcomes that
do not acknowledge the input. They must bypass the existing FailedReception path,
which can mark a failed input delivered, and the direct handoff shortcut that
can then return success. Apply this to direct and supervised delivery without
changing ordinary failure handling for other Entity types.

The current EntityInboxFollowUp map cannot be reused unchanged: it is shard-wide,
can run after session release, and suppresses errors. Keep ordinary follow-ups
separate. Let the current drain retain live promises and accept notifications for
additional input while other Agents wait for AI. Admission and acknowledgement
remain ordered; unrelated Entity processing keeps its current behavior. Do not
create an Agent polling loop. Use ordinary Delivery's existing session durations
for serialized renewal while live work remains; no new Agent lease or timer value.
Loss of that session permanently cancels this invocation; never reacquire to
continue it. Guard later model/tool calls, commits, publication and audit writes.
Already issued external calls cannot reliably be recalled.

Preserve public posting completion semantics deliberately. Produced outgoing
Commands enter ordinary publisher/bus tracking once, without waiting recursively
for the same Agent/shard to finish. No Agent-private saved output list survives.
Commands already durable in ordinary delivery retain ordinary behavior; a crash
before ordinary persistence may lose output, as removal of private recovery implies.

## Preserve live persistence and audit

Extract live conditional Entity-version/state/history/preference mutations before
deleting execution providers. Existing Agent completion has version protection
that generic sequential commit alone does not provide. Preserve the provider's
actual guarantees; do not claim an atomic transaction across a shard service,
database and external model/tool call. Keep persistent model selection independent
of the old execution head.

Live runtime state includes current cancellation, input identity, in-memory
operation budgets and actual audit access. Delete replay lookup/substitution,
named-operation matching, saved reads/deadlines/budgets/revisions and recovery
byte accounting. Preserve configured corrective model attempts, normal schema and
authorization validation, tools, fresh reads and all four ordered/paged histories.
An interrupted history start remains without a fabricated result.

Delete AgentScheduler and every executable backlog, claim, renewal, session,
replay, saved-output contract, provider, export, helper and obsolete test. Review
agentExecution/status explicitly; receipt presence is not a replacement status
API. No compatibility wrappers or migration scans.

## Live conditional persistence contract

D-0154 resolves the actual provider contract needed before recovery removal.
Extend the existing provider-only EntityCommitStorage; keep ordinary commit and
its possible-prefix behavior unchanged:

```ts
readAgentPreferences<I>(entityId: I):
  Promise<readonly ModelPreference[] | undefined>;

commitAgent<I, S extends Message>(input: AgentCommitInput<I, S>): Promise<void>;

interface AgentCommitInput<I, S extends Message> {
  readonly entityId: I;
  readonly expectedVersion: number;
  readonly expectedPreferences: readonly ModelPreference[] | undefined;
  readonly preferences: readonly ModelPreference[];
  readonly entityCommit?: EntityCommitInput<I, S>;
  readonly historyEntries?: readonly AgentHistoryEntry[];
}
```

Undefined expected preferences means no record was observed; an empty array
means an existing record with no overrides. Return defensive copies. Compare
the full captured preference image as well as Entity version inside the native
transaction, even for no-op or preference-only changes. Missing Entity is version
zero under existing rules. Optional Entity mutation must match the handle's
complete tenant, typed ID, state layout and captured history settings, and advance
exactly one version. Validate existing preference kinds/references/uniqueness;
add no count or size limits beyond existing native constraints.

Store AgentModelPreferencesRecord containing a required AgentModelPreferencesKey
(state_type and exact recipient Any) and repeated existing ModelPreference. Its
ordinary string slot is v1: plus full lowercase SHA-256 of compact UTF-8 JSON:

```text
["spine.server.agent.AgentModelPreferencesKey/v1", stateType,
 exactRecipientTypeUrl, standardBase64(recipientValueBytes)]
```

Keep the complete key in the body and verify it on every read/update. Use one
spine_agent_model_preferences family with no query indexes. Derive typed identity
through the captured Entity codec/shared AnyPacker. Do not add execution/source
IDs, timestamps, statuses, revision counters or old-head fallback. Follow existing
portable shared-layout/provider digest conventions without adding a dependency.

Capture Entity ID, both preference arrays, optional Entity mutation and final
history synchronously before any await. Serialize the short transaction for one
Agent, including absent rows. Check preference identity/image and current Entity
version, preflight immutable history conflicts, then commit Entity/state history,
final Agent audit and preferences together. On failure none of that group remains;
earlier independently appended conversation/tool audit remains. Ambiguous native
commit errors propagate without handler retry, read-back success invention or
output finishing. Known rolled-back contention may retry the same captured
storage input under the existing provider policy. Never retry application code.

PostgreSQL reuses its native transaction and stable per-Agent advisory lock before
reading absent/existing rows. MySQL/MariaDB require all participating tables to
be InnoDB and one bound connection; handle absent preference rows with unique-slot
transactional insertion/locking, retaining the observed absence distinction.
Do not rely solely on locking a missing row at every isolation level. Datastore
uses native transactional reads/staging, existing contention policy/payload bounds,
and rejects unsupported custom transactional capabilities. Memory uses shared
history then Entity mutation queues and rolls back all affected records; never
re-enter an already held queue through public append. Preserve shared history
indexes and all four normal history views.

Read current Entity and preferences when the live turn starts, after earlier
same-Agent work settles. Image comparison does not detect A-to-B-to-A changes
and is not a replacement for ordinary Delivery session checks. No monotonic
execution counter is introduced. Conditional persistence does not claim an
atomic transaction across the database, shard service and external model/tool.

Admitted preference reads/commits/preparation use the retained handle's close
fence and drain. Factory shutdown waits before closing internal children; failed
acquisition preserves already retained children and cleans new ones. Agent
preparation includes Entity/enabled histories, Agent history, preference family
and native transaction support. Add a concrete provider-only prepareAgentCommit
operation if the existing requirement dispatcher cannot express that full check;
reuse preparers, perform no DDL/data writes in check mode, and never construct
throwaway handles to discover requirements.

An inactive primitive slice may extract shared native state/history routines,
with old execution checks remaining only in their old caller. No old production
completion is redirected or dual-written. Later switch preference reads, live
completion and admission/scheduler coherently, then delete obsolete helpers.
Provider evidence covers reopen, state plus preference/final audit persistence,
stale no-op/version and preference-only conflicts (including first absent-row
races), rollback without audit prefixes, exact identity/tenant/long-ID handling,
native unsupported cases, capture-before-await, retention and close draining.
Keep those cases focused; do not repeat the receipt's whole identity matrix.

Retain audit message definitions needed to decode history, including historical
System Event types, even when the old scheduler emitted them. The history
envelopes are independent of execution_record.proto. Delete executable records
and status APIs without deleting necessary audit schemas or inventing startup
termination Events. This is history preservation, with no migration or recovery
compatibility wrapper.

## Live inputs and intermediate audit (D-0156)

Every message/enum in execution_record.proto is removed with the coherent cutover.
No definition moves to a replacement Proto. The genuine interaction Events,
AgentOperationRef, history envelopes/records and model/content messages remain.
Historical audit message definitions remain readable, including
AgentInvocationTerminated; startup never fabricates such Events.

Use minimal internal TypeScript inputs: original Command/Event source, exact
recipient Any and state type; selected AiModelKind, ModelRef and connection;
operation ID and conversation ID. Create and validate the existing AgentOperationRef
once for the live operation. Do not recreate an execution journal, saved-input/result
union or record/update-transform abstraction in TypeScript. Detach values passed
to application selectors; preserve state, source, producer, model and operation
identity validation and original causal Event context through AnyPacker.

A running invocation has configured limits, deadline sampled at actual handler
start, and live operation/model-request/tool/read/input-byte counters. Preserve
exact byte arithmetic, active correction attempts and per-handler call-name
uniqueness. Remove maxRecoveryBytes and recovery revision comparisons. Keep
recordedReads as the existing live query/history-read ceiling. Keep outstanding
physical-response byte reservations locally, reserve before sends without an await
between check and reservation, and retain full charges for unknown outcomes in
that live invocation. Parallel MCP callbacks cannot spend the same credit twice.
Preserve allowed tool/server/effect validation and never resend an uncertain write
merely because restart recovery was removed. No map is rebuilt from history.

Live reads still validate, count, sequence and drain actual results. Remove saved
request/result pages, snapshot Proto and replay matching. Use actual history/state
encodings for existing byte accounting. Existing AiValidationIssue supports local
correction inputs without the removed AgentValidationIssue Proto. Actual model,
capability, validation and mapping revisions may identify configured behavior and
audit facts; code/schema/policy resume compatibility revisions are deleted.

Intermediate interaction audit previously wrote conversation rows plus a System
row atomically through execution storage. Preserve that guarantee with the existing
provider history capability:

```ts
interface AgentHistoryCapacity {
  readonly historyRecordBytes?: number;
  readonly transactionPayloadBytes?: number;
}

// Additional members of the existing provider handle.
interface AgentHistoryStorage<Id> {
  readonly capacity: AgentHistoryCapacity;
  appendAll(entityId: Id, entries: readonly AgentHistoryEntry[]): Promise<void>;
}
```

An empty batch is a no-op. Capture before awaiting; validate immutable duplicates
within the batch and against storage. Commit the entire group and its indexes or
none, using native SQL/Datastore transactions or the shared memory history queue.
Preserve native size limits, complete typed identity, ordering, pagination and
handle close/drain behavior. Move only surviving history capacity fields from the
removed execution capability. Preflight uses the full encoded AgentHistoryRecord,
including scope, key and envelope, without replacement execution-sizing schemas.

Create one original System Event, save it with the related conversation rows,
then publish that same Event. Publication is outside the history transaction;
its failure remains observable and does not rerun the handler. Audit.save takes
payload plus optional history rows, with no execution-record mutation callback.
Final Entity/preferences/completion audit remains the separate D-0154 commitAgent.
Never use it to append intermediate audit or change preferences prematurely.

Focused evidence includes second-row conflict with no prefix, exact-repeat groups,
retained audit after publication failure, current model validation and causality,
concurrent output-credit reservation, uncertain tool sends, fresh live reads and
cancellation. No provider matrix solely for coverage, migration or replacement
recovery mechanism is introduced.

## Evidence required

Use deterministic interruption barriers and separate provider handles/processes:
CAS race/ambiguous completion; capacity deferral and CAS failure in both direct
and supervised delivery, proving pending input, no handler execution and later
first admission or suppression; accepted-before-handler interruption; ack failure;
restart/second-instance suppression; fresh Command; same-Agent order and distinct
Agent progress both within a page and after an active page; long-handler ordinary
session renewal/loss; late-effect rejection; same-shard outgoing Command; retained
history and live corrections; unchanged non-Agent delivery. Respect unconditional
duplicate-state registration in all tests. Do not simulate distributed atomicity
only through one JavaScript map or use arbitrary sleeps.

Receipt primitives may land first while inactive. Switch production admission and
remove scheduler execution together, so both mechanisms never execute the same
accepted input. Then delete recovery-only storage/contracts and update narrow docs.
M8 subsequently consolidates shared environment Delivery; it must not re-enable
any old Agent execution or scan.

## Delivery lifetime refinement (D-0157)

The reproduced gated direct-post failure requires separate exact-message
acknowledgement and full tracked shard completion. The accepted
[Delivery lifetime decision](AGENT_DELIVERY_LIFETIME.md) gives the internal
contracts, actual retained dispatcher, wake/capacity/session/close integration,
ordinary error preservation and focused evidence. It refines D-0152; it does not
introduce an Agent scheduler, persisted queue, or recovery.

## Definite live denial and example evidence (D-0158)

Preserve the existing factual termination audit for a typed pre-handler model-use
denial. The [completion audit decision](AGENT_COMPLETION_AUDIT.md) gives the narrow
catch, current-session/error guarantees and source-correlated example history
reader. It adds no execution status, startup synthesis or recovery. Aggregate
cancellation alone is never proof that live model work has ended.
