# Review Log: T-0009a Descriptor Option Surface And Entity Metadata

Task log: `build-protocol/tasks/T-0009a-entity-metadata/TASK.md`
Work log: `build-protocol/work-logs/T-0009a.md`
Branch: `task/T-0009a-entity-metadata`
Setup baseline commit: `dd4a365`
Implementation baseline commit: `5b41111`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009a-entity-metadata`
Reviewer sub-agents: Maintainability/style `019f1056-4f3d-7192-9bec-8094ad784a03`;
documentation `019f1056-4fbe-7eb1-8ef2-dc5c901887b8`; TypeScript/API docs
`019f1056-502b-74f1-8cc5-24587c5ea99d`; security
`019f1056-509e-7853-bafd-246d91c21fa8`; performance/reliability
`019f1056-5133-73c1-9e09-756c7e49b061`.
Status: Review round 1 in progress
Implementation sub-agent: `019f103e-52ca-7722-88f0-49c49b017dbf` (Dalton)

## Review Focus

- `@spine-ts/proto` keeps curated exports and does not broadly re-export
  generated files.
- `@spine-ts/server` owns entity metadata extraction and does not move
  server/runtime concerns into `@spine-ts/core`.
- Metadata extraction is deterministic: entity kind, visibility defaults,
  first field, columns, set-once fields, and semantic tags have stable ordering
  and clear errors.
- No decorators, handlers, transactions, repositories, buses, storage writes,
  transport, or gRPC behavior are implemented in T-0009a.
- Docs and TypeDoc/API export checks cover any new public exports.
- No payload contents, secrets, auth data, or sensitive local data are logged.

## Required Reviewer Roles

- maintainability/style;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Rounds

### Round 1

Dispatched on `2026-06-28 23:25 WEST`.

Review basis: `04d79ed..a12e4f733a118441e076dc8f23ca91e6e0feff62`.

Review package: `.superpowers/sdd/review-04d79ed..a12e4f7.diff`.

Required reviewer roles:

- maintainability/style;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reports are pending.

Findings received by the authoring implementer:

1. Maintainability/style: checked-in server metadata tests use opaque base64
   `fileDesc(...)` blobs without checked-in readable `.proto` fixture sources
   or a regeneration path.
2. TypeScript/API docs: `packages/server/src/entity-metadata.ts` currently
   exposes `(column)` fields for all entity kinds, but `proto/spine/options.proto`
   says only projections and process managers are eligible and other kinds
   should ignore column declarations.

Authoring fix status:

- Added checked-in readable fixture sources under
  `packages/server/test-fixtures/proto/entity-metadata/` plus
  `packages/server/test-fixtures/proto/entity-metadata/README.md` and the
  generator/check command `node scripts/generate-server-test-fixtures.mjs`
  (`--check` for sync verification).
- Reworked server tests to consume the generated fixture module instead of
  inline `fileDesc(...)` blobs, and added a dedicated generator sync test in
  `scripts/generate-server-test-fixtures.test.mjs`.
- Changed `describeEntityMetadata()` so `(column)` metadata is surfaced only
  for `projection` and `process-manager` entity kinds; aggregate/generic entity
  column declarations are ignored.
- Verification after the fix passed: focused server/generator regressions
  (`2` files / `10` tests), focused proto regressions (`1` file / `6` tests),
  generator sync check, `corepack pnpm typecheck`, `corepack pnpm docs:check`,
  and full `CI=true corepack pnpm verify` (`10` test files / `65` tests,
  coverage statements `99.41%`, branches `94.11%`, functions `100%`, lines
  `99.39%`).
