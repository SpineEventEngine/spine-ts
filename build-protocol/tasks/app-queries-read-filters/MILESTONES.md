# App Queries and read-side filters: implementation slices

Status: architecture decomposition complete; M01–M03 accepted. M04 is next.
Slice acceptance remains tracked in implementation logs.

This is the single frozen-wave architecture pass for the approved
[proposal](PROPOSAL.md), against `3135caaa202cdc2de71d249f2859cc4c4329b8c3`.
The proposal and [task ledger](TASK.md) remain authoritative. This sequence
does not reopen their design or replace their detailed acceptance matrix.

Assignment: existing requirements splitter, explicitly dispatched
`gpt-6-astra` / `high`. Actual runtime model metadata is not exposed to this
agent; the configured role and dispatch record are the available evidence.
Only this file was written. No production changes, commits, remote changes,
or descendant agents were made by this assignment.

## Execution and acceptance rules

The overall task is high-risk: public and serialized contracts, shared
generation, authentication, and asynchronous subscription behavior change.
Use one existing implementer, explicitly `gpt-6-sol` / `medium`, for the
sequential slices below. Keep that context for bounded corrections. Runtime,
core, generation, and build files overlap too extensively for parallel writers.
The orchestrator handles records, integration, and prompt authorized pushes;
independent read-only mechanical checks and focused reviews may run concurrently.

Each slice is a reviewable checkpoint, not permission to omit later slices.
Keep narrow TSDoc, affected assertions, and directly broken consumers current
with their change. Defer broad guides and all-example execution to M14.
Use meaningful generated Commands, Events, states, Query/Response pairs, and
distinct identifier messages in fixtures. No authored Proto uses `optional`.

Before each review: focused behavior tests, changed-file formatting,
`git diff --check`, applicable generated-source checks, tooling/affected-package
typechecking, deterministic docs/status checks, and changed-production coverage
inspection must pass. Preserve the runtime coverage threshold of at least 90%.
Run direct `pnpm exec vitest run <paths>` against prepared generated output in
inner loops; regenerate/build only when needed. Do not invoke
`verify:release` as a diagnostic loop or once per slice. The task uses one
release profile after convergence. A genuinely independent bounded checkpoint
may use `pnpm verify:task -- --coverage <tests> --source <sources>` after its
cheap preflight; the tool still classifies the entire accumulated change set.

Record all four canonical review dispositions per accepted milestone. Invoke
only relevant existing concerns: style/maintainability for production
structure, TypeScript/API for contracts and generated declarations,
performance/reliability for runtime/lifecycle/isolation, and documentation for
changed public claims. Collect the complete relevant wave before one correction
batch. Deterministic corrections do not reopen a lane. Final security review is
the existing Sol/high release-readiness gate, after the integrated behavior is
ready. Do not introduce another architecture pass for ordinary failures.

## Existing components to extend

| Concern              | Current integration point and consequence                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic validation   | `packages/core/src/index.ts`: `Validate.message/check`, `GeneratedDescriptors.current()`, registered Proto modules, `TypeRegistry`, and `AnyPacker`. Reuse the shared inventory and existing validation dependency. The dependency's public `validate(schema, message)` has no registry argument; its nested Any catch currently skips malformed bytes.                                         |
| Query execution      | `packages/server/src/services/spine-services.ts` contains target/criteria/tenant checks; `services/query-reader.ts` delegates normalized plans to `stand/stand.ts`. `entity/entity.ts` already binds `EntityQueryDescription` to actor/tenant, and `services/registered-targets.ts` supplies Server-wide destinations. Reuse these semantics instead of adding a query engine.                  |
| Metadata             | `packages/proto-tools/src/generation/{build-time-handler-analyzer,generated-registry-writer,handler-codegen,generator}.ts`, `scripts/{proto-workflow,generate-handler-registry}.mjs`, and `packages/server/src/handler/{generated-handler-registry,generated-registry-discovery}.ts`. Preserve staged generation and metadata validation; change how passive descriptions are located/composed. |
| Model packages       | `packages/proto-tools/src/model/model-graph.ts`, existing `ProtoGeneration.generate/compose`, and generated `proto-module.ts` already compose schemas and register descriptors. Extend those mechanisms; retain useful explicit registry construction.                                                                                                                                          |
| BC assembly          | `packages/server/src/context/bounded-context.ts` currently loads a compiled per-BC registry root before generated repository assembly. Replace that lookup with exact-constructor passive metadata while preserving registered class/instance selection and consistency checks.                                                                                                                 |
| Trust and forwarding | `packages/auth/src/{request,gateway,native,subscriptions}/`, Server browser adapters, and `server/node-coordinator.ts` currently know Read but do not carry verified provider facts to app-node reads. Existing public-admission pseudo-principals are not authenticated principals.                                                                                                            |
| Subscriptions        | `services/spine-services.ts` currently collapses missing/expired and duplicate-active paths to no attachment. `stand/subscription-runtime.ts`, `stand/subscription-observer.ts`, registry providers, managed child fan-out, and the web client's `TopicSubscription` already supply lifecycle/queue/recovery machinery. Extend these instead of adding a delivered-ID ledger.                   |
| History              | `entity/entity.ts` history bindings, `repository/repository.ts` public history reads, and `agent/agent-history.ts` return read views. Persistence hydration uses related lower-level storage paths; filtering storage providers indiscriminately would corrupt reconstruction semantics.                                                                                                        |

Source guardrail: inspected the relevant sections of `TECHNICAL_SPEC.md`,
`DEVELOPER_API.md`, `BUILD_PROTOCOL.md`, and the current completion-plan entry;
searched the query/subscription and validation JVM research notes; read current
JVM snapshot `f2926a58` sections in `QueryService.java`,
`stand/RequestValidator.java`, `commandbus/CommandValidator.java`, and
`stand/Stand.java`. Read the supplied `current-jvm-inputs.md` and TS validation
evidence at `/Users/armiol/.codex/analysis/application-queries-20261030/validation-ts.md`
(the assignment's `priorvalidation-ts.md` name was not present). These confirm
validation-before-read, Command Ack separation, and lifecycle validation;
the proposal explicitly settles TS's improved status mapping.

## M01 — Repair shared validation, shipping the repair to consumers

**Depends on:** nothing. **Class:** high-risk shared validation contract.
**Responsible implementer:** the single runtime implementer. This is the first
actionable bounded assignment.

**Paths:** `packages/core/src/index.ts` and, if separation improves that module,
a small internal validation module under `packages/core/src/`; core validation
tests, domain Proto fixtures, and their tracked generation manifests. Inspect
`packages/proto/proto/spine/client/filters.proto` and its source proof, then
report the safe declaration-migration path before editing those pinned files;
the orchestrator can assign that bounded follow-through with M03.

**Change:** retain the pinned general constraint validator and adapt its shared
core integration for registry-aware annotated Any validation and required
collection members. Reuse registered Proto descriptors. Follow `(validate)`
edges only, keep `(required)` separate, preserve root/path diagnostics, and
avoid duplicate reports for types already in descriptor dependencies.
Malformed bytes for a known Any type must produce invalid-input details;
unknown Any types retain the declared model's permitted behavior. Configuration
or validator execution exceptions remain technical failures, never synthetic
constraint violations. Establish the safe migration for `TargetFilters`'
deprecated `required_field` declaration; preserve its either/or meaning and
semantic checks under the source-provenance gate below.

**Acceptance/tests:** extend
`packages/core/test/validation-facade-boundary.test.ts` and add a generated
domain-fixture matrix for direct/repeated/map/oneof values, annotated and
unannotated edges, application-only Any types, malformed-known Any, permitted
unknown Any, nonempty collections containing missing-valued members, technical
failure classification, path preservation, and existing sanitization. Preserve
ordinary state/transition constraint behavior. Prove the fix in an installed
packed-core consumer outside the workspace, using the normal published
dependency graph. A workspace-only `pnpm patch` is not a shippable fix: consumers
would install the unpatched dependency. No external validation-repository edit
or publication is authorized. Any dependency change must pass the same packed
consumer proof; do not invent an App Query validator or duplicate constraint
engine.

**Gate/risk:** core focused tests and generated Proto checks, then relevant API,
style, and reliability review. Characterize and correct the dependency seam
within this slice; escalate only an evidenced inability to ship the approved
generic behavior. Excludes service status migration and App Query APIs.

## M02 — Command and Event admission contracts

**Depends on:** M01. **Class:** high-risk signal semantics.
**Paths:** `packages/server/src/bus/{command-bus,command-errors,event-bus}.ts`,
`services/spine-services.ts`, and affected existing bus/service tests.

Validate Command envelope requirements and nonempty `CommandId.uuid` before
every dispatcher, including custom ones; retain payload validation and explicit
default-route ID rules. Do not invent UUID-format or blanket CommandContext
recursion rules. Use enum-qualified `INVALID_COMMAND` type/code and packed
validation details in the existing error Ack. Preserve unsupported-command,
domain-rejection, tenant, and technical-error distinctions. Validate internal
Event envelope and payload before acceptance, persistence, or delivery, keeping
the existing internal error contract and no public Event RPC.

**Acceptance/tests:** direct service and bus calls bypass builders; malformed
envelope/domain payload never invokes dispatcher, `onAdmit`, or delivery;
custom routing cannot bypass envelope validation; valid Commands/Events still
execute; state-transition and rejection behavior stays intact. Technical
validator faults use the existing technical signal failure path, not an
invalid-command diagnosis. Gate focused bus/service tests and API/reliability/
style review. Excludes Query RPC conversion.

## M03 — Read and subscription admission/status parity

**Depends on:** M01. **Class:** high-risk transport compatibility.
**Paths:** `packages/server/src/services/spine-services.ts`,
`context/tenant-unknown-error.ts` as an existing structured-error pattern,
auth native/gateway error forwarding, coordinator forwarding, and existing
native/browser service and client tests.

Validate complete detached Query, Topic, and Activate/Cancel Subscription
messages before reading or mutating lifecycle state. Preserve criteria, target,
field/type/order/limit and tenant checks. Return structured `INVALID_ARGUMENT`
with `INVALID_QUERY`, `UNSUPPORTED_QUERY_TARGET`, `INVALID_TOPIC`,
`UNSUPPORTED_TOPIC_TARGET`, or `INVALID_SUBSCRIPTION` as applicable. Encode a
Spine Error with enum-qualified type, numeric code, message, and packed
ValidationError where constraints failed. Preserve both native
`spine-error-bin` and Connect details through forwarding/client boundaries.
Unexpected read/validator faults become sanitized INTERNAL; recognized statuses
retain their meaning. Valid empty reads stay successful empty lists.

**Acceptance/tests:** direct malformed requests prove zero reads/registry
mutations; semantic failures and unsupported targets use the error channel;
unknown tenant/auth/decode-size failures retain distinct statuses. Native and
browser error round trips preserve type/code/details without technical secrets.
Update current callers/fixtures that expect in-response query failures or omit
declared actor/timestamp/format fields. Complete the approved `TargetFilters`
declaration migration if not already assigned after M01's provenance report.
Gate focused service/transport suites,
API and reliability reviews. Excludes unknown-ID activation behavior, which
gets an isolated lifecycle change next.

## M04 — Unknown activation and bounded client recovery

**Depends on:** M03. **Class:** high-risk lifecycle/idempotency.
**Paths:** `services/spine-services.ts`, `stand/subscription-runtime.ts` only as
needed, `server/managed-child-subscription.ts`,
`packages/client-web/src/client/client.ts`, and corresponding native, managed,
registry, browser, and client lifecycle tests.

Return NOT_FOUND with `SubscriptionValidationError.UNKNOWN_SUBSCRIPTION` for
well-formed unknown/expired activation. Preserve duplicate-active behavior and
successful idempotent unknown cancellation. Classify the structured reason in
the existing bounded resubscription flow, obtain a fresh server-issued ID, run
Entity authoritative recovery, and signal Event gaps without replay.

**Acceptance/tests:** separate missing fields, unknown, expired, already active,
cancelled, unauthorized, and tenant-unknown cases. No retry for arbitrary
NOT_FOUND, invalid input, or denied access; cancellation stops in-flight
recovery; exhausted attempts expose terminal error. Test registry expiry and
fan-out child behavior, not only mocks. Gate focused lifecycle tests and
reliability/API review; later trust and filter slices extend these same tests.

## M05 — Passive local metadata and filename migration

**Depends on:** M01–M04 only for sequential writer discipline; no query-runtime
dependency. **Class:** high-risk generated/public assembly contract.
**Paths:** existing proto-tools analyzer/writer/codegen/generator modules,
`scripts/proto-workflow.mjs`, `scripts/generate-handler-registry.mjs`,
`scripts/check-generated-clean.mjs`, server handler metadata/discovery and BC
builder, package exports, current example startup files, container output
lists, and affected generated-registry tests.

Emit `generated/spine-metadata.ts` and a local `generated/spine-bootstrap.ts`
through the ordinary generation path. Metadata describes model schemas and
class-keyed Entity/standalone declarations; bootstrap installs descriptions,
never instances or active routes. Preserve current ingestor checks and use
registered Proto modules for model metadata. BC assembly resolves only
explicitly added classes/instances from that inventory. Remove
`withGeneratedRegistryRoot` and migrate its current consumers in this slice;
do not introduce a replacement Server root setting. Regeneration removes the
old generated file, including staged/publication and container paths.

**Acceptance/tests:** local BC construction works after bootstrap without a
Server; omitted bootstrap/missing class/stale/malformed metadata fails before
assembly with useful class/package diagnostics; importing metadata does not
construct handlers. Explicit useful registries still work. Single-package
generation and current example startup compile. Gate writer/analyzer/codegen/
BC tests, generated cleanliness, and API/style/reliability review. Narrow
migration notes land with the removal; broad docs wait for M14.

## M06 — Runtime dependency discovery and published bootstrap

**Depends on:** M05. **Class:** high-risk packaging/build graph.
**Paths:** proto-tools `generation/generator.ts`, `handler-codegen.ts`,
`model/model-graph.ts` and a bounded build-time discovery module if needed;
existing CLI flow, package manifests/exports/sideEffects configuration,
proto-tools external-consumer tests, and package artifact checks.

Walk declared runtime dependencies transitively through normal package
resolution, inspect the conventional `./spine` export without executing
modules, and emit static imports plus local metadata in the same generation
procedure. Each participating package contributes its local output; never
re-analyze dependency sources/declarations. Resolve workspace dependencies in
build order and preserve supported package-resolution behavior. Deduplicate a
diamond by resolved package identity; conflicting definitions/descriptions
must identify both packages, including conflicting installed versions.
Reject declaration/bootstrap/application-entrypoint cycles that prevent usable
initialization. No runtime cwd or node_modules discovery.

**Acceptance/tests:** model-only packages, no-local-handler app, dependency
handlers with BC builders in app, one BC spanning two packages, transitive and
diamond layouts, nonparticipant dependency, missing published export/file,
conflict/stale metadata, and initialization-cycle diagnostics. Pack/install
fixtures and bundle an app; bootstrap registration survives tree shaking.
Test shipped JS and declarations rather than workspace source aliases alone.
Gate focused tooling/package checks and API/style/reliability review.

## M07 — App Query declarations and generated associations

**Depends on:** M05–M06. **Class:** high-risk serialized/generated contract.
**Paths:** new `packages/proto/proto/spine/client/app_query.proto`, existing
`query_service.proto`, `packages/proto/src/client/index.ts`, Proto source
manifest; existing proto-tools Proto and TS analysis stages; core public
`AppQueryResponses` declaration; minimal server `AppQueryHandler` and context
contract modules under `packages/server/src/` and server exports.

Add the approved AppQuery/AppQueryResponse envelopes and QueryService.Execute.
Discover nested Query/Response pairs only in `_queries.proto`; generate grouped
type/schema aliases and automatic augmentation keyed by Q's literal type name.
Include these schemas in general registries. Analyze real generated types in
`AppQueryHandler<Q,R>` subclasses, including grouped aliases and imports, and
emit exact-constructor descriptions referencing the paired schemas. Keep
client model association modules free of handler or Server imports.

**Acceptance/tests:** accepted pair and class, wrong Q/R pairing, missing pair,
ambiguous/generated-type provenance, neutral message misuse, and separate
browser/Node compilation. Several implementation classes for one pair are
valid metadata. Grouped aliases refer to the same actual schemas/messages.
Generated declarations expose augmentation automatically; no marker option,
annotation, Definition object, or second generation command. Test analyzer,
writer, package consumer, and Proto manifests; gate API/style review. Existing
service implementations compile with Execute explicitly unavailable until M09,
without accidentally dispatching unregistered handlers.

## M08 — Trusted reader context through existing ports

**Depends on:** M03–M04, M07. **Class:** high-risk authentication/context.
**Paths:** `packages/auth/src/{request,gateway,native,subscriptions}/`,
`packages/server/src/browser/`, `server/{server,node-coordinator,managed-child-subscription}.ts`,
service request context plumbing, and existing auth/forwarding tests.

Extend replaceable authentication/forwarding ports to carry verified principal
and authority facts over the authenticated internal connection for Read,
Execute, and subscription admission/activation. Public ingress rejects or
strips forwarded-identity copies. Only a configured trusted forwarding peer can
supply the internal envelope. Direct native authentication establishes context
through its configured adapter; public access has no authenticated principal.
Never forward provider credentials or promote the public-admission marker.
Bind subscription reader identity/context to admitted records and check the
verified reader again on activation/reconnect/cancellation where applicable.

**Acceptance/tests:** authenticated gateway and direct native paths, absent
principal, forged internal metadata/ActorContext/Q claims, changed reader using
another subscription ID, concurrent users, managed child forwarding, and
reconnect. Ports are replaceable; provider facts are detached and no provider
liveness guarantee is implied. Bound forwarded envelope sizes using existing
transport limits. Gate auth/native/browser/coordinator tests and API/reliability
review; final dedicated security review remains M14.

## M09 — Server App Query execution and internal invocation

**Depends on:** M01, M03, M07–M08. **Class:** high-risk dispatch/domain contract.
**Paths:** server App Query handler/context modules, `server/server.ts`,
`services/{spine-services,registered-targets,query-reader}.ts`, and existing
Entity/Agent query-capability binding seams only where required.

Server accepts explicit handler instances, resolves class metadata before
listening, and creates a Server-local Q type URL dispatch table. Duplicate Q on one
Server fails; distinct Servers can choose different classes. Both Execute and
`server.query(query, executionContext)` capture a detached request, validate
envelope/root Q and declared nested constraints, check support/tenant/authority,
then call the handler once. Expose `context.select(description).read()` through
existing normalized Entity reads bound to trusted actor/tenant. Supply the
capability to Entity/Agent code by explicit Server-bound injection using current
execution context, never ServerEnvironment lookup.

**Acceptance/tests:** wrong/missing class metadata fails before listener open;
passive unregistered classes are not callable; invalid/undecodable/unsupported
Q invokes no handler or read; caller mutation during awaits cannot replace the
validated request. One R is type/serialization checked and returned; wrong R
and technical faults are failures, not empty success. Internal errors are
structured local failures; cancellation and recognized tenant/auth errors
preserve meaning. Handler source reads use existing target limits and routes.
No active App Query registrations in BC or ServerEnvironment. Gate direct
execution and Server lifecycle tests plus API/style/reliability review.

## M10 — Execute transport and typed client closure

**Depends on:** M09. **Class:** high-risk external API/forwarding.
**Paths:** `packages/client-web/src/client/client.ts`, client-web exports,
`packages/client-node/src/{client/node-client,index}.ts`, auth native/gateway
operation tables, `server/node-coordinator.ts`, process/browser adapters,
`server/reserved-spine-rpc-paths.json`, and relevant transport/client tests.

Complete Execute forwarding across each existing topology; execution occurs on
app nodes after authentication. Add `ClientRequest.query(Q)` using generated
Q-to-R typing, preserving Response and a readonly decoded R array. Enforce zero
or one payload and the registered R type before decoding. Keep Entity `.send`
behavior and its new RPC error contract. Direct internal calls bypass only the
Server gRPC output-filter boundary, not input validation or BC child reads.

**Acceptance/tests:** browser, native Node, gateway, coordinator, and managed app
node success/error paths; no handler/filter execution at gateway. Separate
packed Node/browser consumers infer R without server imports; unassociated Q
fails typechecking, wrong R/count fails at runtime. Auth/status details survive
all hops. Gate focused clients/transports and consumer declarations plus
API/reliability review.

## M11 — Typed filter execution over detached message trees

**Depends on:** M01, M08–M09. **Class:** high-risk new read-side contract.
**Paths:** a small `packages/server/src/stand/read-side-filter.ts` (public base
and context) plus an internal traversal module if warranted, server exports,
and focused domain-fixture tests.

Implement schema-typed `ReadSideFilter` and ReadSideContext. Index exact
registered type URLs, including prefixes. Capture operation, actor/effective
tenant, verified principal/authority facts, cancellation, producing BC when
present, and parent/field information. Process matching filters in registration
order, then deterministic children of the surviving replacement. Default is
roots only; `{ nested: true }` traverses intermediates, lists/maps/oneofs, and
registry-decoded Any. Each callback gets a detached mutable message and a
detached read-only parent snapshot. Null removes that occurrence with the
container-specific behavior from the proposal; it does not prune the parent.

**Acceptance/tests:** root opt-in distinctions; parent-first replacement with
new children; deterministic ordering; singular/list/map/oneof/Any removal;
registered prefix preservation; isolation from source and retained returned
objects across later filters and consumers; same-type enforcement; bounded
depth/work and cycles/unserializable replacement rejection; cancellation;
unknown/undecodable nested Any errors when inspection is required. Never
revalidate outgoing state constraints or fall back to unfiltered data. Gate
focused filter tests, API/style/reliability review. Excludes storage mutation,
field-mask policy, and automatic value-copy tracking.

## M12 — Filter read boundaries and retained history

**Depends on:** M09–M11. **Class:** high-risk read/persistence separation.
**Paths:** BC builder and Stand, `services/{query-reader,spine-services}.ts`,
server App Query output path, `entity/entity.ts`, `repository/repository.ts`,
`agent/agent-history.ts`, and existing Stand/Entity/Agent history tests.

Install BC filters before BC readiness and Server filters before listening.
Apply BC filters once at each public/internal BC read boundary and Server
filters once when Entity or App Query domain output leaves its gRPC services.
Carry child read and enclosing AppQuery together. Do not infer a BC for final
R or rerun BC policies on a Server replacement. Audit all read façades, including
direct Stand reads and retained Entity/Agent state/Event history. Filter history
items without changing original cursor/continuation; do not filter internal
hydration/restoration/replay or persistence maintenance.

**Acceptance/tests:** BC-only, Server-only, both, repeated same-instance
installation, two BCs and two Servers; App Query source reads versus final R;
direct server.query excludes Server filters; Entity null removes a result,
whole R null yields zero entries, empty R remains one. Public history pages may
be empty with an unchanged continuation. Stored state, Event history used by
runtime, hydration, and caller-retained objects stay unchanged. Test async
concurrent contexts and failures. Gate read/history suites and
API/style/reliability review.

## M13 — Filter Entity and Event subscription deliveries

**Depends on:** M04, M08, M11–M12. **Class:** high-risk concurrency/lifecycle.
**Paths:** `stand/{stand,subscription-runtime,subscription-observer}.ts`,
`services/spine-services.ts`, managed-child/coordinator/browser delivery seams,
and native/client/BC subscription tests.

Evaluate original Topic matching first, BC filters next, Server filters at
gRPC output. Preserve original Entity ID/version independently of mutable
state; root null emits existing `no_longer_matching`, and prior removal notices
pass through. Filter Event domain payloads as roots, repack into the original
envelope, retain ID/delivery metadata, suppress only that consumer's null
Events, and omit all-removed data batches without losing control signals.
Preserve each grouped Event child's BC/context. Use existing bounded queues
with serialized per-consumer async filter work; cancellation prevents later
delivery, and filter errors terminate the affected stream.

**Acceptance/tests:** two consumers with fresh distinct Topics receive isolated
views; ID edits still remove original identity; nested edits deliver state;
stored/dispatched Events remain original; BC+Server order and each boundary's
single application hold. Slow async filters preserve order and bounded work;
cancel races stop delivery; errors never reveal unfiltered values. Re-run
unknown activation recovery: Entity authoritative results are filtered and
Events report gaps without invented replay. Test native/browser/fan-out paths
and control acknowledgements. Gate subscription and recovery suites plus
API/style/reliability review.

## M14 — Consumer examples, migration, and release readiness

**Depends on:** all prior slices. **Class:** high-risk integrated release.
**Paths:** current example startup and model package manifests (including
Message Board); a small multipackage example under `examples/` with model and
handler dependencies; `docs/USER_GUIDE.md`, relevant package README/REFERENCE,
example guides, `build-protocol/{TECHNICAL_SPEC,DEVELOPER_API}.md`, API snippets,
package/build/container checks, and existing task records.

Demonstrate the approved handler/filter APIs, internal execution, trusted
context, and migration from registry roots and in-response Query errors.
Compile single-package, split model/app, dependency-handler/app-builder, and
one-BC/multiple-package arrangements. Include generated Q/R browser-only imports
and a packed/bundled app proof. Update current governing claims without
rewriting historical completed-task evidence. Keep all generated artifacts
ignored; examples must use real domain fixtures and no authored optional Proto.

**Acceptance/gates:** deterministic docs/snippets/export/API-prohibition and
generated checks, all affected examples, package consumers, required coverage,
and complete specialist dispositions. Aggregate the final integration findings,
resolve accepted defects, then run final security review. Run the mandatory
cheap preflight before one `pnpm verify:release` after convergence; reuse
prepared build/generation evidence instead of duplicate full runs. Any new
behavior change after this gate requires its focused checks and risk-based
verification disposition.

Before review readiness, select an unused common workspace version and create
the required version-only commit with exactly `Bump version -> <version>`;
manifest top-level versions only. Put dependency pins/lockfile changes in a
separate commit. The authorized orchestrator promptly pushes feature commits
to official origin, including checkpoints/corrections; no PR, master write,
merge, force push, or shared-ref deletion is authorized.

`.github/workflows/build.yml` currently triggers only on pull requests to
master. A branch push alone cannot produce that Build/trial-publication result.
Record final-SHA CI results that actually exist and this explicit operational
limitation; do not create a PR, alter workflow triggers, or claim Build CI passed
to remove it. Local completion evidence and remote branch readiness remain
reportable with that limitation.

## Cross-slice risks and exclusions

- The validator repair must reach installed consumers, including application
  schemas registered after core initialization. Workspace-only patches or
  parallel validator registries fail acceptance.
- Metadata imports must not start applications; browser model imports must not
  pull handler classes, Server code, or bootstrap registration into clients.
  Package identity, constructor identity, and Proto conflict diagnostics are
  distinct checks.
- Existing direct/history APIs share storage with persistence internals. Capture
  their read boundary precisely; do not redact storage and accidentally alter
  restoration, transactions, or domain Event dispatch.
- Trusted identity is separate from ActorContext. Capture it per invocation
  and per subscription; no mutable current-user field or process-wide active
  handler/policy registry.
- Filter failures are technical failures; removals are successful filtered
  results. Preserve this distinction for empty lists, history continuation,
  Entity removals, and Event suppression.
- Required context enforcement will reveal old minimal fixtures. Correct those
  fixtures and clients; do not weaken Proto rules or reuse unrelated messages.
- No new query engine, generic context hierarchy, AppQueryDefinition, marker
  option, annotations, server-environment query registration, runtime filesystem
  scan, client global cache, delivered-ID ledger, Event replay, automatic
  masking/redaction convention, output-state validation, or provider polling.

No product or architectural blocker was demonstrated during this decomposition.
The dependency integration and forwarding changes are implementation risks with
specific proofs above, not reasons to pause the approved work.

### Pinned Proto source gate

`filters.proto` and `query_service.proto` currently appear in `sources` in
`packages/proto/proto/spine-sources.json` with upstream revision and checksum.
`scripts/verify-proto-sources.mjs` currently accepts copied-source or locally
authored-source entries, without an explicit local-override form. Do not simply
replace a copied-source checksum while continuing to claim untouched upstream
bytes. Record the approved local adaptation with original upstream provenance
and digest, local digest, and the narrowly authorized delta; extend the verifier
and its tests only as needed to represent and enforce that distinction. Do not
move unrelated copied contracts or weaken their checks.

Before changing frozen descriptor compatibility expectations under
`compatibility-tests/jvm/`, prove that the `TargetFilters` delta changes only
the deprecated constraint option to its supported equivalent, preserving every
existing field number/type and either/or semantics. Prove separately that the
QueryService delta adds Execute and its new message closure while preserving
Read and all existing signatures. Keep the original JVM baseline, explicitly
account for these approved TS extensions, and retain detection of unrelated
descriptor changes. New `app_query.proto` has local-source provenance.
An equivalent shared-adapter treatment of the legacy constraint can support an
intermediate checkpoint if necessary, but must be recorded as such; it does not
silently replace the approved final declaration migration.
