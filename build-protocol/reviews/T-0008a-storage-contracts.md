# Review Log: T-0008a Storage Contracts And In-Memory Adapter

Task log: `build-protocol/tasks/T-0008a-storage-contracts/TASK.md`
Work log: `build-protocol/work-logs/T-0008a.md`
Branch: `task/T-0008a-storage-contracts`
Setup baseline commit: `db7130e`
Implementation baseline commit: `f1911d7`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0008a-storage-contracts`
Reviewer sub-agents: Maintainability/style `019f1004-5be9-77c2-9191-4a71a8fea916`;
documentation `019f1004-8374-7f33-a643-13e86daebd3a`; TypeScript/API docs
`019f1004-af48-7563-889e-dde078c55143`; security
`019f1004-de72-7b40-9915-5ecef92ba29e`; performance/reliability
`019f1005-0746-7353-bcda-e6bb1ee956c9`.
Status: Second follow-up fixes complete; pending re-review
Implementation sub-agent: `019f0ff4-becd-7c73-9f34-9120294e9083` (Darwin)

## Reviewer IDs

- Maintainability/style: `019f1004-5be9-77c2-9191-4a71a8fea916`
- Documentation: `019f1004-8374-7f33-a643-13e86daebd3a`
- TypeScript/API docs: `019f1004-af48-7563-889e-dde078c55143`
- Security: `019f1004-de72-7b40-9915-5ecef92ba29e`
- Performance/reliability: `019f1005-0746-7353-bcda-e6bb1ee956c9`

## Round 1

Dispatched on `2026-06-28 21:50 WEST`.

Review basis:
`baee5ae..f82c2487cbfe99d22596e4bb9ccb2e246ae784d5`.

Dispatch log commit:
`d0d204984ba51675337c6551a2ba0f72b438ef06`.

Required reviewer roles:

- maintainability/style;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Findings to fix:

- P1 TypeScript/API + reliability + maintainability: clone strategy corrupted
  non-plain and byte-bearing payloads.
- P1 TypeScript/API: record stores exposed method-level payload generics.
- P2 reliability: empty aggregate appends retained empty stream entries.
- P2/P3 documentation/logs: durable logs still described pre-review restart
  state.
- P3 docs/API: API README omitted storage exports from `docs:check` wording.
- Security: no comments.

## Review Focus

- Storage APIs remain asynchronous, generic, and record-oriented.
- Read-side/write-side segregation is preserved and documented.
- In-memory adapter behavior is deterministic, isolated per instance, and not
  described as durable.
- Tests cover version conflicts, ordering, empty reads, immutable snapshots, and
  independent stores.
- API docs and package/user/architecture docs reflect public exports.
- No payload bytes, secrets, auth data, or sensitive payload contents are logged.

## Verification Evidence

Implementation sub-agent evidence from `2026-06-28 21:41-21:53 WEST`:

- RED: `corepack pnpm vitest run packages/storage/src/index.test.ts` failed
  before implementation with 1 file / 6 tests failing because the skeleton did
  not export `createInMemoryStorageAdapter` or `InMemoryStorageAdapter`.
- GREEN focused: `corepack pnpm vitest run packages/storage/src/index.test.ts`
  passed with 1 file / 9 tests.
- Focused gates: `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack
pnpm format:check`, and `corepack pnpm docs:check` passed. Docs check
  retained the known invalid `origin` TypeDoc warning and confirmed 85 expected
  proto exports, 28 expected core exports, and 25 expected storage exports.
- Coverage: `corepack pnpm test:coverage` passed with 9 files / 49 tests and
  coverage statements 99.63%, branches 93.67%, functions 100%, lines 99.62%.
- Full gate: `CI=true corepack pnpm verify` passed with node check, typecheck,
  lint, format, tests, coverage, docs/API check, proto lint/generate, and
  generated-output cleanliness.

Round-1 fix evidence:

- RED: after adding review-regression tests,
  `corepack pnpm vitest run packages/storage/src/index.test.ts` failed with 1
  failing test because byte payloads were no longer `Uint8Array` instances after
  storage round-trip. `corepack pnpm typecheck` failed because the public
  storage adapter/store types were not payload-generic.
- GREEN focused so far: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 12 tests;
  `corepack pnpm typecheck`, `node scripts/check-api-docs.mjs`, `corepack pnpm
lint`, and `corepack pnpm format:check` passed.
- Full round-1 fix gate: `CI=true corepack pnpm verify` passed on
  `2026-06-28 22:07 WEST` with 9 test files / 52 tests, coverage statements
  99.62%, branches 93.33%, functions 100%, lines 99.6%, docs/API check with 85
  proto exports, 28 core exports, and 25 storage exports, plus proto
  lint/generate/check-generated.

## Closure

Round-1 fix committed as `264c4a5fe6a0e4315a5df1cedae2fb436579e9bc`.

## Follow-Up Re-Review

Review basis:
`9613f84517b1b339a299339c83ba827735bbe4fe`.

Clean reports:

- Maintainability/style: no comments.
- TypeScript/API docs: no comments.
- Performance/reliability: no comments.

Findings to fix:

- Security P2: wrap structured-clone failures in a storage-specific safe error
  message that does not include payload contents.
- Documentation P3: top-level `README.md` should say production storage
  adapters/repository runtime are deferred while the non-durable in-memory
  adapter exists.

Follow-up fix evidence so far:

- RED: `corepack pnpm vitest run packages/storage/src/index.test.ts` failed
  with 1 failing test because non-cloneable payloads still surfaced
  `DataCloneError`.
- GREEN focused so far: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 13 tests;
  `corepack pnpm typecheck` passed; `node scripts/check-api-docs.mjs` passed
  with 85 proto exports, 28 core exports, and 26 storage exports.
- Full follow-up fix gate: `CI=true corepack pnpm verify` passed on
  `2026-06-28 22:18 WEST` with 9 test files / 53 tests, coverage statements
  99.62%, branches 93.33%, functions 100%, lines 99.61%, docs/API check with 85
  proto exports, 28 core exports, and 26 storage exports, plus proto
  lint/generate/check-generated.

Follow-up fix committed as `7b489418c58b2c11171baf70d04db1d009aa5501`.
Orchestrator-owned follow-up re-review completed and produced the second
follow-up findings below.

## Second Follow-Up Re-Review

Review basis:
`fa94e24bb19d6518311dc4470a404ece3853ac31`.

Clean reports:

- Maintainability/style: no comments.
- TypeScript/API docs: no comments.
- Performance/reliability: no comments.

Findings to fix:

- Reliability P2: aggregate append clone failures must be side-effect-free. If
  any event payload cannot be cloned, no event should be stored and global
  positions must not skip on the next successful append.
- Reliability P2: diagnostic attribute clone failures must be side-effect-free.
  If attributes cannot be cloned, the next successful diagnostic should still
  start at `diagnostic-1`/sequence `1`.
- Security regression hardening: clone error name/message must not expose
  function-source identifiers such as `leakedSecret`, function syntax such as
  `() =>`, or native clone text such as `could not be cloned`.
- Durable status hygiene: task and review logs must reflect second follow-up
  fix/re-review state instead of the stale follow-up-in-progress state.

Second follow-up fix evidence so far:

- RED: `corepack pnpm vitest run packages/storage/src/index.test.ts` failed
  with 2 failing tests after adding the regressions. The aggregate retry
  produced `globalPosition: 3` instead of `1`; the diagnostic retry produced
  `diagnostic-2`/sequence `2` instead of `diagnostic-1`/sequence `1`.
- GREEN focused so far: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 15 tests after
  cloning aggregate event payloads and diagnostic attributes before advancing
  counters or storing records.
- Full second follow-up fix gate: `CI=true corepack pnpm verify` passed on
  `2026-06-28 22:33 WEST` with 9 test files / 55 tests, coverage statements
  99.63%, branches 93.5%, functions 100%, lines 99.61%, docs/API check with 85
  proto exports, 28 core exports, and 26 storage exports, plus proto
  lint/generate/check-generated.

Second follow-up fix committed as
`981e0c32ab83cdfaa6acfb467354286177a11267`.

Second follow-up re-review dispatched on `2026-06-28 22:37 WEST`.

Review basis:
`fa94e24bb19d6518311dc4470a404ece3853ac31..981e0c32ab83cdfaa6acfb467354286177a11267`.

Review package:
`.superpowers/sdd/review-fa94e24..981e0c3.diff`.

Reviewer sub-agents:

- Maintainability/style: `019f102a-477a-7371-964b-af2ac0ab0d03`
- Documentation: `019f102a-480a-7633-a941-740b8d1dfb2d`
- TypeScript/API docs: `019f102a-4880-7570-a38f-dee1e90af241`
- Security: `019f102a-4902-7ba0-8450-67abd0923979`
- Performance/reliability: `019f102a-497c-7450-ba7a-6f03c8c4d43d`

Reports are pending.
