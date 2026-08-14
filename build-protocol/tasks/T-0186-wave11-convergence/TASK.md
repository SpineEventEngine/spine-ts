# T-0186: Converge, Release, And Close Wave 11

Status: Security and cheap preflight CLEAN; release profile ready
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

## Package-Build Lifecycle Correction (2026-08-14)

- The clean root build previously omitted Proto Tools' authored
  `generation-reuse.mjs` runtime companion, leaving its package export broken
  until a manual prepack. The correction centralizes copying in the existing
  package copy script, calls it from the package build/prepack lifecycle, and
  invokes that lifecycle step from the root generated build.
- The package-bin regression first observed the missing companion after a
  clean generated build, then passed after the correction. Fresh full package,
  generated-gate, and release-readiness validation passed: full serial Proto
  Tools is `8` files / `199` tests and release readiness reports `82` package
  imports, `51` assets, and `378` links. This packaging-only lifecycle change
  adds no public TypeScript API; targeted API re-review is N/A because fresh
  package/export validation found no export-map or declaration change.

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

## Complete Specialist Wave And Accepted Batch (2026-08-14)

- TypeScript/API (`gpt-5.6-terra` / high): two P2 findings; style/
  maintainability (`gpt-5.6-terra` / high): one P2 finding, deduplicated into
  reliability P1; performance/reliability (`gpt-5.6-terra` / high): four P1
  findings; documentation (`gpt-5.6-luna` / medium): one P2 finding. All
  dispatch fields were explicit, reviewers reported no visible mismatch, and
  Desktop runtime telemetry remains unavailable.
- Accepted correction batch: canonical marker-aware ID reuse across direct and
  workflow/root paths; bounded symlink-rejecting direct tree comparison;
  bounded claim-aware reader retry; retained journal-owned stage evidence after
  rollback failure; remove the accidental public marker-filename export;
  correct/document `ProtoManifest.create()` generation-ID semantics; and remove
  the stale 30-second replay-retention claim.
- No P0 was reported. All four P1 and all three independent P2 concerns block
  convergence until correction and affected-lane re-review. Final security and
  `verify:release` remain unstarted.

## Specialist Correction Closure (2026-08-14)

- The complete accepted batch is corrected through `660d35bf`. Generation-ID
  reuse now uses one internal marker/manifest/bounded-tree policy across direct
  and workflow paths; direct traversal rejects symlinks and enforces exact
  depth/entry bounds; strict readers use bounded claim-aware retry; failed
  recovery retains journal-owned stage evidence until later recovery; the
  marker filename is internal; factory TSDoc is accurate; and replay wording is
  independent of the 30-second duplicate-admission window.
- Behavior proof covers marker parity, exact bounds, live/staged symlinks,
  no-claim/dead-claim/interleaving/exhaustion reads, aggregate primary/recovery
  failure evidence, and later successful cleanup. Full Proto Tools passes
  `127/127`; workflow passes `88/88`; affected static/current/residue checks are
  green.
- Independent final changed-source coverage is **181/186 executable lines
  (97.31%)** and **140/155 branches (90.32%)** across eleven production sources.
  All accepted P1/P2 findings are correction-complete; all four affected lanes
  require targeted re-review. Final security and `verify:release` remain
  unstarted.

## Targeted Re-Review Residual Batch (2026-08-14)

- TypeScript/API and documentation are CLEAN. Style reported one P2 unused
  duplicate root policy wrapper. Reliability reported two P1s and one P2:
  direct generation can still publish a staged symlink after reuse declines;
  Message Board registry stages are deleted while a retained journal can still
  reference them; and claim-aware reader scans lack a per-attempt entry cap.
- All four findings are accepted as one residual batch: delete the dead root
  wrappers; add direct pre-publication safe-tree rejection with prior-output
  preservation; retain Message Board registry stages through failed recovery
  and later cleanup; and bound claim scanning with overflow fail-closed proof.
  Style and reliability reopen after correction. API/docs remain CLEAN unless
  the residual corrections alter their surfaces. Security/release remain
  pending.

## Final Claim-Reader and Recovery Correction (2026-08-14)

- The existing `implementer` completed the accepted final targeted batch under
  explicit `gpt-5.6-terra` / medium configuration. Desktop exposes no
  independent runtime-profile telemetry; the immutable configured profile and
  no visible mismatch are the available evidence.
- Claim scans now first count every lock-named directory entry to the bounded
  `1,000` limit, then open each candidate with read-only, no-follow,
  nonblocking flags, verify its opened descriptor is regular, read that
  descriptor, and close it on every path. Public manifest-reader coverage
  proves regular and symlinked `1,000/1,001` bounds; unsafe claims fail closed.
- A wrapper-level MessageBoard transaction now proves a primary publication and
  recovery failure retains the journal-owned registry file stage, while later
  successful recovery restores the prior root output and removes the journal
  and registry stage. This correction changes no public API or documentation.
- Focused RED/GREEN evidence: the non-regular `1,001` regression first read a
  malformed manifest instead of enforcing the bound; after collection-before-
  validation it is green. Full Proto Tools is `133/133`, workflow `89/89`, and
  generated-clean `10/10`; tooling typecheck, affected ESLint, Prettier,
  diff, current-output, cleanup, and residue checks are green. Targeted
  style/reliability re-review is ready; security/release remain pending.

## Final Security Correction Checkpoint (2026-08-14)

## Final preflight mechanical correction (2026-08-14)

- Scope is limited to cleanup-policy conformance: wrap one Proto Tools fixture
  line, rename the bounded manifest-commit retry delay without changing its
  value or use, and record nine exact standalone-function necessities.
- This correction changes no runtime behavior, public/serialized contract, or
  test expectation. It therefore does not reopen the accepted specialist or
  final-security review dispositions; fresh mechanical validation is required
  before the pending release profile.

- The existing `implementer`, explicit `gpt-5.6-terra` / medium, began the
  accepted final security batch. Desktop independent runtime telemetry is
  unavailable. Test-first corrections now bound descriptor-root traversal
  without iterator invocation and reject direct staged FIFO entries before
  publication while preserving committed state. Claim-release, marker, and
  workflow-tree trust boundaries remain in progress.

## Security Marker Descriptor Checkpoint (2026-08-14)

- Strict marker reads are now descriptor-based and fail closed for a symlinked
  marker; focused RED/GREEN evidence is retained in the work log. Claim and
  workflow trust-boundary corrections remain in progress.

## Claim Protocol Security Correction (2026-08-14)

- The remaining claim P1 is corrected by the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium. The direct and workflow paths now move
  stale and owned claims atomically to a unique same-directory quarantine,
  validate only that quarantine by no-follow/nonblocking regular descriptor,
  and remove only the validated quarantine. Unsafe or replacement entries are
  retained as lock evidence.
- TDD evidence is direct Proto Tools `137/137` and workflow `93/93`; real FIFO
  admission and real symlink/FIFO release-replacement regressions are GREEN.
  Tooling typecheck is blocked by an untouched Core `TS18046` checkpoint defect;
  no unowned source was changed. The final security re-review remains pending.

## Claim Protocol Verification Update (2026-08-14)

- The independent Core correction resolved the temporary typecheck limitation
  without overlap. Fresh tooling typecheck and exact ESLint are GREEN; full
  Proto Tools is `137/137` and workflow is `93/93`. This claim correction is
  ready for final-security re-review.

## Final Security Closure (2026-08-14)

- The mandatory final security reviewer is CLEAN after the second-retirement
  claim correction. Direct and workflow replacement races pass at Proto Tools
  `138/138` and workflow `94/94`; all marker, special-file, reader-bound,
  recovery, logging, dependency, and no-network/auth/tenant lanes are CLEAN.
- Two platform limits are explicit and accepted: portable Node has no
  unlink-by-descriptor against a continuously hostile same-UID writer, and
  JavaScript cannot preempt a non-returning same-process Proxy trap without
  changing external structural descriptor semantics. The attainable controls
  use fresh same-directory retirement plus descriptor identity revalidation,
  and bounded indexed traversal with throwing traps failing closed.
- Specialist and security review are converged. Mandatory cheap preflight is
  next; `verify:release` has not run.

## Final Cheap Preflight Closure (2026-08-14)

- Package lifecycle checkpoint `c7e02d10` makes the canonical clean root build
  materialize the Proto Tools runtime companion; `verify:generated-gates` and
  release readiness now pass without manual prepack repair.
- Final behavior counts are Core `95/95`, Proto Tools `138/138`, workflow
  `94/94`, normalizer `6/6`, generated-clean `10/10`, cleanup `109/109`,
  repository routing `244/244`, routing/runtime `46/46`, Todo short `14/14`,
  black-box `41/41`, and local multi-process `19/19`.
- Two canonical generations retained all-five IDs and hashes; generated/tooling
  typechecks, ESLint, cleanup, TSDoc, copyright, format, docs API/audience/
  snippets, Proto lint/current output, logging containment, release readiness,
  zero residue, and diff checks are GREEN. Exactly one `verify:release` is next.
