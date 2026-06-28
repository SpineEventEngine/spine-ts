# Review Log: T-0004 Spine Proto Intake And Protobuf-ES Generation

Task log: `build-protocol/tasks/T-0004-proto-intake/TASK.md`
Work log: `build-protocol/work-logs/T-0004.md`
Branch: `task/T-0004-proto-intake`
Baseline commit: `6ce0b65`
Reviewed commit/diff basis: `main...task/T-0004-proto-intake` after the T-0004
implementation commit from baseline `6ce0b65`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0004-proto-intake`
Reviewer sub-agents: Round 1 complete; agents closed by orchestrator
Status: Round 1 fixes ready for final verification

## Required Review Roles

- Code style/maintainability.
- Documentation.
- TypeScript/API docs.
- Security.
- Performance/reliability.

## Scope To Review

- Copied Spine proto files are verbatim and have manifest-backed provenance.
- Buf lint and Protobuf-ES generation are real and reproducible.
- Generated exports from `@spine-ts/proto` are intentional and documented.
- Tests cover generated schema availability, custom option visibility, type URL
  prefix preservation, and provenance/drift checks where practical.
- Runtime behavior remains out of scope.

## Review Rounds

### Round 1

Reviewed basis: `main...HEAD` at
`b66f2db2c2d98d41f3f5c6da53ed81a7fd73d6ad`.

Reviewer roles:

- Code style/maintainability reviewer.
- Documentation reviewer.
- TypeScript/API docs reviewer.
- Security reviewer.
- Performance/reliability reviewer.

Reviewer IDs: not provided in the consolidated round-1 handoff; all five
reviewer agents were reported closed by the orchestrator after comment
collection.

Required fixes:

- Harden manifest/provenance verification for exact copied-file set equality,
  duplicate entries, path traversal, symlinks, and malformed fields.
- Use full 40-character upstream commit SHAs and richer source URL provenance.
- Make `pnpm verify` fail if generation rewrites tracked generated output.
- Improve Buf spawn diagnostics and binary lookup reliability.
- Update root/package docs and task/work/review status placeholders.
- Make TypeDoc/API docs claims honest and add a docs evidence check.
- Record author responses and post-fix verification.

## Findings And Dispositions

| Finding                                                                                 | Roles                   | Disposition | Author response                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest verifier trusted manifest paths and did not require exact set equality.        | Security, reliability   | Fixed       | `scripts/verify-proto-sources.mjs` now validates manifest field types, relative safe `proto/spine/**/*.proto` paths, full SHAs, source/raw URLs, non-symlink regular files, duplicate paths, exact copied-file set equality, and SHA-256 checksums. Added script-level tests for unmanifested proto, duplicate path, and path escape. |
| Manifest used short commit IDs and had limited source provenance.                       | Documentation, security | Fixed       | `proto/spine-sources.json` now records full 40-character SHAs plus canonical GitHub blob and raw URLs. D-0025 and docs record the network-free checksum-only default verification behavior.                                                                                                                                           |
| `pnpm verify` did not fail when generation rewrote tracked generated output.            | Reliability             | Fixed       | Added `scripts/check-generated-clean.mjs`, `pnpm proto:check-generated`, and wired it after `proto:generate` in `pnpm verify`.                                                                                                                                                                                                        |
| Buf workflow did not diagnose spawn failures/signals and used bare `buf`.               | Reliability             | Fixed       | `scripts/proto-workflow.mjs` now prefers the local package binary under `node_modules/.bin`, falls back to `buf`, and reports spawn errors/signals for source verification and Buf.                                                                                                                                                   |
| Root/package docs and task logs still had stale skeleton/deferred/pending wording.      | Documentation           | Fixed       | Updated `README.md`, `packages/proto/package.json`, package/proto docs, and T-0004 task/work/review logs.                                                                                                                                                                                                                             |
| API docs claimed generated exports were documented, but TypeDoc did not expose them.    | TypeScript/API docs     | Fixed       | Added TypeDoc-visible entry-point aliases for first-intake proto descriptors/schemas/options and `scripts/check-api-docs.mjs`, which verifies TypeDoc JSON contains 9 expected `@spine-ts/proto` exports.                                                                                                                             |
| Review evidence log needed round-1 roles, findings, dispositions, and author responses. | All reviewer roles      | Fixed       | This review log records round-1 roles, the missing reviewer-ID limitation from the consolidated handoff, findings, author responses, and post-fix verification evidence.                                                                                                                                                              |

## Author Verification

- `2026-06-28 13:20 WEST`: `pnpm test -- packages/proto/src/index.test.ts scripts/verify-proto-sources.test.mjs`
  reported 8 test files and 12 tests passing.
- `2026-06-28 13:20 WEST`: `pnpm proto:verify` verified 4 copied Spine proto
  source file checksums.
- `2026-06-28 13:23 WEST`: `CI=true pnpm verify` exited 0, including node
  check, typecheck, lint, format, 8 test files/12 tests, coverage, docs check,
  proto lint/generation, and generated-output cleanliness.
- `2026-06-28 13:23 WEST`: `pnpm proto:verify`, `pnpm proto:lint`, and
  `pnpm proto:generate` each exited 0.
- `2026-06-28 13:23 WEST`: `pnpm docs:check` exited 0; TypeDoc reported the
  known invalid `origin` warning with 0 errors, and
  `scripts/check-api-docs.mjs` found 9 expected `@spine-ts/proto` exports.
- `2026-06-28 13:23 WEST`: `pnpm proto:check-generated` and
  `git diff --check main...HEAD` exited 0.

## Round 2 Handoff Basis

Round 2 should review `main...HEAD` after the follow-up fix commit. The reviewed
Round 1 implementation basis remains
`b66f2db2c2d98d41f3f5c6da53ed81a7fd73d6ad`.
