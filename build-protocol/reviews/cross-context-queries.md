# Cross-context queries review log

Status: original runtime reviews and local release verification complete; the
repository-query and generated-DSL plan extension has received standalone review.
Its findings are incorporated. The human resolved field selection: remove all
masking APIs, including subscriptions, and ignore incoming Protobuf mask fields.
The earlier follow-up's subscription exception is superseded. No questions remain.
GitHub CI remains unverified.

## Plan review

The approved analysis received one Astra/high architecture pass and one fresh
Sol/medium standalone review without history/memory. Accepted findings are now
requirements: two-phase all-context shutdown and retryable cleanup for routing
validation before attachment. No open product decisions remain.

## Required code-review concerns

- Style/maintainability: complete; accepted test coverage finding corrected.
- Documentation: complete; guides and example claims match the implementation.
- TypeScript/API docs: complete; mask findings corrected and rechecked.
- Performance/reliability: complete; recovery, shutdown and startup findings
  corrected and rechecked.
- Final security: complete; Server isolation and failed-start cleanup findings
  corrected and independently rechecked.

Run independent relevant reviewers after preflight, with fresh contexts and the
complete Human-Imposed Requirements Ledger. Aggregate findings before fixes.
Only substantively changed concerns reopen after corrections. Final security
disposition is recorded at release readiness, not as an early duplicate review.

## Planned independent assignments

Every assignment starts without chat history or memory, reads the complete
Human-Imposed Requirements Ledger in the approved plan, and compares the final
runtime or documentation diff against baseline `2324311be8c23024f66cb2ba702fbe99a99e7dfb`.
Reviewers must verify claims against implementation and tests, not assume that
the plan or this log proves correctness. No reviewer edits files or dispatches
children. Explicit dispatch profiles:

- Existing style/maintainability reviewer: gpt-6-sol / medium. Changed runtime
  and example structure, reuse, simple documentation and unnecessary API surface.
- Existing TypeScript/API documentation reviewer: gpt-6-sol / medium. Query and
  tenant public contracts, registered schema handling, declarations and examples.
- Existing performance/reliability reviewer: gpt-6-sol / medium. Tenant isolation,
  visibility, server separation, startup/recovery, cleanup/retry and shutdown.
- Existing documentation reviewer: gpt-6-luna / medium. Changed human-readable
  guidance, example instructions and agreement with actual behavior.

The desktop surface supports these explicit configurations; no separate runtime
model metadata is exposed. Record any visible mismatch rather than asking the
reviewer to infer its model. Wait for the complete wave before one correction
batch. This section records intended dispatches, not completed reviews.

## Review at 78addab7a

The desktop surface refused a second simultaneous review dispatch with
`agent thread limit reached`. Reviews are therefore sequential, but findings
remain collected until the whole wave completes. Every successful dispatch has
explicit model/reasoning and no inherited history; runtime metadata is not
separately exposed.

Style/maintainability (gpt-6-sol / medium) completed: one P2 coverage finding.
The shutdown regression pauses a direct CommandBus dispatcher and reads Stand,
so it proves the two-phase close correction but does not exercise PM `select()`
during shutdown. Add the promised PM query regression in both context orders;
retain the existing direct-dispatch test because it catches a distinct race.
No other confirmed style/maintainability findings. API review is in progress;
reliability and documentation reviews are pending available capacity.

TypeScript/API documentation (gpt-6-sol / medium) completed: one P1 mask-name
finding. EntityQueryBuilder accepts generated property names but stores Proto
field names in the plan; RegisteredTargets compared masks to `field.localName`.
A valid `mask("skuName")` therefore fails for Proto `sku_name`. Compare to the
Proto field name and test the complete masked read. The reviewer also identified
an existing storage-mask property-name mismatch that must be checked to deliver
the promised valid query result; do not call that older mismatch introduced by
this change. No other confirmed API/declaration/compatibility findings.
Reliability review is now running at the same unchanged checkpoint.

Performance/reliability (gpt-6-sol / medium) completed: no confirmed runtime
defect. It independently confirmed the paused-PM shutdown coverage gap and
added one P2 recovery gap: checking the lookup while tenant work is enumerated
does not prove replayed persistent delivery actually executes a foreign PM
query. Add pending-work replay with a successful real handler read. Existing
route-install timing and direct-dispatch shutdown tests remain useful and stay.

Documentation (gpt-6-luna / medium) completed clean: changed guides, reference,
links, snippets and Orders instructions match the implementation and scope.
No tests/builds run by reviewers. All four configured profiles were explicit
and correct; no runtime mismatch was exposed. The complete wave is accepted.

One correction batch goes to the retained implementer: fix mask-name validation
and prove the selected camelCase property survives a real local/foreign read;
add actual recovered PM querying; add paused PM querying during shutdown in
both context orders without removing the existing direct-dispatch race test.
API and reliability concerns reopen for these substantive corrections; style
needs only confirmation of the promised PM test, documentation remains clean
unless public prose/behavior changes.

Correction preflight passes: 77 PM/Stand tests, tooling typecheck, scoped lint
and formatting, cleanup and TSDoc. Main also checked that the new rejection
handler declares an optional Command result rather than bypassing declaration
rules with void. Two fresh re-review dispatches are planned with explicit
gpt-6-sol / medium: existing API reviewer for the mask correction and Stand
contract/docs; existing reliability reviewer for real recovery/shutdown tests
and changed masking. Neither receives prior reviewer history or memory. They
read original requirements and current source/tests independently.

At cc2a90994, fresh reliability re-review is clean; its 31-test focused run also
passes. The actual PM shutdown, rejection, restored-state and pending-delivery
tests now meet the required behavior. This also resolves the original style
review's test-quality finding. API re-review found one remaining P2: removing
the provider mask bypassed existing normalized-mask validation. Empty or invalid
paths must still fail rather than silently returning unmasked state. Returned
to the retained implementer with instructions to reuse StorageQueryPolicy,
preserve decoded-state masking, and add malformed-mask regression tests.

After this bounded correction passes preflight and API confirmation, the final
release-readiness security reviewer will run with explicit gpt-6-sol / high,
without history/memory, focusing on same-Server routing, tenant isolation,
visibility, startup/shutdown, and query validation. Mechanical final release
verification remains an orchestrator-dispatched gpt-6-luna / low function;
run verify:release and release-cli prepare --check only after convergence.

The final API correction has RED/GREEN evidence: five malformed-mask cases
previously read unmasked or failed with incidental JS errors; all six cases
now pass using existing StorageQueryPolicy validation. The final 83-test
Stand/PM selection, tooling typecheck, scoped lint/format, cleanup and TSDoc
pass. No new public API or duplicated validator was added. Fresh API confirmation
uses the same explicitly configured gpt-6-sol / medium role and narrow diff.

At 88c385b2e, final API confirmation is clean. Final security review used explicit
gpt-6-sol / high with no inherited history/memory and found one P1: route
installation overwrites the map for a running context before a second Server's
attachment rejects reuse of that context. During the interval, the first
Server can resolve a target from the second assembly. A narrow built-code map
reproduction confirmed replacement; startup ordering establishes the access
path. No other confirmed security finding. Release verification is held.

Main accepted the finding and returned it to the same implementer. Reject
already-associated contexts before any route mutation, install complete route
sets synchronously, preserve the original Server's logging/routes/resources,
clean up only the new assembly's contexts/resources, and release associations
at the safe existing close/failed-start lifecycle point. Add an actual
two-Server handler regression and preserve cleanup/retry guarantees. This is
a demonstrated architecture-correctness blocker reviewed by the Astra/high
main agent, not an opportunity for a new lifecycle framework.

Security correction preflight is green: the actual paused-PM leak reproduced
before the fix and passes afterward in both context orders. Additional tests
prove exclusive concurrent startup, fresh-context cleanup, retry preservation
of the first Server, protection when a later builder fails, and route release
after normal close or successful failed-start retry. The combined PM/server/
lifecycle/context selection passes 320 tests; tooling typecheck, scoped lint,
formatting, cleanup and TSDoc pass. Production changes remain in Server and
RegisteredTargets. Fresh final security recheck uses gpt-6-sol / high;
fresh reliability recheck uses gpt-6-sol / medium. Both have no inherited
history/memory and receive original requirements plus source/tests, not prior
review conclusions as proof. Public APIs/docs have not changed in this fix;
their prior clean dispositions stand. No full release check has run yet.

Final security recheck identified two further startup cases: overlapping
asynchronous builds can close a shared, not-yet-associated context; service
construction can fail after attachment without cleanup. Main compared base
2324311be8 and confirmed both underlying gaps predate this feature. They affect
the new association lifecycle, so a bounded architecture consultation is
required before choosing corrections or explicit scope dispositions. Existing
requirements-splitter role is dispatched with explicit gpt-6-astra / high,
no history/memory and no children, to inspect these two cases only and propose
the smallest correction without a new lifecycle framework. No broad release
check runs while this is unresolved.

The Astra/high consultation confirms bounded scope: protect admitted prebuilt
contexts before any awaited builder, reserve returned builder contexts, and
hand off synchronously to installed routes. Keep partial-build cleanup in the
existing retained FailedStartCleanup group, including retries. Cover services
and HTTP adapter/listener construction inside the existing post-attachment
cleanup boundary, not merely the listen call. Queue-limit coercion is existing
valid behavior and must stay; invalid subscription limits throw. No environment
generation, public API, tenant or Proto change is authorized. Main accepted this
design and sent one implementation batch to the retained Sol/medium context.
This resolves the demonstrated architecture uncertainty; no further broad
architecture pass is planned absent a concrete new blocker.

The bounded startup correction passes 325 PM/server/lifecycle/context tests,
tooling typecheck, scoped lint/format, cleanup and TSDoc. It reserves all
prebuilt contexts before builder awaits, reserves returned contexts, retains
partial-build cleanup for retry, and covers service/listener construction in
post-attachment cleanup. Tests reproduce and correct both admission ordering
cases and service/adapter failure cleanup. One existing HTTP/2 session-order
assertion failed once; isolated and identical combined reruns passed. This is
recorded as intermittent evidence, not proof that the assertion is repaired.

Fresh security recheck (gpt-6-sol / high) and reliability recheck (gpt-6-sol /
medium) will inspect the final changed startup paths and relevant original
requirements without history/memory. Their scope distinguishes introduced or
affected defects from unrelated baseline limitations. No public API changes
or reopened broad documentation work are part of this correction.

At 478a530f8, fresh security recheck (Sol/high) is clean and its eight focused
startup/cleanup tests pass. Fresh reliability recheck (Sol/medium) is clean:
prebuilt and returned contexts are admitted at the correct points, conflicts
are excluded from cleanup, handoff to routes is synchronous, retries retain
the required exclusions, and accepted work drains before Stand closure.
No remaining accepted finding. All explicit dispatch profiles matched the
required roles; separate runtime metadata was unavailable. Style, API and
documentation dispositions remain clean, with deterministic checks covering
the final bounded startup extractions and TSDoc. Full release verification
and exact-tarball consumer proof now run through a Luna/low mechanical function.

Release checks exposed only deterministic integration omissions after review:
one header, real-manifest test expectations still at snapshot.16, and a package
README link escaping the tarball. These were corrected without runtime changes
or weakening assertions. All six affected packaging/version test files pass
78 tests, and cheap checks pass. Review dispositions stand; the full release
check is rerun from the next clean checkpoint, with failed logs preserved.

Release attempt three exposed an intermittent pre-existing HTTP/2 test observer
race. A fresh performance/reliability reviewer (explicit gpt-6-sol / medium,
without history or memory) confirmed that observing server-side session close
for ordering and client close separately matches the runtime guarantee, without
hiding a runtime defect. It found one additional test with the same client-side
ordering assumption. The retained implementer receives that finding and checks
the remaining related tests before the correction is accepted. No production
runtime change is part of this correction.

The residual finding is fixed with a scoped HTTP/2 listener observation hook,
reset before every test. Exact server-session-before-resource order is retained.
The adjacent non-draining client stream test now awaits its close notification
before unchanged assertions. All 201 tests in the two affected files pass,
with tooling, lint, format, cleanup and TSDoc checks passing. The same independent
reviewer rechecked the final diff and found no further reliability issue.

## Final verification

At code checkpoint `506b73018`, cheap preflight and `pnpm verify:release` pass
(exit 0): 304 files and all 5,061 tests. Global coverage is 93.28% statements,
90.06% branches, 93.12% functions and 94.43% lines. No threshold was lowered or
coverage exclusion added. `node scripts/release-cli.mjs prepare --check` also
passes (exit 0), including all 19 publishable package tarballs and consumer
installation, compilation and imports. Nothing was published.

New effective-tenant handling has 13/13 lines, 2/2 functions and 10/10 branches
covered. RegisteredTargets has 38/40 lines, 10/10 functions and 23/26 branches;
remaining installation collision guards are preceded by Server admission checks,
and the defensive release identity mismatch is not exercised. The Orders example
runs in two real-Server tests through its compiled JavaScript; authored-source
LCOV reports zero hits, not source coverage. Runtime routing, tenant rejection,
visibility, recovery, retryable cleanup and shutdown have focused regression
tests in the passing suite.

All accepted findings are resolved. GitHub reports no PR for this branch, and
the Build workflow runs on PRs. Final-SHA CI is therefore unverified, not green.
The human has been asked to open the PR; creating it is not authorized here.

## Repository-query and DSL plan review (29 September)

Completed independent assignment: existing requirements splitter as a senior
engineer reviewing public query design, explicit gpt-6-astra / high, with
`fork_turns: none` and no memory/history. This is the architecture pass for the
material extension, not another review of unchanged completed code. Inputs:
the complete updated plan and requirements ledger, applicable protocol, current
code/tests and latest official JVM sources. The reviewer must distinguish
approved user choices from implementation details, give actionable findings,
and ask only genuine unresolved product questions in simple language.

No child dispatch, editing, builds or tests. Actual runtime metadata is not
separately exposed; accept the immutable explicitly configured profile unless
a mismatch is visible. Existing runtime review dispositions above apply only
to the original completed slice, not the unimplemented extension.

The standalone reviewer `/root/repository_query_plan_review` used the expected
requirements-splitter role with both gpt-6-astra and high explicitly dispatched.
No history or memory was supplied. It inspected current code and official JVM
HEAD `ea3067b137938ac0beb6920c39d11e300976fcc9`. No visible profile mismatch was
reported; separate runtime metadata was unavailable. No builds/tests were run.

Accepted findings and plan corrections:

1. An ID-only routing factory cannot infer application Entity methods. Specify
   class-aware routing, exact result types and compile-time inference tests.
2. Existing memory, shared query-policy and Datastore bounds can truncate or
   reject large searches. Specify exhaustive repository execution across all
   four providers, sparse-match tests and complete batched delivery; preserve
   public/PM limits rather than disable them globally.
3. Specify JVM's repository lifecycle defaults, their ID/predicate exceptions,
   and filtering before ordering/limits. Preserve other query paths' behavior.
4. Define the shared typed query before its consumers. Specify PM/client entry
   points, execution-time identity and copied mutable query inputs.
5. Keep repository reads bound to one routing invocation. Test expired access,
   concurrent tenants and asynchronous direct-route/shutdown behavior.
6. Include nested models, name collisions and non-`id` identifier fields in
   generation and consumer tests, with normal output cleanup and fingerprints.

At that review, one product question remained: whether `find()` ignores field selection to
restore complete Entities. The recommendation and JVM alternative are recorded
in the plan and unresolved-questions log, pending the user's decision. All other
findings are incorporated as implementation requirements, not claimed as fixed
runtime behavior. This review does not replace later implementation reviews.

### Follow-up after the human removed query masking

Historical outcome below is superseded where it retained subscription masking
or rejected incoming query masks; see the human correction after this section.

The retained requirements splitter reviewed the revised plan under its original
explicit gpt-6-astra / high configuration. This was a focused follow-up retaining
the prior review context, not a new no-history round: a fresh dispatch failed
because the execution surface had reached its agent limit. No external memory
or chat retrieval was used. Separate runtime metadata remains unavailable.

Outcome: no remaining human decision or contradictory active requirement.
One P2 acceptance gap was accepted and incorporated: subscription recovery runs
an authoritative query and must obey the same no-masking rule. The plan now
tests complete recovery states between masked live updates, rejects a masked
recovery query, and preserves full-state subscription filtering, stored state
and `noLongerMatching` behavior on local and remote paths. This adds test
requirements only, not an exception or new runtime design.

Review dispositions for this revision: public API and reliability plan concerns
accepted after the focused architecture follow-up; documentation checked for
consistent full-state claims and superseded requirements. Production style is
N/A because only Markdown requirements and records changed. Implementation
reviews remain required after the feature is written. No builds/tests executed.

### Human correction of the masking scope

The author incorrectly narrowed the no-masking instruction to queries. The human
explicitly corrected that interpretation: no masks anywhere in the API, including
subscriptions; mask fields present in Protobufs must be ignored. The active plan
and specification now remove all pruning, mask-path validation and mask-specific
rejections, while leaving copied wire definitions unchanged. Acceptance tests
require complete query, live-subscription and recovery results even when incoming
Protobufs contain masks. No subscription-only masking helper remains planned.

This is the human's binding clarification, not another product choice. Checked
the active records for the removed subscription exception and mask-rejection
requirements. No additional independent review or runtime verification is claimed
for this documentation correction; implementation review is still required.

### Requested standalone review of the complete corrected plan

The human requested a new review without memory, followed by remaining questions
or a simple summary. Expected assignment: existing requirements splitter, explicit
gpt-6-astra / high, new context without inherited chat history, prior review
conclusions or memory retrieval. Read the complete current plan and requirements
ledger, governing specification and relevant current source. Do not edit, build,
test, implement or create child agents. No product decision is assumed unresolved
in advance. Record the actual execution surface and profile before acceptance.

The fresh Desktop dispatch explicitly supplied the expected role, model,
reasoning and `fork_turns: none`, but failed at the surface's agent limit. The
installed CLI is now 0.144.1 and supports fresh ephemeral execution, explicit
model/reasoning and read-only sandboxing. Dispatch the same existing role's
read-only planning remit there with gpt-6-astra/high, memories and multi-agent
disabled, fast mode disabled, and no resumed session or prior review input.
Validate reported model/reasoning in its execution header before acceptance.

CLI 0.144.1 was rejected by the model service as too old for Astra; no review
result came from it. Selected the already-installed app-bundled CLI at
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, version
0.158.0-alpha.2.1, with the same explicit restrictions and no software update.
Execution evidence is in `/tmp/spine-query-plan-review.nROe5z/`; the bundled
attempt uses `bundled-execution.log` and writes the final review to `result.md`.

Completed successfully (exit 0). The execution header confirms gpt-6-astra,
high reasoning and read-only sandboxing; separate inference-runtime metadata
was not exposed. This was a new ephemeral session with memories disabled, not
a continuation of any earlier reviewer. No changes, builds or tests were made.

Verdict: feasible plan, no unresolved user decisions. Accepted all three P2
findings and incorporated their smallest corrections:

1. Separate the shared builder's current 1,000-ID input ceiling from repository
   execution. Test more than 1,000 explicit IDs in all three find methods and
   retain applicable PM/public limits at execution boundaries.
2. Include subscription `authoritativeQuery` recovery among common typed-query
   consumers. Test the same generated query for initial reads and reconnection,
   preserving actor/tenant context and complete recovered/live state.
3. Add focused review checkpoints after masking removal, shared-query generation
   and consumers, exhaustive repository reads, and asynchronous routing. Keep
   one final release verification after convergence, with no extra branches or
   routine approval pauses.

The reviewer verified current TS paths and did not claim freshly verified JVM
parity because latest-HEAD JVM access was unavailable in that read-only process.
Earlier explicitly recorded JVM evidence remains the plan's source; the human's
no-masking decision overrides JVM masking behavior. This limitation raises no
new product question. Current synchronous routing and masking code are planned
implementation work, not additional defects in this plan review.

## Masking removal review checkpoint

Review started after cheap checks passed. Baseline for this slice:
`d37ca81793569cf0516ab8d667e96feb928c2cd6`; review the working-tree diff, not
future planned features. The existing TypeScript/API-docs, performance/reliability
and style/maintainability reviewers will each use explicit `gpt-6-sol` / `medium`.
The existing documentation reviewer will use explicit `gpt-6-luna` / `medium`.
Each assignment is a fresh read-only app-bundled CLI process with memory,
multi-agent and fast mode disabled. No inherited conversation or previous review
conclusions. Confirm execution headers before accepting results. Collect the
whole review wave and return one confirmed correction batch to the retained
implementer. This records dispatched assignments, not completed reviews.

First three fresh processes are API, reliability and style, each with explicit
gpt-6-sol / medium confirmed in its execution header. Documentation follows when
a slot is free, with its separately recorded Luna/medium profile. Source is held
unchanged during review. No reviewer receives previous conversation or review
conclusions; requirements, current diff and mechanical evidence are provided.
API and reliability returned no actionable findings (read-only source/test
review; neither reran suites). Style returned an accepted P2: invalid-mask
subscription cases should activate and prove full state/Event delivery rather
than stop at registration. Accepted its small P3 correction to the RecordValues
description as well. Documentation is still independently reviewing with explicit
Luna/medium; do not send a partial correction batch before its result arrives.
The full masking wave is complete. Documentation returned no actionable findings;
its explicit Luna/medium execution profile was verified. API/reliability/style
profiles were verified as Sol/medium. All were fresh, read-only and without memory
or inherited chat. No reviewer reran broad suites. Accepted the style P2/P3 batch
described above and returned it to the retained Sol/medium implementation session.
The correction adds regression proof and fixes one comment; no runtime change is
requested. Deterministically verifiable test/comment corrections do not reopen
unaffected review lanes. Final acceptance awaits the focused correction checks.

Separate Luna/low mechanical verification passed generated documentation, audience
and TypeScript snippets, root formatting, and whitespace checks (all exit 0),
using the existing build outputs. Its explicit profile was confirmed as well.
Masking checkpoint accepted: the P2 correction activates real Event and Projection
subscriptions with unknown/malformed mask paths and asserts the complete delivered
Event/state. The P3 description now accurately describes value/payload comparisons.
No runtime behavior changed in the correction. The full affected service suite
passes 117 tests; both typechecks, affected ESLint/Prettier, TSDoc, cleanup and
whitespace checks pass. All four review concerns have a clean or resolved
disposition. No additional broad review wave is needed for these test/comment
corrections. Final task-wide release/security acceptance remains pending.

## Shared generated query checkpoint

Review converged; corrections verified. Base: `30539151f`; include staged new files and
all current changes against that commit. Concern assignments: existing
TypeScript/API-docs, performance/reliability and style/maintainability reviewers,
each explicit gpt-6-sol / medium; documentation reviewer, explicit gpt-6-luna /
medium. Fresh read-only sessions, memories/multi-agent/fast mode disabled, no
inherited chat or previous review conclusions. Confirm each execution header.
Inputs are the human ledger, source/diff, focused evidence and the concern-specific
brief. Collect the complete wave before one correction batch to the same retained
implementer. Headers confirmed all explicitly configured models and efforts;
the same runtime-identity limitation recorded above applies.

Focus includes typed condition-only branches, query/input independence, ID limits
at execution, consumer actor/tenant binding, actual external generated imports,
name collisions/non-id fields, and strict/atomic generation with fixture selection
outside published-generator policy. Future provider/read/routing slices are not
claimed complete. Existing final release/security acceptance remains pending.

Completed fresh review sessions: API `01a0edd3-394f-7bc3-8caf-3b47d4894cca`,
reliability `01a0edd3-3865-7b61-898f-1068b79adac7`, style
`01a0edd3-3864-7dc1-8135-fd3345146635`, documentation
`01a0edd5-226c-7202-8ad5-196a1f463481`. All exited without edits or tests.

Accepted one batch: API P2 requires validating core runtime dependency for query
companions, not only rejection companions; reliability/style duplicate P2 requires
complete generated-query recovery and resumed updates, not just activation/context
assertions; docs P2 clarifies positive ordered limits. Main confirmed these against
generator.ts and client.test.ts. Documentation's source-marker finding is rejected:
docs/check-typescript-snippets.mjs uses it as the compilation context and replaces
that virtual source with the snippet; it is not a claim of verbatim extraction.
Same implementer receives the confirmed batch and changed-source coverage work.
Only the substantive dependency validation needs targeted API re-review.

Expected targeted follow-up assignment: existing TypeScript/API-docs reviewer,
fresh gpt-6-sol / medium, no memory, read-only. Scope is companion runtime
dependency validation, atomic failure, real external consumer and corresponding
fixture dependency/docs only. Main separately verifies recovery-test assertions
and deterministic documentation corrections; these do not reopen whole lanes.

Targeted API session `01a0ede1-455d-7050-a6bd-262eddbe8169` completed with no
findings. Header confirmed explicit Sol/medium, fresh read-only without memory.
It checked the dependency gate, pre-publication failure, external consumer,
fixture dependency/lockfile and public reference. Main accepted the resolved
recovery and documentation findings after checking assertions and mechanical
evidence. All four canonical concerns are clean or resolved. Scoped coverage
passes unchanged aggregate thresholds; detailed per-file limits are in the work
log. Commit/push and clean-HEAD bootstrap check follow; full release acceptance
remains pending for the complete task.

## Receiving-repository reads checkpoint

Expected concern assignments after mechanical evidence is assessed: existing
TypeScript/API-docs, performance/reliability and style/maintainability reviewers,
each explicitly gpt-6-sol / medium; documentation reviewer explicitly gpt-6-luna /
medium. Fresh read-only sessions without memory/history, no children, source
edits or broad tests. Source baseline `f675c3437`; stage new files before review.
Main collects the complete wave and returns one accepted batch to the retained
implementer. These are planned assignments, not completed review outcomes.

Review scope is exhaustive provider execution, real Entity restoration, effective
tenant binding, lifecycle defaults and descriptor-based Aggregate columns. Keep
filtering/order/application limits in storage where supported. Asynchronous route
integration and broad examples follow later; their absence is not claimed as a
finished feature. Docker was initially unavailable; the human restored it during
review and dedicated test containers are being prepared. Reviewer evidence must
distinguish actual DB execution from fake drivers and import-only tests. Full
release coverage/CI remain pending.

Completed API session `01a0ee0e-00fc-74e2-8d0b-af1fab7c951a`, reliability
`01a0ee0d-ffe5-7d50-8037-cd7c3ec7ed55`, style
`01a0ee0d-ffd6-74d3-a973-6398c6d85310` (all explicit Sol/medium), and docs
`01a0ee10-e143-75d1-b53e-21bf4ad37c92` (explicit Luna/medium). Configured CLI
headers confirm the requested profiles; separate backend runtime metadata is not
exposed. All reviewed independently without memory or edits.

Main accepts one correction batch: flatten supported Datastore conjunctions;
prevent MySQL collation differences from dropping exhaustive results before global
filtering/order/limit; open only Entity storage for read scopes, avoiding unused
commit handles and their partial-open leak; correct exhaustive-query and lifecycle
comments. The resource findings are one correction. Documentation has no further
findings. Source inspection confirms each accepted issue. Preserve SQL pushdown
where its semantics are valid; do not replace every query with a blanket scan.
Expected correction estimate: 0.2–0.4 hours including focused tests and targeted
reliability re-review (explicit Sol/medium). Same implementation session continues.

Targeted fresh reliability session `01a0ee1f-e880-7680-879c-fcfd890ad9f8`
confirmed explicit Sol/medium and found two remaining completeness defects:
recursive conjunction rewrites can restore removed unsafe children, and custom
SQL numeric columns are not checked against their logical comparison type. Main
accepts both as P1/P2 correctness corrections, with exact recursive/type regressions.
The mechanical live session `01a0ee1f-ecd1-7ba1-9b35-632a77f1e014` confirmed
explicit Luna/low. PostgreSQL 16/18 passed (10 each, four conditional skips each).
MySQL and MariaDB each had five schema failures, nine passes and four skips;
Datastore had one missing-type-registry failure, five passes and four skips.
Neither failed suite is accepted. Return one batch to the retained writer; inspect
test isolation and actual underlying errors before correcting them. Source-level
review of the new SQL order optimization also requires checking nullable numeric
PostgreSQL order against the shared missing-value comparator. Expected correction
and focused/live rerun work: 0.2–0.4 hours. No full whole-change review is restarted.

With the writer paused for a Datastore transaction-test scope investigation,
dispatch one fresh focused performance/reliability check, explicit Sol/medium,
for the corrected MySQL/PostgreSQL exhaustive predicate/order/limit code and its
unit/live assertions only. No repository APIs, old Datastore transaction logic,
or whole-change review is reopened. Collect this result and the independent
Astra/high Datastore classification before resuming any correction work.

SQL review `01a0ee31-4adf-7923-83e3-d70ffa7f716a` (explicit Sol/medium)
found no remaining runtime defect. Accepted P2: both SQL live tests must assert
all 10,002 matching results, not only a late filtered row and 1,001 IDs. This is
a deterministic assertion addition with focused live reruns, not another review
wave. Architecture session `01a0ee30-bd17-7a33-bb3d-b074dc9478ed` (explicit
Astra/high) identifies unchanged concurrent Entity commits as the likely source
of the Datastore timeout, but asks for one baseline/stage-trace diagnostic before
calling it a baseline limitation. Do not increase timeout, serialize away the
race, add retries or redesign transactions. Query cases pass independently.

The bounded trace disproves the suspected commit stall: concurrency completes;
the later states.trim call hangs after successful appends. No transaction code
is changed. Main treats history cleanup as a separate scope question pending the
human's asynchronous answer, not as an accepted query-runtime defect. Final SQL
all-result assertions pass on all four SQL engines, and Datastore's large-query
assertions pass. All accepted query-slice review findings are resolved. Final
release coverage remains required; the separate full Datastore suite is not green.
