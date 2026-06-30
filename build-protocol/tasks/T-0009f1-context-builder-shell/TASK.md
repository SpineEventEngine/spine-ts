# T-0009f.1: Context Spec And Builder Shell

Status: Round-4 Fix Applied; Verification Passed
Start: `2026-06-30 05:31 WEST`
Parent task: `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
Baseline commit: `78b3be1`
Task log path: `build-protocol/tasks/T-0009f1-context-builder-shell/TASK.md`
Branch: `task/T-0009f1-context-builder-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f1-context-builder-shell`
Authoring sub-agent: Codex implementation sub-agent
Reviewer sub-agents: completed durable review/fix rounds recorded in review logs; no separate reviewer sub-agents spawned

## Objective

Add the first bounded-context API shell for `@spine-ts/server`: immutable context
name value, tenant mode value, `BoundedContext.singleTenant(name)`,
`BoundedContext.multitenant(name)`, builder shell, name validation, and
immutable built context snapshot.

## Required JVM Shape

Task-relevant JVM/docs evidence:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, builder surface,
  bounded context name, context spec, tenant mode, and build-sequence sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ContextSpec.java`;
- `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNameMixin.java`
  when available.

Implementation impact: preserve JVM-familiar builder entry points and name
validation, but keep system context, buses, stand, tenant index, storage
factories, and service registration out of this subtask.

## Scope

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs` if public exports are added
- Minimal public docs as needed
- Parent T-0009f logs

## Out Of Scope

- Repository registration.
- Handler invocation.
- Command/event routing.
- Inbox/delivery writes.
- Storage opening or storage factory selection.
- Query stand execution or subscription updates.
- System context construction.
- Server/gRPC services.
- ZeroMQ or transport integration.
- Tenant index persistence.

## Skill Applicability

The implementer must perform the canonical skill applicability check from
`BUILD_PROTOCOL.md` and record it in this task/report/work log before or in the
same atomic step as implementation.

Original implementation evidence was logged on `2026-06-30 06:02 WEST` during
implementation log finalization, after the initial code changes had already
been made. That timing mismatch is corrected here instead of claiming the
evidence was recorded before code changes.

Review-fix sub-agent check recorded on `2026-06-30 05:54 WEST`:

- Session skill inventory exposed task-relevant built-ins and installed skills
  including `receiving-code-review`, `verification-before-completion`,
  `implement`, `test-driven-development`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation`.
- Task prompt explicitly required the canonical skill applicability check and
  prohibited sub-agents.
- Checked expected manifest:
  `sed -n '1,220p' build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This checked the full `~/.agents/skills` directory at bounded depth.
- Inspected installed-skill lock source with
  `sed -n '1,260p' /Users/armiol/.agents/.skill-lock.json`; it showed expected
  source repositories/local paths for manifest skills and the task-relevant
  `receiving-code-review`, `implement`, `test-driven-development`,
  `typescript-advanced-types`, `architecture-patterns`,
  `cqrs-implementation`, and `verification-before-completion` skills.
- Fully read and applied:
  `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md`,
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`, and
  `/Users/armiol/.agents/skills/implement/SKILL.md`.
- Skipped `test-driven-development` for this round after metadata/path triage
  because the task was a reviewer-directed narrowing of an existing shell, not
  a fresh behavior slice requiring a new red/green cycle from zero; focused
  post-fix tests are still required and were run.
- Skipped `typescript-advanced-types`, `architecture-patterns`, and
  `cqrs-implementation` after metadata/path triage because this round narrows
  the public construction surface and documentation only; it does not add new
  type-level APIs, architectural runtime patterns, or CQRS behavior.
- No sub-agents spawned.

Correction-round check recorded on `2026-06-30 06:07 WEST`:

- Session skill inventory exposed task-relevant built-ins and installed skills
  including `receiving-code-review`, `verification-before-completion`,
  `implement`, `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation`.
- Task prompt explicitly required a correction worker, prohibited sub-agents and
  commits, and required the canonical skill applicability check.
- Checked expected manifest:
  `sed -n '1,220p' build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This checked the full `~/.agents/skills` directory at bounded depth.
- Inspected installed-skill lock source with
  `sed -n '1,260p' /Users/armiol/.agents/.skill-lock.json`; it showed expected
  source repositories/local paths for manifest skills and the task-relevant
  `receiving-code-review`, `verification-before-completion`, `implement`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` skills.
- Fully read and applied:
  `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md` and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Read but did not fully apply `/Users/armiol/.agents/skills/implement/SKILL.md`
  because its commit/review-close instruction conflicts with this prompt's
  explicit "do not commit" and "do not spawn sub-agents" constraints; the
  repo/task protocol and user instruction govern.
- Skipped `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` after metadata/path triage
  because this correction narrows one existing server module and its durable
  logs without adding new testing infrastructure, advanced type design,
  architectural runtime behavior, or CQRS flow.
- No sub-agents spawned.

Round-2 fix-worker check recorded on `2026-06-30 06:23 WEST`:

- Session skill inventory exposed task-relevant built-ins and installed skills
  including `receiving-code-review`, `verification-before-completion`,
  `implement`, `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation`.
- Task prompt explicitly required a round-2 fix worker, prohibited sub-agents
  and commits, and required the canonical skill applicability check plus parent
  log updates.
- Checked expected manifest:
  `sed -n '1,220p' build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This checked the full `~/.agents/skills` directory at bounded depth.
- Inspected installed-skill lock source with
  `sed -n '1,260p' /Users/armiol/.agents/.skill-lock.json`; it showed expected
  source repositories/local paths for manifest skills and the task-relevant
  `receiving-code-review`, `verification-before-completion`, `implement`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` skills.
- Fully read and applied:
  `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md` and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Read but did not fully apply `/Users/armiol/.agents/skills/implement/SKILL.md`
  because its commit/review-close instruction conflicts with this prompt's
  explicit "do not commit" and "do not spawn sub-agents" constraints; the
  repo/task protocol and user instruction govern.
- Skipped `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` after metadata/path triage
  because this round closes a construction-boundary/security finding set and
  durable docs/logs without introducing new testing infrastructure, advanced
  type abstractions, architectural runtime behavior, or CQRS flow.
- No sub-agents spawned.

Round-4 fix-worker check recorded on `2026-06-30 07:05 WEST`:

- Session skill inventory exposed task-relevant built-ins and installed skills
  including `receiving-code-review`, `test-driven-development`,
  `verification-before-completion`, `implement`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation`.
- Task prompt explicitly required a round-4 fix worker, prohibited sub-agents
  and commits, required the canonical skill applicability check, and required
  durable parent/review-log updates.
- Checked expected manifest:
  `sed -n '1,220p' build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This checked the full `~/.agents/skills` directory at bounded depth.
- Inspected installed-skill lock source with
  `sed -n '1,260p' /Users/armiol/.agents/.skill-lock.json`; it showed expected
  source repositories/local paths for manifest skills and the task-relevant
  `receiving-code-review`, `test-driven-development`,
  `verification-before-completion`, `implement`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` skills.
- Fully read and applied:
  `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md`,
  `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`, and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Skipped `implement` after metadata/path triage because its commit/review-close
  instruction conflicts with this prompt's explicit no-commit/no-sub-agent
  limits; the repo/task protocol and user instruction govern.
- Skipped `javascript-testing-patterns`, `typescript-advanced-types`,
  `architecture-patterns`, and `cqrs-implementation` after metadata/path triage
  because this round closes one bounded-context construction seam and its
  durable review evidence without adding new testing infrastructure, advanced
  type abstractions, architectural runtime behavior, or CQRS flow.
- No sub-agents spawned.

Original implementation sub-agent evidence recorded on `2026-06-30 06:02 WEST`:

- Session skill inventory exposed task-relevant built-ins and user-installed
  skills including `test-driven-development`,
  `typescript-advanced-types`, `architecture-patterns`,
  `cqrs-implementation`, and `verification-before-completion`.
- Task prompt explicitly required the canonical check and highlighted
  `test-driven-development`, `typescript-advanced-types` if needed,
  `architecture-patterns`/CQRS if needed, and
  `verification-before-completion`.
- Checked expected manifest:
  `sed -n '1,220p' build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This checked the full `~/.agents/skills` directory at bounded depth.
- Inspected installed-skill lock source with
  `sed -n '1,220p' /Users/armiol/.agents/.skill-lock.json`; it showed expected
  source repositories/local paths for task-relevant skills, including
  `typescript-advanced-types`, `architecture-patterns`,
  `cqrs-implementation`, `test-driven-development`/`tdd`, and
  `verification-before-completion`.
- Selected and fully read:
  `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`,
  `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`, and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Skipped `architecture-patterns` and `cqrs-implementation` after metadata/path
  triage because this subtask is an immutable value/builder shell only and must
  not introduce architectural runtime patterns, read/write segregation code, or
  routing/projection behavior. Project documents and D-0046 govern the bounded
  context architecture for this slice.
- No sub-agents spawned.

## Implementation Evidence

- JVM notes inspected:
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` sections
  "Context names and specs", "BoundedContext builder surface", and
  "Multitenancy".
- Review-fix JVM/source guardrail refreshed on `2026-06-30 05:54 WEST` with:
  `rg -n "BoundedContext|ContextSpec|tenant|builder|build\\(" spine-jvm-docs/spine-server-runtime-and-bounded-context.md`,
  `sed -n '1,240p' spine-jvm-docs/spine-server-runtime-and-bounded-context.md`,
  and
  `sed -n '1,220p' /private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`.
  Impact: keep the JVM-familiar static builder entry points, keep
  `BoundedContext` non-subclassable/application-non-constructible in spirit,
  and keep runtime collaborators deferred.
- JVM source inspected:
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ContextSpec.java`,
  `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNameMixin.java`,
  and
  `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNames.java`.
- Implementation impact: mirror `BoundedContext.singleTenant(name)` and
  `BoundedContext.multitenant(name)` as public builder entry points, keep
  context name validation to non-null/non-empty/non-blank string values, expose
  `ContextSpec`/tenant mode as immutable metadata, and make `build()`
  copy/freeze its shell snapshot. Defer JVM build-sequence behavior for system
  contexts, buses, stands, tenant index creation, delivery, repository
  registration, storage, transport, and service wiring to later explicit tasks.
- Review-fix impact: remove the public `fromSpecSnapshot()` escape hatch and
  document the metadata-only bounded-context boundary in
  `docs/architecture/README.md`.
- Correction-round impact: actually remove `BoundedContextBuilder.rename()`,
  replace the token/`Reflect.construct(...)` path with plain constructors plus
  runtime validation of constructor inputs, keep arbitrary snapshot-shaped data
  out of builder/context construction, and align the task/report/work logs with
  the actual code state.
- Round-2 fix impact: keep the public construction contract on
  `BoundedContext.singleTenant(name)`,
  `BoundedContext.multitenant(name)`, and `builder.build()`, move
  `ContextSpec` construction fully behind those entry points, switch
  `ContextSpec`, `BoundedContextBuilder`, and `BoundedContext` to
  framework-owned protected constructors gated by a module-private token and
  class-internal factory closures, ensure the builder/build boundary consumes
  validated frozen snapshots instead of public overridable getters, add
  direct-JS/subclass/prototype forgery
  regression coverage, add fresh-copy identity assertions for
  `ContextSpec.snapshot`, `builder.spec`, and `context.spec`, and update
  README/API wording that `build()` returns a frozen metadata-only
  `BoundedContext` while `.snapshot` returns the copy-safe immutable snapshot.
- Round-4 fix impact: remove the remaining internal subclasses and
  `assertFrameworkOwnedConstruction`/`new.target` lattice, validate every
  constructor snapshot path including leaked `.constructor` entry points,
  cover blank names/non-boolean flags/arbitrary tenant-mode mismatch cases,
  and keep the coverage gate green by testing the new rejection branches.

## Required Tests

- Bounded context names reject empty/blank names and accept valid names.
- `singleTenant()` and `multitenant()` produce builders with the expected tenant
  mode.
- `build()` returns a frozen metadata-only `BoundedContext`, and `.snapshot`
  returns a copy-safe immutable snapshot.
- Builder exposes only `constructor`, `name`, `spec`, `tenantMode`,
  `isMultitenant`, and `build`.
- Direct JS constructor calls are rejected for `ContextSpec`,
  `BoundedContextBuilder`, and `BoundedContext`.
- Forged `ContextSpec` subclass/prototype instances cannot reach a valid
  `BoundedContext` through the builder/build path.
- `ContextSpec.snapshot`, `builder.spec`, and `context.spec` each return fresh
  immutable copies on every access.
- No APIs imply runtime dispatch, storage, stand, gRPC, or transport execution.

## Verification

- Baseline verification passed on `2026-06-30 05:34 WEST`: `CI=true corepack
pnpm verify` passed with 15 test files / 160 tests, coverage 97.25%
  statements / 91.41% branches / 99.16% functions / 97.19% lines, TypeDoc/API
  checks with 100 proto / 28 core / 72 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
  Repeat verification after recording this evidence remains pending before the
  setup commit.
- TDD red evidence on `2026-06-30 05:38 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts`
  failed because `./bounded-context.js` did not exist.
- TDD export red evidence on `2026-06-30 05:39 WEST`:
  `corepack pnpm vitest run packages/server/src/index.test.ts` failed because
  `BoundedContext`, `BoundedContextBuilder`, `BoundedContextNameError`, and
  `ContextSpec` were missing from package-root exports.
- Focused verification passed on `2026-06-30 05:40 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests.
- API docs verification passed on `2026-06-30 05:40 WEST`:
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  proto / 28 core / 80 server / 26 storage expected exports. TypeDoc emitted
  the existing warning that the `origin` remote was not valid for source links.
- Full verification passed on `2026-06-30 05:41 WEST`:
  `CI=true corepack pnpm verify` passed with 16 test files / 166 tests,
  coverage 97.26% statements / 91.38% branches / 98.9% functions / 97.21%
  lines, TypeDoc/API checks with 100 proto / 28 core / 80 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Final verification after formatting log updates passed on
  `2026-06-30 05:43 WEST`: `CI=true corepack pnpm verify` passed with 16 test
  files / 166 tests, the same coverage totals, TypeDoc/API checks with 100
  proto / 28 core / 80 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
- Review-fix focused verification passed on `2026-06-30 05:56 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests.
- Review-fix verification attempt on `2026-06-30 05:57 WEST` first failed:
  `node scripts/check-api-docs.mjs` and `CI=true corepack pnpm verify` exposed
  TypeScript private-constructor cast errors, then Prettier drift in the touched
  files after the cast fix.
- Final review-fix verification passed on `2026-06-30 06:00 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  proto / 28 core / 80 server / 26 storage expected exports plus the existing
  invalid-`origin` warning; and `CI=true corepack pnpm verify` passed with 16
  test files / 166 tests, coverage 97.08% statements / 91.27% branches /
  98.54% functions / 97.02% lines, TypeDoc/API checks with 100 proto / 28 core
  / 80 server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Correction-round focused verification passed on `2026-06-30 06:09 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests.
- Correction-round API docs verification passed on `2026-06-30 06:09 WEST`:
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  proto / 28 core / 80 server / 26 storage expected exports plus the existing
  invalid-`origin` warning.
- Correction-round full verification first failed on `2026-06-30 06:09 WEST`
  because `verify` found Prettier drift in the two touched work-log files.
- Final correction-round verification passed on `2026-06-30 06:10 WEST`:
  `CI=true corepack pnpm verify` passed with 16 test files / 166 tests,
  coverage 97.17% statements / 91.51% branches / 98.88% functions / 97.11%
  lines, TypeDoc/API checks with 100 proto / 28 core / 80 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Post-format rerun passed on `2026-06-30 06:13 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts`,
  `node scripts/check-api-docs.mjs`, and `CI=true corepack pnpm verify` all
  passed again with the same focused-test totals, API export counts, existing
  invalid-`origin` warning, and full-verify coverage/gate results.
- Round-2 focused verification passed on `2026-06-30 06:25 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 16 tests,
  including the direct-construction and forgery regressions.
- Final round-2 verification passed on `2026-06-30 06:30 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed again with 2 test files / 16 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` warning; and `CI=true corepack pnpm verify` passed with 16
  test files / 167 tests, coverage 96.75% statements / 90.78% branches /
  98.18% functions / 96.69% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean.
- Final narrowing-fix verification passed on `2026-06-30 06:47 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 16 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` warning; and `CI=true corepack pnpm verify` passed with 16
  test files / 167 tests, coverage 97.08% statements / 90.78% branches /
  98.91% functions / 97.02% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean. The
  emitted declaration file now shows `protected constructor(...)` for
  `ContextSpec`, `BoundedContextBuilder`, and `BoundedContext`, and the fresh
  TypeDoc JSON marks those constructors with `"isProtected": true` while
  exposing no `ContextSpec.singleTenant()`, `ContextSpec.multitenant()`,
  `rename()`, or `fromSpecSnapshot()` entries.
- Post-log-format rerun passed on `2026-06-30 06:51 WEST`: the focused Vitest
  command stayed green at 2 test files / 16 tests, `node scripts/check-api-docs.mjs`
  stayed green with 100 proto / 28 core / 80 server / 26 storage expected
  exports, and `CI=true corepack pnpm verify` stayed green with 16 test files /
  167 tests, coverage 97.08% statements / 90.78% branches / 98.91% functions /
  97.02% lines, plus clean TypeDoc/API, proto lint/generate checksum, and
  generated-output gates.
- Round-4 TDD red evidence on `2026-06-30 06:59 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts`
  failed because leaked `.constructor` access still allowed forged
  `ContextSpec` construction.
- Round-4 verification attempts at `2026-06-30 07:01 WEST` and
  `2026-06-30 07:03 WEST` first exposed TypeScript protected-constructor
  factory wiring issues, then Prettier drift, and finally a branch-coverage
  shortfall from the newly added validation branches.
- Final round-4 verification passed on `2026-06-30 07:05 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 17 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` warning; and `CI=true corepack pnpm verify` passed with 16
  test files / 168 tests, coverage 96.84% statements / 90.49% branches /
  98.93% functions / 96.78% lines, clean TypeDoc/API checks, clean proto
  lint/generate checksum verification, and generated output clean.
- Post-log-format rerun passed on `2026-06-30 07:08 WEST`: the focused Vitest
  command stayed green at 2 test files / 17 tests, `node scripts/check-api-docs.mjs`
  stayed green with 100 proto / 28 core / 80 server / 26 storage expected
  exports plus the existing invalid-`origin` warning, and `CI=true corepack pnpm verify`
  stayed green with 16 test files / 168 tests, coverage 96.84% statements /
  90.49% branches / 98.93% functions / 96.78% lines, plus clean TypeDoc/API,
  proto lint/generate checksum verification, and generated-output gates.

## Files Changed

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `build-protocol/tasks/T-0009f1-context-builder-shell/TASK.md`
- `build-protocol/tasks/T-0009f1-context-builder-shell/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009f1.md`
- `build-protocol/tasks/T-0009f-repository-seams/TASK.md`
- `build-protocol/tasks/T-0009f-repository-seams/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009f.md`
- `docs/architecture/README.md`

## Human Questions And Answers

- None.
