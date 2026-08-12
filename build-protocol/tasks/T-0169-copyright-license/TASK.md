# T-0169: Copyright, License, And Deterministic Enforcement

Status: Specialist review complete and clean; release verification pending

## Objective

Converge Spine TS licensing without changing runtime behavior: add the canonical
Apache 2.0 root license, declare Apache-2.0 on every publishable framework
package, place the approved 2026 CodeMatters header on every eligible authored
TypeScript, TSX, and Proto source, and enforce the contract deterministically.

## Classification

High-risk shared tooling and mechanical repository migration. The checker
changes root validation gates and the migration touches 531 authored sources.

## Frozen Acceptance Criteria

1. `LICENSE` is byte-for-byte equal to the current `core-jvm/LICENSE`.
2. All 18 publishable `packages/*/package.json` manifests declare
   `"license": "Apache-2.0"`; the root private workspace and private examples
   are not misclassified as publishable packages.
3. Exactly the approved CodeMatters Apache 2.0 header with year 2026 appears on
   the 490 eligible tracked TS files, 12 TSX files, and 29 authored Proto files.
4. The three executable TypeScript entry points place the header immediately
   after their shebang. Other TS/TSX sources place it at byte zero; Proto places
   it before `syntax`.
5. The 43 upstream Proto paths from `spine-sources.json.sources` retain their
   non-CodeMatters notices and reject the CodeMatters header. Eligibility comes
   only from the canonical provenance manifest, including its four
   `ownedSources`; no directory-prefix guess is allowed.
6. `pnpm lint:copyright` enumerates tracked and non-ignored untracked eligible
   files through Git and fails closed when enumeration fails. Diagnostics are
   sorted, path-specific, and distinguish missing, malformed, misplaced,
   stale-year, and forbidden headers.
7. During the 2026 migration the exact 2026 header is accepted. In future
   years, a new file or content change outside the recognized header requires
   the current year. Header-only changes and content-identical renames do not.
8. Rename handling uses Git rename detection and a read-only fallback for an
   unstaged untracked destination matched against deleted merge-base files.
   Exactly one header-normalized match is accepted; ambiguity fails closed.
9. Deterministic fixtures cover TS/TSX/Proto, shebang placement, upstream
   exclusion, all diagnostic classes, staged/unstaged/untracked work, future
   years, content changes, header-only edits, both rename forms, ambiguity, and
   fail-closed Git behavior. Time, base lookup, and enumeration are injectable.
10. The checker runs from `pnpm lint`, `verify:task`, and `verify:release`, but
    not from plain builds, startup, Proto generation, or individual Vitest.
    The future publication preflight requirement is recorded without inventing
    a publisher.
11. Package-metadata tests prove the complete framework package SPDX set and
    the private-example exclusion.
12. The four changed authored-Proto checksums are updated through the canonical
    workflow. Frozen descriptor regeneration proves the normalized descriptor
    digest is unchanged.
13. TDD is mandatory for checker behavior. The three fixed pushed checkpoints
    are: unwired checker plus adversarial fixtures; license/manifests/531-file
    migration; checksum/digest proof plus final gate wiring and convergence.
14. No reader-facing Markdown, docs-snippet checker, runtime behavior, upstream
    remote, or package registry is changed.

## Ownership

The single implementation owner controls `LICENSE`, the root copyright-only
package-script/gate wiring, all 18 framework manifests, all 531 eligible source
headers, the four owned-source checksum entries, the copyright checker and its
fixtures, package-metadata tests, verifier wiring/tests, and this task's records.
The owner also narrowly owns `scripts/proto-workflow.mjs` and its focused tests
solely to preserve the exact header on its one tracked generated registry:
without this integration correction `pnpm proto:generate && pnpm lint:copyright`
would remove the required notice and fail deterministically.

## Implementation Assignment

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Dispatch fields must be explicit. Runtime metadata is recorded if exposed;
  otherwise the immutable configured role/profile and limitation are evidence.
- The owner must not spawn subagents and must preserve unrelated changes.

## Verification And Review

Run deterministic checker fixtures and the live 531/43 inventory, package
metadata tests, canonical Proto checksum/descriptor checks, focused lint and
format checks, then cheap preflight. After convergence, invoke the relevant
style/maintainability and documentation/license reviews. TypeScript/API,
performance/reliability, and security are N/A unless implementation expands
their surfaces. Run `pnpm verify:release` once after review convergence.
