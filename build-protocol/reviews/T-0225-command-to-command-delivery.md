# T-0225 Command-to-Command Delivery Review

## Architecture checkpoint

The first GREEN attempt exposed same-runtime Command Bus reentrancy when a
command-input `@Command` handler posts its transformed Command after committing
the current Entity transaction.

The existing `requirements_splitter` role is assigned a read-only architecture
checkpoint covering the smallest compatible follow-up enqueue seam, transaction
ordering, failure behavior, Inbox/retry semantics, causal metadata, and JVM
command-substitution parity. Expected model `gpt-5.6-sol` and expected reasoning
`high` are explicit in the dispatch. The role must not edit files or spawn
subagents.

The checkpoint accepted the existing package-owned path:
`runtimeAccess.enqueueFollowUp()` through
`commandBusAccess.postInternalFollowUp()`. Child envelopes are derived and
packed inside the Entity transaction, Entity state commits, and the returned
detached Inbox callback enqueues the children. The active Command Bus item must
not await a same-runtime child.

The callback must invoke child posts in declaration order, collect every
completion, then await them together. Sequential await would stop sibling
admission after the first failure; discarded promises would create unhandled
rejections. Existing Inbox containment and diagnostics remain authoritative.

The checkpoint also established these mandatory corrections:

- Command substitution produces one or more Commands. JVM
  `CommandSubstituter.fromEmpty()` and the current TS analyzer both reject zero
  output, so task acceptance criterion 4 must be corrected rather than widening
  the public contract.
- A serialized `command-transformation` kind cannot be added under registry
  version 3. The format must advance atomically or avoid a serialized-shape
  change.
- Public assignment lookup must not silently change meaning; transformation
  lookup needs a clearly named receptor seam or a preserved assignment-only API.
- Remove heuristic or unused event-input classification.
- Prove duplicate/mixed receptors, event/rejection regression, true public
  client posting, ordered fan-out, failure observation, metadata lineage,
  immediate close/drain, and durable source-row retry behavior.
- The post-commit in-process callback is best-effort, not an atomic outbox. T-0225
  must not claim durable exactly-once delivery across a process crash between
  commit and enqueue.

Runtime self-introspection will be recorded when exposed. Otherwise, the
immutable configured role/profile and explicit dispatch fields are the accepted
metadata evidence.

## Implementation continuity

The original implementation owner completed and pushed the runtime, reference,
Aggregate, and rollback increments, then exhausted its execution window while
scoping the remaining metadata fixture. It left no uncommitted production or
test changes.

A replacement existing `implementer` role owns the remaining focused tests,
corrections, documentation reconciliation, and implementation records. Expected
model `gpt-5.6-terra` and expected reasoning `medium` are explicit in the
dispatch. The replacement must not spawn subagents. The original owner is idle,
so production ownership does not overlap.

## Canonical review dispositions

- Correctness/compatibility: pending after mechanical convergence.
- Style/maintainability: pending after mechanical convergence.
- TypeScript/API documentation: pending after mechanical convergence.
- Performance/reliability: pending after mechanical convergence.
- Reader documentation: pending after mechanical convergence.
- Security: N/A as a separate lane because this correction adds no credential,
  authorization, or external trust boundary. Remote rejection behavior remains
  a correctness concern.

## 2026-09-08 contract-layer task review

The corrected registry/analyzer slice spans `32b93582e..5e55ca68d`. The
existing `typescript_api_docs_reviewer` performs the task-scoped specification
and code-quality gate because this slice changes the generated TypeScript/SPI
contract. Expected profile is explicitly dispatched as `gpt-5.6-terra` with
high reasoning. The reviewer is read-only, must not spawn subagents, and reads
the prepared brief, implementation report, and frozen review package. Runtime
assembly and reader documentation are outside this checkpoint. Actual runtime
metadata will be recorded when exposed; otherwise the immutable configured
profile and explicit dispatch fields are the acceptance evidence.

The reviewer completed with the explicitly dispatched existing role and
`gpt-5.6-terra` / high profile. Separate runtime self-introspection was not
exposed and no fallback was visible. The task quality verdict is **Needs
fixes**. The complete accepted batch is:

1. Remove `BuildHandlerAnalysis.entities`, require the Entity
   `receiverKind`, and remove the writer fallback from `entities`; the contract
   must have no pre-receiver compatibility path.
2. Validate malformed receiver and handler record structure before any
   dereference, always reporting `HandlerRegistryIngestionError` rather than a
   raw `TypeError`.
3. Introduce a neutral standalone receiver constructor/prototype type instead
   of falsely typing standalone classes as `EntityClass`.
4. Add writer render/typecheck coverage for named and anonymous default
   receivers.
5. Correct changed narrow TSDoc from Entity-only wording to receiver wording.
6. Replace remaining changed-path command-transformation wording with command
   substitution.

No Critical finding was reported. The first three findings are Important; the
last three are Minor but are included in the same correction batch.

The 2026-09-08 contract re-review confirms every Important finding and four
Minor findings closed. Two Minor corrections remain in this contract gate:

1. Replace two shared generated-handler TSDoc references to “Entity” with
   receiver-neutral wording.
2. Remove an obsolete `entities` property and `as never` suppression from the
   writer's no-follow output test; pass the receiver analysis directly.

The final narrow re-review approved both corrections at `5d3daa068` with no
Critical, Important, or Minor finding. The generated contract task is closed.

## 2026-09-08 standalone runtime assignment

The replacement existing `implementer` role retains exclusive production
responsibility for standalone runtime materialization, Bounded Context
registration/assembly, produced-signal publication, System Event state
subscriptions, focused tests, and narrow records. Its immutable and explicitly
selected profile is `gpt-5.6-terra` with medium reasoning. It must use TDD,
must not spawn subagents, and must not commit scratch artifacts. This is the
second bounded task; it receives an independent task review before black-box
and documentation closure.

The runtime implementer mapped nine repository propagation/failure call sites
and found that current Bounded Context close ordering shuts buses before the
proposed publisher could drain. Its remaining execution window ended before
code mutation. This is a demonstrated lifecycle blocker, so the existing
`requirements_splitter` role receives one read-only architecture checkpoint.
Expected and explicitly dispatched profile: `gpt-5.6-sol`, high reasoning. It
must freeze the publisher interface, construction point, close order, stored
Entity-event distinction, and safe call-site migration; it must not edit files
or spawn subagents. A fresh existing implementer receives production
responsibility afterward without overlap.

The architecture checkpoint completed with the explicitly dispatched existing
role and `gpt-5.6-sol` / high profile. Runtime self-introspection was not
exposed and no fallback was visible. It froze one context-scoped internal
`SignalPublisher`, an explicit stored-event redispatch path, trusted cross-bus
follow-up admission while closing, reverse-order assembly rollback, and a
fixed-point drain before bus destruction. It mapped all repository callback
categories and found no remaining human decision. The full blueprint is copied
into the runtime task brief. Repeating this architecture pass is unnecessary
unless implementation reveals a materially different contract conflict.

A fresh existing `implementer` role receives exclusive production
responsibility for the publisher/repository/context lifecycle migration.
Expected and explicitly dispatched profile: `gpt-5.6-terra`, medium reasoning.
It must not spawn subagents or commit scratch artifacts. Standalone adapter
materialization follows after this migration passes its focused task review.

The publisher migration reached an uncommitted implementation with focused
publisher, CommandBus abort, close-drain, server typecheck, and diff evidence.
The broader suites then exposed invalid legacy test fixtures: one
repository-routing handler and six bounded-context generated groups plus three
helpers use Entity state schemas as Command inputs. Validation was not weakened.
The runtime implementer's execution window ended, so the intact working tree
transfers without overlap to a fresh existing `implementer` role. Expected and
explicitly dispatched profile remains `gpt-5.6-terra`, medium reasoning. The
replacement must finish domain-correct fixtures, run the complete focused gate,
and commit the publisher migration only after GREEN.

The replacement completed the frozen lifecycle migration and pushed commit
`f524b67db`. The independent lifecycle task review is assigned to the existing
`performance_reliability_reviewer` role. The expected model is explicitly
`gpt-5.6-terra` and the expected reasoning is explicitly `high`. The reviewer
is read-only, must not spawn subagents, and reviews the frozen range
`5d3daa068..f524b67db` against the lifecycle blueprint and code-quality rules.
Standalone handler adapters remain outside this review. Runtime
self-introspection will be recorded if exposed; otherwise the immutable role
profile and explicit dispatch fields are the accepted metadata evidence.

The reviewer completed with the explicitly dispatched existing role and
`gpt-5.6-terra` / high profile. Separate runtime self-introspection was not
exposed and no fallback was visible. Verdict: **Needs fixes**. There is one
Important finding and no Critical or Minor findings: add direct regression
coverage for publisher drain and rejection after finish, and for trusted
cross-runtime follow-up admission during close while public intake rejects.
The reviewer found no implementation defect; the missing proof is the complete
accepted correction batch. Its narrow Process Manager ordering/failure
diagnostic passed 2 tests.

The correction commit `0c8dff589` adds the two missing lifecycle regressions.
Both tests were GREEN against the existing production behavior, so no runtime
code changed. Focused Command Bus, runtime, and Bounded Context tests passed 102
cases; server typecheck, focused lint and formatting, and diff checks passed.
The same independent `performance_reliability_reviewer` re-reviews only this
accepted finding across `5d3daa068..0c8dff589`, again with explicitly selected
`gpt-5.6-terra` and high reasoning, read-only and without subagents.

The lifecycle re-review verdict is **Approved**. The reviewer confirmed that
the tests directly prove close-time internal admission and drain, observed
post-finish rejection without an unhandled rejection, and trusted
cross-runtime admission while public target intake rejects. No remaining or
new Critical, Important, or Minor finding was reported. The SignalPublisher
lifecycle migration is closed; standalone adapter materialization may begin.

A fresh existing `implementer` role now receives exclusive production
responsibility for standalone handler instance matching, bus adapters, runtime
invocation and output validation, state subscription routing, context assembly,
and focused proof. The model is explicitly `gpt-5.6-terra` and reasoning is
explicitly `medium`. The implementer must follow the frozen runtime brief, use
TDD and domain-correct fixtures, keep Bounded Context thin, and must not spawn
subagents. Runtime self-introspection will be recorded if exposed; otherwise
the immutable configured role/profile and explicit dispatch fields are the
accepted metadata evidence.

The first standalone implementer left an uncommitted compiling draft and
explicitly rejected it as a checkpoint because the focused standalone behavior
matrix was absent. Existing Bounded Context tests passed 68 cases, and server
typecheck plus narrow lint, format, and diff checks passed. The implementer's
execution window ended with no committed production work. A fresh existing
`implementer` role therefore receives the intact working tree without overlap,
with the same exclusive responsibility and explicit `gpt-5.6-terra` / medium
profile. It must add the required TDD matrix, correct defects exposed by those
tests, and commit only a behavior-proven slice. It must not spawn subagents.

That continuation added the first focused standalone test and exposed a real
selection defect: a matching `@Where` method and its fallback both ran. The
draft now delegates selection to the existing event-handler filter. Duplicate
instance registrations also remain observable until assembly validation. The
focused runtime/context tests passed 69 cases and static checks passed, but the
role matrix was still incomplete, so nothing was committed. The same explicit
`implementer` role and `gpt-5.6-terra` / medium profile continues without
overlap on a smaller checkpoint: assembly validation, all four role paths,
method arities, output validation, and duplicate command receptors. State and
close-chain edge cases follow after that checkpoint. It must not spawn
subagents.

The standalone core checkpoint is pushed as `3342a1e4e`. It covers exact
constructor matching, duplicate instance and mixed raw/generated command
receptor rejection, all four public registration paths, two-argument
Reactor/Subscriber invocation, `@Where` selection, output normalization,
declared-schema checks, and empty-result rules. Focused runtime/context tests
passed 74 cases; server typecheck and narrow lint, format, and diff checks
passed. The same explicit implementer/profile continues without overlap on the
remaining external/rejection, System Event state, produced-signal, and close
drain behavior before independent task review.

The next pass found that the state adapter discarded a subscriber's illegal
return value instead of applying the common output contract. The uncommitted
draft now validates that result, and the existing focused 74 tests and static
checks remain green. The implementer's execution window ended before the
required state, external/rejection, produced-chain, and close-drain tests. A
fresh existing `implementer` role receives the intact tree without overlap for
that final behavior tranche, again with explicit `gpt-5.6-terra` / medium
dispatch and no subagents.

The state-output correction was pushed as `1d707badf`. The expanded runtime
matrix was pushed as `2703ed167`, covering external `@Where`, exact state
matching and mismatch, output normalization and errors, both arities, arrays,
and receiver failures. Focused runtime/context tests passed 84 cases, while
`standalone-handler-runtime.ts` reached 96.70% statement, 90% branch, and 100%
function/line coverage. The implementer's next execution window ended before
the remaining rejection and context-level publication/close cases, with no new
changes. A fresh existing `implementer` role receives exclusive responsibility
for those last integration cases, explicitly dispatched as `gpt-5.6-terra` /
medium with no subagents and no production overlap.

The final integration commit `8a5da6938` adds rejection routing for Commander,
Reactor, and Subscriber; context-local Command-to-Command and Event-to-Event
delivery; contained produced-command failure with later sibling delivery; and
immediate-close drain. Focused suites passed 88 cases. Server, generated-build,
and tooling typechecks; fixture reproducibility; scoped lint and formatting;
and diff checks passed. Standalone runtime coverage reached 96.70% statements,
91.42% branches, and 100% functions/lines.

The standalone runtime task review freezes `1bacc57e2..8a5da6938` after a
lightweight pre-review scan. The scan found no accidental public export or
active compatibility claim; obsolete version and transformation wording is
confined to clearly historical records. Two relevant existing reviewers run as
one task wave: `style_maintainability_reviewer` for module depth, OOP shape,
public registration documentation, and test maintainability; and
`performance_reliability_reviewer` for routing, publication, lifecycle, and
failure correctness. Both are explicitly dispatched with `gpt-5.6-terra` and
high reasoning, read-only, without subagents. Findings are collected before a
single correction batch.

Both reviewers completed with the explicitly dispatched existing roles and
`gpt-5.6-terra` / high profiles. Separate runtime self-introspection was not
exposed and no fallback was visible. Both verdicts are **Needs fixes**. No
Critical finding was reported. The deduplicated accepted batch is:

1. Important: partition standalone Event filter plans and dispatch by both
   schema and exact domestic/external origin; prove both directions for the
   same schema.
2. Important: include the generated standalone Event dispatcher when deriving
   Integration Broker external interests; add context-level imported-event
   proof.
3. Important: construct the existing defaulted, isolated Command/Event handler
   context for two-argument standalone methods instead of passing the optional
   envelope context by reference; prove absent context and mutation isolation.
4. Important: reject duplicate standalone command receptors by input type,
   including Assignee/Commander mixtures, before bus intake.
5. Important: replace standalone tests that use the wrong nominal role or treat
   Event messages as produced Commands with semantic role-specific fixtures.
6. Minor: expand public TSDoc for `addCommandDispatcher`,
   `addEventDispatcher`, and `addAssignee` to explain standalone registration,
   `buildAsync()` metadata requirements, parameters, and return behavior.

The reviewers found no additional defect in close drain, contained publication,
state isolation, output validation, or valid source metadata. They also found
the runtime module cohesive and the added Bounded Context wiring acceptably
bounded. All six findings are in scope and accepted as one correction batch.

Correction commit `9ae8faaa7` implements the six review items and its focused
runtime/context tests pass 88 cases. The orchestrator's mechanical acceptance
then rejected the handoff: server typecheck, focused lint/format, fixture, and
diff checks pass, but `pnpm typecheck:tooling` reports current T-0225 test debt.
Failures include removed failure APIs, versioned `entities` registries, removed
`commandTransformations` and `command-transformation` names, widened receiver
discriminants, semantically wrong message initializers, abstract nominal-base
construction, and a new rejection-helper constructor type error. These are not
baseline exclusions. The correction context must update all affected tests to
the current contract and make the blocked external-interest proof executable
before re-review; production compatibility shims are prohibited.

The correction context reproduced the tooling failure and locally fixed the
standalone rejection constructor type, two fixture initializer schemas, and a
missing `EventContext` import, but its execution window ended before the broad
test migration and no commit was made. A fresh existing `implementer` receives
the intact tree without overlap and exclusive responsibility for every current
tooling diagnostic. Its explicit profile is `gpt-5.6-terra` / medium, it must
not spawn subagents, and it must update tests to the current contract rather
than restoring removed production compatibility.

Commit `74fa2d5bf` completes the correction's test-contract migration. Generated
build and tooling typechecks pass; 248 migrated tests and 197 focused
server/external-interest/lifecycle tests pass; fixture reproducibility, scoped
lint and formatting, and diff checks pass. A combined 13-file process showed a
close-test timeout cascade, while its isolated server rerun passed 150 tests;
this is recorded as test-process interference rather than a product failure.

The same two reviewers re-review only their accepted findings against the full
corrected range `1bacc57e2..74fa2d5bf`. Both retain their explicitly selected
existing roles and `gpt-5.6-terra` / high profiles, remain read-only, and must
not spawn subagents. They must verify the semantic fixture migration and the
external-interest proof as part of closure and report any remaining or newly
introduced finding.

Both narrow re-reviews completed with the expected explicit profiles and
returned **Needs fixes**, with no Critical finding. The final targeted batch is:

1. Important: define both domestic and external Event schema sets through the
   existing origin-schema facility; otherwise a schema shared by both origins
   is removed from domestic routing before the runtime filter runs.
2. Important: prove a single runtime with domestic and external handlers for
   the same schema invokes only the matching side for each envelope.
3. Important: add executable Bounded Context/Integration Broker proof that a
   standalone external schema appears in `ExternalEventsWanted` and imported
   delivery reaches the handler.
4. Important: add the required Assignee/Commander same-Command generated
   receptor rejection test.
5. Important: replace remaining runtime fixtures whose nominal role or signal
   kind could not be admitted by generated registry validation.
6. Minor: prove default context creation and mutation isolation for both a
   two-argument Command handler and Event handler.
7. Minor: state in `addCommandDispatcher()` TSDoc that an
   `AbstractCommander` installs its Command and Event sides exactly once.

The re-review found no new problem in broker assembly code, cloned-context
construction, module boundaries, or OOP shape. A fresh existing `implementer`
receives this single batch with exclusive responsibility, explicit
`gpt-5.6-terra` / medium dispatch, and no subagents.

Commit `dda81fa9d` implements all seven targeted corrections. Focused
runtime/context/Integration Broker tests pass 104 cases; tooling and generated
build typechecks, generated-output checks, TSDoc, formatting, and diff checks
pass. Standalone runtime coverage is 97.95% statements, 93.42% branches, and
100% functions/lines. The scoped coverage process fails only the unrelated
repository-wide aggregate threshold. `docs:api:check` still names three removed
T-0225 exports (`CommandTransformationHandlerMetadata`,
`DispatchErrorSnapshot`, and `StoredEventDispatchFailure`); this remains an
active documentation/contract cleanup item, not baseline debt.

The same two independent reviewers receive one final narrow verification of
their seven findings against `1bacc57e2..dda81fa9d`, with their existing
explicit `gpt-5.6-terra` / high profiles, read-only and without subagents.

The correctness/reliability re-review approved the final behavior correction
with no remaining or new finding. The style/maintainability re-review found one
remaining Important proof defect: the Integration Broker test manually creates
the standalone runtime and registers a raw dispatcher, so it bypasses the
generated `buildAsync()` assembly path and cannot prove the corrected
`standaloneEvent` interest collection. Replace that test with a generated
registry-root context using a concrete `AbstractEventSubscriber` registered
through `addEventDispatcher()`, and prove both `ExternalEventsWanted` and
imported delivery. Every other targeted finding is closed.

Commit `ccf1c6133` replaces the bypassing proof with a temporary generated
registry root, a concrete `AbstractEventSubscriber` registered through
`addEventDispatcher()`, and `buildAsync()`. It verifies the external interest
and imported invocation. Focused Integration Broker and Bounded Context tests
pass 92 cases; tooling/generated typechecks, generated-output, TSDoc,
formatting, and diff checks pass. Full-file lint still reports 25 stale
`as never` assertions outside this narrow correction; they remain an active
branch-wide preflight item. The style reviewer receives one final read-only
verification of this single finding with its existing explicit
`gpt-5.6-terra` / high profile and no subagents.

The final style re-review verdict is **Approved**. It confirmed generated
registry discovery, public subscriber registration, `buildAsync()` assembly,
external-interest publication, and imported delivery to the registered
instance. No remaining or new Critical, Important, or Minor finding exists in
the standalone runtime task. This reviewed slice is closed.

The final convergence task is assigned to a fresh existing `implementer` role
with exclusive responsibility for public black-box flow proof, current
documentation/API expectations, canonical terminology, CommandBus/public
TSDoc, and the measured changed-file lint failures. Expected model is explicitly
`gpt-5.6-terra` and reasoning is explicitly `medium`; it must not spawn
subagents. The standalone runtime contract is closed and must not be redesigned.
The task must make `docs:api:check`, full changed-file lint, typechecks,
generated checks, TSDoc/docs checks, focused behavior tests, and coverage green
before the complete specialist review wave.

Checkpoint `95328b745` makes API-doc checking, full changed-file ESLint,
tooling typecheck, formatting, diff checks, 137 focused public-flow tests, and
standalone runtime coverage green. The orchestrator rejected convergence
because `pnpm lint:tsdoc` reports 93 current T-0225 documentation defects across
the generated registry contracts, Bounded Context constructor,
`SignalPublisher`, `StandaloneHandlerRuntime`, and nominal bases. A fresh
existing `implementer` receives exclusive comment/API-documentation correction
responsibility with explicit `gpt-5.6-terra` / medium dispatch and no
subagents. It must fix every diagnostic, verify CommandBus documentation, and
must not suppress the checker or reduce its scope.

Commit `1e2a515a7` corrects all 93 TSDoc diagnostics. `lint:tsdoc`, API and
audience documentation, generated snippets, generated build and tooling/server
typechecks, changed-file lint/formatting, generated Proto checks, current
terminology scan, and diff checks pass. CommandBus and all changed public APIs
have current documentation. Implementation is mechanically converged.

The canonical cheap preflight is assigned as a read-only orchestrator
verification function. Expected model is explicitly `gpt-5.6-luna` and
reasoning is explicitly `medium` because the command spans multiple packages
and requires failure classification. It must not edit files or spawn subagents.
It runs `verify:task -- --no-coverage` across the focused analyzer, registry,
readiness, bus/runtime, context, repository, Integration Broker, and black-box
flow suites before the complete specialist wave.

The preflight function completed with the explicit Luna/medium profile; runtime
self-introspection was not exposed and no fallback was visible. It exited 2
before tests after the Proto/generation gates passed. Tooling TypeScript found
25 T-0225 errors in `integration-broker.test.ts`: broker dispatcher test doubles
return `readonly unknown[]` from `messageSchemas()` instead of
`readonly MessageSchema[]`. Generation left the tree clean. This is an active
fixture typing defect, not baseline debt. The existing final-convergence
`implementer` receives the single correction with its explicit
`gpt-5.6-terra` / medium profile and no subagents; it must type the helpers
correctly rather than restore unnecessary casts.

Commit `92e6660bf` gives the Integration Broker test doubles precise schema
types. Tooling typecheck, full-file lint, all 14 Integration Broker tests,
formatting, and diff checks pass. The same read-only preflight function reruns
the identical canonical command with its explicit `gpt-5.6-luna` / medium
profile and no subagents.

The second preflight cleared TypeScript and stopped before tests on four
T-0225 cleanup findings: overlong lines in `bounded-context.ts` and
`generated-handler-registry.ts`, plus the five-component names
`catchUpErrorMessageLimit` and `assertUniqueStandaloneCommandReceptors`.
Generation remained clean. The same final-convergence implementer receives
these four mechanical production corrections with its explicit
`gpt-5.6-terra` / medium profile and no subagents; behavior must not change.

Commit `d2b923638` resolves all four cleanup findings. Cleanup lint,
tooling/server typechecks, 92 focused context/registry tests, changed-file lint,
formatting, and diff checks pass. The same read-only Luna/medium verification
function reruns the identical canonical preflight.

The third preflight cleared TypeScript, cleanup, and TSDoc, then stopped before
tests on copyright enforcement. Four new handler-registry Proto fixtures lack
the CodeMatters header, and `generated-handler-registry.test.ts` has incorrect
header blank-line spacing. Generation remained clean. The same
final-convergence implementer receives this exact five-file mechanical fix with
its explicit `gpt-5.6-terra` / medium profile and no subagents.

Commit `a34ebb50c` adds the four required Proto headers, corrects the test header
spacing, and updates the deterministic descriptor fixture required by the Proto
source change. Copyright, fixture reproducibility, 14 registry tests, focused
lint, formatting, and diff checks pass. The same read-only Luna/medium function
reruns the identical canonical preflight.

## Contract re-review minor disposition

Both Minor corrections are closed. Shared generated-handler analyzer and
handler-record TSDoc now describes receivers rather than Entities. The no-follow
writer test uses the current writer source and passes the receiver-only analysis
without an obsolete `entities` field or type suppression. Its RED reproduced the
stale package build's legacy dereference; the corrected focused command passed
89 tests, with both package typechecks, fixture `--check`, and diff validation.

## Contract-review correction disposition

All six accepted contract-review findings were corrected on the existing
implementation branch. `BuildHandlerAnalysis` and `GeneratedRegistryWriter`
now accept only discriminated `receivers`; Entity receivers require
`receiverKind: "entity"`. Generated registry ingestion checks malformed
receiver/handler shapes before dereference and reports only
`HandlerRegistryIngestionError` at that boundary. Standalone receiver metadata
uses a neutral prototype constructor type rather than `EntityClass`. Named and
anonymous default standalone receiver rendering and isolated typechecking are
covered. Narrow changed TSDoc now says receiver rather than Entity where the
contract is shared, and changed-path terminology uses command substitution.

Focused evidence: `pnpm exec vitest run packages/proto-tools/test/generated-registry-writer.test.ts packages/proto-tools/test/build-time-handler-analyzer.test.ts packages/server/test/handler/generated-handler-registry.test.ts` passed 89 tests; proto-tools/server typechecks, fixture `--check`, and `git diff --check` passed. Runtime assembly is outside this contract-only correction.

## Mechanical preflight assignment

The orchestrator-dispatched verification function will run the cheap static
gates, focused handler/repository/black-box suites, and source-scoped coverage
before specialist review. Expected model `gpt-5.6-luna` and expected reasoning
`medium` are explicit because selecting valid changed-source coverage from the
shared server module requires classification judgment. The function is
read-only, must not spawn subagents, and may not edit or commit files.

The preflight function completed with its explicit Luna/medium dispatch. Runtime
self-introspection was not exposed and no visible fallback occurred. Focused
behavior tests passed 435/435, but the preflight is not accepted yet:

- TypeScript compilation found nine readiness fixtures missing
  `commandTransformations` and two unsafe test dereferences.
- Formatting failed for eight files; ESLint reported nine errors; cleanup naming
  rejected `internalCommandFollowUpPosters`; TSDoc found incomplete public
  comments in handler metadata.
- Copyright, documentation audience, API docs, Proto lint/generated cleanliness,
  logging containment, production dependencies, and release readiness passed.
- Source-scoped coverage is above 90% for the registry writer, generated registry,
  handler metadata, and readiness metadata. Command Bus branch coverage,
  command readiness, repository, signal metadata, bounded-context wiring, and
  decorator coverage still need valid changed-line evidence or additional tests.

Proto generation changed six tracked random generation IDs under the orders,
projects, and todo examples. These are setup artifacts, not accepted task
changes, and must be restored before the corrected preflight.

## Corrected preflight

After correction, the canonical generated-state task preflight passed every
static, documentation, generated-output, and release-readiness gate. The
expanded focused run passed 574 tests with zero failures. Source-scoped evidence
covered the new transformation helpers and branches; the complete release gate
remains responsible for the repository-wide 90% threshold because shared
`repository.ts` and bounded-context files contain substantial unrelated runtime
code.

## Specialist review wave assignments

All reviews are read-only over
`origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede..bd0e66549b285207bd187193eac381b122809ed4`.
Reviewers must not edit files or spawn subagents. Actual runtime metadata will be
recorded if exposed; otherwise explicit dispatch fields and immutable role
profiles are the acceptance evidence.

- Correctness/compatibility verification function: command registration,
  execution, routing, JVM parity, registry v3/v4 compatibility, and behavior
  tests; model explicitly `gpt-5.6-terra`, reasoning explicitly `high`.
- Existing `style_maintainability_reviewer`: changed runtime, generator, and
  tests; immutable configured `gpt-5.6-terra`, reasoning `high`.
- Existing `performance_reliability_reviewer`: queueing, transaction boundary,
  failure observation, drain, retry, and bounded-resource behavior; immutable
  configured `gpt-5.6-terra`, reasoning `high`.
- Existing `typescript_api_docs_reviewer`: public decorator/metadata contracts,
  serialized registry version, declarations, and compatibility; immutable
  configured `gpt-5.6-terra`, reasoning `high`.
- Existing `documentation_reviewer`: reader-facing REFERENCE and architecture
  claims, especially best-effort post-commit semantics; immutable configured
  `gpt-5.6-luna`, reasoning `medium`.

The first documentation dispatch omitted the explicit tool fields despite
naming them in its prompt. It was interrupted before acceptance and replaced by
a fresh `documentation_reviewer` dispatch with explicit `gpt-5.6-luna` and
`medium` fields. No result from the invalid dispatch was used.

## Complete review wave findings

All five valid reviews completed. Runtime self-introspection was unavailable;
the explicit dispatches, immutable profiles, and absence of visible fallback are
the accepted metadata evidence. The complete accepted correction batch is:

1. Reject an empty normalized runtime transformation result before Aggregate or
   Process Manager persistence. Registry-declared emitted schemas do not prove
   that a handler's returned array is non-empty.
2. Replace the repository-routing test's cloned Entity-state descriptor with
   distinct domain-correct Command input and output messages.
3. Model generated registry v3/v4 as a version-discriminated TypeScript union so
   a v3 registry cannot type-check with a v4-only transformation record; retain
   runtime compatibility tests.
4. Export `CommandTransformationHandlerMetadata` from the supported server
   package root and cover the export.
5. Update public decorator TSDoc and the SPI reference's stale version-3 claim.
6. Preserve post-commit failure containment but report transformed-child failure
   through an existing bounded diagnostic/logging seam with useful source/child
   identity. Do not leave a silent catch, claim source-command failure
   propagation, or add an atomic-outbox promise.
7. Add direct Aggregate multi-child proof for FIFO sibling admission, rejection
   observation/diagnosis, committed source state, and immediate-close drain.
8. Correct reader/reference and work-log claims: transformation output is
   non-empty; accepted follow-ups drain on close; detached enqueue is in-process
   best-effort and can be lost in the commit-to-enqueue crash window; it is not
   atomic outbox or durable exactly-once delivery.

No separate security finding was raised. The task adds no new authentication,
authorization, credential, or external trust boundary; remote-input rejection
remains covered by correctness and public-service tests.

## Registry type correction checkpoint

The implementation owner found that statically coupling v3/v4 at the top level
also affects exported nested handler-group and input-record SPI types plus
context-discovery consumers. A partial top-level-only union would leave an
incoherent public contract.

The existing `requirements_splitter` architecture context is therefore assigned
a second read-only, bounded checkpoint to specify the smallest compatible nested
discriminated-union design and migration. Its original explicit
`gpt-5.6-sol`/high dispatch remains active and unchanged; it must not edit files
or spawn subagents. Runtime self-introspection remains unavailable with no
visible fallback.

## Correction and re-review state

The implementation owner corrected the complete accepted batch and the final
cheap preflight passed on `e25fb12ad`: the canonical generated-state task gate
with 17 focused paths completed successfully, followed by full ESLint, cleanup,
TSDoc, formatting, and diff checks. The worktree was clean and the branch matched
the official remote.

All five original concerns were substantively affected, so the same existing
review contexts are assigned bounded re-review over
`e37ec8a1fed84f11e0df07c78846d5607a698ede..e25fb12ad`. Their original explicit
profiles remain unchanged: correctness function, style/maintainability, and
performance/reliability use `gpt-5.6-terra`/high; TypeScript/API docs uses
`gpt-5.6-terra`/high; reader documentation uses `gpt-5.6-luna`/medium. All are
read-only and may not spawn subagents.

## Review convergence

- Correctness/compatibility: clean after empty runtime output was rejected
  before Aggregate and Process Manager persistence; 304 focused tests passed.
- Style/maintainability: clean after domain Command fixtures, discriminated
  registry types, and the package-root metadata export were corrected.
- TypeScript/API documentation: clean after SPI typing, generated writer,
  package exports, decorator TSDoc, registry docs, and API output converged; 322
  focused tests passed.
- Reader documentation: clean after one-or-more output, diagnosed containment,
  close drain, registry compatibility, and the post-commit best-effort crash
  window were documented.
- Performance/reliability: the first re-review found that a later lint edit had
  removed `async` from a Command Bus test callback, preventing that file from
  parsing. Commit `54def610e` restored the callback, reproduced the zero-test RED,
  and passed all 16 Command Bus tests plus 595 tests in the expanded focused
  matrix. The final bounded reliability re-review was clean.

All canonical review concerns now have a clean or justified N/A disposition.
No reviewer edited files or spawned subagents. Runtime self-introspection was
unavailable for every review; explicit dispatch fields, immutable profiles, and
the absence of visible fallback provide the accepted metadata evidence.

## Release disposition

The first `pnpm verify:release` run passed all 288 test files and 4,575 tests but
correctly failed the global branch threshold at 89.96% (13,173 / 14,642).
Behavioral boundary tests then covered closed and invalid internal Command Bus
follow-up access plus three non-authentic readiness shapes. This deterministic
test-only correction did not reopen a specialist concern.

After the bounded preflight passed 645 tests in 21 files, the corrective release
run passed all 288 test files and 4,576 tests. Global coverage passed at 93.29%
statements, 90.00% branches, 92.87% functions, and 94.45% lines. The accepted
branch is ready for human review and remains unmerged.

## Human-requested independent review reset

The human requested a new review that does not inherit implementation memory.
The fixed comparison is
`origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede...8cef080b21358d6eb9ed488a098fdeabfbd788d7`.
Every reviewer is dispatched with `fork_turns="none"`, must read the repository
instructions, task/spec records, diff, and affected code directly, and remains
read-only. Capacity may split dispatch into parallel groups, but findings are
collected into one complete wave before implementation receives one batch.

Assignments and explicit profiles:

- Specification/correctness review: orchestrator-dispatched senior correctness
  function, `gpt-5.6-terra` / `high`; checks the T-0225 acceptance criteria,
  JVM parity, DDD/Proto correctness, registration, execution, routing,
  transactions, metadata, and tests.
- Standards review: existing `style_maintainability_reviewer`,
  `gpt-5.6-terra` / `high`; checks the milestone diff against `AGENTS.md`,
  `BUILD_PROTOCOL.md`, code-quality rules, and local conventions.
- Performance/reliability review: existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / `high`; checks queueing,
  ordering, idempotency, failure containment, persistence, shutdown, and bounded
  work.
- TypeScript/API documentation review: existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / `high`; checks public and
  serialized contracts, registry compatibility, exports, declarations, and
  runtime/type agreement.
- Reader documentation review: existing `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; checks changed user workflows, examples,
  limitations, links, and claims against the implementation.

The Desktop execution surface supports these explicit dispatch fields. Runtime
self-introspection will be recorded if exposed; otherwise the immutable role
profile and absence of visible fallback are the acceptance evidence.

## Independent review findings

All five memory-isolated reviewers completed. Their model and reasoning fields
were explicit in dispatch, no visible fallback occurred, and runtime
self-introspection was unavailable. The complete deduplicated correction batch
is:

1. Reject command-input `@Command` transformations on Projections. Registry
   ingestion currently accepts them and command readiness advertises them, but
   repository dispatch has no Projection command execution path, so an accepted
   client Command can be silently dropped.
2. Replace the new Command Bus follow-up tests that pack `ProjectionState` as a
   Command with a domain-correct generated Command fixture.
3. Replace the generated-registry transformation test that uses the
   `spine.core.Command` envelope schema as both input and output. Use distinct
   domain Command messages and an Aggregate or Process Manager owner.
4. Update `build-protocol/RUNTIME_ARCHITECTURE.md`: each Command type has one
   effective receptor, either `@Assign` or command-input `@Command`;
   Event/rejection-input `@Command` remains exclusively on the Event Bus.
5. Rename and complete the task's `Human-Imposed Requirements Ledger`, including
   inherited domain-correct fixture, return-shape, and receptor constraints.
6. Update `docs/api/README.md` from five to six handler metadata roles and name
   command transformation explicitly.
7. Replace the API README's v3-only registry SPI claim with the exact v3-read,
   v4-write contract.
8. Add the Command-input `@Command` workflow to the API README, including the
   optional `CommandContext` and non-empty Command output.
9. Add the detached in-process best-effort crash window and lack of durable
   child retry to the API workflow.
10. Update `build-protocol/DEVELOPER_API.md` from an unqualified version-3
    registry claim to v4 output with v3 legacy read compatibility.
11. Correct `GeneratedRegistryWriter` public TSDoc from version 3 to version 4
    and cover the public documentation assertion where practical.
12. Correct the API README's root-export claim: ingestion/discovery are root
    exports, while versioned generated-registry data contracts remain on
    `@spine-event-engine/server/spi/handler-registry`.

The performance/reliability lane found no defects after independently checking
reentrant follow-up admission, commit ordering, sibling fan-out, promise
containment, close/drain, durable duplicate Inbox handoff, crash-window claims,
tenant/metadata isolation, and bounded retention.

The implementation owner receives this as one correction batch. Correctness,
standards, TypeScript/API docs, and reader docs require bounded re-review after
the corrections; reliability re-review is required only if execution behavior
changes beyond rejecting the unsupported Projection configuration.

## Independent review convergence

The complete correction batch was applied before re-review. All re-review
contexts remained memory-isolated from implementation (`fork_turns="none"`),
read the repository and task records directly, and stayed read-only.

- Correctness/compatibility: clean. Projection transformations are rejected
  before readiness, while Aggregate and Process Manager transformations retain
  their command routing, transaction, and metadata behavior.
- Style/maintainability: clean after the test fixtures were renamed for their
  actual domain Command types and the generated Projection fixture was narrowed
  without an unsafe cast.
- Performance/reliability: clean in the first independent wave; no execution
  correction reopened this concern.
- TypeScript/API documentation: clean after the repository-kind restriction,
  two-argument `CommandContext` arity, v4-write/v3-read compatibility, and
  root-versus-SPI exports were documented.
- Reader documentation: clean after the Aggregate/Process Manager support
  boundary and Projection construction-time rejection were made explicit.
- Security: N/A for the unchanged reason above.

The final bounded preflight passed all static, generated-build, documentation,
package-consumer, and release-readiness checks plus 356 focused tests in six
files. The authoritative `pnpm verify:release` run then passed 288 test files
and 4,578 tests. Coverage passed at 93.29% statements (22,337 / 23,942), 90.01%
branches (13,183 / 14,646), 92.87% functions (5,477 / 5,897), and 94.45% lines
(20,710 / 21,925). No independent finding remains open.

## Superseding domain correction

The human clarified that Aggregates permit no `@Command` methods. This
supersedes prior review conclusions that retained Aggregate command
transformations. The corrective implementation rejects every Aggregate and
Projection `@Command` during analysis, generated ingestion, metadata creation,
and repository construction; removes Aggregate command-reaction and
transformation execution; and keeps Process Manager command reactions and
transformations. The prior release evidence predates this correction and is not
current release evidence.

## Independent follow-up review wave

Explicit dispatch fields were recorded for every reviewer; runtime
self-introspection was unavailable and no fallback was visible. Findings were
returned to the existing Terra/medium implementation owner as one batch:

- Style/maintainability (`gpt-5.6-terra`, `high`): P1 inherited entity-family
  analysis and P2 stale status/work-log disposition.
- TypeScript/API specification (`gpt-5.6-terra`, `high`): P1 generated-registry
  Command/Event/rejection schema-role validation and P3 `@Command` overload
  TSDoc.
- Performance/reliability (`gpt-5.6-terra`, `high`): clean after 498 focused
  tests; no new lifecycle or follow-up defect.
- Reader documentation (`gpt-5.6-luna`, `medium`): P2 current status/work-log
  wording and P3 runnable Process Manager example and reaction terminology.

The correction adds inheritance-aware Aggregate/Projection rejection, strict
generated `@Command` schema-role validation, and current documentation/record
dispositions. The earlier final-ready and release assertions remain superseded
until this correction receives its own final verification.

## Final bounded re-review correction

The final bounded re-review requires one analyzer lineage calculation per class
and exact generated command/event basename matching. Focused analyzer and
registry tests, tooling typecheck, TSDoc, targeted lint/formatting, and diff
checks precede the implementation commit. Release verification is parent-owned
and has not been rerun.

## Runtime Event descriptor-name reconciliation

Technical review confirmed that Buf `schema.file.name` omits `.proto`, so
extensionless plural Event names are required at runtime and remain equivalent
to analyzer `.file.proto.name` handling. The singular `*_event` and
`*_event.proto` checks were fixture-only broadening and are removed. Registry
tests reject both singular forms; repository-routing fixtures use strict plural
Event descriptor names. Release verification remains parent-owned and has not
been rerun.

## Canonical preflight artifact correction

The canonical preflight deterministically found an overlong analyzer-test
fixture import and regenerated the absent `server-blackbox-tests` output. The
current manifest generation ID was produced by that regeneration and matches
its generated marker. This correction records no canonical rerun or release
verification claim; those remain parent-owned.

## Black-box fixture role correction

Canonical preflight passed 431 tests and then failed one integration load when
the black-box project-workflow fixture used a mixed command/event/state proto
source. Generated registry validation correctly rejected the resulting
hand-authored command-reaction metadata. The corrective split keeps IDs and
entity states in the workflow file, moves Commands to `project_commands.proto`,
and moves Events to `project_events.proto`; runtime validation was not
weakened. Normal generation refreshed the manifest and exports. No release run
has occurred.

## Final convergence and authoritative verification

The final binding domain correction is complete: only Process Managers support
`@Command`; Aggregates and Projections reject every command handler. Corrected
review findings also cover strict generated Event names, domain-correct
black-box command/event fixtures, executable and truthful registry examples,
and the analyzer's guarded TypeScript symbol lookup for unrelated heritage
types.

The former generator failure reran across 2 files and 98 tests. The canonical
preflight passed 9 files and 437 tests. The authoritative `pnpm verify:release`
exited 0 with 288 files and 4,586 tests, with 93.29% statement, 90.04% branch,
92.89% function, and 94.45% line coverage. This evidence supersedes every
earlier record that stated a release run had not occurred. The branch was clean
before this durable record-only commit; the commit advances final HEAD without
altering the verified behavior.

## SignalPublisher lifecycle migration

RED: the publisher tests failed before the internal publisher module and the
CommandBus assembly-abort seam existed. GREEN: the publisher contains detached
produced-signal failures, admits later siblings in order, and drains accepted
work while context shutdown is in progress. The migration removes the public
stored-event failure registry and routes repository produced commands and
events through the context-scoped publisher.

Generated repository fixtures now use canonical command and event Proto files
(`TaskCommand`, `ProcessManagerTaskCommand`, and `TaskEvent`) rather than
representing Entity states as application signals. Focused validation passed:
repository routing and bounded context (329 tests), registry discovery (16),
lifecycle/export/external-origin/black-box checks (106), and the final
combined lifecycle set (448). Server typecheck, deterministic fixture check,
changed-file ESLint, targeted formatting, and `git diff --check` passed.

Focused V8 coverage passed the 363-test execution and covered
`signal-publisher.ts` at 92.1% lines. Its process exits nonzero only because
the repository's global 90% threshold is evaluated against all workspaces for
this narrowed test selection; no source-level test failed.
