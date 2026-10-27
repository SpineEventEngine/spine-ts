# Environment lifecycle work state

## Current checkpoint

Started 2026-10-27 from freshly fetched official master
`ff6c8669537a016c47f012150306500d3b52b5d1`. Branch `environment-lifecycle` is in
`/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts`.
Checkpoint `c0c312b57` was pushed to official `origin/environment-lifecycle`.
It contains the initial repository Entity-storage retention fix and accepted task
specification. It is not final acceptance. No PR has been created.

Implementation follows [MILESTONES.md](MILESTONES.md). The current patch combines
repository retained-composite acquisition cleanup and EventStore retention. The
first complete review wave found one accepted P1: immediate EventStore close could
interrupt an admitted batch. Its correction passed independent preflight and affected re-review; see
REVIEW_LOG.md.

## Accepted implementation decisions

- Repository cache lookup precedes construction; failed partial acquisition closes
  resources already opened and preserves acquisition plus cleanup errors.
- EventStore retains record storage per complete tenant identity and fixed group.
- Normal EventStore close returns a promise, fences new physical storage groups,
  drains admitted batch/check/query groups and attempts every retained close.
  Provider-only eventStoreAccess.closeIdle supports synchronous construction
  failure only with no active storage work. Normal callers await close; constructor cleanup uses the guard.
- The acceptThenAppend callback gap is outside physical storage work, preserving
  its close-then-reject behavior without introducing a self-deadlock.
- Agent recovery removal precedes shared saved-work scanning. Retained Inbox/shard
  stores must land with the complete Delivery shutdown chain.
- Remaining retention includes repository reads/history/duplicate checks and
  per-commit inner record handles in all four providers. Existing attempt-all
  cleanup gaps in clearRuntime/history-switch remain for the next repository slice.

## Verification evidence

Node 24.18.0 and pnpm 11.9.0; frozen dependency installation succeeded.
Baseline Proto generation, build/tooling typechecks and 50 focused tests passed.
Before review, the combined retention patch passed 386 tests across repository
routing, history cache and EventStore. Source/tooling typechecks, ESLint, cleanup,
TSDoc, formatting, documentation audience and diff checks passed. Exact focused
LCOV covered every changed executable line and branch; this was not a global
coverage claim. A truncated first coverage extraction was corrected before use.

The close-race regression failed against immediate closure. The correction's
523-test run across five suites, storage/server/MySQL typechecks, lint, cleanup,
TSDoc and formatting passed. Independent preflight confirmed those results and all changed EventStore
branches. Two existing Agent integration tests exercised the testing utility.
The accepted API correction moved idle cleanup behind the provider seam; 534
focused tests and all narrow checks passed afterward, and API review confirmed
the public declaration excludes it. Four normal test cleanup calls await close. Final release and live
provider checks have not run. Baseline generation refreshes tracked generationId
stamps; those unrelated stamp changes were excluded from the checkpoint.
Raw outputs and detailed assignment evidence are outside version control under
`/tmp/spine-environment-lifecycle-20261027`.

## Assignment evidence

| Existing role or dispatched function | Agent                    | Explicit configured profile | Scope                                                                               |
| ------------------------------------ | ------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| requirements_splitter                | application_architecture | gpt-6-astra / high          | Frozen milestone sequence; bounded follow-up for demonstrated close contract defect |
| implementer                          | storage_retention        | gpt-6-sol / medium          | Current retention patches, focused tests and accepted corrections                   |
| Mechanical/scanning function         | mechanical_checks        | gpt-6-luna / low            | Independent preflight/LCOV and provider handle inventory                            |

Model and reasoning were explicit in original dispatches and immutable on reuse.
Each agent confirmed its configured profile; runtime introspection is unavailable.
Specialist assignments and dispositions are recorded in REVIEW_LOG.md. No child
delegation occurred. Source inspection used the JVM runtime notes and local
`core-jvm` Repository.storage()/close(), InboxStorage, EventBus and delegated
storage close. No dependency or generic infrastructure was added.

## Next actions

Commit and push the accepted EventStore retention and drain correction. Continue repository/query/history retention and provider
preparation in the frozen order. Keep narrow API docs current; finish broad
examples after interfaces stabilize. Run the full release and security gates at
convergence, choose the required unused common workspace version, and verify
remote state. No existing-data migration, PR creation or master write is authorized.

## Next repository slice preparation

Read-only implementation analysis exposed a concrete close-contract blocker:
clearRuntime and the public administrative state-history switch are synchronous,
while direct query/history reads can be in flight outside bus drains. Retaining
their storage requires defining when those handles close. The existing
requirements_splitter (explicit immutable gpt-6-astra/high) receives only this
bounded blocker and the unchanged-state Process Manager EventStore cleanup path;
it must preserve current administration semantics and avoid a new framework-wide
lifecycle abstraction. No implementation of this slice has started.
