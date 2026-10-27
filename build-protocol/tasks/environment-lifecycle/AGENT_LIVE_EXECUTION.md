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
