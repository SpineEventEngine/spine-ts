# Entity dependency configuration work log

## Implementation start — 27 September 2026

Branch: `entity-dependency-configuration`.
Base: `794bd524b8875f10a75777a41bbebe1dbece600b`.
The human approved the proposal and requested implementation in this chat.
The plan's Human-Imposed Requirements Ledger remains binding. Its analysis-only
restriction is superseded by this approval; no live npm publication or tag
mutation, PR creation, or master change is authorized.

Classification: high-risk public construction/lifecycle contract and release
policy. Estimate: 2–3 hours active implementation, focused verification,
documentation/example, review and corrections; CI waiting additional.

The working tree initially contained only the preceding task's planning record
and publication decision amendment. Fresh origin fetch still resolves master
to the recorded base. Use this checkout per the human instruction, not a new
chat/worktree. The architecture assessment is complete; do not repeat it unless
a demonstrated contract blocker requires one.

## Skills and dispatch

The applicable session catalog, installed skill manifest/lock and project skill
manifest were checked during planning. With implementation now approved, main
read implement, test-driven-development, subagent-driven-development and its
implementation prompt completely. Repository role/model rules, retained
implementation context, one aggregated review wave, existing task records and
the human's no-new-worktree instruction override conflicting skill defaults.
Verification and review skills will be read before their governed actions.

Desktop supports explicit profile selection. Each dispatch below must supply
both model and reasoning. Native runtime self-introspection is not separately
exposed; explicit immutable dispatch is accepted absent a visible mismatch.
No child may spawn children. Main handles records, Git, versions and release
coordination. One implementer changes production/tests/examples/TSDoc; broad
human documentation is coordinated after the interface stabilizes.

| Assignment                                                            | Existing role/function                          | Model      | Reasoning |
| --------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- |
| Entity callback, typing, behavior tests, example and subsequent fixes | implementer                                     | gpt-6-sol  | medium    |
| Pinned npm trusted-publishing and tag API evidence                    | Read-only version-specific API investigation    | gpt-6-luna | medium    |
| Focused and final checks                                              | Orchestrator-dispatched mechanical verification | gpt-6-luna | low       |
| Style/maintainability review                                          | style_maintainability_reviewer                  | gpt-6-sol  | medium    |
| TypeScript/API review                                                 | typescript_api_docs_reviewer                    | gpt-6-sol  | medium    |
| Lifecycle and publication reliability review                          | performance_reliability_reviewer                | gpt-6-sol  | medium    |
| Human documentation review                                            | documentation_reviewer                          | gpt-6-luna | medium    |

Only one heavy test/build process runs at a time. Focused red/green checks come
first. Never interrupt a runner because it prints a failing test; allow its full
summary and natural exit. Reserve `verify:release` and package-consumer checks
for convergence after cheap preflight and reviews. No duplicate full baseline
run: master's published tree is the previously verified branch tree.

## Progress

- Runtime slice: starting with failing tests and constructor typing.
- Publication slice: read-only source/authorization investigation in parallel;
  code changes follow through the same implementation context.
- Version preparation: verify next common snapshot is unused; version-only
  commit, then dependency pins/lockfile separately. Push every commit immediately.
- Review: pending; all four concerns apply. Security review is required only if
  release authorization changes, or for final project release-readiness.
- Local release/consumer checks: pending.
- Remote CI: the current Build workflow runs on pull requests only. No new PR
  is created without human instruction; report that limit if none exists.

Registry inspection confirmed all 19 public packages expose snapshot.15 through
`snapshot`, and snapshot.16 is absent from every package. All 31 tracked workspace
manifests are therefore updated to snapshot.16 in the separate version-only
commit. Existing `latest` tags remain snapshot.2 or snapshot.13; no registry
mutation was performed. Internal dependency pins follow separately.

The version-only commit `112af3806` was pushed immediately. Internal pins and
Proto manifests were then updated to snapshot.16 and the lockfile refreshed.
The lockfile diff changes only workspace specifiers. Frozen-lockfile install
passed without install scripts, and the release CLI accepted the package
inventory. Existing dependency deprecation notices appeared during lockfile
resolution; no dependency-cycle warning or third-party version change occurred.

Runtime red test: the supplied Aggregate callback was never called, yielding
`[]` instead of the expected new/restored Versions `[0, 1]`. One test failed as
expected. An initial dependency guard failure coincided with the pin update;
the frozen install resolved it, and subsequent commands must use the normal
guard without an override.

Typing blocker: tsc confirmed `typeof Entity` rejects a constructor with a
required service argument. Removing that intersection admits such constructors
but loses two existing rejection checks for manually widened class aliases;
SpecScanner also consumes the static constructor type. Main paused a proposed
new runtime base class and requested a bounded follow-up from the existing
requirements splitter (explicitly configured Astra/high) to prefer a type-only
solution. This is the demonstrated architecture-blocker exception, not a repeat
of the completed general design pass. Independent runtime tests continue.

The bounded follow-up completed with the same explicit Astra/high profile.
It proposes a non-exported ambient constructor declaration inheriting Entity's
existing protected static marker and exposing an internal constructor type with
unrestricted application arguments. This is erased TypeScript syntax, not a
new runtime superclass. Existing fabricated-constructor negative cases remain
valid and unchanged. The implementer is proving this candidate with tsc before
acceptance; the architecture report alone is not compiler evidence.

The implementer verified the ambient constructor declaration with
`pnpm exec tsc --noEmit -p tsconfig.eslint.json --pretty false` (exit zero).
Existing negative constructor checks remain in force; new required-service,
optional-service, async-factory, and wrong-result cases are checked too.
Focused Projection and Process Manager runtime checks passed (two tests).
Generated registration and construction failure tests are still in progress.
Main applies the doc-coauthoring skill's reader-focused structure within the
approved autonomous workflow; no additional document interview is needed.

Generated registration's focused runtime test passed: its required-service
Process Manager received the client on creation and restoration with Versions
zero and one. The Projects example will use `AssignmentWeightService` with
`AssignmentManager`, retaining default weight one.

The independent mechanical documentation check used explicit Luna/low dispatch
and completed without edits. Audience rules, scoped whitespace, local links,
and added-line wording checks passed. Existing baseline wording was not expanded
into unrelated work. Example compilation remains pending the example update.

The GitHub CLI initially received HTTP 401 because its environment token had
expired. Running read-only commands without that override used the existing
valid saved login; no credentials were changed. The PR listing returned no open
PR for this branch. `git ls-remote` confirmed the pushed dependency-pin commit.

The Projects test exposed an existing example limitation: AssignmentManager's
`@Subscribe` metadata is not executed by the Process Manager Event path, which
selects reactions. This task changes that one handler to supported `@React`
with an explicit `undefined` result and regenerates its handler metadata. It
does not change framework subscription semantics or unrelated example managers.
The cleanup checker also identified two modified callables over 35 lines:
Repository's constructor and Projects context assembly. The implementer is
extracting bounded existing registration steps without changing execution order.

The Projects dependency test now passes with supported `@React` metadata:
two service calls, stored updates six, and Version two. Cleanup passes after
the bounded helper extraction. Tooling typecheck also passes. Main caught and
returned a refactoring detail before review: initial registration must retain
the validated identity values rather than newly call overridable getters.

TSDoc preflight failed with 455 output lines, mostly existing undocumented
methods in modified bounded-context.ts and entity-metadata.ts. The systematic
debugging skill guided source/policy inspection before correction.
`CODE_QUALITY.md` explicitly requires documentation for every class/method and
generic in a modified production file. The checker correctly applies that
file-wide rule. The implementer will complete the semantic comments and spacing;
no checker weakening, new debt baseline, or blanket suppression is allowed.
The original checker output is retained at
`/tmp/spine-entity-configuration.O1NMsX/tsdoc-preflight.log`.

To reduce repeated reading while preserving one source writer, two independent
read-only documentation/API checks use explicit Luna/medium dispatch. One
checks missing context-access and public builder method descriptions; the other
checks internal context assembly/lifecycle helper descriptions. They may return
source-grounded wording proposals, but cannot edit files or launch children,
builds, or tests. The retained Sol/medium implementer checks and applies any
useful proposals while documenting Entity metadata. These are preparation
functions, not substitutes for the independent review wave.

Both read-only documentation checks completed with their explicit Luna/medium
profiles and sent source-based wording proposals to the retained implementer.
They made no edits and ran no builds/tests. Main recorded token hashes of the
five runtime/example source files before the documentation-only correction;
compare those after correction to detect unintended non-comment edits.

The focused combined runtime run passed five files: 20 selected tests passed,
385 tests were intentionally skipped by the filter. It covered the new factory
cases, generated registration, Projects dependency behavior, and all five
Process Manager query tests. This is focused evidence, not a full suite claim.

Main inspected the generated server declarations after the focused build:
the internal ambient constructor shape is present in entity.d.ts, absent from
entity.js, and not re-exported by the public server entry point. Public-guide
snippet compilation passed for all six changed guides/references with no
diagnostics. The independent public-documentation review completed; its one
wording advisory is recorded for the aggregated correction batch.

TSDoc now passes. Completing nested method documentation exposed one enclosing
delivery-descriptor callable over 35 lines. A narrow extraction preserves its
frozen descriptor, tenant validation, endpoints, replay, and readiness behavior;
the focused delivery regression passed three tests. Cleanup and tooling
typecheck pass again. Comparing TypeScript's comment-free parsed output against
the runtime checkpoint confirms the other four source files are unchanged;
only bounded-context.ts contains the reported delivery helper extraction.

Both default and custom Projects weight tests pass. The implementer has frozen
the source for independent preflight and retains its context for fixes. The
Luna/low verification function is now rebuilding only affected declarations,
linting changed source/tests, running complete Entity/context/repository and
Projects test directories, and checking generated cleanliness and whitespace.
It will not run the full release profile while publication scope is pending.

Independent preflight completed with its explicit Luna/low profile: affected
build passed; all 633 tests across 22 files passed; whitespace passed. ESLint
reported nine findings (test callback braces, unused import, redundant casts,
an async negative type fixture, and the deliberately type-only ambient class).
The retained implementer corrected them. The ambient declaration retains one
local explanatory lint exception: it preserves the protected nominal type
without emitting a runtime class or exporting a nonexistent runtime value.

The generated-output check first failed because direct Node invocation lacked
pnpm's generator PATH. The pnpm-wrapped command then correctly detected stale
Projects outputs after the earlier scoped generation. The implementer is running
the canonical root generation command and rechecking affected builds and
cleanliness. Technical review awaits
these mechanical corrections; the public documentation review is retained.

Report correction: the implementer disclosed an earlier manual restoration of
the generationId strings in examples/projects/spine-proto-manifest.json and
generated/.spine-proto-generation.json after scoped generation. The latter
marker is tracked as an explicit exception inside the ignored generated tree.
This violated the required generated-output boundary; the earlier blanket
"not hand-edited" claim was incorrect. No Protobuf source or generated message
or handler body was hand-edited. Canonical root generation has rewritten both
IDs, and its subsequent cleanliness check is required before acceptance.
Do not repeat that metadata restoration or hide generated metadata drift.

Canonical generation, affected build, targeted ESLint, tooling typecheck,
TSDoc, cleanup, formatting, and generated-output comparison now pass. The
independent Luna/low verifier reran all affected directories against the
canonical artifacts: 22 files and 633 tests passed again; whitespace passed.
The source is frozen for the three fresh technical reviewers, with the already
completed public-documentation review retained in the same wave. New decision
branches and the corresponding behavior/type tests are mapped in the review log.

The implementation checkpoint cc3a0de14 was pushed. Main's explicit staging
list initially omitted the tracked generation marker; its value was verified
equal to the already committed manifest and added in pushed commit 0bd063089.
This records the same canonical generated artifacts used in the passing tests,
not a new runtime change. GitHub reports no open PR for this branch, so no PR
Build run exists yet. Independent style and TypeScript/API reviews returned no
findings with their expected explicit Sol/medium profiles; reliability is pending.

## Review corrections

Human follow-up requests three additional sequential whole-changeset review/fix
rounds. Each receives fresh context with no history or memory, explicit
gpt-6-sol/medium, using the existing performance/reliability review role for
whole-change correctness and regressions; the prior specialist dispositions
remain recorded. Reviewers read the full diff and requirements, do not edit or
run heavy checks, and do not dispatch children. Collect each complete report,
fix accepted findings in the retained implementation context, verify affected
behavior, then start the next fresh review. Estimate: 0.5–0.9 additional hours
for these three rounds and focused rechecks. The human request overrides the
normal limit on complete review rounds. Round one can review the current Entity
changes while the independent publication API investigation runs read-only;
any subsequent release implementation must also receive review.

Dispatch correction: the initial performance/reliability reviewer reported no
findings but confirmed its configured instructions prevent a whole-changeset
review. Its result is retained only as reliability evidence, not counted as
one of the human's three rounds. For those rounds, dispatch a fresh default
agent explicitly as the human-requested whole-changeset review function with
Sol/medium, covering the existing technical and documentation concerns; do not
create or rename a persistent project role. No prior results or memory enter
these fresh reviewer contexts.

Whole-changeset rounds one and two completed with no actionable findings across
all changed categories. Both used fresh explicit Sol/medium contexts and did
not edit or run builds/tests. Round three is dispatched the same way. The
release authentication decision remains separate: after these Entity reviews
converge, verify the current complete changeset once with verify:release and
the package-consumer preparation check, without claiming the unimplemented
dual-tag change has passed. This closes the independent runtime verification
rather than waiting indefinitely on an unrelated release-policy choice.
The mechanical verification function retains its explicit Luna/low profile;
only one heavy process may run. Existing scoped tests/typechecks are still
current because review rounds changed no source, tests, or public guides.

Round three completed full-scope review and withdrew its proposed runtime
WeakSet after verifying the approved boundary: freshness and unchanged options
are callback preconditions, not a promise of exhaustive runtime validation.
No valid-callback defect was found. Its remaining P3 wording correction is
applied to TECHNICAL_SPEC and the creation helper TSDoc, explicitly naming
wrong-class and Promise results. This is a comment-only production-file change;
no runtime logic or test changes. All three requested rounds and accepted fixes
are complete. The verification skill requires fresh evidence for final claims;
the Luna/low mechanical function will check the wording correction, then run
one full release profile and package-consumer preparation check.

Final release verification stopped naturally at docs:api:check: TypeDoc output
exposes internal EntityConstructor machinery. Build, tooling typecheck, global
ESLint, cleanup, TSDoc, copyright and formatting passed; the global coverage
tests were not reached. Consumer and audit checks did not run. This is a real
documentation-generation defect missed by the reviews, not a green release.
Return it to the retained explicit Sol/medium implementer for a bounded fix,
with targeted API-doc generation and constructor type regressions. Do not
weaken the forbidden-internal-symbol gate or simply rename a leaking symbol.
After the fix, rerun the complete cheap preflight before another release gate;
only substantively affected API documentation concerns need follow-up review.

Two targeted TypeDoc annotation approaches failed and were reverted: inlineType
on the public alias and inline on the internal alias. @internal hides the helper
declaration but its reference/type-query remains embedded in Repository and
builder generic constraints. This is a demonstrated nominal-type/docs blocker.
The retained requirements splitter receives one bounded Astra/high consultation
to preserve compiler nominality while producing public docs without private
helper names. No permission to weaken documentation checks, add runtime types,
or introduce broad new tooling. The implementer remains the only source writer;
the consultation is read-only. Explicit retained profile is acceptance evidence
without separate runtime self-inspection.

The bounded Astra/high consultation confirmed TypeDoc 0.28.19 query conversion
does not honor inline directives, and resolved generic constraints lose the
original public alias syntax. Correcting excludeTags plus annotations removed
one direct alias but still leaked private typeof queries; the targeted check
failed naturally. Those ineffective edits are reverted. Approve the supported
fallback: a small local TypeDoc converter plugin, loaded by typedoc.json for
both generation paths, removing only exact internal nominal helper members
from documented constructor intersections. Preserve constructor, instance,
prototype/name and schema members, actual TypeScript source/declarations, and
the strict forbidden-name checker. Focused tests must prove unrelated types
and unexpected shapes are not silently removed. This is presentation-only,
not a new runtime abstraction. The retained Sol/medium implementer writes it;
fresh API/style review follows targeted mechanical checks.

The retained implementer completed the correction in scripts/typedoc-entity-types.mjs,
its focused test, and typedoc.json. An initial wrong event-callback arity failed
the real API check, then was corrected against TypeDoc's actual context-only
event and covered by a load-hook regression. Final eight focused tests, real
docs:api:check (including all 240 server exports), targeted ESLint/formatting,
TSDoc, cleanup, tooling typecheck and whitespace pass. No server runtime source
or emitted declaration contract changed. Fresh API and maintainability reviews
use the recorded explicit Sol/medium profiles, no memory or prior chat history,
before the complete cheap preflight and release rerun.

Fresh API and maintainability reviewers completed without findings, using the
explicit recorded Sol/medium profiles and no memory/history. The complete
correction wave is accepted. The retained Luna/low mechanical function repeats
the complete cheap preflight, including the real API-doc gate and focused
Entity/Projects/plugin behavior tests, before one release rerun. On success it
then runs package-consumer preparation and publication audits, sequentially.
No live publication, npm tag mutation, credential reading, or PR creation.

The release retry completed its full coverage run naturally: 5,015 of 5,019
tests passed, with four failures in three files. All four fail before package
consumer setup because the new server README links outside its packed package
to ../../docs/USER_GUIDE.md. No coverage summary was produced on failure.
Main corrects repository-level links in the published server README and
REFERENCE to official GitHub URLs; package-local reference links remain local.
This is a documentation-only mechanical correction, not a runtime or script
change. Estimate: 0.1 hours for the correction and focused link checks, plus
the measured full-suite waiting time (about nine minutes) after preflight.
The retained Luna/low function reruns the three failing files first, then the
complete cheap preflight before one further release attempt. Existing reviewer
dispositions remain valid for this deterministic link correction.

The focused regression passes all three files and 36 tests in 61.64 seconds.
It includes real release-cli prepare --check and native/full tarball consumers,
not just mocked preparation. Reuse their successful full-suite rerun as final
package-consumer evidence rather than invoke identical preparation a third
time. Audits still run separately after full verification. No test or gate was
weakened; the fix changes only server documentation URLs.

## Final verified state

The explicit Luna/low verification function completed naturally on source
commit e14e196ae36478ac2045d9d175b01a44c9e1902f. Complete preflight and
verify:release pass: 303 files, 5,019 tests, no skipped tests reported,
580.85 seconds. Coverage is 93.27% statements, 90.05% branches, 93.08%
functions, and 94.42% lines. The real staged release preparation and native/full
packed consumers pass inside that suite. Both all-dependency and production-only
audits report no known vulnerabilities. Main checked the raw final summaries
and confirmed the exact pushed remote SHA. No visible profile mismatch.

Evidence: /tmp/spine-entity-configuration.O1NMsX/release-links-final.log,
package-links-focused.log, and audit-final.log. Earlier failed release logs are
retained, not replaced. The final record update changes no verified source.
All three requested independent no-memory whole-change rounds and accepted
fixes are complete, along with the bounded TypeDoc correction review.

No open PR exists for this branch; no CI success is claimed. No publication or
tag mutation occurred. The Entity work is locally verified and pushed, but
publication remains blocked: both tags must advance and npm trusted publishing
cannot automate the second tag update. The human's answer on a manual
authenticated second-tag step is still required. Do not merge for publication
until that requirement is settled; do not introduce stored tokens or a private
authentication workaround. This historical blocker was resolved by the human's
28 September decision recorded below.

The independent review wave completed. Style and TypeScript/API found no
issues. Reliability found no runtime defect but identified missing tests for
history access and tenant-aware Process Manager queries on injected instances.
These are required by the approved plan, so the finding is accepted. The
retained Sol/medium implementer received one bounded correction batch, without
new agents or production changes unless a test exposes a defect. Main corrects
the Projects README to describe the actual Commands and resulting Events.
Only the affected reliability concern will be reviewed again.

The new focused query check passes for tenant A, tenant B, then restored tenant
A, with callback Versions 0, 0, 1 and separate query results. The first history
check failed because its new Aggregate Assign fixture returned no Event, which
the existing runtime correctly rejects. The fixture now returns ProjectCreated
with the corresponding outcome metadata. Both focused checks pass: restored
history contains the earlier service-derived state, callback Versions are 0, 1,
and final state uses the same service. No production change was needed. Full
affected-file and mechanical checks precede the limited review follow-up.

The retained implementer completed the correction using the accepted explicit
Sol/medium profile. All 299 tests in both affected files pass without filtering;
tooling typecheck, targeted ESLint, formatting, and whitespace also pass. No
runtime code changed. The retained reliability reviewer is checking only its
original finding and this correction, using its existing Sol/medium profile.

The reliability follow-up confirms the P2 resolved with no remaining finding
or introduced defect. The Entity implementation and documentation review is
complete. The correction will be committed and pushed immediately. No PR
exists for this branch at the last GitHub check, so no branch CI result is
available. The final release profile is deferred until the publication choice
below is resolved; scoped passing checks are not a claim of release readiness.

## Publication support and human decision

27 September follow-up: the human answered "Both tags advance." Future snapshot
publication must advance both latest and snapshot to the same version; leaving
snapshot behind is rejected. The remaining question is technical support, not
the intended policy. No stored npm credential, patched third-party library,
private authentication workaround, or live publication is authorized.

Estimate: 0.2–0.4 hours for supported-API verification, plus 0.4–0.8 hours for
implementation, review, and checks if a supported credential-free path exists.
This continues the existing high-risk release slice and branch. Main re-read
systematic-debugging for source-first constraint verification. Desktop still
supports the explicit profiles. A read-only version-specific API function is
assigned gpt-6-luna/medium to check current npm CLI and registry documentation,
including dist-tag authentication and multi-tag publication. No builds, tests,
live registry writes, credential reads, or child dispatches are permitted.
Runtime introspection is not separately exposed; explicit dispatch fields are
the profile evidence absent a visible mismatch.

The fresh Luna/medium investigation completed using the explicit profile,
read-only, without memory, file changes, builds, tests, registry writes or
child dispatches. It confirms the same limitation in pinned npm 11.16.0 and
current upstream CLI: publish accepts one tag; dist-tag uses traditional auth,
not the publish-only OIDC helper. The registry can represent both tags, but
the supported trusted-publishing flow cannot automate both. Re-publishing the
same version is prohibited; staged publishing also selects one tag and requires
human approval. Main independently checked the current official documentation.
Sources: [trusted-publishing limitations](https://docs.npmjs.com/trusted-publishers/#limitations-and-future-improvements),
[pinned publish command](https://github.com/npm/cli/blob/v11.16.0/lib/commands/publish.js),
[pinned dist-tag command](https://github.com/npm/cli/blob/v11.16.0/lib/commands/dist-tag.js),
and [publish tag contract](https://docs.npmjs.com/cli/v11/commands/npm-publish/#tag).

An asynchronous question asks whether a manual authenticated second-tag step
after each CI publication is acceptable without storing a token in GitHub.
Only that supported-process choice can unblock the release slice under the
current constraints. Entity review rounds continue independently.

The Luna/medium API investigation completed read-only. Main verified the current
[npm trusted-publishing limitations](https://docs.npmjs.com/trusted-publishers/#limitations-and-future-improvements)
and [single string tag configuration](https://docs.npmjs.com/cli/v11/using-npm/config/#tag).
Pinned Lerna 10.0.1 source publishes with one tag; its temporary-tag flow is not
a supported dual-tag option. Separate npm dist-tag mutation is outside the
documented trusted-publishing command support. No token fallback, third-party
patch, custom OIDC credential reuse, or live tag mutation is introduced.

The earlier asynchronous question offered latest-only publication or continued
advancement of both tags. The human rejected latest-only; the remaining
manual-step question and supported-flow limitation are recorded above.

## Snapshot-only publication confirmed — 28 September 2026

The human instructed: advance only `snapshot` automatically; leave `latest`
unchanged. This replaces the earlier two-tag requirement and closes the
publication-policy question. No manual second-tag step is required.

This is a record-only correction to the existing task, implemented by the main
agent. Estimate: 0.05–0.1 hours for updating the five existing records, checking
their consistency and formatting, and committing and pushing. Acceptance:
current records reflect the new instruction, historical decisions are marked
as superseded, and release code and live npm tags remain unchanged.

Source inspection confirmed `classifyReleaseVersion()` selects `snapshot` for
snapshot versions and `publishRelease()` checks that the opposite tag is
unchanged. No runtime, API, dependency, authentication, or workflow edit is
needed. The verification-before-completion skill guides the focused checks.
All specialist concerns are unchanged: this mechanically records the explicit
human decision and restores the existing policy, so no review lane is reopened.
The completed full release verification remains the source evidence; record
checks do not claim new test or CI results.

Verification: changed-file Prettier and `git diff --check` pass. Source and
existing test inspection confirm snapshot selection, the workflow's single
`--dist-tag`, and rejection when the opposite tag moves. Only five Markdown
records changed. No build or test suite was rerun for this record correction.
