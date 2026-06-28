# Review Log: T-0004 Spine Proto Intake And Protobuf-ES Generation

Task log: `build-protocol/tasks/T-0004-proto-intake/TASK.md`
Work log: `build-protocol/work-logs/T-0004.md`
Branch: `task/T-0004-proto-intake`
Baseline commit: `6ce0b65`
Reviewed commit/diff basis: `main...task/T-0004-proto-intake` after the T-0004
implementation commit from baseline `6ce0b65`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0004-proto-intake`
Reviewer sub-agents: Final focused re-check passed with no remaining comments
Status: Complete; integrated into main and verified

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

### Round 2

Reviewed basis: `main...HEAD` at
`3f82056cc1f5bacc004046ada5d753b08f18cb85`.

Reviewer outcomes:

- Security reviewer: no remaining comments.
- Performance/reliability reviewer: no remaining comments.
- Documentation reviewer: stale durable status text requires correction.
- Code style/maintainability reviewer: stale work-log next-step text requires
  correction.
- TypeScript/API docs reviewer: P1 mismatch between broad generated root
  re-exports and the curated TypeDoc/API docs check.

Required fixes:

- Update stale durable status/next-step wording for the round-2 fix pass and
  final handoff state.
- Remove broad generated root re-exports from `@spine-ts/proto`, keeping a
  curated TypeDoc-visible root API for the first intake.
- Record author responses and post-fix verification.

Round-2 author response:

- Security and performance/reliability are accepted as clean with no code
  change needed.
- Documentation and maintainability stale-log findings are applicable and will
  be fixed in this pass.
- TypeScript/API P1 is applicable: the root package should not accidentally
  expose generated implementation details that TypeDoc intentionally excludes.
  The fix will keep generated files on disk for package-internal imports and
  expose only curated root aliases/types.

Round-2 dispositions:

| Finding                                                                                                | Roles                          | Disposition | Author response                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security review had no remaining comments.                                                             | Security                       | Clean       | No code change needed.                                                                                                                                                                                            |
| Performance/reliability review had no remaining comments.                                              | Performance/reliability        | Clean       | No code change needed.                                                                                                                                                                                            |
| Durable review/work logs still had stale round-1 status wording.                                       | Documentation, maintainability | Fixed       | Updated review, task, and work logs to show round-2 changes requested, fix pass evidence, and the final handoff state after verification.                                                                         |
| Root `@spine-ts/proto` re-exported broad generated modules while TypeDoc checked only curated aliases. | TypeScript/API docs            | Fixed       | Removed generated wildcard root re-exports, kept curated descriptors/schemas/options/message types, added runtime root export regression coverage, and made `scripts/check-api-docs.mjs` reject wildcard exports. |

Round-2 focused evidence:

- `2026-06-28 13:37 WEST`: `pnpm test -- packages/proto/src/index.test.ts`
  exited 0 with 8 test files and 13 tests passing.
- `2026-06-28 13:37 WEST`: `pnpm typecheck:build` exited 0.
- `2026-06-28 13:37 WEST`: `pnpm docs:check` exited 0; TypeDoc reported the
  known invalid `origin` warning with 0 errors, and
  `scripts/check-api-docs.mjs` found 13 curated `@spine-ts/proto` exports.
- `2026-06-28 13:37 WEST`: built-root inspection showed only the 9 curated
  runtime descriptor/schema/option exports.

Round-2 final verification:

- `2026-06-28 13:40 WEST`: `CI=true pnpm verify` exited 0, including node
  check, typecheck, lint, format, 8 test files/13 tests, coverage, docs check,
  proto lint/generation, and generated-output cleanliness.
- `2026-06-28 13:40 WEST`: `pnpm docs:check` and
  `node scripts/check-api-docs.mjs` exited 0; TypeDoc reported the known invalid
  `origin` warning with 0 errors, and the API docs check found 13 curated
  `@spine-ts/proto` exports while rejecting generated wildcard root re-exports.
- `2026-06-28 13:40 WEST`: `pnpm proto:verify`, `pnpm proto:lint`,
  `pnpm proto:generate`, and `pnpm proto:check-generated` each exited 0.
- `2026-06-28 13:40 WEST`: `pnpm test -- packages/proto/src/index.test.ts`
  exited 0 with 8 test files and 13 tests passing.
- `2026-06-28 13:40 WEST`: `git diff --check main...HEAD` exited 0.

## Round 3 Handoff Basis

Round 3 should review `main...HEAD` after the focused round-2 fix commit. The
reviewed Round 2 basis remains
`3f82056cc1f5bacc004046ada5d753b08f18cb85`.

### Round 3

Reviewed basis: `main...HEAD` at
`feee5c06cd2748f1570bb8432a2c6d84e45bf3e5`.

Reviewer outcomes:

- TypeScript/API docs reviewer: no remaining comments.
- Security reviewer: no remaining comments.
- Performance/reliability reviewer: no remaining comments.
- Documentation/maintainability finding: durable task/work logs still described
  the next step as committing the round-2 fix for Round 3 review, even though
  `feee5c06cd2748f1570bb8432a2c6d84e45bf3e5` already exists.

Round-3 dispositions:

| Finding                                                           | Roles                          | Disposition | Author response                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript/API docs review had no remaining comments.             | TypeScript/API docs            | Clean       | No code change needed.                                                                                                                                                      |
| Security review had no remaining comments.                        | Security                       | Clean       | No code change needed.                                                                                                                                                      |
| Performance/reliability review had no remaining comments.         | Performance/reliability        | Clean       | No code change needed.                                                                                                                                                      |
| Durable task/work logs still had stale round-2 next-step wording. | Documentation, maintainability | Fixed       | Updated task, work, and review logs to state that the round-2 fix commit exists, Round 3 found only stale-log wording, and Round 4/re-check should review the log-only fix. |

Round-3 verification plan:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the three expected modified
  durable log files before commit.
- Stale-wording search for the old round-2/round-3 pending phrases returned no
  matches.

## Round 4/Re-check Basis

Round 4/re-check should review `main...HEAD` after the focused round-3 log-only
fix commit, then proceed to orchestrator integration if clean.

### Round 4 Focused Re-check

Reviewed basis: `main...HEAD` at
`7c1f8d9cd98024df7f2c43d7f65a4e52f843aff8`.

Reviewer outcome:

- Focused stale-wording re-check found one remaining top-level task metadata
  line: `Reviewer sub-agents:` still said Round 3 had only stale durable-log
  wording remaining.

Round-4 disposition:

| Finding                                                                                                                 | Roles                          | Disposition | Author response                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level task reviewer metadata still described stale durable-log wording as remaining after the round-3 log-only fix. | Documentation, maintainability | Fixed       | Updated task metadata to state the stale metadata wording fix is applied and pending focused Round 5 re-check; updated work/review logs with the round-4 fix evidence. |

Round-4 verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the three expected modified
  durable log files before commit.
- Targeted stale-wording search for the old top-level reviewer metadata phrase
  and old round-2 pending phrases returned no matches.

## Round 5 Focused Re-check Basis

Round 5 focused re-check should review `main...HEAD` after the focused round-4
metadata wording commit, then proceed to orchestrator integration if clean.

### Round 5 Focused Re-check

Reviewed basis: `main...HEAD` at
`cb775d48268b1fe801b6362a77277ff4ee3f37b8`.

Reviewer outcome:

- Focused current-state re-check found one remaining work-log `Last completed
step` line still pointing to the round-3 log-only fix commit
  `7c1f8d9cd98024df7f2c43d7f65a4e52f843aff8`.

Round-5 disposition:

| Finding                                                                                                                           | Roles                          | Disposition | Author response                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Work-log current state still named the round-3 log-only fix as the last completed step after the round-4 metadata wording commit. | Documentation, maintainability | Fixed       | Updated the work-log current state to name the round-4 metadata wording fix commit `cb775d48268b1fe801b6362a77277ff4ee3f37b8`; recorded this round-5 fix evidence. |

Round-5 verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the expected modified durable log
  files before commit.
- Targeted stale current-state search found no `Last completed step` reference
  to `7c1f8d9cd98024df7f2c43d7f65a4e52f843aff8`.

## Final Focused Re-check Basis

Final focused re-check should review `main...HEAD` after the focused round-5
current-state wording commit, then proceed to orchestrator integration if clean.

### Final Focused Log-State Re-check

Reviewed basis: `main...HEAD` at
`0f8dd65ae5fc5cc1944fc985bfc796267ad567ba`.

Reviewer outcome:

- Final focused log-state re-check found two stale top-level reviewer metadata
  lines in the task and review logs still describing the Round 4 metadata fix.

Final focused disposition:

| Finding                                                                                                          | Roles                          | Disposition | Author response                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level task and review metadata still described Round 4 metadata wording after the Round 5 current-state fix. | Documentation, maintainability | Fixed       | Updated both top-level reviewer metadata lines to final focused cleanup wording and recorded this final metadata cleanup in the durable logs. |

Final focused verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the expected modified durable log
  files before commit.
- Targeted search for the stale Round 4 reviewer metadata phrase returned no
  matches.

## Final Re-check Basis

Final re-check should review `main...HEAD` after the focused final metadata
cleanup commit, then proceed to orchestrator integration if clean.

### Final-Final Focused Log-State Re-check

Reviewed basis: `main...HEAD` at
`92d470939288ac928a4f73aceee33c6797b1ebcf`.

Reviewer outcome:

- Final-final focused log-state re-check found one stale task integration-result
  line still referencing the focused round-5 current-state wording commit.

Final-final disposition:

| Finding                                                                                                                            | Roles                          | Disposition | Author response                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task integration result still referenced the focused round-5 current-state wording commit after the final metadata cleanup commit. | Documentation, maintainability | Fixed       | Updated the task integration result to reference the focused final metadata cleanup commit `92d470939288ac928a4f73aceee33c6797b1ebcf`; recorded this final-final line fix in durable logs. |

Final-final verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the expected modified durable log
  files before commit.
- Targeted search for the stale integration-result phrase returned no matches.

## Final-Final Re-check Basis

Final re-check should review `main...HEAD` after the focused final-final
integration-result wording commit, then proceed to orchestrator integration if
clean.

### Final Integration-Result Re-check

Reviewed basis: `main...HEAD` at
`605e325cfa45597250d33324f8d0033b79a76ef9`.

Reviewer outcome:

- Final integration-result re-check found that current-state metadata kept
  becoming stale because it named the previous focused cleanup commit. The work
  log current state still named `0f8dd65ae5fc5cc1944fc985bfc796267ad567ba`,
  while task/review top metadata still described the prior metadata-cleanup
  phase.

Final integration-result disposition:

| Finding                                                                                                | Roles                          | Disposition | Author response                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-state and top-level metadata used wording that became stale after each focused cleanup commit. | Documentation, maintainability | Fixed       | Replaced volatile prose with stable wording: latest focused log-state cleanup on this branch, final focused log-state re-check pending, and orchestrator integration if clean. Historical SHAs remain only in chronological evidence. |

Final integration-result verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the expected modified durable log
  files before commit.
- Targeted search found no prior cleanup SHAs or stale cleanup-phase phrases in
  top metadata, Current State, or Integration Result prose.

## Stable Final Re-check Basis

Final re-check should review `main...HEAD` after the stable log-state cleanup
commit, then proceed to orchestrator integration if clean.

### Stable Log-State Re-check

Reviewed basis: `main...HEAD` at
`269384bcea1eb745864734257b85dfcc78232aaf`.

Reviewer outcome:

- Stable log-state re-check found two remaining top metadata lines that still
  named prior focused cleanup SHAs: task `Round 5 reviewed basis` and work-log
  `Round 4 reviewed basis`.

Stable log-state disposition:

| Finding                                                                                           | Roles                          | Disposition | Author response                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top metadata still contained moving-basis reviewed commit SHAs from prior focused cleanup rounds. | Documentation, maintainability | Fixed       | Replaced those top metadata fields with stable focused re-check basis wording; exact prior SHAs remain only in chronological work-log and review-history entries. |

Stable log-state verification:

- Full `pnpm verify` is intentionally skipped because this pass changes only
  durable Markdown logs and does not affect package code, generated output, or
  build configuration.
- `git diff --check main...HEAD` exited 0.
- `git status --short --branch` showed only the expected modified durable log
  files before commit.
- Targeted search over top metadata, Current State, and Integration Result
  found no prior focused cleanup SHAs or stale cleanup-phase phrases.

## Stable Re-check Basis

Final re-check should review `main...HEAD` after the moving-basis top metadata
cleanup commit, then proceed to orchestrator integration if clean.

## Final Focused Re-check

Reviewed basis: `main...HEAD` after stable top-metadata cleanup.

Reviewer outcome:

- Final stable top-metadata re-check reported no remaining comments.

Final disposition:

| Finding                                                                                                                           | Roles                          | Disposition | Author response                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Top metadata, Current State, and Integration Result should not contain prior focused cleanup SHAs or stale cleanup-phase wording. | Documentation, maintainability | Clean       | Scoped metadata, Current State, and Integration Result contain stable wording; historical entries retain exact SHAs where appropriate. |

Final verification:

- `git diff --check main...HEAD` exited 0.
- Targeted stale metadata search returned no matches.
- `git status --short --branch` showed a clean branch before this closure-log
  update.

## Integration Review Closure

The reviewed branch was merged into `main` at integration commit `8c82646`.
The post-merge closure/config delta was reviewed by the five required focused
reviewer roles; all reported no comments:

- Code style/maintainability: `019f0e7b-54d4-7cd0-bc52-fd2d8df62228`.
- Documentation: `019f0e7b-7349-7bd0-9f1d-e17fa29f39e3`.
- TypeScript/API docs: `019f0e7b-8b64-7cb2-90aa-c84cb78e541e`.
- Security: `019f0e7b-a079-75c3-9e2d-1739118062c8`.
- Performance/reliability: `019f0e7b-b7e9-7c70-afad-24756c164f27`.

Post-merge verification is complete after pinning pnpm local virtual-store
behavior in workspace config. `CI=true corepack pnpm verify` passed on `main`.
