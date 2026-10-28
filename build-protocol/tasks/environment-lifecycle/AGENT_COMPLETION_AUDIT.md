# D-0158: Live authorization denial and example completion evidence

Accepted bounded M7b decision, 2026-10-28. Environment-lifecycle worktree, current WIP.
Existing requirements splitter explicitly configured Astra/high; actual runtime
model metadata is unavailable. No source edits, tests, or child agents.

## Decision

Record a definite **pre-handler model-use denial** with the existing
AgentInvocationTerminated System Event. Derive Studio's local completion evidence
from its Agent's committed domain output or this exact correlated denial. Keep
Repository.agentExecution/AgentExecutionStatus removed. Add no execution record,
completion-status service, new Proto, or startup processing.

This is deliberately narrow. A generic exception, missing history, process stop,
session loss, aborted hook, unknown commit outcome, or Aggregate cancellation is
not proof that an invocation completed safely. Do not add a catch-all termination
writer to make the UI unlock.

## Framework change

`AgentLiveRunner.run()` currently loads state/preferences, calls select(), then
constructs its audit writer and publishes dispatchStart. Move audit construction
before select(). Surround only pre-handler model selection with the following
decision:

1. If selection succeeds, continue the existing dispatch/handler/conditional
   completion path unchanged.
2. If it throws `AgentLiveFault` with `reason === "MODEL_USE_DENIED"`, check the
   live cancellation and current session again. Persist exactly one original
   AgentInvocationTerminated through AgentLiveAudit.save, then propagate the
   original failure to tracked Delivery completion. The accepted source remains
   acknowledged; this is not permission to invoke it again.
3. Other selection exceptions propagate without manufacturing terminal evidence.

The exception is already typed: agent-model-selection.ts:connection awaits
authorizeUse and explicitly throws `new AgentLiveFault("MODEL_USE_DENIED", ...)`
for false. selectLiveKind awaits connection without wrapping it. Use the class
and reason, never parse Error.message or the text of a provider exception. The
call-site restriction matters: the same authorization operation may run later
during an active handler or final preference authorization, where no-external-work
reasoning is different.

The retained Event's fields are sufficient:

- agent: exact recipient Any and Agent state type URL;
- sourceSignal: original Command/Event typed ID and original payload type URL;
- reason: the fixed safe string MODEL_USE_DENIED;
- unresolvedAttempts/unresolvedToolCalls: empty, because this catch occurs before
  entering any handler/model/tool dispatch;
- terminatedAt: Spine Time at the actual observation.

Reuse AgentLiveInteractionEvents.sourceRef and existing validated source/recipient
construction. Envelope the fact with the original causal context and shared
AnyPacker. Validate the existing Proto. Do not invent a selected model, operation
ID, conversation result, handler-dispatched Event, or ReleaseGenerationFailed
domain Event. The application's failure Event requires an operation ID and
represents an actual handler result; no handler ran in this denial case.

AgentLiveAudit already sizes the complete history rows, checks session authority,
appends, checks authority again and publishes the same original System Event.
Use that path. If cancellation/loss wins before append, write nothing. If the
append fails or has an ambiguous result, do not retry the handler or invent an
acknowledged terminal status. Surface the original denial together with audit
failure (AggregateError/cause according to existing error conventions), preserving
the original error object. If append commits but publication fails, the retained
history fact remains valid and readable; report publication failure too. A reader
may use the real retained fact even though its System Context copy was not
published. No read-back is used to convert an ambiguous write into runtime success.

There is no new success Event. The Agent's existing final conditional commit stores
its domain output atomically with the completed Entity/preference mutation.
Do not use commitAgent for the denial: it would introduce an unrelated Entity/
preference mutation and version check merely to append a factual failure audit.

## Studio evidence reader

Replace generationPhase's repository status query with a small example-local
typed history reader. The existing Studio method/IPC may retain its UI-facing
terminal values `"completed" | "terminated" | undefined`; declare that union
locally, remove the framework status import, and document it as **observed terminal
evidence**, never as a live execution-status read. Do not reproduce the removed
accepted/running/pending-commands phases.

Use the existing in-memory GenerationAdmission and source observer to locate the
exact original ReleaseGenerationRequested Event. Missing source identity remains
unknown. Read typed Agent history through the public AgentHistoryReader, not JSON
string searching or internal record storage. Walk normal page cursors until a
matching fact or end; do not inspect only the newest 20 rows or stop at an invented
history-age bound. Positive evidence may be cached for this live Studio session;
do not cache absence. Existing history paging/count limits remain unchanged.

Match all of the following:

- the registered ReleaseNotesAgent repository and exact typed draft recipient;
- the admission's exact generation and historical input Version for a domain
  output, not merely the draft's latest status;
- the exact source EventId and ReleaseGenerationRequested payload type in the
  output's immediate causal Origin; do not use only root Command or conversation;
- the expected producer Any and tenant/actor scope as available from the existing
  original envelope/admission.

For System termination, match agent and sourceSignal MessageIds exactly, including
their type URLs, plus normal causal envelope checks. Accept only the definite
MODEL_USE_DENIED case described above, with empty unresolved lists, for this
minimal example change. An unrelated termination or a generic reason with empty
lists is not automatically an account-safety assertion.

Classify:

| Evidence                                                                                                      | Studio terminal value | Meaning                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| Exact ReleaseNotesProposed or ReleaseGenerationFailed in the Agent's committed domain history                 | completed             | The live handler returned and its final conditional persistence succeeded. |
| Exact pre-handler MODEL_USE_DENIED termination                                                                | terminated            | No handler/model/tool request started for this source.                     |
| Aggregate canceled/edited/requested, dispatch/operation-start audit, missing facts, or uncertain interruption | undefined             | No supported terminal evidence observed.                                   |

A ReleaseNotesProposed remains completion evidence if the Aggregate later returns
ReleaseProposalDiscarded because the user canceled or changed the draft. Conversely,
ReleaseGenerationCanceled alone cannot unlock account/model selection while the
Agent is still inside a model call. A stale output for an older generation cannot
unlock a newer accepted generation. Keep the existing all-admissions lock check
and atomic withAccountTransition admission fence.

These domain outputs prove local handler/final persistence completion; they do
not promise that every previously issued external effect has a known outcome.
An ordinary handler may deliberately return its existing safe domain failure after
an uncertain external result. That factual output remains valid; do not rewrite
the uncertainty as successful external execution. A generic termination with
unresolved requests does not receive the pre-handler-denial unlock treatment.

## Draft state and UI behavior

Agent final history precedes outgoing Event publication. Thus completed does not
mean the Aggregate applied the proposal, and terminated does not set its state to
failed. Keep readDraft's authoritative Aggregate/projection contents unchanged.
Do not synthesize staged/failed/canceled state from the evidence reader, dispatch a
replacement result, retry publication, or replay the source.

Update the writing view to read both draft state and generationObservation:

- Real staged/failed/canceled Aggregate state keeps its current display semantics.
- Definite denial shows an actionable authorization failure and permits existing
  account/model selection and an explicitly requested fresh generation. The draft
  may still say requested; explain the observed failure in UI state, not by changing
  domain state behind the user's back.
- Committed Agent output without an applied draft result shows that generation
  finished and the draft result is not yet available. Release the generation busy
  indicator; offer ordinary refresh/navigation. Do not label it failed or staged.
  Do not poll forever waiting for an Event that might never have entered ordinary
  publication. A later normal draft read can still observe delivery completion.
- Without terminal evidence, retain the account/new-generation lock. Present
  waiting/uncertain work honestly with the existing native Wait or Stop-and-close
  option. Stopping the application does not create historical completion evidence.

Replace awaitGenerationFence's unconditional infinite loop in signOutSafely with
a terminal-evidence check that returns control to the UI when still unknown
(a clear wait/close message, busy flag released). The user can wait and retry or
use the existing native close decision. No timeout is interpreted as completion.
Keep the trusted StudioAccountGate check authoritative, so renderer state cannot
unlock credentials. Preserve the current terminal cleanup and account-close
behavior; this decision does not add a restart/resume UI or change native IPC APIs.

## Minimal implementation and tests

One current implementer, overlapping repository/Agent/example files:

1. Initialize audit before selection; add the typed pre-handler denial catch.
   Test false authorizeUse yields one exact System fact, zero handler/model/tool
   calls, unchanged Entity/preferences, and original failure in tracked completion.
   A fresh signal with authorization allowed executes normally.
2. Test cancellation/session loss before failure append produces no terminal
   fact; audit failure remains observable. Test committed audit plus System
   publication failure remains readable without re-entry. Do not add provider-wide
   duplicate coverage for already tested appendAll semantics.
3. Replace Studio status reads with typed correlated paged history. Cover an
   exact denial beyond the first page, unrelated source/draft/generation facts,
   canceled-but-still-gated Agent (locked), and its later committed stale output
   (unlocked without changing canceled draft). Keep the existing denial/account
   switch/fresh-generation test, replacing sleep polling with a history observation
   or deterministic barrier where practical.
4. Cover committed proposal plus held/failed domain publication: completion is
   visible, draft is not falsely staged, writing is no longer an endless busy loop,
   and refresh can later show the real Aggregate result. Cover unknown work in
   sign-out: no credential change, no infinite awaited operation, existing native
   Stop/close path remains available. Update release-agent/release-domain tests
   to assert real output/history instead of generic execution phases.

No blanket failure-audit subsystem, generic status reader, schema change, data
migration, new limits, or application recovery mechanism is required.

## Source anchors

- `server/src/repository/repository.ts`: AgentLiveRunner.run/select/audit/
  dispatchStart/complete; AgentLiveOutputs.emittedHistory stores domain Events in
  the final commit before publish; AgentLiveHandler can stop awaiting a still
  outstanding handler on deadline/abort, so a catch-all exception is not quiescence.
- `server/src/agent/agent-model-selection.ts`: selectLiveKind/connection preserves
  the typed AgentLiveFault denial before backend use.
- `server/src/agent/agent-live-audit.ts`: guarded appendAll then original publication.
- `proto/proto/spine/ts/agent/interaction_events.proto`: existing independent
  AgentInvocationTerminated message; `runtime/signal-metadata.ts`: originFromEvent.
- `examples/release-notes/src/trusted/studio-service.ts`: GenerationAdmission,
  source observation, generationObservation/generationPhase, selectionLocked,
  public history readers, existing generation/account admission fences.
- `examples/release-notes/src/domain/index.ts`: Agent returns proposed/failed;
  Aggregate cancellation and proposal discard are separate facts.
- `examples/release-notes/src/studio-flow.tsx`: useWritingPoll and
  awaitGenerationFence/signOutSafely; trusted StudioAccountGate and
  StudioWindowClose already provide account and terminal-close control.
