# Handler result corrections

Status: implementation, independent reviews, and local release verification
complete. The human approved the no-output reaction declaration on
25 September 2026. The published commit's CI result is recorded in the final
task reply and [PR #10 checks](https://github.com/SpineEventEngine/spine-ts/pull/10/checks).
Three additional independent review/fix rounds, requested on 26 September,
are in progress in the [review record](../reviews/handler-result-corrections.md).

Branch: `entity-and-signal-handler-declarations` (continuation of PR #10).
Baseline: `bbdcd319441b3c6153cc8db63b0cbb309ad411b8`.
Classification: high-risk because public handler declarations and transaction
failure behavior change. No wire or storage schema change is intended.

## Human-Imposed Requirements Ledger

1. A Process Manager command assignment must reject an empty result before
   committing state, matching Aggregate and standalone assignments.
2. Event- or rejection-input Command reactions may return one concrete Command,
   a union of concrete Commands, or no Command. `undefined` may appear anywhere
   in such a union. Command-input transformations must still produce Commands
   or reject the incoming Command.
3. Event reactions must reject `void` and `Promise<void>` declarations.
4. Subscriptions may declare only `void` or `Promise<void>`. Other declared
   results are errors; unexpected actual values must not be silently discarded.
5. Remove the retired event-applier decorator completely, including exports,
   legacy metadata, implementation paths, tests for removed functionality, and
   project documentation. Do not retain a compatibility implementation.
6. Equivalent TypeScript declarations must behave consistently: direct types,
   parentheses, aliases, concrete generic aliases, arrays, tuples, union members,
   and one outer built-in Promise. Resolve the reported null, subscriber, and
   envelope-result inconsistencies as part of the same public return contract.
7. Arrays remain the supported collection form. Do not add general iterables.
8. Preserve unions of concrete known generated signal types. Do not add
   open-ended interface output discovery.
9. Allow `undefined` alongside any number of concrete Command alternatives for
   Event/rejection-input Command reactions. No new no-action wrapper is needed.
10. The human explicitly approved `undefined` or `Promise<undefined>` alone for
    a reaction that never emits, both Event reactions and Command reactions.
    Do not permit this for command assignment, command transformation, or
    subscriptions.
11. Use ONLY freshly fetched official Spine JVM GitHub source for JVM reference,
    including source Javadocs and tests, not published sites or saved research.
12. Keep wording simple; document every changed production class/method and
    generic parameter. Keep methods within 35 physical lines, use blank lines
    between declarations, and use domain-correct, readable Proto fixtures.
13. Continue in this chat and checkout; no additional task or worktree. Preserve
    unrelated changes. Commit on the feature branch and push every commit to
    official origin. Do not merge, publish, or rewrite history.

## Return rules

| Handler/input                                    | Normal result                                        | No-output result                                  |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| Assignment / Command                             | Concrete Events, unions, flat arrays, fixed tuples   | Not allowed on success                            |
| Command transformation / Command                 | Concrete Commands, unions, flat arrays, fixed tuples | Not allowed on success                            |
| Command reaction / Event or rejection            | Concrete Commands, unions, flat arrays, fixed tuples | `undefined`, optional union, or empty typed array |
| Event reaction / Event or rejection              | Concrete Events, unions, flat arrays, fixed tuples   | `undefined`, optional union, or empty typed array |
| Subscription / Event, rejection, or Entity state | `void`                                               | `void`                                            |

One outer built-in Promise may wrap a permitted declaration. `void` is valid
only for subscriptions. `null`, normal returned rejections, framework envelopes,
nested collections/promises, custom thenables, unresolved types, and arbitrary
objects remain invalid. Optional tuple members remain supported. A wholly absent
result or array entry is represented by `undefined`, never null. Keep tuple
shape checking with TypeScript; do not introduce a runtime tuple interpreter.

## Work sequence and acceptance

1. One bounded architecture pass checks public contracts and the transaction
   boundary. Retain one implementer for the code corrections and review fixes.
2. Add failing focused tests, then correct return-type analysis and metadata
   ingestion. Prove Command-input versus Event-input behavior, undefined-only
   reactions, optional unions in every position, equivalent declaration syntax,
   strict subscription declarations, and rejected void reactors.
3. Correct runtime validation before commit/publication. Prove empty Process
   Manager assignment rejection without state/version/history/output changes;
   consistent subscriber/null/envelope checks; valid no-output reactions persist
   legitimate state changes; preserve unions, tuples, order, and rejections.
4. Delete the retired event-applier API and paths. Migrate affected fixtures and
   current no-output reactor declarations. Preserve unrelated aggregate history
   and transaction behavior; do not delete features solely because they share
   a name with the retired handler mechanism.
5. Update human and agentic documentation, TSDoc, checks, and examples. Audit
   tracked files for obsolete signatures and retired API references. Demonstrate
   optional and undefined-only reactions in real application behavior without
   inventing unnecessary domain messages or a new wrapper library.
6. Run the cheap preflight: focused tests/coverage, affected typechecks, formatting,
   cleanup/TSDoc checks, documentation checks, and `git diff --check`. Collect
   independent concern-specific reviews, fix all accepted findings, then run
   `verify:release` once after convergence and the CI package-consumer check.
7. Push changes and confirm required CI is green at the exact final SHA. The
   branch already contains the snapshot.15 version-only commit; do not bump a
   second time without an actual publication/version conflict.

Estimate: 2–3 hours active work for code/tests (1–1.5), documentation/example
updates (0.3–0.5), review and corrections (0.4–0.6), and verification/reporting
(0.3–0.4). GitHub runner waiting is additional. Broad legacy fixture removal is
the main uncertainty; revise the estimate when evidence changes it.

## Sources and implementation boundaries

Fresh official JVM `origin/master` is
`ea3067b137938ac0beb6920c39d11e300976fcc9`. The local JVM tree contains unrelated
changes, so read the GitHub-fetched tree with `git show`, never change that tree.
Relevant source paths under `server/src/main`: command/model/AssigneeReceptor,
CommandSubstituter, CommandReactionSignature; event/model/EventReactorSignature;
model/MethodResult and VoidMethod; aggregate/model/AggregateClass; tuple factories;
and kotlin/io/spine/server/event/Just. Matching signature and runtime tests are
under `server/src/test` and `server/src/testFixtures`.

No third-party library is needed: TypeScript compiler APIs, native return types,
existing generated schema metadata, and current runtime transactions are enough.
No outbox, persistence migration, wire additions, new role, or background work.

## Skills and assignments

The exposed session catalog, `build-protocol/skills/EXPECTED_SKILLS.md`, bounded
installed SKILL.md discovery, and readable `.agents/.skill-lock.json` were checked.
Selected implement, subagent-driven-development, and test-driven-development;
main read their complete bodies and the implementation prompt. The worktree
skill was read; the explicit human instruction to stay in place overrides new
checkout/setup suggestions. The project forbids a redundant full baseline run.
Existing project planning/work/review records replace a duplicate skill ledger.
Repository model routing and retained-context, aggregated-review rules override
skill suggestions for new fixer contexts, new roles, or repeated full reviews.
Review and completion skills will be read before their respective actions.

Desktop exposes explicit Astra/high, Sol/medium, and Luna/low or medium profiles.
No child may spawn children. Only the implementer changes production/test code;
main edits disjoint Markdown docs and records. Main coordinates all heavy test
runs so that only one single-worker run is active at once.

| Assignment                                               | Existing role/function           | Explicit model | Reasoning |
| -------------------------------------------------------- | -------------------------------- | -------------- | --------- |
| One bounded contract/transaction plan check              | requirements_splitter            | gpt-6-astra    | high      |
| Runtime, analyzer, removal, migration, and focused tests | implementer                      | gpt-6-sol      | medium    |
| Style/maintainability review                             | style_maintainability_reviewer   | gpt-6-sol      | medium    |
| API/type and declaration review                          | typescript_api_docs_reviewer     | gpt-6-sol      | medium    |
| Transaction/runtime correctness review                   | performance_reliability_reviewer | gpt-6-sol      | medium    |
| Human and agentic documentation review                   | documentation_reviewer           | gpt-6-luna     | medium    |
| Final mechanical verification                            | orchestrator-dispatched function | gpt-6-luna     | low       |

Reviewers receive fresh context, the complete requirements above, and their
concern-specific diff. They do not use saved memory or prior review conclusions.
Security review is N/A for this bounded correction: no authentication, secret,
transport, dependency, or new untrusted-input boundary is introduced; transaction
and malformed-result checks receive reliability/API review.
