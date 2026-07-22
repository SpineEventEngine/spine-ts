# T-0053 Frozen Protobuf Intake Review

Status: Complete; all concerns closed and post-merge verified

Baseline: `2bdbc903`

## Required Concerns

- TypeScript/API: required for complete serialized compatibility, generated
  declarations, curated entrypoints, and negative export guarantees.
- Documentation: required for source provenance, supported public imports, and
  honest runtime exclusions.
- Style/maintainability: required because tooling and broad import migration are
  in scope.
- Performance/reliability: provisional N/A because this packet must not add a
  runtime execution path; confirm against the final diff with a concrete reason.
- Security: deferred to T-0067 unless the implementation introduces a security
  boundary outside copied contract/package exposure.

## Specialist Assignment Gate

- Existing role: `typescript_api_docs_reviewer`. Concern: complete serialized
  compatibility, generated/public declarations, curated entrypoints, and
  negative package-export guarantees. Explicit expected model/reasoning:
  `gpt-5.6-terra` / `high`.
- Existing role: `documentation_reviewer`. Concern: source provenance,
  supported public imports, descriptor guarantees, and honest runtime
  exclusions. Immutable configured model/reasoning: `gpt-5.6-luna` /
  `medium`.
- Existing role: `style_maintainability_reviewer`. Concern: descriptor and
  provenance tooling, mutation fixtures, generation integration, and broad
  import migration. Explicit expected model/reasoning: `gpt-5.6-terra` /
  `high`.
- All model and reasoning fields are explicit in dispatch. Reviewers are
  read-only, may not spawn children, and must report P0-P3 findings with exact
  evidence or `CLEAN`.
- Actual runtime metadata will be recorded when exposed. Otherwise the
  immutable configured role/profile and the metadata limitation are recorded
  honestly; missing self-introspection alone does not invalidate a result.
- The execution surface rejected passing `gpt-5.6-luna` as a redundant model
  override for `documentation_reviewer`; that existing role is itself
  immutably configured to `gpt-5.6-luna` / `medium` and cannot accept an
  override. The dispatch therefore names the fixed role directly, using its
  recorded immutable profile rather than inheriting the parent profile.

## Pre-review Mechanical Disposition

- Not ready for review: deterministic generation is blocked by a missing
  frozen transitive source (`spine/time_options.proto`).
- TypeScript/API, documentation, and style/maintainability remain pending; no
  public curated exports or generated declarations can be correctly reviewed.
- Performance/reliability remains N/A provisionally: the partial diff adds no
  runtime execution path.

## Pre-review Mechanical Evidence

- `pnpm --config.verify-deps-before-run=false typecheck`: passed.
- `pnpm --config.verify-deps-before-run=false lint:generated`: passed,
  including cleanup enforcement.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed;
  TypeDoc API verification found 100 expected root `@spine-ts/proto` exports.
- `pnpm --config.verify-deps-before-run=false proto:check-generated`: passed.
- `pnpm --config.verify-deps-before-run=false check:release-readiness`: passed
  (13 package imports; 120 relative Markdown links).
- `pnpm --config.verify-deps-before-run=false format:check` and
  `git diff --check`: passed.
- Focused descriptor and export fixtures pass. The descriptor verifier builds
  48 files and compares normalized output to the committed frozen digest while
  excluding only `source_code_info`.

## Current Dispositions

- TypeScript/API: P1. Public end-user guides still import blocked
  `@spine-ts/proto/generated/**` paths. The exact locations are
  `docs/USER_GUIDE.md` and `examples/todo/USER_GUIDE.md`; migrate Spine
  contract imports to `@spine-ts/proto/client` and re-run snippet/import
  checks.
- Documentation: P1 for the same stale guide imports plus the executable
  `examples/todo/scripts/smoke.mjs`; P2 because `proto/README.md` still calls
  the old 15-file root subset the current compileable closure instead of
  describing the 39-source/48-descriptor frozen closure. Re-review required
  after correction. Other package/API provenance, sole descriptor exclusion,
  curated-entrypoint, and runtime-exclusion claims are clean.
- Style/maintainability: P1. `scripts/verify-proto-sources.mjs` checks URL
  shape and commit but does not cross-check `repository` and `upstreamPath`
  against `sourceUrl` and `rawUrl`. Derive or compare exact canonical URLs and
  add repository/path mismatch rejection fixtures. No other style finding.
- Performance/reliability: N/A confirmed. The final reviewed diff adds no
  production runtime execution path: copied schemas and public export metadata
  are consumed at build time, while new logic is confined to generation and
  verification tooling, tests, and documentation.

## Review Runtime Metadata

- TypeScript/API: runtime self-introspection unavailable; immutable configured
  role/profile `typescript_api_docs_reviewer`, `gpt-5.6-terra` / `high`, with
  no visible fallback or mismatch.
- Documentation: runtime self-introspection unavailable; immutable configured
  role/profile `documentation_reviewer`, `gpt-5.6-luna` / `medium`, with no
  visible fallback or mismatch. The surface rejected a redundant model
  override and used the role's fixed profile directly.
- Style/maintainability: runtime self-introspection unavailable; immutable
  configured role/profile `style_maintainability_reviewer`,
  `gpt-5.6-terra` / `high`, with no visible fallback or mismatch.

## Consolidated Correction Assignment

- Existing role: `implementer`.
- Scope: only the two P1s and one P2 above, their RED/GREEN regressions,
  affected documentation/import checks, and task records.
- Explicit expected model/reasoning: `gpt-5.6-terra` / `medium`.
- Both fields must be explicit in dispatch. No child spawning, unrelated
  cleanup, acceptance weakening, commits, pushes, or merges.

## Consolidated Correction Result

- TypeScript/API P1 addressed: public guides and the executable Todo smoke
  module use `@spine-ts/proto/client`; the package regression suite scans those
  consumers and real module import succeeds.
- Documentation P1/P2 addressed: stale generated-subpath snippets are gone and
  the Proto intake guide accurately distinguishes 39 manifest sources, the
  curated root subset, and 48 compiled descriptors.
- Style/maintainability P1 addressed: provenance URLs are exact deterministic
  functions of repository, commit, and upstream path; RED/GREEN mismatch
  fixtures cover repository and path substitution.
- Affected re-review remains required for TypeScript/API, documentation, and
  style/maintainability. Performance/reliability remains N/A because the
  correction changes build verification, docs, tests, and an example import
  path without adding a production runtime behavior.
- Correction verification is clean: 4 focused files / 13 tests, smoke-module
  import, generation, typecheck, lint/cleanup, docs/API, generated-clean,
  release-readiness, formatting, and diff hygiene all pass. The packet is ready
  for affected-lane re-review.

## Affected-Lane Re-review Assignment

- TypeScript/API re-review: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`; scope is the corrected consumer imports, export
  resolution regression, and unchanged serialized/public-contract surface.
- Documentation re-review: existing immutable `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; scope is both corrected guides/smoke references,
  closure counts/terminology, and consistency of the previously clean claims.
- Style/maintainability re-review: existing
  `style_maintainability_reviewer`, explicit `gpt-5.6-terra` / `high`; scope is
  exact canonical provenance URL validation, its negative fixtures, and
  regression risk in the corrected tooling.
- Each lane is read-only and may not spawn children. Runtime metadata is
  recorded when exposed; otherwise the immutable profile and limitation apply
  exactly as in the initial review wave.

## Affected-Lane Re-review Result And Full-Gate Corrections

- TypeScript/API: CLEAN. All real consumers use supported root/client imports,
  exact four package exports resolve, private paths reject, and generated
  declarations agree. Runtime self-introspection was unavailable; accepted
  configured profile `typescript_api_docs_reviewer`, `gpt-5.6-terra` /
  `high`.
- Documentation: prior P1/P2 corrections are clean, but re-review found one
  additional P2 in `docs/api/README.md`: it says the generated TypeDoc
  reference contains the three new subpath modules although `typedoc.json`
  indexes only `packages/proto/src/index.ts`. Correct the wording to separate
  generated root-reference coverage from supported package imports, then run a
  focused documentation confirmation. Runtime self-introspection unavailable;
  accepted immutable `documentation_reviewer`, `gpt-5.6-luna` / `medium`.
- Style/maintainability: prior provenance P1 is clean; re-review found one P3
  stale diagnostic saying a path escapes `proto/spine` after the verifier root
  expanded to `proto`. Correct the diagnostic and focused test if applicable,
  then run focused style confirmation. Runtime self-introspection unavailable;
  accepted configured `style_maintainability_reviewer`,
  `gpt-5.6-terra` / `high`.
- Full verification reached the ordinary Vitest run and failed three stale
  pre-task assertions: manifest length 25 instead of 39, generated wildcard
  package metadata, and the old curated root symbol inventory. Update those
  deterministic expectations to the reviewed T-0053 contracts. The run passed
  1,907 tests, skipped 21, and also reproduced the previously known late
  Connect cancellation from the project-management load-runner test; rerun
  after deterministic corrections and classify separately if it recurs.
- Final correction owner: existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`; scope is only these two re-review findings, three
  stale assertions, focused RED/GREEN evidence, records, and verification.
  Child spawning, unrelated cleanup, commits, pushes, and merges are
  prohibited.

## Second Full-Gate Proto-Lint Correction

- The corrected ordinary and coverage suites each passed 84 files / 1,910
  tests, with 3 files / 21 tests skipped; coverage remained above repository
  thresholds. The prior Connect cancellation did not recur.
- The run then failed only at Buf lint because the exact frozen upstream
  closure intentionally violates four STANDARD conventions:
  `SERVICE_SUFFIX`, `PACKAGE_DIRECTORY_MATCH`, `PACKAGE_SAME_DIRECTORY`, and
  `PACKAGE_SAME_JAVA_MULTIPLE_FILES`. Editing the copied contracts would
  violate source fidelity.
- Correction owner: existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`. Scope is narrow documented `buf.yaml` exceptions
  for only those four upstream conventions, Proto lint/full-gate evidence, and
  records. No copied Proto edits, other lint weakening, child spawning,
  unrelated cleanup, commits, pushes, or merges.
- Focused style confirmation found P1: placing those four rules in global
  `lint.except` disables them for authored example modules too. Replace only
  the four new global entries with `ignore_only` paths scoped to the exact
  manifest-pinned frozen files that exhibit each violation. Preserve the
  existing historical exceptions, copied sources, and all other lint rules.
- Final scoped correction owner remains the existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`; focused lint/config evidence, records, and style
  confirmation are required before the final full rerun.

## Final Correction Result

- Documentation P2 addressed: the guide distinguishes the generated TypeDoc
  root reference from the three supported package subpaths and does not call
  those subpaths TypeDoc entrypoints.
- Style P3 addressed: the resolved-path diagnostic names the actual `proto`
  validation root.
- Full-gate deterministic expectations addressed: 39 manifest sources, 78
  exact reviewed root runtime exports, and exactly four curated package export
  entries. Focused RED reproduced all three old assertions; GREEN passes 4
  files / 17 tests.
- Typecheck, lint/cleanup, docs/API, format, and diff hygiene pass. Affected-lane
  confirmation and the orchestrator's next full verification remain outside
  this correction owner.

## Path-scoped Buf Lint Correction

- Focused style confirmation rejected the four new global `lint.except`
  entries as P1 because they disabled the same STANDARD rules for authored
  example modules. That finding invalidated the proposed compatibility fix and
  stopped the full verification sequence before integration.
- The four global entries were replaced with Buf v2 `lint.ignore_only`
  mappings. Local Buf behavior established that this multi-module workspace
  requires workspace-relative paths. Each mapping now names only the exact
  frozen upstream file or files that exhibit its rule violation; copied Proto
  sources, historical exceptions, and all other lint rules are unchanged.
- A focused behavioral fixture uses the repository `buf.yaml` in a temporary
  four-module workspace. It confirms that `SERVICE_SUFFIX`,
  `PACKAGE_DIRECTORY_MATCH`, `PACKAGE_SAME_DIRECTORY`, and
  `PACKAGE_SAME_JAVA_MULTIPLE_FILES` are still reported for authored Todo
  sources while the exact frozen health path remains ignored.
- GREEN: `proto:lint` verifies 39 source checksums and the normalized 48-file
  descriptor digest. Workflow/provenance/descriptor coverage passes 3 files /
  18 tests; format and diff hygiene pass. Focused style re-review and the
  orchestrator's fresh full verification remain required.
- Runtime self-introspection remained unavailable. The correction dispatch
  explicitly used existing `implementer`, `gpt-5.6-terra` / `medium`; no
  visible fallback or mismatch occurred.

## Second Full-gate Correction Result

- Full ordinary and coverage suites passed 84 files / 1,910 tests; 3 files / 21
  tests were skipped. Coverage thresholds and docs passed, and the prior Connect
  cancellation did not recur.
- `proto:lint` then failed only on exact frozen upstream service suffix,
  package-directory, package-same-directory, and Java multiple-files
  conventions. The four corresponding narrow exceptions were added beside the
  existing documented upstream exceptions; no copied Proto or other lint rule
  changed.
- `proto:lint` now passes with 39-source and 48-descriptor verification;
  workflow/provenance/descriptor tests pass 3 files / 17 tests. The orchestrator
  will run final full verification.

## Final Accepted Dispositions

- TypeScript/API: CLEAN after correction and re-review. Serialized descriptor
  fidelity, generated declarations, exact curated exports, private-path
  rejection, and repository consumers are accepted.
- Documentation: CLEAN after correction and re-review. Provenance, the
  39-source/48-descriptor distinction, supported imports, TypeDoc root-only
  coverage, sole `source_code_info` normalization exclusion, and runtime
  exclusions are accurate.
- Style/maintainability: CLEAN after correction and final focused re-review.
  Canonical URL validation, mutation fixtures, workflow integration, and exact
  path-scoped Buf exceptions are maintainable; authored modules retain all
  four lint rules.
- Performance/reliability: N/A. No production runtime execution path is added;
  the packet changes immutable schemas, package export metadata, build-time
  tooling, tests, import paths, and documentation.
- Security: no task-local network/runtime boundary was introduced; final Wave
  1 security review remains T-0067.
- Final full verification passed 84 files / 1,911 tests twice, coverage at
  94.45% statements and 90.14% branches, TypeDoc/API, scoped Proto lint,
  generated cleanliness, release readiness, formatting, and diff hygiene.

## Post-merge Correction Review Gate

- Post-merge tracked-file cleanup exposed a package-layout and test-line-length
  correction after merge `4e3a68a9`; the prior endpoint is not durably closed.
- Implementation owner: existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`.
- TypeScript/API re-review is required for unchanged public subpath resolution
  after moving internal entrypoint files. Style/maintainability re-review is
  required for directory depth, line-length compliance, and cleanup-rule
  coverage. Documentation is N/A if no claim changes; reliability remains N/A
  because no runtime behavior changes.
- Expected re-review profiles: existing `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / `high`; existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / `high`. All fields must be
  explicit in dispatch; reviewers are read-only and may not spawn children.

## Post-merge Correction Implementation Evidence

- The three non-root implementation files now use semantic directories; package
  exports preserve exactly `.`, `./client`, `./delivery`, and
  `./delivery-server` while their private dist targets move to each directory's
  `index` output.
- Focused entrypoint resolution passes for all supported imports and continues
  to reject private paths after a clean TypeScript build. Descriptor mutation
  coverage remains behaviorally identical, with all source lines at or below
  120 characters.
- Mechanical GREEN: tracked-file cleanup, focused 3-file / 7-test suite,
  generated typecheck, lint, formatting, and diff hygiene all pass.
- Runtime metadata is not exposed; the correction assignment explicitly used
  existing `implementer`, `gpt-5.6-terra` / `medium`, with no visible fallback
  or mismatch. TypeScript/API and style/maintainability re-review remain
  required. Documentation and performance/reliability are N/A for the concrete
  no-claim-change and no-runtime-path reasons recorded above.

## Post-merge Correction Final Dispositions

- TypeScript/API: CLEAN. Internal source/dist paths moved to semantic
  directories while exact public specifiers, exported symbols, declarations,
  and private-path rejection remain unchanged.
- Style/maintainability: CLEAN. Tracked cleanup, semantic source layout,
  120-character enforcement, and unchanged descriptor mutation coverage are
  accepted.
- Documentation: N/A for the correction because no end-user claim changed.
  Performance/reliability: N/A because no production runtime behavior changed.
- Reviewer runtime introspection was unavailable; the explicitly dispatched
  immutable API and style reviewer profiles were both
  `gpt-5.6-terra` / `high`, with no visible fallback or mismatch.
- Final staged full verification passed 84 files / 1,911 tests twice, coverage
  at 94.45% statements and 90.14% branches, TypeDoc/API, tracked cleanup,
  scoped Proto lint, generated cleanliness, release readiness, formatting, and
  diff hygiene.
- Final post-merge verification on tracked `main` at merge `7db798dc` passed
  the same full gate. All task and correction commits/merges are pushed.
