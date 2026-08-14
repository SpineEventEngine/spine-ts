# T-0186 Review Log

Status: Targeted residual findings accepted; correction in progress

Task: `build-protocol/tasks/T-0186-wave11-convergence/TASK.md`
Baseline: `f128af42`
Branch: `task/T-0186-wave11-convergence`

## Assignment Evidence

The implementation assignment uses the existing `implementer` role with
explicit `gpt-5.6-terra` / medium. Desktop runtime telemetry does not expose
independent child metadata; the immutable configured profile is the available
evidence.

Planned final concern-specific review wave:

- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  immutable `gpt-5.6-terra` / high;
- style/maintainability: existing `style_maintainability_reviewer`, immutable
  `gpt-5.6-terra` / high;
- performance/reliability: existing `performance_reliability_reviewer`,
  immutable `gpt-5.6-terra` / high;
- documentation: existing `documentation_reviewer`, immutable `gpt-5.6-luna` /
  medium;
- final security: existing `security_reviewer`, immutable `gpt-5.6-terra` /
  high.

Runtime metadata limitations and every reviewer disposition will be recorded
before acceptance. No review has started.

The targeted wave is now dispatch-ready with these bounded assignments:

- `typescript_api_docs_reviewer`, explicit immutable `gpt-5.6-terra` / high:
  public/generated TypeScript contracts, manifest v2 reader compatibility,
  declarations, exports, and API documentation;
- `style_maintainability_reviewer`, explicit immutable `gpt-5.6-terra` / high:
  changed production/test structure, duplicated policy, naming, and one
  canonical implementation per publication rule;
- `performance_reliability_reviewer`, explicit immutable `gpt-5.6-terra` /
  high: bounded tree traversal, generation-ID reuse, commit-point publication,
  rollback evidence, claim/retry cleanup, and replay lifecycle;
- `documentation_reviewer`, explicit immutable `gpt-5.6-luna` / medium:
  changed reader-facing publication, page-bounded drain, Inbox dedup/replay,
  generated provenance, and Wave scope claims.

Desktop does not expose independent child runtime telemetry. The immutable
configured roles/profiles and explicit dispatch fields are the acceptance
evidence unless a visible mismatch is reported. Reviewers must not spawn
subagents.

## Review Concerns

- public and generated API compatibility and provenance;
- one canonical implementation per policy and maintainable release wiring;
- publication atomicity, bounded resources, lifecycle, rollback, persistence,
  and replay;
- reader-facing accuracy and Wave status/navigation;
- final generated-input, path, supply-chain, and trust-boundary security review.

## Pending Evidence

- complete specialist findings and one accepted correction batch;
- targeted re-review dispositions;
- final security verdict;
- release and post-merge evidence.

## Pre-Review Convergence Evidence (2026-08-14)

- One-time generated-output audit (an inline command recorded in the task, not
  a permanent gate) initially found two unnoticed Todo generated interface
  declarations. The behavior RED and minimal normalizer correction are
  recorded in the work log. The rerun inventory covered `169` generated TS/d.ts
  files with `0` notice/provenance/copyright/unstable-path violations.
- The prohibited active-name scan found no `TaskReassignmentEvent`,
  `routeSemantic`, or `@Route` occurrences outside excluded records and test
  fixtures. Cloud Run/multiple-Gateway occurrences are explicit unsupported
  boundaries; no support claim was found.
- Focused release-publication transaction evidence is green: `5` proto-tools
  fixtures and `8` workflow fixtures covered semantic post-Buf validation,
  generated-tree rename, manifest failure and rollback, backup/journal
  recovery, generation claims, and cleanup.
- Cheap preflight with focused changed-source coverage passed at
  `a4ce5fa88b886e12003c9a6a9d0710c094d0a002`; no release profile was run.
- Pre-review records head `6a41476834bd459adf428bd1a09bdd415e16f4d5` is pushed
  and clean. Direct audience, copyright, API-documentation, owned-record
  formatting, and diff checks also pass.
- The previously inherited repository-format offenders were mechanically
  formatted in their named files only. Strict snippets and the Todo reader
  contract passed (`18` tests); the full `pnpm format:check`, diff check, and
  bounded no-coverage task preflight are green. This correction does not open
  a new specialist concern.
- No specialist reviewer was dispatched in this implementation pass. The
  configured reviewer profiles and desktop runtime-telemetry limitation remain
  the immutable assignment evidence until the orchestrator starts that wave.

## Accepted Correction Batch (2026-08-14)

The accepted findings are being corrected by the existing `implementer`,
explicit `gpt-5.6-terra` / medium. The copied requirements-splitter plan used
the existing `requirements_splitter`, explicit `gpt-5.6-sol` / high. Desktop
runtime telemetry exposes neither independent runtime profile; immutable
configured profiles are the available evidence.

Order: forged descriptor validation; manifest v2 generation IDs and
manifest-last publication; recovery evidence/aggregation; bounded symlink
traversal and declaration idempotency; then wording/records. Findings: API P1
forged tokens; reliability P1 commit point and recovery evidence plus P2
bounds/idempotency; style P2 long lines/stale log; documentation P1
commit-point/total-drain and P2 dedup/replay wording. No reviewer is dispatched
by this fix pass.

## Correction Evidence (2026-08-14)

- API P1 forged descriptor validation is covered by the focused core suite.
- Reliability P1/P2 coverage includes v2 manifest/marker reader rejection,
  manifest-last publication, retained recovery evidence, aggregate recovery
  failures, and bounded tree/declaration inventories. The live graph and
  compose fixtures now publish valid v2 dependency manifests and matching
  markers, so operational readers are exercised through `ProtoManifest.read`.
- Documentation/style corrections state the manifest commit point and retained
  rollback evidence without determinism overclaim; distinguish a bounded drain
  page from total backlog processing; and distinguish 30-second duplicate
  admission from replay retention. The duplicate stale `Next` entry was
  removed.
- No reviewer has been dispatched. Configured reviewer profiles and the desktop
  runtime-telemetry limitation above remain the available immutable evidence.

## Correction-Complete / Re-review-Ready (2026-08-14)

- Final implementation handoff remains the existing `implementer`, explicit
  `gpt-5.6-terra` / medium. Desktop does not expose independent child runtime
  telemetry; the configured profile is therefore the recorded acceptance
  evidence.
- The inherited fixture migration is converged: feedback-cycle/one-way tests
  use a separate Projection-family descriptor with compatible scalar identity,
  and catch-up uses generated `TaskCreated.taskListId` for its message-valued
  `TaskList` route. No Aggregate identity is used to stand in for a Projection.
- Fresh focused repository routing is clean: 244 tests passed, and
  `git diff --check` passed. The correction is ready for the planned relevant
  review wave after the remaining mechanical validation; no reviewer or final
  security reviewer has started in this pass.

## Marker-Policy Correction Evidence (2026-08-14)

- A clean checkout needs the v2 generation marker before source regeneration.
  The checker permits only that exact marker and retains failure for all other
  tracked generated output. Focused regression: 10 checker tests passed; the
  current-output gate passed after repeated generation. No reviewer was
  dispatched; this mechanical correction is re-review-ready.

## Coverage Closure Evidence (2026-08-14)

- Fresh workflow verification passed `77/77`; the fresh serial affected-source
  profile passed seven files and `379/379` tests.
- Exact changed-source coverage from retained LCOV is **150/154 executable
  lines (97.40%)** and **120/128 branches (93.75%)** across the nine changed
  production sources. The remaining misses are bounded CLI/defensive fallback
  paths, not omitted normal-transaction behavior.
- Coverage is mechanically converged. Specialist and security review remain
  undispatched pending the complete cheap preflight and its durable evidence.

## Preflight Reopened Correction (2026-08-14)

- Two unchanged canonical generations failed to reuse the root `packages/proto`
  generation ID while all four example model IDs remained stable. Publication
  stayed coherent and current-output/residue checks passed, but specialist
  review remains blocked until the root-only reuse defect is corrected.
- Bounded correction owner: existing `implementer`, explicitly dispatched as
  `gpt-5.6-terra` / medium, with root-cause investigation and behavior-first
  regression scope. Desktop runtime telemetry remains unavailable.

## Root Reuse Correction Evidence (2026-08-14)

- Disposition: corrected and targeted re-review ready. The existing
  `implementer` ran with explicitly configured `gpt-5.6-terra` / medium;
  Desktop exposes no independent runtime telemetry, so the immutable configured
  profile is the available acceptance evidence.
- The root stage omitted the existing `reuseStagedGenerationId()` handoff that
  model stages already use. The production root manifest and all `48` staged
  generated files were semantically identical; only this omitted handoff left
  the random staged ID to publish.
- Regression TDD observed RED (`root-staged` rather than `root-live`) then
  GREEN. The focused test passed `1/1`, full workflow passed `78/78`, two
  serial canonical generations retained identical all-five manifest/marker
  hashes and IDs, current-output passed, and no workflow residue remained.

## Tooling Fixture Correction Evidence (2026-08-14)

- Disposition: deterministic fixture correction complete; no production review
  concern reopened. The existing `implementer` used explicit
  `gpt-5.6-terra` / medium configuration; Desktop runtime telemetry is
  unavailable.
- Typecheck failures originated in stale test declarations: duplicate export
  key, obsolete scalar generic for `TaskList`, and a missing current
  `Task.taskListId` fixture property. Tooling typecheck passed; focused Proto
  Tools and repository routing suites passed `109/109` and `244/244`.

## Complete Pre-Review Mechanical Evidence (2026-08-14)

- Exact affected results: Core `57/57`; Proto Tools `109/109`; workflow
  `78/78`; normalizer `6/6`; generated-clean `10/10`; cleanup `109/109`;
  repository routing `244/244`; five routing/runtime `270/270`; Todo short
  contracts `17/17`; black-box `41/41`; local multi-process `19/19`.
- Two serial canonical generations retained byte-identical all-five IDs and
  all ten manifest/marker hashes. Current-output passed; residue was zero.
- Complete generated gates passed. Fresh changed-source coverage is **155/159
  executable lines (97.48%)** and **126/136 branches (92.65%)** from
  `/tmp/t0186-changed-source-coverage-pre-review/lcov.info`.
- One-time generated-family audit: `169` files, zero violations. Prohibited
  active names are absent and every Cloud Run/multiple-Gateway match is an
  explicit exclusion. Lightweight status/API/overclaim lint is clean.

## Complete Targeted Specialist Wave (2026-08-14)

Assignment acceptance gate: every dispatch used its existing role and explicit
model/reasoning fields. TypeScript/API, style, and reliability used immutable
`gpt-5.6-terra` / high; documentation used immutable `gpt-5.6-luna` / medium.
Every reviewer reported no visible mismatch. Desktop exposes no independent
runtime telemetry, so configured roles/profiles are the acceptance evidence.

Accepted and deduplicated findings:

1. **P1 reliability/style:** generation-ID reuse is duplicated and marker-blind
   in direct model/root paths. Establish one canonical internal marker-aware
   manifest/tree reuse policy and parity tests for missing, malformed, empty,
   and mismatched markers.
2. **P1 reliability:** direct generator tree comparison is unbounded and
   follows symlinks. Use bounded, symlink-rejecting traversal and cover depth,
   entry, and live/staged symlink cases.
3. **P1 reliability:** strict manifest readers do not perform bounded retry
   while a live generation claim exists. Add fail-closed bounded claim-aware
   retry and reader interleaving/exhaustion tests.
4. **P1 reliability:** wrapper cleanup removes journal-referenced stage
   evidence after rollback restoration fails. Preserve recovery-owned stages
   and prove primary/recovery errors, journal, backup, and staged evidence
   survive until later recovery.
5. **P2 TypeScript/API:** `generationMarkerFile` leaked as a public export while
   documentation calls the marker internal. Make it internal and remove it from
   public API inventory unless a stable public contract is deliberately added.
6. **P2 TypeScript/API:** `ProtoManifest.create()` claims determinism while its
   optional `generationId` defaults to `randomUUID()` and is undocumented.
   Correct declaration/implementation TSDoc or narrow the public parameter.
7. **P2 documentation:** remove the stale claim that exact-row replay occurs
   only during a 30-second retention window; replay follows Inbox delivery
   lifecycle independently of duplicate-admission expiry.

Disposition: all findings accepted. The style marker-policy finding is the same
underlying defect as finding 1 and receives one correction. No P0 was reported.
Corrections return as one batch to the existing implementer; TypeScript/API,
style, reliability, and documentation are all affected for targeted re-review.
Final security and release verification remain pending.

## Accepted Batch Correction Evidence (2026-08-14)

- Checkpoints `fc507d08`, `a246519d`, `1dc5dbfe`, `e71189bb`, `c1107a1d`,
  `8fc57c5c`, `df213200`, `10ce8a45`, and `660d35bf` correct the complete
  accepted batch. The first implementation context became unavailable before
  adversarial completion; the fresh existing implementer finished the bounded
  handoff. Both used explicit immutable `gpt-5.6-terra` / medium configuration;
  Desktop runtime telemetry is unavailable and no visible mismatch was
  reported.
- Canonical reuse parity now includes marker validity/coherence, manifest
  semantics, bounded depth/entries, and symlink rejection. Strict readers
  distinguish no/dead/live claims, yield for bounded interleaving, and fail
  closed after three attempts. Recovery tests retain aggregate errors, journal,
  backup, and stage evidence until a later successful recovery cleans them.
- Public/API/docs corrections internalize the marker filename, correct
  generation-ID TSDoc, and separate exact-row replay lifecycle from the
  30-second duplicate-admission window.
- Independent evidence: Proto Tools `127/127`, workflow `88/88`, tooling
  typecheck, affected ESLint, current-output, formatting/diff, and residue are
  clean. Final coverage is **181/186 lines (97.31%)** and **140/155 branches
  (90.32%)** using the retained serial correction LCOV plus the independent
  Proto Tools coverage report.
- Targeted re-review scope: TypeScript/API findings 5-6; style/canonical-policy
  finding 1; reliability findings 1-4 including reader retry and retained
  recovery evidence; documentation finding 7. Final security remains pending.

## Targeted Re-Review Wave (2026-08-14)

- TypeScript/API (`gpt-5.6-terra` / high): CLEAN. Marker filename is internal,
  factory TSDoc is accurate, and no API regression was introduced.
- Documentation (`gpt-5.6-luna` / medium): CLEAN. Replay lifecycle is
  independent of duplicate-admission expiry with no nearby contradiction.
- Style/maintainability (`gpt-5.6-terra` / high): remaining P2. Unused root
  `scripts/generation-reuse.{mjs,d.mts}` wrappers create a misleading second
  entrypoint after workflow imports the canonical Proto Tools implementation.
- Performance/reliability (`gpt-5.6-terra` / high): remaining P1 direct staged
  symlink publication; P1 Message Board registry stage deletion despite a
  retained journal; P2 unbounded package-root claim scan per retry attempt.
- All dispatches retained explicit configured profiles and reported no visible
  mismatch; Desktop runtime telemetry is unavailable. The four residual
  findings are accepted as one batch for the current implementer. Only style
  and reliability reopen after correction unless public/docs surfaces change.

## Residual Correction and Final Targeted Re-Review Assignment (2026-08-14)

- Checkpoints `9932c49c`, `dcc7ee55`, and `62464e92` delete the obsolete root
  wrappers, prove direct staged symlinks fail before publication, preserve and
  later recover journal-owned registry stages, bound claim scans at
  `1,000/1,001`, restore ordinary unowned-stage cleanup, and close the final
  public manifest-read branch without changing production behavior.
- Fresh affected evidence is Proto Tools `131/131`, workflow `88/88`, and
  generated-clean `10/10`; tooling typecheck, affected ESLint, current-output,
  formatting/diff, and residue checks are clean. The exact current
  changed-source union is **194/197 lines (98.48%)** and **153/169 branches
  (90.53%)**.
- Final targeted re-review is limited to the existing style/maintainability and
  performance/reliability roles. Both dispatches explicitly use immutable
  `gpt-5.6-terra` / high configuration. Desktop exposes no independent runtime
  telemetry, so the configured role/profile and absence of a visible mismatch
  are the acceptance evidence. TypeScript/API and documentation remain CLEAN
  because the residual correction changed no public or reader-facing surface.

## Final Targeted Re-Review Findings (2026-08-14)

- Style/maintainability (`gpt-5.6-terra` / high): P2. The `1,000` claim cap
  counts only regular files after filtering; arbitrarily many lock-named
  symlinks/directories can therefore make every retry scan unbounded. Count all
  candidate claim entries before file-kind filtering and cover non-regular
  overflow.
- Performance/reliability (`gpt-5.6-terra` / high): P1. A claim entry can be
  replaced between `Dirent.isFile()` and path-based `readFileSync()`, allowing
  symlink following or FIFO blocking. Open with no-follow/nonblocking flags,
  verify the opened descriptor is regular, and fail closed on unsafe/change
  races. P2: add wrapper-level MessageBoard primary-plus-recovery-failure proof
  that its journal-owned registry file stage survives only until later recovery.
- Both findings are accepted as one bounded batch for the existing implementer,
  explicitly configured `gpt-5.6-terra` / medium. Desktop exposes no independent
  runtime telemetry; the immutable configured role/profile is the assignment
  evidence. Re-review remains limited to style and reliability.

## Final Targeted Re-Review Correction Evidence (2026-08-14)

- The existing implementer, explicitly configured `gpt-5.6-terra` / medium,
  corrected both accepted findings. Desktop exposes no independent runtime
  telemetry; configured profile and no visible mismatch remain the acceptance
  evidence.
- Claim scan collection bounds all lock-named entries before candidate-kind
  validation. Each candidate is opened read-only with no-follow and nonblocking
  flags, fstat-validated as a regular descriptor, read through that descriptor,
  and closed. Public reader tests cover regular and symlinked `1,000/1,001`
  boundaries; the test-first `1,001` symlink case was RED before the ordering
  correction and is GREEN after it.
- The wrapper-level MessageBoard primary-and-recovery failure regression proves
  its registry file stage remains only while journal-owned, then later recovery
  removes it with the journal and restores the prior root output.
- Evidence: Proto Tools `133/133`; workflow `89/89`; generated-clean `10/10`;
  tooling typecheck, affected ESLint, Prettier/diff, current-output, cleanup,
  and residue checks pass. Style and reliability targeted re-review are ready.
- Independent complete-source V8 verification passed the six extant affected
  files and `404/404` tests. All ten changed production sources are present in
  LCOV; exact changed coverage is **201/204 lines (98.53%)** and **159/175
  branches (90.86%)**. The verification function used explicit
  `gpt-5.6-luna` / low configuration; Desktop runtime telemetry is unavailable.
- Final correction re-review is dispatched only to the existing style and
  performance/reliability roles, each with explicit immutable
  `gpt-5.6-terra` / high configuration. Desktop exposes no independent runtime
  telemetry; configured profiles and no visible mismatch are the acceptance
  gate.

## Converged Specialist Verdict and Final Security Assignment (2026-08-14)

- Style/maintainability: CLEAN. Candidate bounding, descriptor lifecycle,
  public behavior tests, MessageBoard ownership proof, and the single canonical
  reuse policy are clear and contain no dead wrapper or private test seam.
- Performance/reliability: CLEAN. The review confirms candidate and retry
  bounds, no-follow/nonblocking descriptor reads and closure, fail-closed
  special/replacement handling, journal-owned stage retention and later
  recovery, ordinary unowned cleanup, and publication path containment.
- The mandatory existing `security_reviewer` is dispatched with explicit
  immutable `gpt-5.6-terra` / high configuration. Scope is generated input and
  path containment, manifest/marker trust boundaries, claim/retry races and
  resource bounds, rollback/recovery evidence, and confirmation that Wave 11
  adds no network, authentication, authorization, or tenant boundary. Desktop
  exposes no independent runtime telemetry; the configured role/profile and
  no visible mismatch are the acceptance evidence.

## Final Security Review Findings (2026-08-14)

Final security verdict: BLOCK. The existing `security_reviewer` used explicit
`gpt-5.6-terra` / high configuration; Desktop exposes no independent runtime
telemetry, and no visible profile mismatch was reported.

1. **P1 claim protocol:** direct and workflow writer admission classify claim
   paths, then read them by path; release likewise reads/inspects/unlinks across
   mutable path operations. A symlink/FIFO replacement can escape or block the
   bounded protocol. Use no-follow/nonblocking descriptor validation and an
   ownership-safe release protocol with race regressions.
2. **P1 generated trees:** staged traversal rejects symlinks but permits other
   non-regular entries which can then be renamed live. Direct and workflow
   boundaries must reject every entry that is neither a regular file nor a
   directory, with FIFO/socket coverage and prior-tree preservation.
3. **P1 marker trust:** strict manifest readers open the coherent-commit marker
   by path without no-follow/regular-file validation. Require a contained,
   non-symlink regular marker and cover crafted/replaced marker paths.
4. **P2 schema resources:** `descriptorTreeIncludes()` spreads an
   attacker-controlled roots array before applying its bounds. Traverse bounded
   indexed own data properties without invoking arbitrary iterators or making
   an unbounded copy; cover huge/custom-iterator/proxy inputs.

The four findings are accepted as one correction batch for the existing
implementer, explicitly configured `gpt-5.6-terra` / medium. Reader-side claim
bounds/descriptors, v2 semantic mismatch rejection, journal allowlists and
retained evidence, network/auth/tenant scope, logging, dependencies, and
generated registry loading outside the marker gap are CLEAN. Security re-review
will cover only these four corrected trust boundaries.
## Final Security Correction Checkpoint (2026-08-14)

- Existing `implementer`, explicit `gpt-5.6-terra` / medium; Desktop exposes
  no independent runtime-profile telemetry. Test-first corrections address the
  accepted P2 descriptor iterator exposure and direct P1 staged FIFO exposure.
  The remaining accepted claim, marker, and workflow-tree findings are still
  in progress; final security verdict remains BLOCK pending re-review.
