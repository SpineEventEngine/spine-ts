# Implementation Report: T-0009f.1 Context Spec And Builder Shell

Status: Round-4 Fix Applied; Verification Passed
Task log: `build-protocol/tasks/T-0009f1-context-builder-shell/TASK.md`
Work log: `build-protocol/work-logs/T-0009f1.md`
Review log: `build-protocol/reviews/T-0009f1-context-builder-shell.md`
Branch: `task/T-0009f1-context-builder-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f1-context-builder-shell`

## Summary

Implemented the T-0009f.1 metadata-only bounded-context builder shell:
immutable bounded context name values, `TenantMode`, immutable `ContextSpec`,
`BoundedContext.singleTenant(name)`, `BoundedContext.multitenant(name)`,
`BoundedContextBuilder`, validated non-empty/non-blank names, and immutable
copy-safe built context snapshots.

The shell intentionally does not expose repository registration, handler
invocation, command/event routing, inbox/delivery writes, storage, query stand
or subscription execution, system context construction, gRPC services,
transport integration, or tenant index persistence.

Review rounds narrowed the shell repeatedly until it matched the intended
JVM-familiar boundary. The final round-4 fix keeps construction on
`BoundedContext.singleTenant(name)`, `BoundedContext.multitenant(name)`, and
`builder.build()` only; `ContextSpec`, `BoundedContextBuilder`, and
`BoundedContext` emit protected constructors; removed helper APIs
(`fromSpecSnapshot()`, `rename()`, `ContextSpec.singleTenant()`, and
`ContextSpec.multitenant()`) stay absent; and construction uses module-private
factory closures plus a private token with full snapshot validation. Regression
tests cover direct JavaScript construction, subclass/prototype forgery, and
leaked `.constructor` attempts with blank names, non-boolean flags, mismatched
spec names, and mismatched tenant mode. Docs/logs describe `build()` as
returning a frozen metadata-only `BoundedContext` whose `.snapshot` accessor
returns the copy-safe immutable snapshot.

## Skill Applicability

Canonical round-4 fix skill applicability check recorded on
`2026-06-30 07:05 WEST` in the task/work logs:

- checked `build-protocol/skills/EXPECTED_SKILLS.md`;
- enumerated installed skill entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
- inspected `/Users/armiol/.agents/.skill-lock.json` for expected/task-relevant
  skill provenance;
- fully read and applied `receiving-code-review`,
  `test-driven-development`, and `verification-before-completion`; and
- skipped `implement`, `javascript-testing-patterns`,
  `typescript-advanced-types`, `architecture-patterns`, and
  `cqrs-implementation` for this round after task-fit triage because the work
  closed constructor/security and durable-doc/log findings rather than adding a
  new runtime slice.

## JVM Research Used

Implementation inspected `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
sections on context names/specs, builder surface/build sequence, and
multitenancy, plus task-relevant JVM source:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ContextSpec.java`
- `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNameMixin.java`
- `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNames.java`

This confirmed the familiar static builder entry points, name validation, spec
ownership of multitenancy/event-storage metadata, and build-time copy/freeze
need while keeping runtime construction out of this subtask.

The review-fix round refreshed the same boundary with the local notes and
`/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`
to keep `BoundedContext` as a framework-owned final-style type, preserve the
static `singleTenant()`/`multitenant()` entry points, and avoid inventing
runtime registration or transport APIs in this shell.

The round-2 fix refreshed the JVM guardrail with the same bounded-context and
builder/context-spec sources to preserve framework-owned construction and keep
the public TypeScript surface aligned with the JVM's static entry-point style
instead of exposing direct constructor seams.

The round-4 fix kept the same JVM guardrail while removing over-invented
subclass construction machinery. It preserves static bounded-context builder
entry points and framework-owned construction without exposing runtime
registration, transport, storage, or direct constructor seams.

## Files Changed

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- T-0009f.1 and parent T-0009f task/report/work logs.

## Verification

- Baseline verification passed on `2026-06-30 05:34 WEST`: `CI=true corepack
pnpm verify` passed with 15 test files / 160 tests, coverage 97.25%
  statements / 91.41% branches / 99.16% functions / 97.19% lines, TypeDoc/API
  checks with 100 proto / 28 core / 72 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
  Repeat verification after recording this evidence remains pending before the
  setup commit.
- Red: `corepack pnpm vitest run packages/server/src/bounded-context.test.ts`
  failed because `./bounded-context.js` did not exist.
- Red: `corepack pnpm vitest run packages/server/src/index.test.ts` failed
  because the new context API was not exported from package root.
- Green/focused: `corepack pnpm vitest run
packages/server/src/bounded-context.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 15 tests.
- API docs: `node scripts/check-api-docs.mjs` passed with TypeDoc JSON
  including 100 proto / 28 core / 80 server / 26 storage expected exports
  and the existing invalid-`origin` source-link warning.
- Full: `CI=true corepack pnpm verify` passed with 16 test files / 166 tests,
  coverage 97.26% statements / 91.38% branches / 98.9% functions / 97.21%
  lines, TypeDoc/API checks with 100 proto / 28 core / 80 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Final rerun after formatting log updates: `CI=true corepack pnpm verify`
  passed again with 16 test files / 166 tests, the same coverage totals,
  TypeDoc/API, proto, and generated-output gates clean.
- Review-fix focused: `corepack pnpm vitest run
packages/server/src/bounded-context.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-30 05:56 WEST` with 2 test files / 15 tests.
- Review-fix verification first failed on `2026-06-30 05:57 WEST` because the
  then-current private-constructor `Reflect.construct(...)` helpers needed an
  `unknown` cast for TypeScript, and the subsequent rerun exposed Prettier
  drift in the touched files.
- Final review-fix verification passed on `2026-06-30 06:00 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` source-link warning; and `CI=true corepack pnpm verify`
  passed with 16 test files / 166 tests, coverage 97.08% statements / 91.27%
  branches / 98.54% functions / 97.02% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean.
- Correction-round focused verification passed on `2026-06-30 06:09 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests.
- Correction-round API docs verification passed on `2026-06-30 06:09 WEST`:
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` source-link warning.
- Correction-round full verification first failed on `2026-06-30 06:09 WEST`
  because `verify` found Prettier drift in the two touched work-log files.
- Final correction-round verification passed on `2026-06-30 06:10 WEST`:
  `CI=true corepack pnpm verify` passed with 16 test files / 166 tests,
  coverage 97.17% statements / 91.51% branches / 98.88% functions / 97.11%
  lines, TypeDoc/API checks clean, proto lint/generate checksum verification
  clean, and generated output clean.
- Post-format rerun passed on `2026-06-30 06:13 WEST`: the focused Vitest
  command, `node scripts/check-api-docs.mjs`, and `CI=true corepack pnpm verify`
  all passed again with the same totals and only the existing invalid-`origin`
  TypeDoc warning.
- Round-2 focused verification passed on `2026-06-30 06:25 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 16 tests.
- Final round-2 verification passed on `2026-06-30 06:30 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed again with 2 test files / 16 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` source-link warning; and `CI=true corepack pnpm verify`
  passed with 16 test files / 167 tests, coverage 96.75% statements / 90.78%
  branches / 98.18% functions / 96.69% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean.
- Final narrowing-fix verification passed on `2026-06-30 06:47 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 16 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` source-link warning; and `CI=true corepack pnpm verify`
  passed with 16 test files / 167 tests, coverage 97.08% statements / 90.78%
  branches / 98.91% functions / 97.02% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean.
  Inspection of `packages/server/dist/bounded-context.d.ts` confirms the
  emitted API now uses `protected constructor(...)` for `ContextSpec`,
  `BoundedContextBuilder`, and `BoundedContext`; inspection of the fresh
  TypeDoc JSON confirms those constructor nodes are marked
  `"isProtected": true` and the removed `ContextSpec.singleTenant()`,
  `ContextSpec.multitenant()`, `rename()`, and `fromSpecSnapshot()` entries are
  absent from the accepted public API surface.
- Post-log-format rerun passed on `2026-06-30 06:51 WEST`: the focused Vitest
  command stayed green at 2 test files / 16 tests, `node scripts/check-api-docs.mjs`
  stayed green with 100 proto / 28 core / 80 server / 26 storage expected
  exports, and `CI=true corepack pnpm verify` stayed green with 16 test files /
  167 tests, coverage 97.08% statements / 90.78% branches / 98.91% functions /
  97.02% lines, plus clean TypeDoc/API, proto lint/generate checksum, and
  generated-output gates.
- Round-4 focused verification passed on `2026-06-30 07:05 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 17 tests;
  `node scripts/check-api-docs.mjs` passed with TypeDoc JSON including 100
  expected proto / 28 core / 80 server / 26 storage exports plus the existing
  invalid-`origin` source-link warning; and `CI=true corepack pnpm verify`
  passed with 16 test files / 168 tests, coverage 96.84% statements / 90.49%
  branches / 98.93% functions / 96.78% lines, TypeDoc/API checks clean, proto
  lint/generate checksum verification clean, and generated output clean.
- Round-4 post-log-format rerun passed on `2026-06-30 07:08 WEST` with the
  same green focused/API/full verification totals. Source search confirmed no
  internal subclass construction symbols remained in runtime/docs, and
  `Reflect.construct` remained only in rejection tests and historical logs.

## Review

- Initial review produced nine bounded-context shell follow-ups.
- Subsequent review rounds removed the public construction surface,
  `rename()`, `fromSpecSnapshot()`, `ContextSpec` factory leakage, subclass
  construction leakage, and stale durable-log wording.
- Final state: the round-4 constructor-leak fix is applied and the required
  verification commands are green.
