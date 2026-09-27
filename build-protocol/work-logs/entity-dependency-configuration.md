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

## Pending publication choice

The Luna/medium API investigation completed read-only. Main verified the current
[npm trusted-publishing limitations](https://docs.npmjs.com/trusted-publishers/#limitations-and-future-improvements)
and [single string tag configuration](https://docs.npmjs.com/cli/v11/using-npm/config/#tag).
Pinned Lerna 10.0.1 source publishes with one tag; its temporary-tag flow is not
a supported dual-tag option. Separate npm dist-tag mutation is outside the
documented trusted-publishing command support. No token fallback, third-party
patch, custom OIDC credential reuse, or live tag mutation is introduced.

An asynchronous question asks whether future snapshots should publish under
latest while the existing snapshot tag stays unchanged, or whether advancing
both remains required. Await this choice before release-policy implementation;
continue the independent Entity runtime work. This is not a blocker for that
runtime slice.
