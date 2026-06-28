# Review Log: T-0005 Metadata And Type Registry

Task log: `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
Work log: `build-protocol/work-logs/T-0005.md`
Branch: `task/T-0005-registry-core`
Baseline commit: `80714f3`
Reviewed commit/diff basis: Implementation working tree before commit; formal
reviewers pending
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0005-registry-core`
Reviewer sub-agents: Review round 1 completed; fix pass ready for re-review
Status: Review round 1 fixes verified; ready for re-review after fix commit

## Reviewer IDs

- Maintainability: `019f0edc-1a7b-7ba1-8c3f-0645ebc1db57`
- Documentation: `019f0edc-4344-7bf1-a173-b5003e4855c2`
- TypeScript/API docs: `019f0edc-756c-7101-9d1e-81c7709dfab7`
- Security: `019f0edc-a25e-7e03-87fe-482060e40d9d`
- Performance/reliability: `019f0edc-c7e1-7ff1-89f3-fcc97abb8f1f`

## Required Review Roles

- Code style/maintainability.
- Documentation.
- TypeScript/API docs.
- Security.
- Performance/reliability.

## Scope To Review

- Metadata and type registry APIs over Protobuf-ES schemas.
- Type URL derivation and lookups by full name, type URL, schema, and semantic
  tag where current descriptors support it.
- Descriptor-backed custom option and metadata visibility.
- Tests, TypeDoc/API docs, package docs, architecture notes, and user guide
  updates for the registry public API.
- Durable logs and decision records for registry design choices.

## Review Rounds

- Implementation self-review, `2026-06-28 16:28 WEST`:
  - Scope check: registry remains in `@spine-ts/core`, consumes curated
    `@spine-ts/proto` exports, and does not add validation, `Any`
    pack/unpack, buses, storage, decorators, handlers, or transport behavior.
  - Tests check: RED/GREEN focused Vitest evidence recorded; final
    `CI=true corepack pnpm verify` passed.
  - Docs/API check: package README, framework guide, API notes/check, and
    architecture notes updated.
  - Deferral check: semantic tag lookup is API-shaped but intentionally empty
    because the current copied proto closure has no provable `(is)` or
    `(every_is)` consumers.

Formal code style, documentation, TypeScript/API docs, security, and
performance/reliability reviewer sub-agents remain pending for the orchestrator
handoff.

- Review round 1, `2026-06-28 16:34 WEST`: reviewer findings received and
  verified against the branch. Required fixes: expose `spineCoreRegistry` as a
  read-only runtime lookup view, validate explicit type URLs, make schema
  lookup methods generic, update stale task/work/review log fields, and update
  D-0028 with the fallback prefix value `type.googleapis.com`.
- Review round 1 fix pass, `2026-06-28 16:46 WEST`: fixes applied before GREEN
  rerun. The pass covers maintainability
  `019f0edc-1a7b-7ba1-8c3f-0645ebc1db57`, documentation
  `019f0edc-4344-7bf1-a173-b5003e4855c2`, TypeScript/API docs
  `019f0edc-756c-7101-9d1e-81c7709dfab7`, security
  `019f0edc-a25e-7e03-87fe-482060e40d9d`, and performance/reliability
  `019f0edc-c7e1-7ff1-89f3-fcc97abb8f1f` findings. Next review step after
  the fix commit is formal re-review of this branch.

## Outcome

Review round 1 fix pass verified and ready for formal re-review after the fix
commit.
