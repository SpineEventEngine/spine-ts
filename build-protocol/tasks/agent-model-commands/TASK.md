# Agent model Commands and asynchronous handlers

## Accepted requirements

The human authorized implementation on 2026-11-19 after accepting the proposal
in the delivery-agent-analysis chat. This is high-risk work: serialized public
contracts, Entity persistence, Delivery, concurrency, and shutdown change.
The existing separate worktree and branch are `delivery-agent-analysis`.
The implementation baseline is official `origin/master` at `987a687d1`.
The no-durable-publication decision is recorded in DECISION_LOG.md under
“Agent model Commands: no durable outgoing publication (2026-11-19)”.

### Ordinary Agent delivery

- Complete the Agent handler and save successfully before ordinary Inbox
  acknowledgement. Remove Agent-specific early acknowledgement, deferred
  execution tied to shard sessions, Agent session renewals for remote calls,
  and `AgentAcceptanceReceipt` and its storage.
- Introduce no Inbox status, including `DELIVERY_IN_PROGRESS`.
- Do not promise atomic saving and acknowledgement or exactly-once execution.
  Existing ordinary Delivery/redelivery semantics remain. Do not retain
  Agent-specific acceptance suppression to hide shared delivery gaps.
- Do not police handler duration. Existing direct `ai.invoke()`/`ai.call()`
  execution semantics remain direct; history reads and arbitrary user awaits
  remain allowed.

### Model Commands and application API

- Add typed `this.modelCommands.create(definition, { conversation, input })`
  returning `CallModel`, without contacting a provider. An unused constructed
  Command creates no pending call or remote work.
- Register definitions through existing `.withAi(registry)` and
  `.add(AgentClass, { ai: { models: [...] } })`. The framework model handler
  resolves the registered definition by Agent state type URL, operation name,
  and revision. It does not import application modules.
- Preserve deployment selection, authorization, typed output checks, and
  explicitly configured corrective attempts. Capture selected `ModelRef`
  during construction; no credentials in Commands.
- Bind transported input type URLs to the registered definition in ordinary
  signal admission/output preparation. Do not revalidate incoming messages
  during asynchronous dispatch.
- Use language-neutral `spine.agent` / `spine/agent` for public Agent Protos.
  Update existing authored Agent Protos and maintained references directly.
  Internal storage records remain `spine.server.agent`.
- Commands, Events, and rejections have separate Proto files. Use `CallModel`,
  `ModelReplied`, and `ModelCallFailed` on domain buses, with ordinary rejection
  envelopes and rejected-Command context.
- `AgentId` pairs `state_type_url` with typed `entity_id` packed in Any. Its
  Proto documentation describes identity, not tenancy/storage implementation.
- `ModelCall` contains unique AiOperationId, typed BoundedContextName
  reply_context, trusted tenant when applicable, AgentId, optional observed
  core.Version agent_version, capability name/revision, conversation, and
  when_requested. Use the persisted version at handler entry; omit it for a
  new Agent with no saved record. No additional turn counter or guessed version.
- `CallModel` contains call metadata, ModelRef, typed input in Any, and optional
  when_submission_attempted. Record the attempt before posting; an unsuccessful
  history append prevents that submission and is reported. The timestamp is
  evidence of an attempt, not bus acceptance.
- `ModelReplied` contains call metadata, output Any, when_started/completed.
  `ModelCallFailed` contains call metadata, reason, outcome_unknown,
  optional when_started, and when_failed. All authored Timestamp fields begin
  with when_; correct violations in changed authored files, not frozen sources.
- Model-specific routes for both outcomes select Bounded Context, tenant,
  domain state type URL, and exact typed Entity ID. Verify consistency with
  trusted metadata. No broadcast to all Agents and no automatic stale filtering.

### Agent attributes and history

- Keep the domain state in the unchanged common EntityRecord. Do not add
  Agent fields to common Entity Protos or require application state fields.
- Replace AgentModelPreferencesRecord with AgentAttributesRecord containing
  AgentId, model_preferences, and pending_model_calls. This replaces existing
  preferences storage rather than adding another current-attributes store.
- Replace successive current-state/preferences reads with a provider combined
  current-data load. SQL requires one statement/data-read round trip; Datastore
  requires batched consistent retrieval (transaction control requests remain
  possible); memory reads are coordinated. Do not wrap two old reads and claim
  the extra call was eliminated. Preserve ordinary state queries/access checks.
- Save domain changes, attributes, and corresponding history atomically,
  checking previously read Entity version and attributes even for changes
  that do not advance Entity version. No history read on every dispatch.
- pendingModelCalls is framework-maintained and supports many simultaneous
  calls. Add returned calls on commit; retain an outcome's call during its
  handler; remove it only on successful matching application-handler commit.
  Failure or unmatched outcome leaves it pending. Report unmatched outcomes.
- `modelCommands.abandon(callId)` saves explicit abandonment with history.
  It neither cancels provider work nor suppresses late outcomes.
- Expose protected `modelCallHistory(callId)` returning the original CallModel
  and complete triggering Command/Event envelope. Add indexed request lookup
  by Agent identity and call ID; save index and request with the Agent commit.
- Extend existing Agent history with prepared request/source, submission
  attempts, successfully handled outcomes, and abandonment. Preserve provider
  exchange history. Use stable entry IDs, conversation/call IDs, deterministic
  ordering, and when_occurred. fullHistory includes new entries;
  conversationHistory retains its provider-exchange result type.
- Application code decides how to handle steering, overlapping calls, and
  out-of-order results using versions, pending calls, inputs, and history.
  Never automatically cancel, supersede, or reject an older reply.

### General asynchronous Command handlers

- Add a scenario-independent AsyncCommandHandler base. Dispatch registers
  invocation and returns without awaiting remote completion.
- Track invocation AND all outcome publication attempts; observe unexpected
  exceptions with original Command identity. Declared rejections follow normal
  handling. Logging failed publication does not establish delivery.
- Generic runtime knows nothing about Agents, models, or pending-call records.
  No arbitrary concurrency cap, retry budget, or shutdown timeout.
- Participate in Bounded Context shutdown: stop external intake, retain
  accepted follow-ups, drain Delivery/buses/publication/async tasks to stability,
  then close dependencies. A task that never settles can prevent draining.
- The framework model handler uses this base, registered once per relevant
  Bounded Context. Multiple remote calls for one Agent can overlap.
- Execution is process-local. No outbox, durable outgoing publication,
  persisted execution queue, startup replay, or automatic recovery from history
  or pending calls. Option 2 was rejected permanently, not deferred. A saved
  pending call may never reach its handler after process loss. Existing delivery
  after ordinary bus admission remains unchanged.

### Examples, documentation, and release

- Update maintained examples and documentation to actual implemented APIs.
  Explain model definition module/imports/registration/runtime lookup clearly.
  Keep SupportTicket and SupportReview registrations. Clear an old draft when
  replacing its associated facts unless original draft provenance is retained.
- Use plain, beginner-readable explanations. No documentation-writing skills.
- No migrations, compatibility aliases solely for migration, disposable review
  transcripts, or detailed execution diaries in Git.
- Push every feature-branch commit to official origin. No GitHub PR/issue writes.
- Include the required common unused package version in a version-only commit
  before completion; update internal pins/lockfile separately.

## Acceptance and milestones

1. Freeze implementation seams and ordered slices with one architecture pass.
2. Implement public protocol and generic asynchronous handler runtime, with
   focused runtime tests for independent dispatch, rejection, errors, and drain.
3. Implement attributes/history/provider combined load and atomic save, including
   provider behavior tests for consistency, missing records, and conflicts.
4. Integrate model command construction, execution, routing, and ordinary Agent
   lifecycle. Remove obsolete acceptance/session work. Test simultaneous calls,
   steering/out-of-order results, failure, abandonment, and accepted crash gaps.
5. Update examples, maintained docs, generated contracts, and versioning. Run
   the mandatory cheap preflight before the independent reviews.
6. Run three sequential fresh no-memory Astra/high reviews, addressing relevant
   findings after each round. Each covers correctness/DDD/API/persistence/
   concurrency/security and human comprehension for affected behavior. Complete
   required final security concern and record concise dispositions. Repeat only
   affected checks after corrections. Run shared-runtime release verification
   after convergence and leave a clean pushed branch.

## Assignments and review status

The Desktop collaboration surface supports explicit model/reasoning dispatch.
Actual runtime metadata is recorded when exposed; absence of child introspection
is not a model mismatch. Subagents may not spawn subagents.

- Architecture pass: requirements_splitter, gpt-6-astra/high, fresh context.
  Scope: implementation seams, provider load/commit feasibility, ordered slices,
  relevant JVM comparison. Completed read-only; explicit model/reasoning fields
  confirmed. Runtime self-introspection not exposed; immutable configured
  requirements_splitter profile is Astra/high. No human design blocker.
- Implementation slice 1: implementer, gpt-6-sol/medium, fresh context.
  Scope: language-neutral Agent Proto namespace, existing timestamp corrections,
  new model Command/Event/rejection/identity contracts, generated exports and
  maintained references, focused generation/type verification. Assigned
  production files are exclusive to this implementer while the orchestrator
  maintains task/coordination records. Explicit dispatch fields required.
  Completed; explicit model/reasoning confirmed, immutable implementer profile
  Sol/medium, runtime introspection unavailable. Generation/build, focused
  public-contract/history tests, Proto lint, docs/TSDoc/cleanup/format checks
  passed. Tracked generation metadata stays synchronized; generated source is
  untracked. No delivery/runtime behavior changed in this slice.
- Implementation slice 2: same implementer, gpt-6-sol/medium profile retained.
  Scope: generic AsyncCommandHandler public base, analyzer/registry recognition,
  independent standalone invocation/publication tracking, and coordinated
  shutdown preserving accepted follow-ups. Focused deferred-handler, rejection,
  publication-failure and close-chain tests required. No provider or model
  execution integration changes in this slice except necessary shared seams.
- Review rounds 1–3: each a fresh no-memory Astra/high reviewer, explicit model
  and reasoning, as requested by the human. Pending implementation completion.

## Current status

Requirements recorded. Official master fetched and already contained by this
branch. Architecture pass and slice 1 accepted; slice 2 is next. No
unresolved human design question; implementation discoveries must preserve the
accepted contract or be raised with concrete evidence.

## Implementation seams

JVM comparison used the official research checkout at
`04ba1bedc3f8db3c8c58b987f9795f952f14c0ab`: AbstractAssignee invokes ordinary
receptors and handles outcomes; LiveDeliveryStation dispatches before marking
delivery complete. Detached asynchronous lifecycle and Agent model Commands are
new APIs, not claimed JVM equivalents.

- AsyncCommandHandler subclasses AbstractAssignee and reuses @Assign and
  addAssignee metadata. Extend build-time-handler-analyzer recognition; Promise
  results already have generated support. The standalone runtime tracks method
  and all publication attempts; existing SignalPublisher logs contained errors,
  so settlement never establishes delivery.
- Extend Bounded Context drain coordination, retaining recipients and accepted
  internal follow-ups until the work reaches stability. Current beginClose
  removes recipients and aborts Agent work too early. Cover direct and
  Server/Application-coordinated close. Detach asynchronous invocations with the
  existing withoutDeliveryCommitFence seam to avoid inherited shard state.
- Replace readAgentPreferences with combined current/attributes retrieval.
  SQL uses independently resolved current/attributes identities in one seeded
  join or tagged UNION statement. Datastore uses one transactional batch lookup
  and identifies returned records by their native identities, including absence.
  Memory uses the shared Agent mutation coordination. Reuse commitAgent atomic
  writes, comparing both loaded Version and complete attributes, including
  absence versus an empty record.
- Agent repository loading must bypass the old sequential ProcessManager load
  plus preferences read, reuse Entity restoration/history binding, and preserve
  normal Stand queries and access checks.
- Index prepared requests through existing immutable history identities: a
  request category with call ID as stable record ID. Existing Agent scope plus
  that ID enables exact primary-record lookup without another store or history
  scan. Add memory direct lookup and extend history categories/order.
- Replace admitAgent/reservation/receipt/post-ack execution with an awaited
  ordinary Agent reception. Delete special startAgent lease renewal and session
  callbacks. Keep shared ordinary Delivery commit fencing.
- Reuse AgentLiveAiRuntime: its dependencies are registry, policy, scope,
  selection, budget, audit, and cancellation rather than an Agent instance.
  Add an internal admitted-operation entry accepting the transported operation
  ID, while preserving direct invocation validation and behavior. The standalone
  model handler creates its own audit resources and never captures the requesting
  Agent or shard session.
- Framework Proto output must not import core, since core already depends on
  proto. Suppress generated runtime throwable companions for spine/agent using
  the same layering rule as existing spine/delivery companions; retain the
  public ModelCallFailed rejection message/schema. The built-in model handler
  must declare that rejection in ordinary handler metadata and construct its
  throwable through core. ModelCallFailed must not become an Event or gain an
  extra ModelCallRejected substitute to work around generation.

Provider test services are isolated containers named spine-agent-model-pg,
spine-agent-model-mysql, spine-agent-model-mariadb, and spine-agent-model-datastore.
Local connection setup is outside Git in /tmp/agent-model-provider-env.sh.
MariaDB overrides are in /tmp/agent-model-mariadb-env.sh. Provider acceptance must
exercise missing-record combinations, combined-read counts, concurrent commits,
attributes-only conflicts, atomic rollback, and tenant/type/ID isolation.
