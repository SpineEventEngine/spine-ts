# T-0080C: Enforce authored example Proto quality

## Status

Complete.

## Parent And Dependency

- Parent: T-0080.
- Depends on: T-0080B.
- Exits to production remediation and Chat migration.

## Objective

Add deterministic source-provenance-aware checks for concise comments and
semantic names in authored example Proto files.

## Classification

Standard. This changes Proto quality tooling, not serialized contracts.

## Human-Imposed Requirements Ledger

- Every authored example Proto declaration and field is documented.
- Authored example Proto names have at most four semantic components, ideally
  three.
- Original copied Spine JVM Proto definitions and names remain unchanged.
- Generated output is regenerated and never hand-edited.
- Debt records are exact and temporary; narrow compatibility exceptions require
  a source-backed reason.
- No Spine JVM build is run.

## Ownership

- Authored-example Proto checker integration and focused tests.
- Source-provenance classification for authored versus copied/generated Proto.
- Partitioned exact Proto debt records.
- No example Proto or TypeScript remediation.

## Acceptance Criteria

1. The checker recursively discovers tracked `examples/**/proto/**/*.proto`,
   including nested Chat packages.
2. Authored/copy provenance comes from existing Proto workflow/manifests or an
   equally explicit recorded source contract. A path/name heuristic alone is
   insufficient.
3. It requires useful leading comments for authored messages, enums, enum
   values, services, RPCs, fields, and other named authored declaration forms
   used by the repository.
4. It rejects empty, placeholder, TODO-only, and mechanically copied comments
   that do not identify the represented concept.
5. It checks authored declaration and field names using the same four-component
   semantics as TypeScript, adapted deterministically for `snake_case` and
   Proto enum constants.
6. It never reports or authorizes a rename/comment rewrite for an original
   copied Spine JVM source.
7. Diagnostics are stable, escaped, source-path-confined, and identify the
   declaration independently of mutable line numbers.
8. Exact partitioned debt entries reject new, broadened, duplicate, malformed,
   and stale violations and remain writable by one example owner at a time.
9. `pnpm proto:lint` or the root lint path invokes the rule without requiring a
   Spine JVM build.

## Exclusions

- No authored Proto rename/comment remediation.
- No generated TypeScript edits.
- No change to wire behavior, field numbers, type URLs, or package names.
- No broadening of copied-source manifests.

## Verification And Review

- Focused Proto checker fixtures for nested packages, comments, names,
  provenance, stale debt, control paths, and copied Spine exclusions.
- Existing Proto workflow/verification tests, formatting, and
  `git diff --check`.
- Documentation and TypeScript/API-doc reviews: relevant to comment and
  serialized-contract policy.
- Style/maintainability: relevant to checker integration.
- Performance/reliability: N/A if source scanning remains bounded and no
  runtime/serialized contract changes.

## Implementation Assignment

- Existing role: implementer.
- Ownership: authored-example Proto checker integration/tests, explicit
  provenance classification, exact partitioned Proto debt, and T-0080C
  evidence only. No example Proto or generated TypeScript remediation.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.
- Implementation follows red-green-refactor; debt is generated only after the
  complete focused behavior is green.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and self-introspection limitation are accepted absent visible
  mismatch or fallback.

## Implementation Evidence

- The existing implementer was explicitly configured as `gpt-5.6-terra` with
  medium reasoning. Runtime model/reasoning self-introspection is unavailable
  on this surface; no visible fallback or mismatch appeared.
- Red fixtures first established the missing checker, then the missing nested
  example-root and map-field behavior. Focused green coverage checks comments,
  named forms, snake/enum semantics, copied provenance, exact debt failures,
  immutable baseline identity, workflow integration, and escaped diagnostics.
- `scripts/check-example-proto-quality.mjs` classifies each tracked example
  Proto only through its package manifest. Explicit copied entries require a
  pinned Spine upstream repository, 40-character commit, and confined upstream
  path; copied sources are excluded from authored comment/name enforcement.
- Exact migration debt is pinned to immutable pre-T-0080C baseline
  `b1a3dc7b1f21e4f7239014ea56f451941ef7addd`: K 32, L 34, M 117, N 54
  (237 total). New, malformed/broadened, duplicate, stale, and post-baseline
  entries fail; no operational baseline override exists.
- `pnpm proto:lint` invokes the check before descriptor compatibility. No
  example Proto, generated TypeScript, wire declaration, copied Spine source,
  or JVM build changed.

## Review Wave 1 Correction Evidence

- The correction remains in the explicitly configured existing implementer
  profile `gpt-5.6-terra` / medium; runtime self-introspection remains
  unavailable with no visible mismatch or fallback.
- Package manifests are now derived only from tracked Proto package roots.
  An untracked manifest cannot authorize a tracked Proto file.
- Immutable baseline reads use `git --no-replace-objects show` and cache parsed
  debt keys per pinned file. The focused regression creates a replacement ref
  only to prove it cannot authorize debt; no fixture relies on it for success.
- Chat-model and users-model debt belongs to T-0080J. Current exact partitions
  are J 32, K 0, L 34, M 117, N 54 (237 total), all pinned to
  `b1a3dc7b1f21e4f7239014ea56f451941ef7addd`.
- The checker now returns stable diagnostics for non-array copied-source lists,
  rejects absolute upstream paths, and rejects mechanical templates including
  `This is a field.`. The pure production-used debt validator explicitly tests
  malformed/broadened, duplicate, stale, and post-baseline records without a
  fixture baseline override. Focused tests, direct checker, Proto lint, tooling
  typecheck, ESLint, Prettier, diff check, and canonical lint pass.
