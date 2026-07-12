# Spine TS Agent Instructions

`build-protocol/BUILD_PROTOCOL.md` is the canonical autonomous-development
workflow. `build-protocol/PROJECT_COMPLETION_PLAN.md` is the current completion
sequence. Preserve all accepted DDD, Protobuf, public API, testing,
documentation, logging, review, and worktree requirements in those files.

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

## Existing Roles

Do not invent, rename, merge, or replace project roles. Project `.codex` files
configure the existing requirements splitter, implementer, four specialist
reviewers, and final security reviewer. Mechanical verification and read-only
scanning remain functions dispatched by the orchestrator; they are not new
agent identities.

## Concurrency And Ownership

- At most four agent threads may exist, including the parent.
- Subagents must not spawn subagents.
- Only one production-code writer may own overlapping files at a time.
- Parallelize only independent read-only exploration, documentation/API
  verification, test analysis, and bounded specialist reviews.
- Return confirmed findings to the current implementation context when it is
  still available; do not create a fresh fixer solely to rediscover context.
- Use separate worktrees only for genuinely independent write-heavy streams.
- Preserve unrelated user changes and dirty-worktree contents.

## Autonomous Cycle

1. Frame the next coherent milestone from actual repository state and record
   behavior-focused acceptance criteria and high-risk assumptions.
2. Invoke deep planning only for new subsystems/bounded contexts, public or
   serialized contracts, domain semantics, transaction/concurrency/idempotency,
   or a demonstrated architectural blocker.
3. Give one bounded implementation owner the milestone and require focused
   behavior tests.
4. Run the narrowest useful mechanical checks before review.
5. Invoke only existing reviewer concerns relevant to the changed behavior.
   Every canonical review concern must still receive a recorded disposition;
   an N/A disposition requires a concrete reason.
6. Return findings to implementation, rerun affected checks first, then the
   appropriate regression suite.
7. Record acceptance, evidence, resolved findings, limitations, and the next
   milestone, then continue automatically.

Do not pause for routine implementation choices. Stop only for the blockers
listed in `build-protocol/BUILD_PROTOCOL.md` and the completion plan.
