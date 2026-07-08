# T-0016b: Framework-Owned Generated Repository Assembly

Status: implemented; round 2 documentation/API fixes in progress
Start: `2026-07-08 03:00 WEST`
Baseline commit: `08d8f0e`
Task log path:
`build-protocol/tasks/T-0016b-framework-owned-assembly/TASK.md`
Branch: `task/T-0016b-framework-owned-assembly`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016b-framework-owned-assembly`
Roadmap parent:
`build-protocol/tasks/T-0016-framework-readiness-roadmap/TASK.md`
Review log: `build-protocol/reviews/T-0016b-framework-owned-assembly.md`

## Objective

Make bounded-context assembly own generated handler registry discovery and
default repository creation, so ordinary application code can add entity classes
without importing handler-registry internals or manually constructing
repositories from generated metadata.

The intended end-user shape is JVM-familiar and small. Generated registry
discovery uses dynamic module import from an explicit trusted compiled package
root, so this generated-assembly path uses the async build method while the
existing synchronous `build()` remains for explicit repository assembly:

```ts
return await BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .add(TaskListProjection)
  .withGeneratedRegistryRoot(compiledPackageRoot)
  .buildAsync();
```

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use one implementation sub-agent for this task and separate reviewer
  sub-agents for style, docs, TypeScript/API docs, security, and
  performance/reliability.
- Close every participating sub-agent once its role is complete.
- Update durable task, work, decision, and review logs before or alongside
  changes.
- Prefer the smallest JVM-familiar concept over a precise but large
  TypeScript-specific abstraction.
- Look closely at corresponding Spine JVM `core-jvm/server` code before
  changing server-module runtime/API code.
- Ordinary application code must not import `HandlerMetadataRegistry`,
  `EntityHandlersMetadata`, or generated-handler registry discovery/materializer
  internals.
- Ordinary application code must not hand-wire generated metadata into
  `new Repository(...)`.
- Handler discovery/materialization is a framework responsibility only.
- End-user application code uses bare decorators and returns generated domain
  messages, not framework `Event` or `Command` envelopes.
- Aggregates must not use `@Apply`.
- End-user application code must not call transaction-control methods or create
  internal event IDs.
- Generated registry loading must preserve declaration order, `parameterCount`,
  `emittedSchemas`, handler kind, and generated-message-only signal/return
  metadata.
- Generated Protobuf-ES output remains ignored and regenerated, not committed.
- Public API docs, package docs, and user guides must describe the new assembly
  path in this task.
- Add or update automated guard coverage where practical so examples do not
  regress to app-owned handler metadata discovery.

## JVM Inspection Notes

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` records the
  public JVM assembly entry points `BoundedContext.singleTenant(name)` and
  `BoundedContext.multitenant(name)`.
- JVM `BoundedContextBuilder` supports `add(repository)` and `add(entityClass)`.
  When repositories are registered, the context opens storage, registers
  visibility/read-side suppliers, and routes repository dispatchers through the
  context-owned buses.
- `spine-jvm-docs/spine-entities-repositories-and-state.md` records
  `DefaultRepository.of(Class)` selecting the default repository by entity
  family: aggregate, process manager, or projection.
- TypeScript cannot use JVM reflection/model metadata directly, so this task
  uses the already-generated handler registry module as the framework-owned
  metadata source for default repository construction.
- The API must avoid a broad factory hierarchy. The builder-owned `add(entity)`
  path is the smallest current analogue of JVM default repository assembly.
  Existing synchronous `build()` call sites should remain valid for explicit
  repository assembly; generated entity-class assembly should fail clearly if a
  caller uses sync `build()` instead of `buildAsync()`.

## Skill Applicability

Canonical checklist evidence:

- Session skill inventory is available in the root session.
- Selected and read before task actions:
  `subagent-driven-development`, `using-git-worktrees`,
  `verification-before-completion`, `requesting-code-review`,
  `code-review-excellence`, `codebase-design`, and `architecture-patterns`.
- Repo-local expected-skill manifest checked at
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Bounded installed-skill entrypoint enumeration is pending for the
  implementation sub-agent; the sub-agent must record its own canonical skill
  check before code edits.
- Implementation sub-agent check recorded `2026-07-08 03:05 WEST` before
  production code edits:
  - session skill inventory exposed relevant installed skills including
    `implement`, `codebase-design`, `typescript-advanced-types`,
    `javascript-testing-patterns`, and `verification-before-completion`;
  - task prompt explicitly required reading
    `/Users/armiol/.agents/skills/implement/SKILL.md`,
    `/Users/armiol/.agents/skills/codebase-design/SKILL.md`,
    `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`,
    `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`,
    and
    `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`;
  - selected and fully read those five required skill files before task code
    actions;
  - checked repo-local expected-skill manifest at
    `build-protocol/skills/EXPECTED_SKILLS.md`;
  - enumerated readable installed skill entrypoints with bounded command
    `find /Users/armiol/.agents/skills /Users/armiol/.codex/skills -maxdepth 2 -name SKILL.md -print`;
  - inspected `/Users/armiol/.agents/.skill-lock.json` for task-relevant
    expected skill source/path entries with bounded `rg`;
  - skipped `subagent-driven-development` and `requesting-code-review` for this
    implementation pass because the human prompt forbids spawning sub-agents and
    review is orchestrator-owned after this commit; skipped
    `using-git-worktrees` because the prompt provided the exact worktree and
    branch; skipped `nodejs-backend-patterns` because this slice changes
    framework assembly, not Node server middleware/API design.
- Server-module JVM inspection completed before production code changes using
  the local `spine-jvm-docs` bounded-context and repository notes.
- GitHub/library search is not required for this slice because it reuses the
  existing generated registry discovery and repository classes; no common
  infrastructure or dependency is being selected.
- Review-fix sub-agent check performed `2026-07-08 03:32 WEST` before round-1
  fix code edits and recorded during this fix pass:
  - selected and read required skill files for `receiving-code-review`,
    `verification-before-completion`, `typescript-advanced-types`,
    `javascript-testing-patterns`, `security-best-practices`, and
    `codebase-design`;
  - loaded JavaScript/TypeScript backend security references relevant to
    filesystem/import trust before hardening generated registry loading;
  - skipped sub-agent skills because the round-1 prompt explicitly forbids
    spawning sub-agents;
  - treated `security-best-practices` and `codebase-design` as applicable for
    the dynamic-import trusted-root fix and public builder interface; treated
    `typescript-advanced-types` and `javascript-testing-patterns` as applicable
    for the public type surface and regression coverage.

## Acceptance Criteria

- `BoundedContextBuilder.add()` accepts entity classes and `buildAsync()`
  constructs default repositories through framework-owned generated registry
  discovery.
- Existing `BoundedContextBuilder.add(repository)` remains supported for custom
  repositories and explicit tests.
- Default repository construction discovers generated handler metadata from the
  conventional compiled package registry module.
- The to-do example context uses entity-class assembly and no longer imports or
  calls handler registry/discovery internals.
- The generated registry contract remains intact: declaration order,
  `parameterCount`, `emittedSchemas`, handler kind, and generated-message-only
  metadata are preserved.
- Tests cover entity-class assembly, missing generated metadata failure, and the
  to-do context path.
- Cleanup checks reject application/example imports of handler metadata registry
  and generated registry discovery internals.
- Public docs and API comments describe the new assembly path.

## Verification Plan

- Focused server tests for bounded-context default repository assembly.
- Focused to-do example tests.
- Cleanup guard test or full cleanup check.
- `corepack pnpm typecheck`.
- `corepack pnpm test`.
- `corepack pnpm docs:check`.
- `corepack pnpm verify` before integration.
- `git diff --check` and `git status --short` to confirm generated output and
  `human-review-1-jul.md` are untouched.

## Work Log

- `2026-07-08 03:00 WEST`: Created task log from roadmap T-0016b before
  production edits. Selected the JVM-shaped `BoundedContextBuilder.add(entity)`
  path and recorded the generated-registry metadata source.
- `2026-07-08 03:05 WEST`: Inspected existing build call sites and adjusted the
  task shape to preserve sync `build()` for explicit repositories while adding
  async `buildAsync()` for generated entity-class assembly.
- `2026-07-08 03:05 WEST`: Orchestrator reported dependency setup completed:
  sandboxed `corepack pnpm install` failed with registry `ENOTFOUND`, then
  escalated `corepack pnpm install` succeeded. The orchestrator also confirmed
  D-0060 as the corrected design decision and the required sync `build()` plus
  async generated-assembly split.
- `2026-07-08 03:24 WEST`: Implemented framework-owned generated entity-class
  assembly. `BoundedContextBuilder.add()` now accepts repository instances or
  entity classes, synchronous `build()` rejects queued entity classes with a
  `buildAsync()` message, and `buildAsync()` loads the conventional generated
  registry module, ingests metadata, builds default repositories, and carries
  command-assignee emitted schemas into aggregate repositories. Updated the
  to-do example to entity-class assembly and expanded cleanup guards against
  registry/discovery internals in example source. Verification completed:
  focused server/cleanup tests passed (119 tests), escalated to-do tests passed
  (18 tests), `corepack pnpm typecheck` passed, sandboxed `corepack pnpm test`
  failed only on local listener/IPC permission errors, escalated
  `corepack pnpm test` passed (50 files / 825 tests),
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning, and `git diff --check` passed.
- `2026-07-08 03:40 WEST`: Applied round-1 review fixes. Entity-class
  generated assembly now requires explicit
  `withGeneratedRegistryRoot(compiledPackageRoot)`, canonicalizes the trusted
  root and final registry module realpaths, rejects registry symlink escapes,
  and checks the registry file is still readable before every dynamic import.
  The public `withGeneratedRegistryRoot()` parameter is the simple
  `string | URL` surface. Cleanup rules now catch string-literal namespace
  element access to forbidden server internals. Package/user/API/example docs
  now show the explicit trusted root requirement and keep synchronous
  `build()` documented for explicit repository assembly. Verification run:
  focused server/cleanup tests passed (123 tests), sandboxed to-do test failed
  only on `listen EPERM` and escalated rerun passed (18 tests),
  `corepack pnpm typecheck` passed, `corepack pnpm docs:check` passed with the
  known TypeDoc invalid-origin warning, sandboxed `corepack pnpm test` failed
  only on local HTTP/2 listener and ZeroMQ IPC sandbox permission errors, and
  escalated `corepack pnpm test` passed (50 files / 829 tests). Integration
  result remains pending. Commit metadata: branch
  `task/T-0016b-framework-owned-assembly`, planned message
  `Fix generated registry assembly review findings`.
- `2026-07-08 04:03 WEST`: Applied round-2 documentation/API cleanup after
  re-review found stale default-repository/deferred wording. Public docs, task
  notes, and the implementation report now consistently describe
  `add(EntityClass).withGeneratedRegistryRoot(root).buildAsync()`.
