# Entity dependency configuration review

Status: all requested review rounds and the API documentation correction review are complete; no accepted finding remains. Final preflight and release verification are being repeated. Dual-tag automation remains blocked by npm support.
Branch: `entity-dependency-configuration`.
Base: `794bd524b8875f10a75777a41bbebe1dbece600b`.

## Requirements and scope

Review against the accepted requirements in the
[plan](../planning/entity-dependency-configuration.md) and current evidence in
the [work log](../work-logs/entity-dependency-configuration.md).
The new callback supplies constructor dependencies to fresh and restored
Entities, without changing stored messages, framework context bindings, or
existing constructor/schema restrictions. Existing one-options constructors
remain valid. The Projects example and public documentation teach the same API.

The human confirmed that both publication tags must advance. Supported npm
trusted publishing cannot automate the second tag update; a manual-step choice
is pending. Do not treat the unimplemented amendment as completed behavior.

## Independent assignments

Each reviewer receives fresh context, no conversation history or memory, the
requirement paths, the base commit, and a distinct scope. Reviews are read-only;
reviewers do not run builds or tests, change files, or dispatch children.
All model and reasoning fields will be explicit. The surface does not expose
separate runtime self-inspection; the immutable dispatch configuration is the
profile evidence absent a visible mismatch.

| Existing role                    | Model      | Reasoning | Scope                                                                                                                     | Disposition                           |
| -------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| style_maintainability_reviewer   | gpt-6-sol  | medium    | Changed construction helpers, callback storage, registration types, example code, maintainability                         | Completed; no findings                |
| typescript_api_docs_reviewer     | gpt-6-sol  | medium    | Required/optional factories, ID/schema/result inference, generated registration, declaration output, TSDoc                | Completed; no findings                |
| performance_reliability_reviewer | gpt-6-sol  | medium    | Creation/restoration/rebuild, error ordering, framework bindings, independent contexts, persistence and resource lifetime | Completed; P2 resolved on follow-up   |
| documentation_reviewer           | gpt-6-luna | medium    | Changed public guides, example instructions and claims, explanatory clarity, current contract                             | Completed; wording advisory corrected |

Security review is not a separate task-level requirement: this feature changes
neither authorization nor credential handling. Reassess if the publication
choice introduces either; no such change is approved or planned.

## Public documentation preflight

Audience, added wording, local links, whitespace, formatting, and TypeScript
snippet compilation all passed for the six public guides/references. Their
prose and runtime behavior are frozen; the source writer is completing
comment-only changes required elsewhere. The documentation review can proceed
on that clean scope while code preflight finishes. Findings will be collected
with the subsequent technical reviews before one correction batch is assigned.

## Technical preflight

Affected builds, tooling typecheck, targeted ESLint, TSDoc, cleanup, formatting,
canonical generated-output comparison, and whitespace checks pass. The final
unfiltered focused run passes 633 tests in 22 files, using canonical generated
outputs. The full release profile and global coverage remain pending publication
scope and review convergence; they are not claimed complete.

New runtime branches have focused behavior checks: present/absent onCreate;
valid/wrong/Promise results; thrown construction; fresh/restored objects in all
three families; deleted Projection rebuild; two separate contexts; default and
custom example services. Constructor validation and delivery helper extraction
are also exercised by the complete affected test directories. Type-only
conditional paths are covered by required/optional constructor and negative
class/schema/Promise compile cases, not by runtime coverage.

The three technical reviewers are dispatched with the explicit profiles above.
Their scope includes the necessary constructor and delivery helper extractions,
and the declaration-local lint exception for the ambient nominal constructor.
Ignore neither the source documentation additions nor the generated manifest
update, but do not broaden into unchanged framework behavior.

## Findings and corrections

Public documentation review completed with the expected explicit Luna/medium
profile and fresh context. No source edits, builds, tests, or child dispatches.
It found no substantive contradiction, and suggested making the Projects test
description more precise: the test posts Commands which produce the Events.
This is a P3 wording advisory, retained for the complete correction batch.
Use "posts two CreateTask Commands" rather than the suggested "creates two
tasks": the actual test posts twice for the same task ID to exercise restoration.

All three technical reviews completed with the expected explicit Sol/medium
profiles and fresh context. Style and TypeScript/API returned no findings.
Reliability found no concrete runtime regression, but reported one accepted P2
coverage gap: the injected-instance tests do not exercise restored history
access or tenant-aware Process Manager queries. Both are explicit requirements
of the approved plan; ordinary-constructor tests alone do not demonstrate them.

The complete correction batch was returned to the retained implementer, using
its existing Sol/medium profile: add those focused checks, and add a failure
report assertion if straightforward. Main corrects the example wording above.
Only reliability coverage needs a follow-up review. Final release checks remain
required after convergence and resolution of the publication choice.

Correction preflight passes: all 299 tests in the two affected files,
workspace tooling typecheck, targeted ESLint, formatting, and whitespace. The
correction changes tests only. The retained reliability reviewer receives the
bounded follow-up using its existing explicit Sol/medium profile; it checks
the original P2 and the added tests, without reopening unchanged concerns or
running duplicate verification. The example wording advisory is corrected.

The follow-up review confirms the P2 resolved, with no introduced defect:
the restored injected Aggregate reads the prior persisted state, and the
injected Process Manager reads tenant-specific Projections across A/B/A with
the expected callback Versions. The explicit retained Sol/medium profile is
accepted; no runtime metadata mismatch was visible. All accepted Entity review
findings are resolved. Publication policy and the final release gate remain
pending; no remote CI success is claimed for this branch.

## Three additional whole-changeset rounds

Requested explicitly by the human after the initial specialist wave. Each
whole-changeset review function uses a fresh default-agent context with explicit
Sol/medium, no conversation history or memory, and no prior review findings.
The earlier specialized follow-up could not cover all concerns and is not
counted as a whole-changeset round.

1. Round one reviewed base `794bd524b` through `1497b95e3`: no actionable
   findings. It covered runtime, public types, tests, Projects, public docs,
   package versions, lockfile, generation markers, and release test updates.
   No edits, tests, or builds were performed by the reviewer. The explicit
   Sol/medium profile is accepted; no separate runtime introspection is exposed.
2. Round two independently reviewed base `794bd524b` through `1497b95e3`:
   no actionable findings across runtime, public types, tests, public docs,
   Projects, generated metadata and version alignment. Whitespace was clean;
   no edits, builds, or tests were performed. Explicit Sol/medium accepted
   without visible mismatch. No correction was needed after either round.
3. Round three reviewed the complete diff in another fresh explicit Sol/medium
   context. It initially proposed detecting reused callback results with a
   WeakSet, then withdrew that finding after comparing it with the approved
   application preconditions and limited runtime validation. No failure with
   a conforming callback was established. Its remaining P3 wording finding
   was accepted and corrected: TECHNICAL_SPEC and the creation helper TSDoc
   now name wrong-class and Promise results explicitly instead of implying
   all incorrect callbacks are detected. No runtime tracking was added.

All three whole-changeset rounds are complete, their explicit profiles accepted,
and every accepted finding corrected. None used memory, inherited chat history,
or earlier reviewer conclusions. No production behavior changed in these rounds.
The final preflight and release checks follow; dual-tag publication remains a
separate supported-authentication blocker.

## API documentation correction after release verification

The full release gate found private constructor helper references in TypeDoc
output. Earlier reviews did not catch this. Configuration/annotation attempts
were ineffective and reverted. A bounded architecture consultation confirmed
the converter limitation and retained the nominal TypeScript contract. The
implementer is adding a narrowly scoped, supported converter plugin with
behavior tests; the strict API checker remains unchanged. Fresh
typescript_api_docs_reviewer and style_maintainability_reviewer assignments
use explicit Sol/medium with no inherited context after targeted mechanical
checks. Reliability is covered within the plugin's exact matching and
fail-closed shape tests and API review; there is no new Entity runtime path.
No new framework or wire contract, dependency, or authentication behavior.

Both fresh correction reviewers completed with no actionable findings. The API
review confirmed precise helper matching, retained structural constraints and
unchanged TS declarations. Maintainability confirmed the bounded supported
converter integration and focused tests. Both explicit Sol/medium profiles are
accepted without visible mismatch; no separate runtime metadata is exposed.
The real docs:api:check and eight focused tests passed before review. Repeat the
complete cheap preflight before rerunning verify:release, then package-consumer
preparation and publication audits if successful. No gate has been weakened.
