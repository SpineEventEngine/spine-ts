# T-0080I Chat Family Migration Review

## Review Endpoint

- Immutable committed base:
  `f13de2485e0fc51c31aea24d27056df498f68406`.
- Review endpoint: the complete uncommitted T-0080I worktree diff against that
  base. The task cannot be committed until the required review gate passes.
- Scope: the four Git-aware Chat-family moves, move-driven package/config/path
  changes, exact debt-path migration, the new family README, and focused
  migration regression.

## Required Concerns

- Style/maintainability: relevant to workspace and module structure.
- TypeScript/API documentation: relevant to package coordinates, Proto import
  topology, generated mappings, and public example entry points.
- Documentation: relevant to the foundational Chat family README and accurate
  commands, topology, and limitations.
- Performance/reliability: N/A unless the move changes runtime topology,
  lifecycle, or delivery behavior; a path-only move with unchanged behavior
  receives a concrete N/A disposition.

## Runtime Metadata Policy

Every reviewer dispatch records the existing role and configured model/reasoning
profile. Runtime metadata is recorded when exposed; otherwise the immutable
configured role/profile and self-introspection limitation are accepted unless a
visible mismatch or fallback appears.

## Pre-Review Verification

- The focused migration/workflow/Proto suite passes: 4 files, 75 tests.
- Clean model generation, authored Proto quality, descriptors, Buf generation,
  and generated-output cleanliness pass.
- `tsc -b` passes for Chat users-model, model, app, and web.
- Chat runtime tests pass: 5 files, 58 tests.
- The lightweight browser runner and harness lifecycle tests pass: 5 tests.
- The real local Envoy/native-gateway topology test passes: 1 test.
- The browser fixture passes in Chromium, Firefox, and WebKit: 3 tests.
- Documentation snippets, cleanup rules, TSDoc enforcement, scoped configured
  TypeScript/JavaScript lint, formatting, the migration regression, and
  `git diff --check` pass.
- No Spine JVM build or launch ran.

Two environment/tooling limitations are explicit. A clean dependency relink
cannot finish under the current registry policy because uncached workspace
metadata requires network access; verification instead used the recovered
workspace store plus public-only temporary dependencies. Also, the root ESLint
configuration did not lint `.tsx` before this path-only migration and still
does not; broadening that semantic tooling boundary belongs to the later
T-0080 remediation rather than this move-only slice.

## Review Assignments

### Style And Maintainability

- Existing role: style/maintainability reviewer.
- Concern: package/workspace structure, bounded nested discovery, path
  maintainability, history-preserving moves, and absence of unrelated semantic
  remediation.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: high.
- Both fields must be explicit in dispatch.

### TypeScript And API Documentation

- Existing role: TypeScript/API documentation reviewer.
- Concern: package coordinates, TypeScript project/discovery paths, Proto
  import topology, generated mappings, and public Chat entry points.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: high.
- Both fields must be explicit in dispatch.

### Documentation

- Existing role: documentation reviewer.
- Concern: the foundational family README, commands, module boundaries,
  topology, authentication guidance, and stated delivery limitations.
- Immutable role profile: `gpt-5.6-luna` / medium.
- The role fixes its model and reasoning; dispatch records that profile
  explicitly in the prompt, while the surface does not accept redundant model
  overrides for this fixed role.

### Performance And Reliability

- Disposition: N/A.
- Reason: this slice performs a physical/package/path migration and explicitly
  changes no runtime, delivery, authentication, subscription, or lifecycle
  behavior. The unchanged runtime path is independently demonstrated by 58
  Chat tests, five lifecycle/browser-run tests, the real Envoy topology test,
  and all three Playwright engines.

## Review Wave 1

- Style/maintainability found one P1: Chat registry generation, freshness
  checking, publication-journal validation, and their fixtures still target the
  removed flat app root instead of `examples/chat/app`. All other assigned
  style concerns are clean.
- TypeScript/API documentation independently confirmed the same P1 and found no
  additional issue.
- Documentation found one high-priority accuracy issue and one low-priority
  wording issue: the app and family READMEs incorrectly describe the Users
  model as only transitive and omit its direct app dependency, while the family
  README also implies every module has a README.
- Performance/reliability remains N/A for the recorded no-behavior-change
  reason and independent runtime evidence.
- Runtime self-introspection was unavailable in all three review surfaces.
  Style and TypeScript/API ran with their immutable explicit
  `gpt-5.6-terra` / high dispatch profiles; documentation ran with its fixed
  `gpt-5.6-luna` / medium role profile. No mismatch or fallback was visible.
- One consolidated correction batch returns to the existing implementer:
  migrate the registry production/allowlist/fixture paths and correct both
  README dependency descriptions and the overbroad README reference. Focused
  workflow/generated-clean tests, the migration regression, documentation
  snippets, and `git diff --check` must pass before affected re-review.

## Correction Evidence And Re-Review Assignment

- Registry staging, freshness checking, publication-journal validation, and
  focused fixtures now consistently target `examples/chat/app`.
- The app and family READMEs now state the direct Users-model app dependency,
  distinguish it from transitive registry composition, and point only to the
  app/web READMEs that exist.
- Independent verification passes 63/63 focused workflow/generated-clean/
  migration tests, documentation snippets, authored Proto quality, and
  `git diff --check`. No generated artifacts appeared.
- Direct regeneration remains limited by the recovered install's absent
  `protoc-gen-es` binary; the same generation path passed before review, and
  the corrected staging/freshness behavior is directly exercised by the
  focused tests.
- Targeted style and TypeScript/API re-review use explicit
  `gpt-5.6-terra` / high dispatches. Targeted documentation re-review uses its
  fixed `gpt-5.6-luna` / medium role profile. Runtime metadata limitations are
  recorded again on completion.

## Acceptance

- Targeted style/maintainability re-review: CLEAN.
- Targeted TypeScript/API documentation re-review: CLEAN.
- Targeted documentation re-review: CLEAN.
- Performance/reliability: N/A with concrete no-behavior-change and runtime
  regression evidence.
- Reviewer runtime metadata remained unavailable; all immutable configured
  profiles matched the explicit assignments and no fallback was visible.
- Final change-sensitive verification passes the corrected 63-test suite, four
  Chat project builds, 57 Chat integration tests, scoped lint, formatting,
  documentation, Proto-quality, cleanup/TSDoc, and diff-integrity gates.
- T-0080I is accepted. The next milestone is T-0080D production foundations.

## Review Wave 1 Correction Evidence

- RED: move-corrected registry fixture expectations failed against the old
  staging root and publication-journal allowlist, proving that the removed flat
  app root was still used.
- GREEN: `stageChatRegistry()`, journal validation, and generated-clean/workflow
  fixtures now target `examples/chat/app`. Focused
  `proto-workflow`, `check-generated-clean`, and migration tests pass 63/63.
- The app README now states its direct dependencies/imports on both model
  packages while retaining the registry's transitive Users composition. The
  family README states the direct app edge and names only the app/web READMEs
  alongside the authoritative guide. `docs/check-typescript-snippets.mjs`
  passes.
- Generation and generated-clean regeneration were attempted but are blocked by
  the recovered environment's missing `protoc-gen-es` executable. Formatting
  and `git diff --check` pass; no generated output was edited or left tracked.
- The implementation assignment remains explicitly `gpt-5.6-terra` / medium.
  This surface exposes no runtime self-introspection metadata; no mismatch or
  fallback was visible.
