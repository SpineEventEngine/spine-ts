# Three independent reviews of the complete changeset

## Request and scope

On 1 October the human requested three sequential independent reviews, fixes
after each round, a simple explanation, and a copy-pasteable PR description.
Each reviewer starts without conversation history or memory. The full review
base is `9e1147298248a8e0b095bf41ecabd8d8dbb2b511`, not the later runtime
extension checkpoint. The initial head is `153ebbd8a0cf94b02e286f520859260d63af7d9d`.

This remains high-risk work: release authentication/recovery, persistence,
delivery, and published provider contracts. The complete requirement ledgers
are in `TASK.md` and `entity-save-delivery-plan.md`. No new branch, publication,
merge, or PR mutation is authorized. The explicit request for three rounds
supersedes the protocol's ordinary two-wave limit.

## Evidence at entry

Head `153ebbd8a` passed `pnpm verify:publish`, the real-library Rekor
reproduction, and all 19 prepared-archive consumer checks. The full suite had
5,165 passing tests and one opt-in benchmark skipped. Overall branches were
90.04%. GitHub run 36873032271 passed for that exact head.

The one-second performance requirement remains unmet: the comparable fresh
1,000-recipient runs in `performance-corrections-report.md` are above one
second. Passing CI does not establish that target. The existing Datastore
history-trimming timeout remains separately documented; live SQL provider
checks passed. Reviews must not present either limitation as resolved.

## Dispatch and acceptance rules

Desktop CLI supports explicit model and reasoning profiles. Review assignments
use the existing technical-review function with `gpt-6-sol`, `medium`, Standard
speed, fresh ephemeral contexts, memories disabled, and child spawning disabled.
Each round covers the entire diff and records style, documentation, TypeScript
API, and performance/reliability dispositions. The prior dedicated release
security review remains evidence unless a correction changes that boundary.
Actual runtime metadata is recorded when exposed; otherwise explicit immutable
dispatch configuration is the available evidence. No inherited model is used.

Corrections return to the existing Sol/medium implementation context
`01a0f732-e0c9-7970-a2d5-67afc04e3d69`. Only one writer changes runtime files.
Focused checks precede each following review. After convergence, runtime or
release changes require one final full gate and green CI on the pushed head.

Skills used: requesting-code-review, receiving-code-review, and
verification-before-completion from the exposed installed skill inventory.
Their instructions were read completely. Existing task skill discovery remains
applicable. Repository review/model rules supersede generic role names in skill
templates. Review prompts contain requirements and source references, not
earlier reviewers' conclusions.

## Round 1

Assignment recorded before dispatch: independent senior technical reviewer;
explicit `gpt-6-sol` / `medium`; full base-to-153ebbd8a changeset; read-only,
no memory, no children, no full build or test suite. Review all affected runtime,
release, test and user-facing documentation paths against both requirement
ledgers. Completed normally with explicit configured profile and no reported
model fallback; actual runtime model metadata is not exposed.
Reviewer session: `01a0f817-6d70-7ae3-bc49-04e8adc58457`.

Findings and dispositions:

1. P1: one-second performance acceptance is not demonstrated. Accepted. A fresh
   single-worker run at the reviewed head failed: 1234.0135, 1245.568875,
   1215.341083, 1186.454458, 1219.917834 ms. Warm-up 1330.549458 ms;
   100 recipients 120.743375 ms; 500 recipients 613.1835 ms. The unchanged
   benchmark verified every state and exact handler count before failing its
   speed assertion. Return measured performance work to the existing writer.
2. P1 verification gap: the combined Datastore Entity/history emulator test
   has not completed successfully. Accept investigation, not an assertion of
   a new regression. Compare the stalled operation with baseline behavior and
   establish live evidence for affected commit paths. Do not change timeout or
   weaken assertions to obtain a pass; do not expand unrelated baseline work
   without evidence it is necessary for the changed contract.
3. Main's P2 finding: `packages/server/REFERENCE.md` still describes a custom
   `retentionTime()` method that no longer exists. Correct the paragraph.

The reviewer found no other confirmed source defect. Maintainability and
TypeScript/API concerns were clean; documentation requires the correction
identified by main; reliability/performance retains the two evidence gaps.
The report is `/tmp/full-branch-review-1.md`.

Correction assignment recorded before dispatch: resume the existing
implementation context with explicit Sol/medium, Standard speed; no children.
Responsible for focused runtime/test fixes and the stale reference paragraph;
main maintains review records. Use measured causes and failing behavior tests.
Systematic-debugging and test-driven-development skills were read for this
correction. No broad architecture, validation shortcut, dependency patch,
benchmark weakening, public API expansion, or unrelated storage redesign.

The documentation fix passed 57 focused delivery tests, emitting builds,
TSDoc, cleanup, format and diff checks. No runtime code changed. A fresh CPU
profile attributes roughly 196 ms per 1,000-recipient post to repeated registry
construction inside the installed validation package. Its public API offers no
prepared registry. The speed assertion still fails. Main asked the human whether
to extend work to that separate source repository or retain the documented
performance limitation; no dependency edit is authorized pending that answer.

The next bounded correction remains with the same explicit Sol/medium writer:
add and run a real Datastore commit test independent of unrelated history
trimming, preserving the original combined test; trace the trim stall to its
provider operation and classify the baseline evidence. Docker is authorized
for disposable local verification. No other benchmark or heavy check runs
concurrently. Do not broaden production changes without demonstrated need.

The additive live test passed after comparing serialized Protobuf bytes instead
of treating Buffer and Uint8Array object representations as different content.
Main identified a follow-up fixture correction before acceptance: the new
Entity/Event test must use existing generated Project state and Event messages,
not inherit generic StringValue payloads from the older storage tests. This is
an application of the existing domain-correct fixture rule, not a redesign of
the unchanged tests. Return it to the same writer before the correction commit.

Datastore evidence now separates the changed behavior from history trimming:
the new live test passes byte-exact readback, replay, current replacement,
four-family row counts and tenant isolation. A bounded append-only history
probe reproduced eight repeated 128-row reads and 127-row deletes without
calling the revised Entity commit. The relevant trim, query and delete method
bodies match the base revision. This is evidence of a separate existing path,
not a successful baseline checkout run or a resolved trim defect. The combined
test remains intact. The changed commit verification gap is addressed; the
trimming limitation remains recorded rather than being silently waived.

The public npm registry was checked on 1 October: validation's `snapshot` and
`latest` tags both name the installed `2.0.0-snapshot.7`; there is no newer
published release to adopt. Its repository is
`SpineEventEngine/validation-ts`. No edits in that repository, installed
dependency patches, or validation shortcuts have been made or authorized.

The final domain-correct live test passed (one selected test, five unrelated
tests excluded by its explicit filter; 555 ms test time). Test ESLint, tooling
typecheck, cleanup, TSDoc, changed-file formatting, documentation audience and
diff checks passed. The disposable emulator was stopped. The fixture correction
and stale-reference finding are resolved. The reviewer-required commit-path
live proof is now established. All implementation processes have exited.

Checkpoint scope is test/documentation only; runtime and release code remain
byte-identical to the previously verified head. No full local suite was repeated
for this checkpoint. The push starts the regular full PR checks; their exact-head
outcome is not yet known. Do not confuse the previous green run with new CI.

The three-round request is not complete. Rounds 2 and 3 have not started:
the human's requested review-then-fix sequence still has the first round's
unmet performance requirement, and work in a separate source repository needs
the requested scope decision. No final readiness or performance-success claim
is made.

Independent mechanical assignment: explicit `gpt-6-luna` / `low`, Standard
speed, no memories or children. Confirm package source/build freshness and run
the existing opt-in delivery benchmark once, without coverage or profiling.
Do not modify code, lower the threshold, start Docker or run other tests/builds.
Record every raw timing and exit status, including failures. This refreshes the
performance evidence while the read-only reviewer inspects code.

## Round 2

Not started. Starts only after round 1 findings are addressed and checked.

## Round 3

Not started. Starts only after round 2 findings are addressed and checked.
