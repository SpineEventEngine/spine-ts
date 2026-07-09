# T-0018d Review Log

Status: complete on main

Scope: descriptor-based command/event role discovery for generated-registry
analysis.

## Participants

- Requirements splitter:
  `019f47d4-a4ca-7333-8f5c-c2d6ec204148`; completed and closed by root after
  selecting this task.
- Implementation agent: `019f47f9-3944-73e3-9fd8-4a804572db90`; completed
  implementation and closed by root.
- Code style/maintainability reviewer:
  `019f4804-2403-7660-8a5b-1341f5309224`; completed and closed by root.
- Documentation reviewer: `019f4804-4fef-7ae2-8168-38b0ce383f4d`;
  completed and closed by root.
- TypeScript/API reviewer: `019f4804-8964-70b1-9519-a39d5f1c1527`;
  completed and closed by root.
- Security reviewer: `019f4804-b96d-7d12-85a8-b7ec835470c4`; completed
  and closed by root.
- Performance/reliability reviewer:
  `019f4804-db96-7a53-aa0e-e79ecd2dfc4b`; completed and closed by root.
- Round 2 code style/maintainability reviewer:
  `019f480e-12a2-77a0-a130-260a1cb5dedb`; completed and closed by root.
- Round 2 documentation reviewer:
  `019f480e-3b66-7af1-b511-2605b984a43e`; completed and closed by root.
- Round 2 TypeScript/API reviewer:
  `019f480e-6c19-7332-b6dd-036fa86609d5`; completed and closed by root.
- Round 2 security reviewer: `019f480e-932a-7051-98cd-d177212ff5cd`;
  completed and closed by root.
- Round 2 performance/reliability reviewer:
  `019f480e-bd44-72e2-99fb-f631eb71879b`; completed and closed by root.
- Targeted documentation re-reviewer:
  `019f4812-170f-7f80-ba2c-920dea6bfd0b`; completed and closed by root.
- Final documentation re-reviewer:
  `019f4813-83ad-7dd2-a0d2-9f2d0dc2a0e1`; completed and closed by root.
- Final status-alignment reviewer:
  `019f4814-beb4-7c40-9718-5f04a5b59866`; completed and closed by root.
- Final verification-fix code style/maintainability reviewer:
  `019f4822-a056-7a02-9c21-7dfcf9a639e7`; completed and closed by root.
- Final verification-fix documentation reviewer:
  `019f4822-c20a-7a81-8da0-8a566868f382`; completed and closed by root.
- Final verification-fix TypeScript/API reviewer:
  `019f4823-01bd-7fd2-8122-52c13f274522`; completed and closed by root.
- Final verification-fix security reviewer:
  `019f4823-438d-7f12-9e1f-d3d126c3b966`; completed and closed by root.
- Final verification-fix performance/reliability reviewer:
  `019f4823-89d0-7513-836a-6fc7d0d1bcaf`; completed and closed by root.
- Final log-order documentation re-reviewer:
  `019f4825-e640-7f62-8e46-69949bfc4f76`; completed and closed by root.
- Final log-order performance/reliability re-reviewer:
  `019f4826-0def-71d2-b613-f5534c298c8c`; completed and closed by root.

## Required Lanes

- Code style/maintainability: clean after Round 2.
- Documentation completeness: clean after final status-alignment re-review.
- TypeScript/API docs: clean after Round 2.
- Security: clean after Round 2.
- Performance/reliability: clean after Round 2.

## Round 1 Findings

- Code style/maintainability: replace bespoke Protobuf wire parsing with a
  generated Protobuf API so descriptor decoding is recognizable and
  maintainable. The test fixtures should also avoid hand-built descriptor
  bytes.
- Documentation: remove stale `Pending implementation.` wording from this log.
- Security: do not classify arbitrary schema exports by filename suffix alone.
  Tie the schema export to descriptor contents, including the message name at
  the `messageDesc(file, index)` slot, and fail closed for mismatches or forged
  descriptor contents.
- Performance/reliability: make generated module source selection
  deterministic when both `.ts` and `.d.ts` files are present, preferring
  executable generated source for descriptor role discovery.

## Round 1 Fixes

- Replaced analyzer-local hand-written Protobuf wire parsing with
  `@bufbuild/protobuf` generated APIs. The analyzer now decodes `fileDesc(...)`
  payloads via `fromBinary(FileDescriptorProtoSchema, ...)`, loaded from the
  package dependency path so the temporary build-tool loader can still import
  the analyzer.
- Tightened schema role classification so `messageDesc(file, index...)` must
  resolve to a descriptor message path whose generated name matches the schema
  export name. Forged command/event descriptors with mismatched message names
  fail closed.
- Made generated module source selection deterministic by checking candidate
  paths in priority order and preferring executable `.ts` generated source over
  `.d.ts`.
- Updated analyzer tests to create `FileDescriptorProto` messages with
  `create(FileDescriptorProtoSchema, ...)`, serialize them with
  `toBinary(FileDescriptorProtoSchema, ...)`, and added focused coverage for
  forged message names and `.ts`/`.d.ts` source selection.

## Round 2 Findings

- Documentation: correct the Round 1 test-fixture wording in this log and add
  completed reviewer participants to the work log.

## Round 2 Fixes

- Corrected the Round 1 fix wording to describe the actual generated
  Protobuf API sequence used by the test fixtures.
- Added the completed Round 1 review lanes to the work-log participant list.

## Targeted Documentation Re-Review

- Reviewer `019f4812-170f-7f80-ba2c-920dea6bfd0b` confirmed the Round 2
  documentation fixes and requested one remaining top-level work-log status
  correction.
- Updated the work-log status line for re-review.

## Final Documentation Re-Review

- Reviewer `019f4813-83ad-7dd2-a0d2-9f2d0dc2a0e1` confirmed the old status
  wording and descriptor-fixture wording were fixed, and requested the review
  and work logs stop describing the already-completed targeted re-review as
  still pending.
- Updated the review and work-log status lines to describe the current final
  status-alignment re-review gate.

## Final Status-Alignment Re-Review

- Reviewer `019f4814-beb4-7c40-9718-5f04a5b59866` reported clean. The review
  and work logs no longer contain contradictory status wording, participant
  records are aligned, and descriptor-fixture wording remains accurate.

## Final Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`:
  passed; 1 test file, 23 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing TypeDoc warning that git remote `origin` is not valid for source
  links.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed.
- Full `pnpm --config.verify-deps-before-run=false verify`: failed during
  `typecheck:tooling` because two test fixture calls passed an `exportName`
  property to a helper typed only for `descriptorName`.

Verification-failure fix:

- Removed the extraneous `exportName` properties from the mixed-descriptor
  fixture calls that only need `descriptorName`.
- `pnpm --config.verify-deps-before-run=false typecheck:tooling`: passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`:
  passed; 1 test file, 23 tests.
- `git diff --check`: passed.
- Full `pnpm --config.verify-deps-before-run=false verify` after this fix:
  failed during ESLint with four mechanical issues: one unnecessary optional
  chain, one unnecessary type parameter, and two numeric template-literal
  expressions.

Lint-failure fix:

- Removed the unnecessary optional chain after the `messageDesc` call guard.
- Changed the Protobuf package loader to return `unknown` and kept type safety
  with typed assertions at the two package load call sites.
- Stringified numeric fixture indexes before template-literal interpolation.
- Split the mixed-descriptor fixture's generated descriptor strings into local
  constants after cleanup enforcement reported two long lines.
- `pnpm --config.verify-deps-before-run=false lint:generated`: passed;
  cleanup enforcement checks passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`:
  passed; 1 test file, 23 tests.
- `git diff --check`: passed.

Verification after fixes:

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`:
  passed; 1 test file, 23 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed.
- Sandboxed `pnpm --config.verify-deps-before-run=false verify`: failed with
  loopback/local IPC permission errors (`listen EPERM 127.0.0.1` and ZeroMQ IPC
  `Operation not permitted`).
- Escalated `pnpm --config.verify-deps-before-run=false verify`: passed; 57
  test files, 1088 tests, coverage 95.05% statements, 90.13% branches, 98.19%
  functions, 95.07% lines; docs check passed with the existing TypeDoc origin
  warning; proto lint and generated-clean checks passed.

## Final Verification-Fix Review Results

- Code style/maintainability: clean; reviewer
  `019f4822-a056-7a02-9c21-7dfcf9a639e7` completed and was closed by root.
- Documentation: findings; reviewer
  `019f4822-c20a-7a81-8da0-8a566868f382` completed and was closed by root.
- TypeScript/API docs: clean; reviewer
  `019f4823-01bd-7fd2-8122-52c13f274522` completed and was closed by root.
- Security: clean; reviewer `019f4823-438d-7f12-9e1f-d3d126c3b966`
  completed and was closed by root.
- Performance/reliability: findings; reviewer
  `019f4823-89d0-7513-836a-6fc7d0d1bcaf` completed and was closed by root.
- Documentation and performance/reliability re-review after work-log
  chronology fix: clean; reviewers `019f4825-e640-7f62-8e46-69949bfc4f76`
  and `019f4826-0def-71d2-b613-f5534c298c8c` completed and were closed by
  root.

## Integration

- Task branch commit `5dbe06a` was merged into `main` by merge commit
  `14a788a`.
- Post-merge full verification first failed at `format:check` because
  `build-protocol/work-logs/T-0018d.md` needed Prettier formatting.
- After formatting, escalated post-merge
  `pnpm --config.verify-deps-before-run=false verify` passed: 57 test files,
  1088 tests, coverage 95.05% statements, 90.13% branches, 98.19% functions,
  95.07% lines; docs check passed with the existing TypeDoc origin warnings;
  proto lint and generated-clean checks passed.

## Round 2 Review Results

- Code style/maintainability: clean; reviewer
  `019f480e-12a2-77a0-a130-260a1cb5dedb` completed and was closed by root.
- Documentation: findings; reviewer
  `019f480e-3b66-7af1-b511-2605b984a43e` completed and was closed by root.
- TypeScript/API docs: clean; reviewer
  `019f480e-6c19-7332-b6dd-036fa86609d5` completed and was closed by root.
- Security: clean; reviewer `019f480e-932a-7051-98cd-d177212ff5cd`
  completed and was closed by root.
- Performance/reliability: clean; reviewer
  `019f480e-bd44-72e2-99fb-f631eb71879b` completed and was closed by root.
