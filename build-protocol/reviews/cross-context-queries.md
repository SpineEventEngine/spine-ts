# Cross-context queries review log

Status: original runtime reviews and local release verification complete; the
repository-query and generated-DSL plan extension has received standalone review.
Its findings are incorporated; one field-selection decision awaits the human.
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

One product question remains: whether `find()` ignores field selection to
restore complete Entities. The recommendation and JVM alternative are recorded
in the plan and unresolved-questions log, pending the user's decision. All other
findings are incorporated as implementation requirements, not claimed as fixed
runtime behavior. This review does not replace later implementation reviews.
