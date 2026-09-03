# Spine TS Agent Instructions

## Progress Communication

Immediately send a concise user-facing progress update after every subagent
completion, verification result, review result, merge, push, or real blocker.
Each update must state the outcome, the next action, and whether work continues.
Treat subagent notifications as user-visible milestones, not internal-only
events. Do not end a turn or wait silently while an active task remains.

`build-protocol/BUILD_PROTOCOL.md` is the canonical autonomous-development
workflow. `build-protocol/PROJECT_COMPLETION_PLAN.md` is the current completion
sequence. Preserve all accepted DDD, Protobuf, public API, testing,
documentation, logging, review, and worktree requirements in those files.

## Domain-Correct Protobuf Fixtures

Do not reuse a logically different Protobuf message merely because its fields
or wire shape happen to fit. Commands, Events, Entity states, identifiers,
queries, and responses in production code and tests must use message types that
represent their actual domain concepts. A fixture that posts an Entity state as
a Command, treats a Command as an Event, or substitutes one identifier type for
another is invalid because it hides contract mistakes and teaches the wrong
API.

## Model Allocation

Use Standard speed. Do not enable Fast/boost mode. Do not use Max or Ultra in
the normal autonomous cycle.

- Future main orchestrators default to `gpt-5.6-sol` with `medium` reasoning.
- Requirements splitting, architecture, domain modelling, public-contract
  design, and difficult milestone planning use `gpt-5.6-sol` with `high`
  reasoning only at milestone boundaries or demonstrated architectural blocks.
- Normal TypeScript implementation, ordinary fixes, and bounded refactoring use
  `gpt-5.6-terra` with `medium` reasoning.
- Correctness, DDD, compatibility, concurrency, persistence, security, and
  difficult public-contract review use `gpt-5.6-terra` with `high` reasoning.
- Builds, tests, typechecking, linting, log triage, and repository scanning use
  `gpt-5.6-luna` with `low` reasoning; use `medium` when classification or
  version-specific verification needs judgment.
- Documentation, dependency, package, and version-specific API verification use
  `gpt-5.6-luna` with `medium` reasoning.
- Escalate to `gpt-5.6-sol` with `high` reasoning only for high-risk
  architecture/correctness ambiguity or after a lower-cost configuration cannot
  establish the answer.

Always pass the model and reasoning explicitly when spawning a subagent. Never
allow the parent model to become the accidental default for a child.

For an approved frozen wave, run one `gpt-5.6-sol` / `high` architecture pass.
Repeat it only for a material contract change or a demonstrated architecture
blocker. Persist scripts-first mechanical evidence before asking an agent to
classify an ordinary failure. Use `gpt-5.6-terra` / `medium` for ordinary
implementation, and Luna/medium or Terra/medium for ordinary documentation,
package, and API-documentation work. Reserve Terra/high for public or wire
contracts and real correctness, persistence, concurrency, or lifecycle risk.

Before accepting child work, record the assignment's existing role or
orchestrator-dispatched function, expected model, and expected reasoning in the
task or review log. Confirm that both fields were explicit in the dispatch.
Record actual runtime metadata when the surface exposes it; otherwise record
the immutable configured role/profile and the metadata limitation. Missing
self-introspection alone does not invalidate a result. Reject and redispatch
only an omitted field, wrong role, visible mismatch, or actual fallback to an
inherited profile. This is an orchestrator acceptance gate, not a separate
verifier role.

At session startup, confirm that the selected execution surface supports the
required model profiles and explicit child model/reasoning dispatch. Desktop
support satisfies this gate even when a separate shell CLI is stale. If the
selected surface is incapable, update it or select a capable installed surface;
do not block work merely because an unused surface needs an update.

## Existing Roles

Do not invent, rename, merge, or replace project roles. Project `.codex` files
configure the existing requirements splitter, implementer, four specialist
reviewers, and final security reviewer. Mechanical verification and read-only
scanning remain functions dispatched by the orchestrator; they are not new
agent identities.

## Concurrency And Ownership

- The project imposes no numerical cap on concurrent agent threads. Use the
  execution surface's available capacity while obeying file ownership and
  independence rules. Sequence work only when capacity or dependencies require
  it, and collect a complete review wave before returning one accepted finding
  batch for fixes.
- Subagents must not spawn subagents.
- Only one production-code writer may own overlapping files at a time.
- Parallelize only independent read-only exploration, documentation/API
  verification, test analysis, and bounded specialist reviews.
- Return confirmed findings to the current implementation context when it is
  still available; do not create a fresh fixer solely to rediscover context.
- Use separate worktrees only for genuinely independent write-heavy streams.
- Preserve unrelated user changes and dirty-worktree contents.

## Autonomous Cycle

1. Classify the milestone as micro, standard, or high-risk using
   `BUILD_PROTOCOL.md`, and record behavior-focused acceptance criteria and
   high-risk assumptions proportionate to that class.
2. Invoke deep planning only for new subsystems/bounded contexts, public or
   serialized contracts, domain semantics, transaction/concurrency/idempotency,
   or a demonstrated architectural blocker.
3. A micro task may be implemented directly by the orchestrator. Standard and
   high-risk tasks use one bounded implementation owner and focused behavior
   tests.
4. Run deterministic mechanical checks before specialist review. Mechanical
   findings do not require a reviewer invocation.
5. Invoke only existing reviewer concerns relevant to the changed behavior.
   Every canonical review concern must still receive a recorded disposition;
   an N/A disposition requires a concrete reason.
6. Collect one complete review wave, aggregate its findings, and return one
   correction batch to implementation. Re-review only substantively affected
   concerns; record-only and deterministic corrections do not reopen lanes.
7. Run the mandatory cheap preflight before an expensive verification profile.
   Use `verify:task` for bounded changes and `verify:release` for shared runtime,
   build, and release work. Run the selected expensive profile once after
   convergence, not as a diagnostic loop.
8. Keep reviewer inputs concern-specific, return one accepted finding batch to
   the existing implementation owner, and use deterministic documentation and
   coverage checks before review.
9. Record acceptance, evidence, resolved findings, limitations, and the next
   milestone, then continue automatically.

Keep narrow TSDoc and behavior claims current in each runtime slice. Defer broad
documentation and all-example execution until the affected runtime interfaces
stabilize, unless a concrete changed interface requires earlier expansion.

## Official Repository Workflow

The only development remote is `origin`, and it must resolve to
`SpineEventEngine/spine-ts`. Never fetch from or push to a personal fork.
Treat official `master` as protected, coordination-only history:

- start every task from a freshly fetched `origin/master` in a separate feature
  branch and worktree;
- never create a branch whose name begins with `codex/`;
- push every feature-branch commit to `origin` immediately, including
  checkpoint and review-correction commits;
- never commit, merge, or push directly to `master` unless the human explicitly
  instructs that exact action;
- never create or merge a pull request unless the human explicitly asks;
- never rewrite a published feature branch or delete an organization branch or
  tag without explicit human direction.

Every merge to official `master` starts NPM publication. Every feature branch
intended for merge must therefore include one version-only commit that updates
every workspace manifest to one common unused version. That commit changes only
top-level `version` fields and uses the exact message `Bump version -> <version>`.
Internal dependency pins and the lockfile belong in a separate commit. After a
human merges the pull request, fetch and verify the resulting `origin/master`;
do not integrate or push it yourself.

A task is durably ready for human review when its required feature-branch pushes
succeed and its verification and review evidence are current. Remote cleanup is
not a task-completion invariant in the shared organization repository.

Do not pause for routine implementation choices. Stop only for the blockers
listed in `build-protocol/BUILD_PROTOCOL.md` and the completion plan.
