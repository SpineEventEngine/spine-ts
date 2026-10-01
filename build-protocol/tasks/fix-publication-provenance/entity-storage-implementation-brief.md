# Entity storage correction: implementation assignment

## Scope

Implement the first runtime slice of the approved Entity-save/delivery plan.
Work in the existing checkout and branch. You are not alone in the codebase:
main handles task/decision records, public Markdown documentation and Git.
Do not revert or stage their changes. You are the sole runtime/test writer.
No child agents, commits, pushes, branches, package version changes or full builds.

Read AGENTS.md, CODE_QUALITY.md, and the requirements ledger plus Sections 1–3,
6 and compatibility section of entity-save-delivery-plan.md. This brief is the
bounded assignment; later delivery implementation will continue in this context.
Use /Users/armiol/.agents/skills/test-driven-development/SKILL.md and its testing
anti-patterns reference. Reuse generated fixtures; no descriptor/base64 fixtures.
Existing task skill applicability has been checked. Repository workflow overrides
generic advice to add roles, repeat a full baseline build, or create a worktree.

## First: establish the real measurement

Before production edits, add a small repeatable opt-in benchmark using existing
domain-correct routing fixtures and real InMemoryStorageFactory. Use a separate
test fixture/test file rather than enlarging the huge repository-routing file.
No new dependency or custom benchmark framework. One Event must reach 1,000
distinct Process Managers and actually update all their states. Include routing,
Inbox, dispatch, commits and acknowledgements in timing; fixture setup and final
state assertions remain outside. Record Node/hardware, history and retention
settings, one warm-up and five fresh-context runs without coverage, one worker.
Also record 100/500 cases. Timing target is below 1 second on every measured
1,000-recipient run; do not enforce a fragile wall-clock CI test. Keep the same
measurement available for after the later delivery correction. No full tests.

## Runtime changes

Change EntityCommitStorage.commit to Promise<void>; remove expected and the
conflict result throughout all four adapters and repository paths. This is an
exported provider API change, not an application API or schema migration.
Do not remove automatic versions, tenant/type checks, immutable collision
checks, normal DB transaction retries, shard coordination or Inbox CAS.
SQL/Datastore must still finish associated immutable writes when current==next.
Do not add expected-state rejection under another name. Preserve provider-specific
identical replay behavior and MyISAM/Aria ordered partial-write behavior.

Replace whole-map memory staging with preparation of affected entries only.
Finish cloning, key generation, materialization, collision checks and other
throwing validation before synchronous live application. Keep existing queues
without recursively acquiring the same queue through storage methods. If any
supported apply operation can still fail, restore only complete affected prior
entries including prior absence and columns; no collection snapshots/backups.
No new generic transaction framework, locks, outbox or persistent dedup store.

## Files and verification

Responsible paths: packages/storage/src/internal/entity-commit.ts and memory
commit/history/record helpers; MySQL, PostgreSQL, Datastore commit implementations;
packages/server/src/repository/repository.ts call sites; affected tests and the
new real-delivery measurement fixture. Update semantic TSDoc in touched source
files, including private methods, classes and type parameters, blank lines, and
35-line callable limit. Avoid broad unrelated rewrites.

Relevant JVM source: /tmp/spine-jvm-storage-review.lEI6Fm/core-jvm at
ea3067b137938ac0beb6920c39d11e300976fcc9, memory InMemoryRecordStorage/TenantRecords
and entity Transaction. Read those relevant source methods before changes.

Write and run focused failing tests first, then implement and pass them.
Preserve rollback/immutability/tenant tests; replace only Entity conflict-policy
assertions. Test both histories enabled/disabled, delivery events, mutations of
input values, unrelated population, input/live immutable collisions and async
serialization. Update SQL/Datastore fixture calls and declarations together.
Run focused suites, affected typechecks and cheap formatting/cleanup/TSDoc checks.
Do not start Docker or run live DB checks/full coverage suite yet: main schedules
those after both runtime slices. One test worker. No competing benchmark builds.

## Report and handoff

Write entity-storage-implementation-report.md beside this brief via apply_patch.
Keep it current at meaningful checkpoints. Include exact red/green commands,
results, raw timing runs, changed paths, unresolved concerns and check failures.
Return after this bounded slice is complete. Main will check and commit/push it,
then continue delivery implementation in your existing context. Do not stop just
because the pre-delivery benchmark has not met the final performance target.
