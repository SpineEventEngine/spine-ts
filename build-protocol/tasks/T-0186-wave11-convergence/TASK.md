# T-0186: Converge, Release, And Close Wave 11

Status: Correction complete; targeted specialist re-review ready
Start: `2026-08-14 WEST`
End: Pending
Baseline: `f128af42`
Branch: `task/T-0186-wave11-convergence`
Worktree: `.worktrees/T-0186-wave11-convergence`
Classification: High-risk release closure

Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` /
medium. Desktop runtime telemetry does not expose independent child model
metadata; the immutable configured role/profile is the available evidence.

## Objective

Converge the complete Wave 11 generated-interface and interface-routing train,
prove all release and publication invariants together, obtain the final
specialist and security dispositions, integrate, tag, post-merge verify, and
close the Wave.

## Required Inputs

- `AGENTS.md` and `build-protocol/BUILD_PROTOCOL.md`;
- `build-protocol/DECISION_LOG.md` D-0113;
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md`;
- integrated tags `T-0180` through `T-0185`, including `T-0184A`.

## Human-Imposed Requirements Ledger

1. Preserve the fresh frozen upstream `ts_type` contract and its provenance.
2. Preserve generated TypeScript notices and Proto provenance without any
   copyright header.
3. Preserve generated and authored interface validation, same-module recursive
   inheritance, staged compiler inputs, atomic publication, and rollback.
4. Preserve exact-schema then first registered matching interface token then
   replacement/default routing precedence for Command, Event, and state-update
   routing.
5. Preserve route-once admission and durable stored-target replay; catch-up is
   a separate intentional rebuild.
6. Preserve the To-Do create/assign/reassign/unassign proof and its rejection,
   zero/one/two-target, snapshot reset, and no-migration boundaries.
7. `TaskReassignmentEvent`, `routeSemantic`, `@Route`, generated copyright
   headers, absolute generated provenance, hidden multiple-Gateway behavior,
   and Cloud Run support remain absent.
8. Run the existing final security reviewer. No provisional Gateway API or
   Wave 12 implementation belongs in this milestone.

## Acceptance

- A deterministic repository audit classifies all prohibited-name and generated
  provenance results without adding a permanent broad scan to ordinary test
  runs.
- Every generated TypeScript family has one generated/do-not-edit notice,
  stable Proto provenance, and no copyright header or absolute temporary path.
- Publication failure coverage includes semantic validation after Buf,
  generated-tree rename, manifest publication, backup restoration failure,
  coherent generation-ID/commit-point reads, and stage/backup/claim cleanup.
- One complete relevant specialist review wave is collected; confirmed findings
  return as one correction batch and only affected lanes are re-reviewed.
- Every canonical review concern has a concrete CLEAN, accepted, or N/A
  disposition. The existing final security reviewer runs after convergence.
- Cheap preflight passes before one converged `pnpm verify:release`; repository
  branch coverage is at least 90%.
- The reviewed release commit is tagged `T-0186`, fast-forwarded to `origin/main`,
  post-merge verified, and Wave 11 status mirrors are closed.

## Pending Gates

- specialist and security review wave;
- correction/re-review if required;
- cheap preflight and one converged `verify:release`;
- integration, tag, post-merge verification, and cleanup.

## Coverage Closure Status (2026-08-14)

- Closed for implementation convergence. A fresh serial seven-suite V8 run
  passed `379/379` tests. Its retained LCOV, intersected with added executable
  points from `origin/main` through the current worktree, covers **150/154
  changed executable lines (97.40%)** and **120/128 changed branches (93.75%)**
  across all nine changed production sources. Exact per-source results and the
  bounded defensive misses are retained in the work log. No release or review
  gate has been started.

## Convergence Evidence (2026-08-14)

- The one-time audit command was an inline `node --input-type=module` inventory
  over the declared generated roots plus the generated registry and server
  fixture families, followed by `rg` excluding build records and test fixtures
  for prohibited active identifiers and deployment-support claims. It is
  recorded here only and was not added as a normal repository gate.
  - Initial output: `generatedFamilyFiles: 169`; exactly two violations:
    `examples/todo/dist/generated/interfaces/task-event.d.ts` and
    `task-assignment-event.d.ts`, both with `notices: 0` and no provenance.
  - Corrected output after the focused TDD fix:
    `{ "generatedFamilyFiles": 169, "violations": [] }`.
  - Active-source scan output for `TaskReassignmentEvent`, `routeSemantic`, and
    `@Route`: no matches. All Cloud Run/multiple-Gateway matches state the
    established unsupported/out-of-scope boundary; the durable binding source
    expressly says it does not coordinate multiple Gateway processes.
- RED: `pnpm exec vitest run scripts/normalize-generated-declarations.test.mjs
-t 'normalizes generated interface declarations with their Proto provenance'`
  failed as expected because the emitted interface declaration had no notice.
- GREEN: the same focused test passed after interface `.d.ts` paths joined the
  declaration normalizer inventory. `pnpm typecheck:build:generated` completed
  and the corrected generated-output audit was clean.
- Publication transaction fixtures passed: `5` focused proto-tools tests and
  `8` focused workflow tests. They cover post-Buf validation, generated-tree
  rename, manifest publication failures, recovery journal/backup behavior,
  generation claim cleanup, and rollback/fail-closed publication boundaries.
- Cheap preflight passed at correction commit `a4ce5fa88b886e12003c9a6a9d0710c094d0a002`:
  `pnpm verify:task -- --coverage scripts/normalize-generated-declarations.test.mjs
--source scripts/normalize-generated-declarations.mjs`. It includes the
  changed-source coverage inspection; `verify:release` was not run.
- Pre-review records head: `6a41476834bd459adf428bd1a09bdd415e16f4d5`, pushed
  to `origin/task/T-0186-wave11-convergence` with a clean worktree.
- The canonical formatter was then applied only to the three inherited
  formatting offenders: `examples/todo/REFERENCE.md`,
  `examples/todo/USER_GUIDE.md`, and
  `scripts/check-typescript-snippets.test.mjs`. The inspected diff is
  formatting-only. The wrapped runnable fence was rechecked by the focused
  reader contract and strict snippet checks (`18` tests passed), followed by
  repository-wide `pnpm format:check`, `git diff --check`, and
  `pnpm verify:task -- --no-coverage scripts/check-typescript-snippets.test.mjs`.
  All passed; no release profile or review was started.

## Accepted Review-Correction Plan (2026-08-14)

The existing requirements splitter supplied the accepted dependency-ordered
correction plan under its immutable configured `gpt-5.6-sol` / high profile.
Desktop telemetry exposes no independent runtime model/reasoning metadata; the
explicit role/profile is the available evidence. No implementation work is
delegated from this owner.

1. Harden `MessageInterfaces.define()` with descriptor-backed runtime
   self-consistency validation before nominal registration; preserve tuple
   typing, deduplication, freezing, and genuine Buf schemas without claiming
   JavaScript provenance security.
2. Upgrade manifests to v2 with opaque generation IDs and matching generated
   root markers. Install trees/markers before manifests, which remain the sole
   commit point; readers reject malformed, mixed, and v1 state.
3. Retain journal-owned recovery evidence and the primary failure when rollback
   fails; aggregate failures and recover on a subsequent safe run.
4. Bound generated-tree symlink traversal and preserve declaration
   normalization idempotency.
5. Correct affected wording/records and run strict documentation gates.

## Final Fixture-Convergence Handoff (2026-08-14)

- The prior implementation owner exhausted its context after migrating the
  fixture publication manifests. Final convergence remains owned by the
  existing `implementer`, configured explicitly as `gpt-5.6-terra` / medium;
  this Desktop surface does not expose independent runtime model telemetry.
- The checkpoint retains that migration and corrects its affected fixtures:
  the two state-subscription cases use a second descriptor-valid Projection
  state schema with the same scalar ID shape, and catch-up routes generated
  `TaskCreated.taskListId` to the compatible message-valued `TaskList` ID.
- Fresh focused evidence: `pnpm --config.verify-deps-before-run=false exec
vitest run packages/server/test/repository/repository-routing.test.ts` —
  244 passed; `git diff --check` — clean. Specialist/security review and
  `verify:release` remain unstarted.

## Clean-Checkout Marker Correction (2026-08-14)

- The sole tracked exception beneath a generated root is its v2 generation
  marker, required to validate a manifest in a clean checkout. The current
  generated-output check rejects all other tracked generated files. Focused
  checker evidence: 10 tests passed; committed-HEAD bootstrap and repeated
  generation/current-output validation were rerun.

## Root Generation-ID Reuse Correction (2026-08-14)

- The existing `implementer`, explicitly configured `gpt-5.6-terra` / medium,
  traced the root-only instability. Desktop exposes no independent runtime
  telemetry, so that immutable configured profile is the assignment evidence.
- Root cause: `reuseStagedGenerationId()` was invoked after every model stage,
  but never at the `packages/proto` root stage. A real staged diagnostic showed
  equal canonical root manifests and `48/48` equal generated files, leaving
  only the new staged UUID unreplaced.
- TDD RED: the new root normal-transaction test failed because it published
  `root-staged` where `root-live` was required. GREEN: root staging now invokes
  the existing fail-closed reuse gate after either root manifest producer.
  Focused regression passed `1/1`; the full workflow suite passed `78/78`.
- Two serial canonical `pnpm proto:generate` runs retained byte-identical
  hashes and IDs for all five manifest/marker pairs (root ID
  `32aa4024-1052-4da2-ae47-f2ec6b8b431d`); both retained the 47-source/52-
  descriptor digest. `pnpm proto:check-generated:current` passed and the
  stage/backup/claim/journal/lock residue scan was empty.

## Tooling Fixture Correction (2026-08-14)

- The existing `implementer`, explicitly configured `gpt-5.6-terra` / medium,
  corrected the deterministic tooling-typecheck batch without production
  changes. Desktop exposes no independent runtime telemetry; its immutable
  configured profile is the assignment evidence.
- The stale test declarations were a duplicate npm export, a string identity
  left on message-valued `TaskList`, and a local Todo `Task` shape missing its
  current `taskListId`. Tooling typecheck passed; direct suites passed Proto
  Tools `109/109` and repository routing `244/244`.

## Complete Cheap Preflight (2026-08-14)

- Affected suites are green: Core `57/57`, Proto Tools `109/109`, workflow
  `78/78`, normalizer `6/6`, generated-clean `10/10`, cleanup `109/109`,
  repository routing `244/244`, the five routing/runtime files `270/270`, Todo
  short contracts `17/17`, Todo black-box `41/41`, and Todo local
  multi-process `19/19`.
- Two serial canonical generations retained all five IDs and all ten
  manifest/marker SHA-256 hashes byte-for-byte. Root ID remains
  `32aa4024-1052-4da2-ae47-f2ec6b8b431d`; both runs passed 47 source checks and
  the 52-descriptor digest. Current-output passed and workflow residue was zero.
- `pnpm verify:generated-gates` passed generated/tooling typechecks, full
  ESLint, cleanup, TSDoc, copyright, formatting, API inventory, audience,
  snippets, generated Proto lint/current-output, logging containment, and
  release readiness. `git diff --check` is clean.
- The refreshed serial coverage suite passed `380/380`; exact changed-source
  coverage is **155/159 executable lines (97.48%)** and **126/136 branches
  (92.65%)** across all nine changed production sources.
- The one-time generated-family audit found exactly `169` files and zero
  notice/provenance/copyright/absolute-path violations. Prohibited active names
  are absent; all Cloud Run/multiple-Gateway matches are explicit exclusions.
  The lightweight pre-review status/API/overclaim pass found no new public
  export, duplicated policy source, or active behavioral overclaim.
