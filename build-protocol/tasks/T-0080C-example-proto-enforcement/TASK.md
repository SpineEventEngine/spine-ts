# T-0080C: Enforce authored example Proto quality

## Status

Planned.

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
