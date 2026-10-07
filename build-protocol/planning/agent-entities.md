# Signal-driven Agent entities

## Scope and status

High-risk runtime/public-contract task authorized on 7 October 2026. Base:
`658da1cdddcb8fd40f9205b1c200abc3a58dd62e` (snapshot.22). Feature branch:
`agent-entities`; worktree: native managed `agent-readiness/spine-ts`.
Adapter composition, the bounded transport and Agent family foundation are
verified. The AI facade and shared/memory history are accepted; persistent history
integration is underway. Physical Entity deletion is explicitly deferred.

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

Milestone 0 preflight: mature Ax 25.0.0 / ai 7.0.128 compose successfully through
real-library protocol tests; all/prod dependency audits pass. Initial coverage
shortfalls returned to the same implementer before review. Strict vendor
checking fails in provider-utils/ai declarations with exactOptionalPropertyTypes;
the selected and adjacent ai versions fail the same vendor declaration checks.
Read-only Luna/medium probes established that direct `@ai-sdk/provider@4.0.22`
model interfaces pass with skipLibCheck false. Accept a narrow adapter-only
third-party declaration exception; authored source and tests retain strict flags
and receive separate tooling checks. Public factory types must use provider
interfaces without exposing ai/Ax declarations. The root compiler flags remain
unchanged. Diagnostic logs remain outside the repository.

Milestone 0 dispatch/acceptance: implementer gpt-6-sol/medium and read-only
compatibility scanning gpt-6-luna/medium were explicitly configured. Runtime
metadata beyond configured roles is unavailable. Parent reran 23 protocol tests:
all pass; coverage statements 96.87%, branches 92.64%, functions 95%, lines 97.5%.
Root tooling initially lacked generated package declarations in this worktree.
Generation/build and the repeated complete source/test tooling check now pass.
Scoped lint, cleanup, TSDoc, formatting, audience and whitespace checks pass.
Copyright checking identified four new files missing the standard header; return
that deterministic correction with the review batch. First-generation metadata
churn was discarded after verifying the only changes were generationId fields;
existing IDs and formats remain unchanged.

Milestone 0 review wave will use the existing style_maintainability_reviewer,
typescript_api_docs_reviewer and performance_reliability_reviewer roles with
explicit gpt-6-sol/medium, and documentation_reviewer with explicit
gpt-6-luna/medium. Each receives only the internal adapter proof and its affected
contracts/claims, without prior reviewer findings. No child delegation. Security
is deferred to the required final release review; this slice introduces no
application registration or credential handling. Full verify:release is selected
for the complete task because shared runtime/build/storage behavior changes;
focused mechanical checks apply to this intermediate compatibility proof.

Milestone 0 review wave: explicit profiles match the planned roles; actual runtime
self-introspection is unavailable. Style and TypeScript/API reviewers identified
parameterless tool-schema handling, duplicate tool-call identity mapping,
provider finish-reason preservation and assistant text/tool-call preservation.
Documentation review requires a stated README audience and runnable first step.
These are accepted P2 corrections, together with the deterministic copyright
headers. Runtime review reproduced P1 malformed JSON skipping usage/correction and P2
cancellation during reservation reaching the provider. The complete accepted
batch went to the same implementer, explicitly Sol/medium, for regressions and
fixes. The read-only Luna/medium scan context is preparing exact generation/test
commands and family-switch locations for the next slice; no architecture repeat.

Milestone 0 correction verification: parent reran 34 tests and all pass; coverage
96.55% statements, 90% branches, 95% functions, 97.87% lines. Complete workspace
tooling, scoped lint, cleanup, TSDoc, copyright, audience and formatting checks
pass. Focused second-wave style and TypeScript/API reviews closed their findings;
runtime closed its original findings and identified tool-call-only output marked
`stop` being converted to empty text after SDK parsing fails. Return this final
bounded correction to the same implementer with a protocol regression. No third
complete review wave; the deterministic fix must explicitly reject or preserve
that response. Documentation corrections were checked directly; no broad prose
review reopened.

Foundation preparation: explicit Luna/medium read-only scan found that the current
server-blackbox-tests model target has no handler-discovery TS project and uses
a literal registry. The Agent parity fixture must wire actual generator discovery
and exercise its emitted registry. Commands and exact family guard locations are
in temporary working notes, not new repository evidence files.

Milestone 0 accepted: the final protocol regression explicitly rejects empty SDK
parse-error output after recording usage. Parent reran all 35 tests and package
tooling: pass. Coverage is 97.41% statements, 91.11% branches, 95% functions and
97.87% lines. All accepted findings are closed. No public adapter factory or
complete Agent runtime is claimed by this checkpoint. Full release verification
remains scheduled after the complete feature converges.

Next dispatch: existing implementer role, explicit gpt-6-sol/medium, for the Agent
family/generated registry/repository/BlackBox foundation. The adapter implementer
remains available for later integration questions and corrections, with no
concurrent production edits. New assignment receives the frozen architecture and
exact requirements rather than repeating deep planning. Runtime metadata beyond
configured profiles remains unavailable.

Milestone 0 checkpoint `0e16da19a` was pushed to official `origin/agent-entities`.
Foundation implementer dispatched with explicit Sol/medium; no child delegation.
The existing explicit Luna/medium read-only scan function is independently mapping
current Proto validation/JSON APIs for facade reuse. It does not design another
architecture or edit production files.

Facade preparation accepted from Luna/medium source scan: reuse public core
TypeRegistry/TypeMetadata, Validate.message/check and Stringifiers.forMessage.
Schema derivation and facade JSON policy need new behavior tests for presence,
oneofs, extra properties and exact integer values. No runtime/schema library is
selected by this scan. The official Buf protoschema plugin was investigated as
an existing alternative: https://github.com/bufbuild/protoschema-plugins documents
build-time Draft 2020-12 generation and Buf validation examples, rather than a
JavaScript runtime descriptor API. Evaluate that distinction when implementing
Spine-specific schema lowering; retain the existing Proto parser/validator.
The same explicitly configured Luna/medium read-only function is checking the
published OpenRouter decision API against pinned Vercel provider interfaces,
using temporary package probes only and no live paid calls.

Decision compatibility follow-up: the pinned ai 7.0.128 entrypoint already accepts
both Experimental_DecisionModelV4 and Experimental_EvaluationModelV4 and normalizes
legacy doEvaluate itself. Both interfaces are exported directly by provider 4.0.22.
Published OpenRouter 3.1.0 evaluationModel satisfies that compatibility union;
use the SDK normalization, not a second Spine method-name shim. The temporary
strict authored-code probe passes; optional vendor declaration limitations remain
as previously recorded. Production protocol tests must still prove actual Jev
request/answer mapping, usage, rounding and cancellation.

Adapter production preparation is assigned read-only to the existing explicit
Sol/medium implementer context while the foundation writer edits server code.
It checks pinned streaming request/result hooks and byte-buffering boundaries
against the approved connection API; no production edits or new contract are
authorized by that scan. Escalate only a source-demonstrated contract blocker.

Demonstrated adapter boundary blocker: pinned provider-utils buffers SSE events
without a configured parser cap and JSON/error bodies up to its default 2 GiB
before doStream emits parsed items. Parsed-delta accounting alone cannot establish
the required received-byte bound for an opaque model. Reopen only this boundary
with the existing requirements_splitter role, explicitly gpt-6-astra/high, to
choose the smallest compatible bounded-transport contract. Foundation work remains
independent and continues. Source evidence and probes are outside the repository.

Bounded transport decision accepted from the explicitly configured Astra/high
requirements_splitter; configured metadata verified, runtime introspection absent.
This check used codebase-design guidance to keep the interface in the optional
adapter. The normative task §5.2 now requires VercelConnectControl.fetch for
provider construction, retains connect -> {model, identity}, and documents exact
decoded-body accounting, crossing-chunk failure, shared request reservation and
no hidden fetches/redirects. OpenRouter uses explicit decisionsBaseURL from the
accepted identity. No Agent/domain API or generic AiControl changes. Built-in
profiles require tested fetch propagation; trusted custom implementations must
meet that contract rather than pass a fictional transport-safe flag.

Implementation: a pull-based response-body guard precedes SDK parsers and covers
success, SSE and error bodies. Direct generation doStream avoids streamText's
internal accumulation; decisions use the SDK compatibility input behind the same
guard. Persist response-byte credit before dispatch so a crash cannot refund an
uncertain reservation. The physical attempt is counted once across Ax/fetch.
MCP's published client supports HTTP fetch injection and a custom MCPTransport;
use guarded stdio before line parsing, not the built-in unbounded read buffer.
The investigation inspected @ai-sdk/mcp 2.0.69 but did not select/install it.
Protocol fixtures must prove exact-limit EOF, crossing chunks, giant SSE/JSON
errors, split UTF-8, decompression accounting, cancellation, retry/redirect denial,
credential containment, durable credit and uncertain writes. This is the only
architecture extension; do not reopen the complete frozen wave.

Proto formatting clarification: current repository workflow enforces Buf output
for authored files. The older task's four-space JVM indentation refers to its
illustrative text; actual source uses Buf formatting, preserving JVM declaration
and comment ordering. Clarified the normative sentence rather than weakening
format gates or reformatting unrelated source. No schema behavior changed.

Facade slice preparation: dispatch the existing implementer context with its
explicit gpt-6-sol/medium profile for packages/ai and public Agent Proto contracts.
Its writing scope excludes server, proto-tools, existing adapter source and the
foundation fixtures. Coordinate global generation/build commands after the
foundation writer finishes. First deliver immutable model/MCP registrations,
registry selection, SDK-free contracts and descriptor-backed validation with
focused tests; server execution and provider transports remain later slices.
Configured role metadata is available; runtime model introspection is not.

Foundation review wave planned after its cheap checks: existing
style_maintainability_reviewer, typescript_api_docs_reviewer and
performance_reliability_reviewer each explicitly gpt-6-sol/medium;
documentation_reviewer explicitly gpt-6-luna/medium. Fresh contexts receive only
the relevant foundation requirements and changed paths, with no session memory.
All four concerns apply to this public family/routing addition. Security remains
the final release-readiness concern. Review the foundation diff against
0e16da19a; exclude concurrent isolated facade/Proto additions. Collect the whole
wave before returning one correction batch to the existing foundation writer.

Foundation preflight: 9 suites/529 tests pass; generated build, tooling types,
scoped ESLint, cleanup, TSDoc, documentation, format, Proto lint/current output
and diff checks pass. Parent independently reran Agent BlackBox and scoped query
tests (2 suites/6 tests): pass. Focused coverage of large existing files does not
meet whole-file thresholds (89.78% statements, 83.35% branches); changed executable
lines are 23/24 and their branches 30/32. The unmatched location is the preserved
PM query branch and V8 lacks source attribution for compiled BlackBox handoff.
Do not call this a passing full coverage gate. Final verify:release retains the
global thresholds. The foundation is frozen for scoped review; facade work may
now use shared generation/build outputs. Its draft copyright finding was fixed
and copyright passes.

Foundation review wave received from all four explicitly configured roles; no
runtime profile introspection is exposed. Confirmed findings: duplicate guard
accepts Agent without the event history needed for persistence; public repository
TSDoc omits Agent; shared diagnostic text names Process Manager for Agent;
generated fixture selects a positional registry entry; docs conflate Entity and
database transaction wording, expose development-slice language, and omit a small
Agent declaration/registration example. Return this complete batch to the same
foundation implementer. The interim shared-PM guard prerequisite must not become
a switch to disable the mandatory Agent histories in the final feature.

While corrections and the isolated facade continue, dispatch a read-only storage
test/integration scan as an orchestrator function, explicit gpt-6-luna/medium.
Map existing provider extension points, conformance fixtures and local commands
for the already frozen history/execution design. No new architecture, production
edits, provider services or subprocess tests; do not repeat the completed design.

Storage scan accepted from the explicit Luna/medium function (configured metadata
verified; runtime introspection unavailable). Use the existing published
storage/provider subpath, four factory registration points, separate conformance
fixture and native Datastore query/index path. MySQL's shared coordinator already
has requireTransaction for rejecting nontransactional participation; conditional
Agent completion must use it. No provider services or tests were run by this scan.

Foundation correction preflight: reconstructed-repository guard regression
demonstrated red then green; generated-context Agent registration is now exercised
through BlackBox. All 576 tests in 10 affected suites and the affected server/build
fixture typecheck pass. Scoped format, lint, docs snippets/audience/API and diff
checks pass. Global cleanup/TSDoc reports only in-progress facade paths. Parent
verified corrected constructor/diagnostic wording and receiver-based fixture
selection directly. Follow up only substantive reliability and new documentation
content with the same explicitly configured Sol/medium and Luna/medium reviewers;
no repeat architecture or complete four-lane wave for deterministic wording fixes.

Foundation accepted: focused reliability follow-up closed the persistence finding
using two distinct repositories/contexts over one storage factory. Documentation
follow-up closed all three findings. Parent reran 7 Agent BlackBox/query tests and
the reconstructed-repository regression: pass. Type/API wording, shared error text
and receiver-based discovery corrections were verified directly. All four review
concerns are closed for this slice; full feature/release coverage remains pending.
Commit/push this checkpoint, then continue shared/memory Agent history storage
with the same explicit Sol/medium implementation context. Facade validation is an
independent active slice; its draft coverage and mechanics are not yet accepted.

Foundation checkpoint 260135e9e pushed to official origin/agent-entities. Next
bounded storage packet stays in packages/storage only: provider port, complete
ordering key, memory indexes and reusable provider conformance. Dispatch the same
existing implementer with its explicit gpt-6-sol/medium profile; no child agents.
Facade implementer retains all ai/public Proto edits. Public history/content
message shapes are generated and settled; import them through proto/agent.
Persistent adapters follow review of this shared contract/memory slice. Do not
claim Agent invocation/history integration before the later server binding exists.

Independent transport slice: existing implementer role, explicit gpt-6-sol/medium,
for new internal bounded-fetch modules/tests in ai-vercel-ax only. This implements
the already accepted pre-parser transport decision; it does not change the facade,
public connection contract, existing Ax proof or other writers' files. No new
dependencies or shared build changes. Parent coordinates builds and keeps the
facade implementer responsible for later adapter integration. This independent
bounded stream uses the available fourth execution slot.

Transport preflight: two new private adapter files, 22 focused tests pass;
coverage 98.22% statements, 92.07% branches, 93.1% functions, 100% lines. Scoped
types, ESLint and formatting pass; concurrent facade/storage cleanup diagnostics
are outside this frozen packet. Review with the existing reliability and style
roles, each explicitly gpt-6-sol/medium in fresh contexts. Public TypeScript/API
review is N/A here because no public export, factory or declaration boundary
changes; documentation review is N/A because no user-facing prose changes and
internal TSDoc is in the style scope. Security remains final release-readiness.
No durable/runtime integration claim is made by the controlled callback tests.

Transport review wave complete: both explicitly configured Sol/medium reviewers
returned confirmed findings. Configured profiles verified; runtime introspection
unavailable. Combined corrections: forbid zero output credit dispatch; cancel
pending body materialization; snapshot approved URL and accepted scalar ticket
values; classify internal failures by private type/code, sanitize external errors,
and preserve cancellation versus deadline through streams; reschedule timer
chunks for deadlines beyond Node's timer range. Parent independently reproduced
mutable-ticket credit bypass and long-deadline immediate cancellation. Return the
complete batch to the same implementation context; focused regressions and scoped
checks precede substantive reliability/style follow-up. Work continues.

Facade preflight received: 31 tests pass, focused coverage 95.78/90.63/96.62/97.12.
Types, lint, cleanup, TSDoc, copyright, format and Buf pass; parent diff/status
check found and removed three filler adjectives and roadmap wording before
review. Review wave uses existing TypeScript/API, reliability and style roles
explicitly gpt-6-sol/medium, documentation explicitly gpt-6-luna/medium, fresh
contexts without memory. All four concerns apply to these public contracts,
validation and user prose. Review only ai/public Proto changes against 260135e9e;
exclude transport/storage. Final security remains at full integration.

Shared/memory history preflight received: 6 suites/60 tests, new-source coverage
97.48/90.83/100/98.98; storage/tooling types, lint/format and deterministic docs
checks pass. Review existing reliability, style and TypeScript/API roles explicitly
gpt-6-sol/medium; documentation role explicitly gpt-6-luna/medium, fresh contexts
without memory. All four apply to provider contracts, persistence and changed
README/reference claims. Scope packages/storage only against 260135e9e; public
Proto dependencies are facade review scope. Persistent adapters/server binding
remain later work. Final security review stays at release readiness.

Transport correction preflight received: 34 focused and 69 combined bridge/guard
tests pass; coverage97.02/92.45/94.28/98.3; types/lint/format/cleanup/TSDoc pass.
All accepted findings have targeted regressions, including mutable ticket credit
and timer overflow. Follow up substantive reliability and style concerns with
the same explicitly configured Sol/medium reviewers, then parent reruns focused
checks before checkpointing. No public adapter/runtime integration claim.

### Accepted transport, facade and memory history

Transport reliability and style follow-ups closed all accepted findings. The
parent reran 69 bridge/guard tests and adapter package types successfully.
Checkpoint `2fb9959d8` was pushed to official `origin/agent-entities`. Production
connection installation and durable callbacks remain integration work.

The complete facade/history review wave used the configured TypeScript/API,
reliability, style and documentation roles with explicit model and reasoning
fields. Runtime introspection was unavailable. Findings went back to the existing
implementers as complete batches.

Facade corrections cover exact singular/repeated 64-bit and wrapper admission,
integer schema types, frozen model defaults, unsupported-output checks in both
modes, recursive-schema diagnostics, domain-correct application fixtures and
public TSDoc. Root scalar wrappers fail before dispatch; nested wrappers and
Empty output are covered. Substantive follow-ups closed the contract findings;
the parent checked the last fixture/comment corrections and reran all 38 tests
and the package build successfully. Focused coverage is 95.75% statements,
90.64% branches, 96.77% functions and 97.00% lines. Tooling types, lint, cleanup,
TSDoc, copyright and formatting checks passed. Documentation describes the facade
boundary accurately; complete runtime documentation follows integration.

History corrections cover complete UTF-8/prefix and Timestamp-edge ordering
through pagination, exact content for all categories and filtered identity checks.
The reliability follow-up closed the substantive findings. The parent reran all
60 tests and inspected the content assertions and capability wording. Focused
coverage is 97.75% statements, 92.48% branches, 100% functions and 99.1% lines;
types, lint, formatting, cleanup and TSDoc passed. The alleged missing provider
exports were rejected and the reviewer corrected the report. The unrelated-data
test demonstrates scoping, not an index; source review confirms memory indexes.
Sorted-array insertion remains an in-process provider characteristic. Public
Protos and shared/memory history were pushed as checkpoint `f798e7666`.

### Release inventory and persistent history

The release inventory includes 21 public packages and 29 manifest paths. The
trial diagnostic derives its package count from the inventory. Exact tests and
the trusted-publisher list include both AI packages; no publication behavior,
versions, credentials or workflows changed. The parent reran 96 tests
successfully. The independent reliability review, explicitly Sol/medium, found
no defects in paths, names, dependency order or the documentation list. Style
is N/A for mechanical list/count edits; TypeScript/API is N/A for no signature
changes, with facade contracts reviewed separately. Documentation counts were
compared directly. Final security review remains at feature readiness. Commit
this packet with the facade so every inventory entry has a package.

Persistent history is assigned to the existing implementer, explicitly
Sol/medium, with no subagents. Scope: shared record layout and PostgreSQL,
MySQL and Datastore implementations, indexes, conformance and narrow docs.
Estimated duration is 1.5–3 hours including live tests and review corrections.
Disposable local PostgreSQL, MySQL and Datastore emulator services are running.
No server, AI or physical-deletion changes belong to this packet.

AgentHistoryEntry lacks the Agent scope needed by RecordSpec. The approved
internal AgentHistoryRecord wrapper stores canonical state type and Agent key
alongside the original entry. Category, conversation and ordering columns derive
from that entry. A constant agent_history storage group permits declared
Datastore indexes. Reuse provider record lifecycle and immutable-write seams.
A fixed-width scope digest may be physical index metadata only: retain exact
scope predicates and original values, reject conflicting immutable IDs, and
never allocate a history position. Any provider key-length limit must follow
its actual index capacity, without truncation or prefix-order scans. The writer
must establish that the concrete schema supports the complete ordering index.

Facade/release checkpoint `62c281d08` pushed to official origin. Continue with the
same adapter implementer, explicitly configured `gpt-6-sol` / `medium`; original
dispatch fields were explicit and runtime introspection remains unavailable.
Packet: production generation/decision integration in ai-vercel-ax, with narrow
AI adapter SPI changes coordinated before coding. No server/storage edits,
subagents, commits or pushes. First return the concrete request/budget/tool SPI
outline; implement after the parent checks its fit with durable runtime work.

Dispatch server history binding to the existing implementer role with explicit
`gpt-6-sol` / `medium`, fresh context and no subagents. Scope is server history
methods, cursor binding, repository integration and BlackBox fixtures/tests;
provider contracts are already accepted. The persistent provider writer and
adapter writer have disjoint production paths. The server writer must coordinate
Proto generation and shared builds. Estimate 1–2 hours including focused checks;
durable completion integration remains a subsequent slice.

The parent coordinated direct server→ai and adapter→ai/core/proto/protobuf
manifest dependencies and TS project references. Install succeeded with existing
release-age policy. A fresh package/artifact/release-policy run passed 86 tests
across five files. PostgreSQL, MySQL and Datastore live history conformance and
reopening checks passed in implementation; edge cases and mechanical preflight
continue before independent review. No full release-readiness claim.

Adapter SPI coordination preserves one runtime-assigned attempt ticket per
physical request. Journal actual rendered content before dispatch, reserve full
response credit durably, tally received bytes synchronously, then await a fenced
journal/admission barrier. Unknown receipt/usage stays distinct from zero.
Connection creates an inert request gate, not a charged model attempt. Runtime
selects tool policy and assigns call identity; definitive Proto/application
admission stays in the runtime callback, including decision mapping.

Parent micro integration adds AI TypeDoc entry points, audience/snippet inventories
and exact provider-export expectations. The provider inventory test passes. The
expanded onboarding test correctly reports missing AI package install/first-use
content; production adapter documentation will supply that before acceptance.
No checker is disabled. Final TypeDoc declaration inventories wait for the
completed public runtime surface.

Both full and production dependency audits passed before provider-fixture packages
were added. The parent then installed OpenAI 4.0.84 and OpenRouter 3.1.0 as adapter
dev dependencies for actual constructor tests. Registry metadata confirms OpenAI
4.0.84 meets the 24-hour release-age policy and uses provider 4.0.22. No policy
exception or paid request is involved; repeat audits after dependencies converge.

A demonstrated serialized-contract gap requires one narrow architecture follow-up:
GenerationResponse cannot represent requested tool calls before a final answer,
and the outcome enum has no nonterminal tool-request result. Dispatch the existing
requirements_splitter role explicitly as gpt-6-astra/high, fresh context, read-only
and no subagents. Scope is only this material response/audit contract correction
and safe diagnostic allocation; do not reopen the frozen implementation design.

The narrow architecture follow-up is accepted. Parent verified explicit
requirements_splitter gpt-6-astra/high dispatch and configured-role evidence;
actual runtime metadata is not exposed. Add AI_OUTCOME_TOOL_REQUESTED=6 and
ordered ModelToolCall proposals on GenerationResponse. These preserve raw provider
correlation/name/argument text, including rejected proposals, separately from
validated authorized ToolRequest. Finish the physical attempt before any tool
execution; this outcome never admits application output or terminates the logical
operation. Reject it in decision/tool/operation-failure contexts. Include proposal
metadata in byte accounting and response digest.

AiToolInvocation carries the requesting ticket. Runtime verifies the recorded
proposal and persists its association to a runtime tool-call ID before dispatch;
reject duplicate/forged correlation and reuse the association during recovery.
The SPI recordFailure callback records a fenced safe diagnostic only, without
terminalizing the operation, finishing an attempt or releasing reservations.
Diagnostics precede attempt completion; terminal operation recording stays in
the runtime. The same adapter implementer (explicit Sol/medium) implements this
small public Proto/SPI correction and its deterministic tests, then resumes the
production packet. Parent coordinates generation with the other writers.

Server history preflight is ready: build, BlackBox typecheck, 331 focused server
checks, seven compiled BlackBox checks and scoped mechanics pass. Binder coverage
is 95.06% statements, 91.25% branches, 100% functions and 98.68% lines. The complete
review wave will cover reliability, public TypeScript contracts, maintainability
and documentation, using existing roles with explicit Sol/medium or Luna/medium
as applicable. First reliability assignment: gpt-6-sol/medium, fresh context,
read-only, no subagents. Collect the wave before returning fixes to the existing
server implementer. Durable source dedup, saved-read integration and atomic final
completion remain explicit subsequent work, not claims of this history slice.

Server reliability review returned one cursor-allocation bound finding and a
continuing-page journal replay test gap. Await the full concern wave before fixes.
Next server TypeScript/API review: existing role, explicit gpt-6-sol/medium,
fresh context, read-only/no subagents. Review only the history public/test seams
and changed declarations; production durable execution remains separately pending.

Persistent history preflight frozen: 13 live provider tests and nine helper/CI
inventory tests pass; affected storage build, scoped lint/format and Proto checks
pass. Five new production modules have 97.97% statement, 92.75% branch, 100%
function and 99.55% line coverage; each exceeds 90% branches. Canonical global
cleanup/TSDoc residuals belong only to concurrent AI/adapter work. Minimal docs
were added in touched Datastore factory declarations; two documented generic
callback interfaces have local prefer-function-type exceptions after reproducing
the conflicting alias checks. No global rule change.

Persistent-history review wave covers relevant reliability, TypeScript/provider
contracts, maintainability and documentation. First reliability dispatch is the
existing reviewer role, explicit gpt-6-sol/medium, fresh read-only context and no
subagents. Review only this provider slice and its integration test inventory;
collect the whole wave before returning findings to its existing implementer.

Server TypeScript/API review returned no confirmed blocking findings; explicit
Sol/medium role and runtime metadata limitation recorded. Continue server style
review with existing style_maintainability_reviewer, explicit Sol/medium, fresh
read-only context and no subagents. Parent reran 14 storage-helper/CI-inventory/API
inventory tests successfully; live persistent rerun is underway.

Server style review returned duplicate testing access and stale audit-method
TSDoc findings. Persistent reliability returned unusable PostgreSQL index-state
admission and closed-factory handle creation findings. Parent will assess the
complete waves before fixes. Explicit configured Sol/medium profiles verified;
actual runtime metadata unavailable. Next independent assignments: documentation
reviewer gpt-6-luna/medium for server history claims, and TypeScript/API reviewer
gpt-6-sol/medium for persistent provider contracts. Both fresh/read-only, no
subagents. Parent independently reran all 13 live history and 338 server/BlackBox
tests successfully; those passes do not dismiss review findings.

Server history complete review wave accepted under explicit configured profiles;
runtime introspection remains unavailable. Return one correction batch to the
same Sol/medium implementer: bound cursor parsing before allocation using valid
scope/key constraints; test nonempty saved-page continuation without a live read;
keep only standalone readAgentHistory testing access; document required Agent
audit append; explain independent count/byte page ceilings. Estimated 0.5–1 hour
including focused checks and substantive reliability follow-up. Parent verifies
deterministic API/comment edits; no repeated complete wave for those corrections.

Persistent TypeScript/API review is clean, configured Sol/medium verified. Next
style and documentation concerns use existing roles explicitly Sol/medium and
Luna/medium, fresh read-only contexts and no subagents. Collect those results with
the existing reliability findings before returning one provider correction batch.

Parent prepares the already planned testing→ai dependency/reference for the
scripted backend. Decision audit review found provider rounding absent from saved
responses: the adapter writer will preserve a documented DecisionRounding message
with wrapper-presence precision counts on DecisionResponse; zero and missing stay
distinct. This completes recorded-result semantics without changing admission.
Parent coordinates generation; no SDK type enters the public facade.

Parent package preflight found one stale exact boundary inventory (37 other
checks passed). Add ai/ai-vercel-ax and the accepted adapter/runtime SPI subpaths;
preserve exact inventory and cycle enforcement. No rule relaxation.

Persistent provider complete wave accepted: TypeScript and documentation clean;
reliability requires PostgreSQL valid/ready index state and closed-factory
rejection; style requires one MySQL key-capacity declaration and table-scoped
full native-index assertions. Return this combined batch to the same Sol/medium
implementer, with regression/live checks and substantive reliability follow-up.
Explicit dispatch profiles verified; runtime introspection unavailable. Estimate
0.5–1 hour for corrections and validation; no new architecture.

Parent package-boundary correction rerun passed all 38 checks. Shared Proto
generation initially stopped at authored-source checksum validation; update the
specific approved content.proto entry before regeneration, without changing
upstream provenance or suppressing the gate.

Server correction preflight passes 332 focused tests, seven BlackBox tests,
build/typecheck and scoped mechanics; binder coverage 95.45/91.66/100/98.78.
Focused reliability follow-up uses same existing reviewer, explicit configured
Sol/medium, to close cursor-bound/replay findings. Parent checks removed duplicate
export and corrected documentation directly. Storage lifecycle regression was
reproduced red then green in all three providers; remaining corrections continue.

Parent API comparison requires the production adapter retain approved public
capabilities option and VercelAx/VercelDecision.capabilities namespace, rather than
unrequested profile/profiles names. Internal profile types may remain descriptive.

Server reliability follow-up closed both findings. Parent direct source check
found the audit TSDoc correction attached to the Aggregate method instead of the
Agent/PM method; moved that comment to the correct method and restored Aggregate
wording. This is documentation-only, with no runtime change or new review wave.

Server history accepted: parent reran all 339 focused server/BlackBox checks;
format/diff checks pass and follow-up reliability is closed. Verification skill
read; checkpoint only server history plus its exact ai dependency/lock entry.
The full Agent feature remains in progress.
