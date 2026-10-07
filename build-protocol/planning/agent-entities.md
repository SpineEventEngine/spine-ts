# Signal-driven Agent entities

## Scope and status

High-risk runtime/public-contract task authorized on 7 October 2026. Base:
`658da1cdddcb8fd40f9205b1c200abc3a58dd62e` (snapshot.22). Feature branch:
`agent-entities`; worktree: native managed `agent-readiness/spine-ts`.
Implementation is starting. Physical Entity deletion is explicitly deferred.

The approved specification is `AGENT_ENTITIES_API_TASK_2026-10-02.md` and its
`AGENT_HISTORY_PROPOSAL.md` appendix in the user's
`Spine/spine-ts-new-feature-analysis` directory. Its 7 October decisions govern:
full Timestamp ordering with existing category/record identity tie-breaks, and
no dependency on future physical deletion. Historical proposals are superseded.

## Human-Imposed Requirements Ledger

- Agent is a non-autonomous Entity family with Proto ID/state, canonical Version,
  repositories and generated routing. Assign/React/Command handlers return native
  messages. Subscribe and Apply are invalid on Agents; other families retain
  their behavior. Preserve one ordered handler set and one Entity transition.
- Domain handlers use Spine's AiModel/AgentAi facade only. No provider types,
  ReasoningReceiver, Captured, Reason decorator, LangChain or public llm names.
- Vercel supplies provider integration; Ax structured generation/correction must
  use a controlled Vercel request path. Support actual non-generative decisions,
  including Jev, separately from generation. Validate Proto output and account
  for every request/correction/tool execution under bounded budgets.
- Explicit ConversationId; mandatory conversation, System and emitted domain
  event records. Repository-indexed fullHistory, conversationHistory,
  systemEventHistory and domainEventHistory return newest first. No arbitrary
  total-history/page cap, sequence counter, TTL, trimming or recording switch.
- Preserve original event timestamps. Use full Time timestamps for ordering;
  existing record ID/category resolves ties. Framework runtime time reads use
  Time. TSX and non-runtime scripts remain excluded.
- Authenticated registry defaults resolve at app/context/repository/instance
  scope. No login protocol implementation. Credential refresh cannot silently
  change an accepted invocation's identity. MCP tools are authorized, bounded
  and intercepted for audit. Unknown write outcomes are not automatically resent.
- Reuse saved model results and relevant reads on recovery. Preserve accepted
  recipients, actor/tenant, revisions, budgets and named call identity. One
  transition per instance; slow inference must not stall other instances in the
  same delivery shard. Late execution cannot commit after losing authority.
- Entity transactions are not database transactions held across model calls.
  No new recovery protocol for copies in context-wide and repository event stores.
- Use documented production-style Protos and domain-correct fixtures. No proto3
  optional/readonly, invented Money or wire-compatible substitute domain types.
- BlackBox is the domain-test entry point. Deliver a warehouse support-ticket
  reply example: typed request, suggested reply for human review, no auto sending.
- General physical removal, ID reuse after removal and related tests are deferred;
  retain history through logical deletion/archive. No provisional Agent purge API.

## Implementation sequence and acceptance

0. Prove Ax-to-Vercel schema, corrections, tool continuation, cancellation and
   request/usage control using protocol fixtures. Pin compatible packages.
1. Agent family, generated handlers/registry and repository integration, tested
   with domain-correct signals and BlackBox. Reuse current Entity semantics.
2. AI facade, public Proto contracts, deployment registry, validation and scripted
   testing backend; SDK-free imports and public declarations compile.
3. Mandatory repository history across supported storage providers. Demonstrate
   scoped indexed reads, full precision and complete equal-time pagination.
4. Durable accepted execution, saved-result/read reuse, persistent budgets,
   same-shard progress, interruption and stale-completion tests.
5. Production adapters, authenticated selection and MCP transport execution with
   protocol-level tests and uncertainty behavior.
6. Complete example, README/reference/user guides and public API documentation;
   specialist reviews, corrections, full release/audit/publication-trial checks.

Each slice receives focused mechanical checks before relevant specialist review.
Do not claim the whole task complete while any required slice is pending. Final
release verification follows convergence; do not repeatedly run it diagnostically.
The final version-only commit uses one unused common workspace version, with
internal pins/lockfile separate. Push every commit to official origin. No PR
creation or merge is authorized.

## Execution record

Initial work estimate: 8–14 hours including implementation, tests, reviews and
release verification; provider composition and durable storage are uncertainties.
Fresh fetch confirms origin/master equals the base; clean reusable worktree.
Desktop supports explicit model/reasoning dispatch. Runtime metadata beyond the
configured profiles is unavailable. Subagents must not delegate.

Skill applicability: session catalog and project EXPECTED_SKILLS inspected;
47 installed SKILL.md paths enumerated with rg; installed lockfile readable.
Selected: using-git-worktrees (already read for this worktree),
subagent-driven-development and test-driven-development (read before work).
Executing-plans was inspected; use the subagent workflow instead. Repository
protocol overrides skill demands for new generic roles, repeated full reviews,
extra evidence files and fresh fixers: retain existing role names and return fixes
in the current implementation context. Read verification/review skills when those
phases begin. Generic web/backend/design skills add no task-specific guidance.

Dispatches planned: requirements_splitter gpt-6-astra/high for the frozen
implementation wave; implementer gpt-6-sol/medium for bounded code slices.
All four canonical review concerns apply to the completed feature; dispatch
focused existing reviewers after deterministic checks, security at final release.
No baseline full rerun: the base tree was release-verified in the Time task.

## Frozen implementation architecture — 7 October 2026

This is the single architecture pass for the approved high-risk wave. Dispatched
function: existing `requirements_splitter`; explicit requested profile:
`gpt-6-astra` / `high`, matching `.codex/agents/requirements-splitter.toml`.
Runtime metadata is not exposed to this child. No subagents or production edits.
The orchestrator confirmed both explicit dispatch fields and accepted this pass.
The normative task and history appendix were read in full from the supplied
`Spine/spine-ts-new-feature-analysis` directory. There is no product blocker.

Source evidence: `spine-jvm-docs/spine-entities-repositories-and-state.md`
(Process Manager/transaction sections),
`spine-jvm-docs/spine-routing-dispatch-and-delivery.md` (Inbox and shard sections),
and local `core-jvm/server/src/main/java/io/spine/server/` sources
`procman/{ProcessManagerRepository,PmEndpoint,PmTransaction}.java` and
`delivery/{Inbox,InboxWriter}.java`. Preserve their familiar split: repository
routing and Inbox admission, one Entity transaction, persistence, then produced
signals. They do not supply external AI recovery; the approved task requires
that bounded extension. TS source confirms that handlers already await native
Promises, reactors then commanders share one draft, and the service awaits
`commandBus().post()` before returning OK. Do not reimplement awaited handlers.

### Responsibilities and seams

- **Entity and generated registration:** add the sibling Agent in
  `packages/server/src/entity/entity.ts` (or a focused adjacent Agent module),
  extend `EntityFamily`, `Repository` options and family detection, and reuse
  existing transaction/return-schema/routing machinery. Extend
  `packages/proto-tools/src/generation/build-time-handler-analyzer.ts`, generated
  registry emission, `server/src/handler/{handler-metadata,generated-handler-registry}.ts`
  and repository readiness checks together. Extract the existing handler-scoped
  query binding only as needed for Agent reuse; preserve Process Manager APIs.
  Agent restrictions must be checked at generation and runtime registration.
  Avoid copying the 10,000-line repository module into another large runner.
- **Facade below server:** new `packages/ai` contains factory-created immutable
  capabilities, Proto codec/schema validation, registry/selection rules, history
  read types, and the documented adapter SPI. Its dependencies remain core/proto,
  with no server/storage/vendor imports. Put server-bound execution in focused
  `server/src/agent/` modules for invocation, history binding and runtime lifecycle.
  Expose only the narrow SPI needed by server, `ai-vercel-ax` and testing through
  declared package subpaths; no source/private imports. The SPI admits one
  controlled physical request/tool execution at a time through the runtime's
  budget/audit callbacks, rather than delegating an unrestricted retry loop.
- **Wire contracts:** use `packages/proto/proto/spine/ts/agent/` for the approved
  `model.proto`, `history.proto`, `interaction_events.proto` and the closed set
  of generation/decision/tool content messages. Persist execution records in
  separate internal server Proto contracts; execution claims are not domain
  state or new application APIs. Generated exports follow existing generation.
  Complete semantic types for revisions, limits, identities, usage presence and
  outcomes before storage consumes them.
- **Repository history:** introduce a provider-only Agent history port under
  `packages/storage/src/internal/` and record layout under `storage/src/entity/`.
  Reuse `RepositoryStorage.entityStorageInput()`, `StorageGroup`, tenant boundary
  and Entity ID codecs. Bind the four protected methods to repository storage.
  Do not reuse the version/depth-based event-history port or expose its trim API.
  One append-only logical history has category and conversation indexes; full
  history is one indexed view, not another copy. Add corresponding implementations
  beside memory, PostgreSQL, MySQL and Datastore `entity-history.ts`, registering
  through the existing provider-factory pattern and Datastore index manifest.
- **Accepted execution:** introduce a provider-only Agent execution port beside
  `storage/src/internal/entity-commit.ts`. Extend the existing commit coordinators
  (`memory/in-memory-entity-commit.ts`, SQL `entity-commit.ts`, Datastore
  `entity-history.ts`) for conditional Agent completion, preferences and durable
  outgoing envelopes. This is storage integration, not a public worker or
  transaction API. Ordinary record writes plus a process-local mutex are
  insufficient. No database transaction spans a callback or model/tool request.
- **Server integration:** `server/src/context/{bounded-context,entity-inbox}.ts`,
  `repository/repository.ts`, `server/server.ts`, and normal delivery lifecycle
  attach/close the internal Agent runtime. `.withAi()` respects context override
  and rejects rebinding built contexts; Agent registration requires persisted
  System events and a compatible provider before intake. Scripted model/tool
  dependencies remain in `packages/testing`, exercised through real BlackBox.

Keep exact approved configuration names, including `resolveIdentity`,
`authorizeUse`, `connect`, `authorizeSelection`, validation `check` and mapping
`toMessage`. Where the general callback-name checker conflicts, record a narrow
exception for these specified declarations; do not rename the public API or
weaken the general rule. Example identifiers and prose consistently describe
support tickets, reply drafting and support knowledge, replacing stale
project/planner vocabulary in illustrative specification snippets.

### Execution invariants to implement before durable acceptance

1. Persist the accepted signal envelope, concrete recipient, complete ordered
   handler bindings and code/schema/policy revisions before successful Agent
   admission. Use source signal plus typed Entity scope for deduplication, not
   transient Inbox row identity alone. Preserve accepted fan-out recipients on
   retry; persisted work never reruns recipient queries. Each recipient is one
   invocation containing all its matching handlers. Infrastructure failures
   must not enter a monitor path that acknowledges and discards unpersisted work.
2. Reuse the durable Inbox as intake. Its Agent endpoint performs an idempotent,
   short handoff to the execution store before marking the Inbox row delivered.
   Crash between handoff and acknowledgement safely repeats that handoff.
   The existing follow-up callback is a wake-up hint, not durable evidence and
   not a place to await inference on the shard/bus queue. An internal bounded
   scheduler discovers pending records at start and after interrupted work;
   scoped indexed scans, finite batches and the context tenant catalog prevent
   process memory or a lost notification from becoming the recovery mechanism.
3. Serialize transitions by context/tenant/type/typed ID using a persisted
   per-instance active-invocation claim with expiry and a replaceable token.
   Pending invocations follow accepted Inbox order. Ready work on another ID in
   the same shard proceeds while inference waits. Bound registry concurrency
   and waiting operations; overflow retains already accepted durable records
   and applies intake backpressure rather than creating unlimited promises.
4. Start the invocation deadline and choose per-kind instance/repository/registry
   preferences only when execution begins, after the preceding transition.
   Persist that absolute deadline, effective limits, selection and non-secret
   authenticated identity. Queue waiting does not spend execution time; restart
   does not reset it. Accepted revisions remain fixed; unavailable incompatible
   code/configuration explicitly blocks or terminates the invocation. Credential
   refresh must retain identity and resumed external work is reauthorized.
5. Journal ordered named operations by handler binding and call name, plus
   projection/history reads with their request, scope and returned snapshots.
   Persist attempt/tool reservations before dispatch; charge received bytes
   while streaming and save validated results before returning to handlers.
   Recovery reruns the one Entity transaction using those exact results/reads;
   changed definitions, call order/input/conversation or read sequence fail
   explicitly. Sequential calls and duplicate-name guards span the active
   handler, while invocation counters span every matching handler. Record actual
   rendered requests/corrections and failed outputs in conversation history.
6. Every mutable execution write checks the current token in the same provider
   operation as its mutation. Final persistence conditionally checks token,
   accepted initial Entity version and terminal status, then commits state,
   optional state history, Agent-emitted domain history, staged preferences,
   execution completion and outgoing signal envelopes/IDs together. No-op or
   command-only transitions still commit completion/output obligations. The
   existing `commit-fence.ts` precheck protects an in-memory transaction and
   alone cannot close the later persistence race. Late callbacks/results never
   mutate state, counters, preferences or outgoing signals after authority loss.
7. Deliver saved outgoing envelopes through normal publisher/Inbox paths and
   retain their IDs across interruption. Keep this pending-delivery status in
   the invocation record until ordinary delivery accepts it; do not rerun the
   handler after a committed transition. This is accepted-execution recovery,
   not a new context/repository event-copy reconciliation protocol. System and
   domain context-wide copies continue through the existing EventStore paths;
   their failures remain ordinary storage/publication failures.
8. Persist write-tool intent before sending. Any interrupted intent without proof
   of non-dispatch is uncertain, including remote success with lost local result:
   return `TOOL_OUTCOME_UNKNOWN` and never automatically resend through recovery,
   SDK retries or corrections. Saved read-tool results are reused. Cancellation,
   deadlines and shutdown revoke authority and bound framework waits even if a
   callback ignores AbortSignal; late resources close without starting work.

Provider capability checks must cover atomic conditional mutation/completion,
immutable append, scoped pending/history indexes and relevant payload limits.
Memory proves in-process behavior only; PostgreSQL, transactional MySQL/MariaDB
and Datastore need persistent conformance. Reject MyISAM/Aria for Agent execution
before accepting work, preserving support for other Entity families. Persisted
execution evidence and preferences must not be removed by Inbox cleanup.

### History ordering and access

Freeze one total order: full seconds/nanos descending, then category
(`conversation`, `system`, `domain` in that explicit order), then existing record
ID ascending by unsigned UTF-8 bytes. Document the comparison and make SQL
collation/Datastore key encoding/memory comparison match it. These category
values are comparison ranks, not persisted sequence counters. Filter by full
Entity scope and optionally category/conversation before paging. Bind opaque
cursors to scope, method, conversation and the complete last key; validate them
at the read boundary. Use provider range predicates and composite indexes,
never a context EventStore scan or in-memory sort of an entire history.

The history provider port takes typed scope/view, an optional complete-key
boundary, requested count and response-byte budget; it returns entries and
whether continuation remains. It does not accept a generic `RecordQuery` plan.
Datastore's normalized query path permits one inequality column and limits
candidates to 1,000, so routing this read through it cannot meet the contract.
Use a provider-internal sortable key derived solely from the existing full
Timestamp, category and immutable record ID, with equality-filtered Entity/view
scope and one range predicate over that key. This derived index value is neither
a new identity nor an allocated position/counter. Preserve exact timestamp range,
UTF-8 ordering and prefix safety in its canonical encoding. Add the required
Datastore composite indexes and use native cursor/range reads; fetch further
bounded provider chunks when a requested page exceeds a backend batch size,
subject to the response-byte limit, without the generic candidate ceiling.
SQL can use its native composite predicate/index or the same derived key under
binary collation. Shared provider conformance must prove identical order and
complete page boundaries; existing version-history readers remain unchanged.

Pages have no arbitrary record-count ceiling. Enforce documented response-byte
bounds with a continuation when more remains; explicitly reject an oversized
first record. Keep original Event envelope/ID/timestamp; each new conversation
record receives its own Time occurrence. Repeated writes retain identity/time.
Reads are live continuations, not frozen snapshots. Record handler history reads
for recovery just like projection reads. Administrative reads must use the same
repository port through the existing authorized query boundary, with no public
access to framework System publication. Logical archive/deletion retains all
three categories. No physical removal, recreation identity, TTL or purge work.

### Ordered slices and acceptance gates

One Sol/medium implementer remains responsible for overlapping runtime, Proto,
provider and test edits across these slices. The separate adapter proof touches
only its assigned proof files until integration is coordinated. The orchestrator
handles mechanical evidence and focused review dispatch; no parallel repository,
Proto/package-manifest or shared-provider writers.

1. **Agent parity and Proto foundation.** Add generated Agent registration,
   allowed decorators, native returns, repository construction and shared query
   binding. BlackBox proves typed IDs, command/event/rejection routing, actor and
   tenant propagation, reactor/commander order, currentDraft visibility, one
   Version increment, no-op preservation and no partial persisted result when a later handler fails.
   Generation/runtime tests reject Subscribe/Apply and empty successful Assign
   output without changing Process Manager support. Generate canonical public
   AI contracts and complete internal serialized records as their slices need them.
2. **Facade and scripted execution.** Add immutable model/registry factories,
   validation/Proto JSON and adapter SPI; add BlackBox scripted backend and builder
   configuration. Tests reject fabricated/mutated definitions, unsupported schema
   features before requests, invalid input/output, wrong-kind scripting and
   invalid decisions. Preserve 64-bit values, presence/oneofs, exact issue-based
   corrections and optional usage. Verify default precedence, allowed deployment
   intersection, staged selection denial, SDK-free imports and public declarations.
   Only after the mandatory history binding below is present is invocation
   success eligible for feature acceptance; no temporary recording switch.
3. **Mandatory history end to end.** Implement all provider ports/indexes and
   trusted System-event persistence; connect actual exchanges and emitted domain
   events. Test four reads, multiple conversations/signals, empty conversation,
   cross-tenant/type/ID rejection, wrong-method cursors, same-millisecond and
   exact-equal timestamps, page size one across categories, more than 100 entries
   and page size above 100, changed page sizes, byte continuations, oversized
   record errors and live insertion semantics. Inspect executed query/index paths
   with large unrelated data. Prove original Event equality, history storage
   failures, persisted System audit through a documented testing read seam, and
   retention after logical lifecycle changes. Do not use `assertEvents()` for audit.
4. **Durable admission and fenced scheduling.** Add execution port/capability
   checks, Inbox handoff, indexed recovery and bounded per-instance scheduling.
   Test failure before durable admission, repeated handoff, complete handler-set
   capture, fixed routed recipients, same-shard progress, per-ID serialization,
   queued preference changes, backpressure and unsupported-provider rejection.
   Crash immediately after acknowledged admission must leave discoverable work.
5. **Recovery and final transition.** Add saved reads/results, persistent counters,
   absolute deadlines, conditional completion/preferences and outgoing
   envelopes that retain their IDs. Barrier tests interrupt before/after response save and transition
   commit; saved results make no new request, unsaved attempts consume budget,
   stale completions cannot write, changed call/read/revision fails explicitly,
   and committed no-op/command-only work neither disappears nor runs twice.
   Reopen persistent storage and use BlackBox to observe outcomes; also run real
   process termination against supported persistent providers, not only graceful
   close. Use Time control and barriers rather than arbitrary sleeps.
6. **Production adapters, authentication and MCP.** Integrate the independent
   Ax/Vercel proof via the frozen SPI. Protocol fixtures cover actual schema and
   Jev decision requests, one correction/request counter, cancellation/usage and
   same-identity refresh. Actual local HTTP/stdio MCP fixtures prove permissions,
   discovery/input/output bounds, errors, cleanup, saved reads, and interruptions
   after write intent/during send/after remote success. All callbacks are bounded
   and all tool requests/results pass through the same audit/recovery boundary.
7. **Example and release closure.** Deliver the warehouse support-ticket Agent,
   result projection and BlackBox suite. A suggestion retains request/conversation
   facts, never sends a reply, and failure preserves the previous accepted reply.
   Compile/run documented public examples, exports and adapter consumers; keep
   narrow docs current throughout, then finish guides. Run deterministic checks
   before relevant review concerns, aggregate one findings batch, complete final
   security review and one converged release/publication-trial profile.

Risks requiring focused evidence are provider transaction/fencing differences,
Datastore index/payload constraints, durable handoff versus default failure
acknowledgement, callback lifetimes, exact schema lowering, and output-delivery
crash boundaries. They are implementation risks, not scope questions. Reopen this
architecture pass only for a demonstrated blocker or material contract change.
Exclude physical Entity deletion/ID reuse, autonomous goals, application-facing
workers/buses, hidden reasoning, model-inferred tool permissions, generic remote
write reconciliation, and a separate protocol for maintaining history copies.

Immediate coding packet after the adapter proof: slice 1, one implementation
context. Focus existing suites in `proto-tools/test/{build-time-handler-analyzer,
generated-registry-writer}.test.ts`, `server/test/handler/{handler-metadata,
generated-handler-registry}.test.ts`, `server/test/entity/{entity,
process-manager-querying}.test.ts`, and `server/test/repository/repository.test.ts`;
add a generated domain-correct Agent fixture and BlackBox parity suite in the
existing `packages/server-blackbox-tests` workspace. Regenerate, run these focused
suites and affected typechecks/preflight before relevant review. History/execution
ports above constrain the later implementation; they do not enlarge this first
packet into an all-feature rewrite or permit claiming it completes the feature.

Package scan accepted from explicit gpt-6-luna/medium read-only dispatch: workspace
patterns already discover new packages/examples; TS project references, public
release inventory, API entries and example namespace checks require updates.
Final inventories must match actual added packages and fixtures. New npm packages
follow the existing human first-publication procedure after implementation is
otherwise ready; no publication or PR creation is authorized now.
